import {
  addTile, removeTile, raiseTile, tileAt, removeEntityAt, entityAt, describeAt,
  propsAt, removePropsAt, removeLastPropAt, removeDetailAt, thinDetail, tuneLandmarks,
} from './level.js';
import { PLACEABLES, PLACEABLE_BY_ID, placeableGroups, refusal } from './entities.js';
import {
  paletteGroups, chosen as palette, chosenMany, firstId, placeOne, scatterProps,
  paintOne, canStand, LIGHT_DEFAULTS, HEIGHT_DEFAULT, HEIGHTS,
} from './objects.js';
import { DETAIL_RANGE } from '../game/detail.js';

// What the editor can do to a board, as a list of tools.
//
// The point of this file is the shape of an entry, not the three entries in it.
// A tool is data - a name, an icon, what settings it exposes, and two or three
// small functions - so adding one is adding an object here and nothing else:
// main.js routes the pointer to whichever is active and never learns what any of
// them are, and the toolbar renders whatever settings it finds. The units,
// enemies, objects and pickups that come next are entries in this list.
//
// A tool never touches the scene. It changes the level through the mutators in
// level.js and returns how many hexes it changed; the caller rebuilds and stores.
// That is the whole contract, and it is what keeps "paint a hill" and "load a
// file" the same kind of operation as far as the rest of the editor is concerned.
//
//   id, name, group   what it is called and which heading it sits under
//   hint              one line, shown under the settings
//   color             the brush preview's colour, so the mode is visible
//   colorAt(ctx,hex)  a colour for this hex instead, when the tool has something
//                     to say about it - which is how a refusal is visible before
//                     the click rather than after it
//   icon              inline SVG, 16x16, currentColor
//   settings          [{ key, label, min, max, step }] for a number, or
//                     [{ key, label, groups }] for a choice - the toolbar builds
//                     whichever it finds. `when(s)` on a descriptor hides it
//                     while it means nothing, which is how one tool covers two
//                     workflows without becoming two tools
//   continuous        false for a tool that acts on the press only, not on the
//                     hexes a drag crosses afterwards
//   brush(ctx, hex)   the hexes the tool would affect, for preview and for use
//   paint(ctx, hexes) left press and drag; returns how many hexes changed, or
//                     throws with a sentence about why it did nothing
//   erase(ctx, hexes) the right button: the inverse of whatever this tool places,
//                     and nothing wider - taking a lamp back must not fell the
//                     tree beside it. Same contract as `paint`. The press only,
//                     because a right *drag* is the camera's rotate
//   select            true for a tool that picks rather than changes; main.js
//                     keeps the hex and nothing is handed to the tool
//   wheel(ctx, hexes, dir)  the wheel over the board; returns how many changed
//
// `ctx` is `{ level, envelope, s, step }` - the level being edited, the lattice
// of hexes that can be pointed at, this tool's own settings values, and how far
// into the current stroke this call is. `step` is 1 on the press and counts up
// while the button is held, which is what lets one tool tell a click from a drag:
// see the Props tool, where a press places one thing on purpose and a drag
// scatters.
//
// Every `paint` a continuous tool declares has to be *idempotent per hex*: the
// pointer reports every move, not every new hex, so a stroke calls the tool many
// times over the same tile. Tools that place a countable number therefore either
// count what is already there or act on the press only.

const HEX = 'M8 1.2 13.9 4.6 13.9 11.4 8 14.8 2.1 11.4 2.1 4.6Z';
const ARROW = 'M3.4 1.9 3.4 12.9 6.4 10.1 8.5 14.3 10.4 13.4 8.3 9.3 12.3 9.3Z';

export const TOOLS = [
  {
    id: 'select',
    name: 'Select',
    group: 'Edit',
    hint: 'Click to pick what is on a hex, drag to move it. Right-click takes it away.',
    color: 0xf0dcc0,
    icon: `<svg viewBox="0 0 16 16"><path d="${ARROW}" fill="currentColor"/></svg>`,

    // It places nothing, so it paints nothing: main.js sees `select` and keeps
    // the hex rather than handing it to a tool. What the tool *is* is the readout
    // in the panel, the right button - the same right button every other tool has,
    // so "point at the thing and get rid of it" needs no mode of its own - and the
    // drag, which carries whatever the press picked up.
    select: true,
    // Continuous so that main.js keeps calling while the button is held, which is
    // what the drag needs. Moving what has been picked up is handled there rather
    // than here, because what is selected is something the editor holds and not
    // something the level says. See `pick` and `carry` in main.js.
    continuous: true,

    brush: (ctx, hex) => (hex ? [hex] : []),
    // Warm where there is something to pick and cold where there is not, so the
    // arrow says whether a click will find anything before it is spent.
    colorAt: (ctx, hex) => (hex && describeAt(ctx.level, hex.q, hex.r) ? 0xf0dcc0 : 0x6d8195),
    erase: (ctx, hexes) => eraseTop(ctx, hexes),
  },

  {
    id: 'ground',
    name: 'Ground',
    group: 'Terrain',
    hint: 'Drag to draw ground. Right-click clears a hex.',
    color: 0x9fe8b0,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="currentColor" opacity="0.85"/></svg>`,
    settings: [{ key: 'radius', label: 'Brush', min: 1, max: 3 }],

    // Every hex under the brush, whether or not it is already board. Showing the
    // whole footprint rather than only the part that would change is what makes
    // a wide brush legible - a preview that shrinks as it crosses existing
    // ground reads as the tool losing its grip.
    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius),

    // `addTile` returns null for a hex that already has a tile, so dragging back
    // across ground you have just drawn changes nothing and costs nothing - no
    // duplicate, and no rebuild either, because the count comes back zero.
    paint: (ctx, hexes) => {
      let changed = 0;
      for (const h of hexes) if (addTile(ctx.level, h.q, h.r)) changed++;
      return changed;
    },

    erase: (ctx, hexes) => eraseTop(ctx, hexes),
  },

  {
    id: 'height',
    name: 'Height',
    group: 'Terrain',
    hint: 'Hover and scroll to raise or lower.',
    color: 0x9fd8ee,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.3" opacity="0.6"/><path d="M8 11.4V5.2M5.6 7.4 8 4.9l2.4 2.5" ` +
      `fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    settings: [
      { key: 'radius', label: 'Brush', min: 1, max: 3 },
      { key: 'step', label: 'Step', min: 1, max: 3 },
    ],

    // Only tiles: there is no height to change on a hex that is not board, and a
    // preview that offered one would be promising something.
    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius).filter(h => tileAt(ctx.level, h.q, h.r)),

    // The wheel, and deliberately not the click. Sculpting is a continuous
    // adjustment - up a bit, too far, back down - and the wheel is the one input
    // that does that without counting clicks. See the note in hex_picker.js about
    // how it is taken off the camera.
    wheel: (ctx, hexes, dir) => {
      let changed = 0;
      for (const h of hexes) {
        const was = tileAt(ctx.level, h.q, h.r)?.level ?? 0;
        if (raiseTile(ctx.level, h.q, h.r, dir * ctx.s.step) !== was) changed++;
      }
      return changed;
    },
  },

  {
    id: 'erase',
    name: 'Erase',
    group: 'Terrain',
    hint: 'Drag to clear hexes, a layer at a time.',
    color: 0xe8a09a,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.3" stroke-dasharray="2.4 2" opacity="0.75"/></svg>`,
    settings: [{ key: 'radius', label: 'Brush', min: 1, max: 3 }],

    // What would actually go, which for erase is the honest preview: hexes with
    // nothing on them are not shown, and neither is the King's - so a brush
    // dragged over him visibly parts around the one tile it may not take.
    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius).filter(h =>
      tileAt(ctx.level, h.q, h.r) && !isKing(ctx.level, h)),

    // The same layered removal every tool's right button does, with a brush on
    // it - which is the one thing the right button cannot have, because a right
    // drag is the camera's rotate. That is what this tool is still for.
    paint: (ctx, hexes) => eraseTop(ctx, hexes),
  },

  {
    id: 'place',
    name: 'Place',
    group: 'Forces',
    hint: 'Click to place, right-click to remove. The King moves rather than doubles.',
    color: 0xf0dcc0,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.2" opacity="0.5"/><circle cx="8" cy="6.6" r="1.9" fill="currentColor"/>` +
      `<path d="M4.6 12.4c0-2 1.5-3.3 3.4-3.3s3.4 1.3 3.4 3.3z" fill="currentColor"/></svg>`,

    // One hex, always, and no brush setting: a wide brush that dropped seven
    // bodies on seven hexes is not a thing anybody wants to undo. What this tool
    // has instead is *what* to place, which is the same kind of setting - a
    // choice rather than a number - and the toolbar renders it from the same
    // descriptor list.
    settings: [{ key: 'what', label: 'Place', groups: placeableGroups(), value: PLACEABLES[0].id }],

    // The press only. Dragging would smear a unit onto every hex the cursor
    // crossed, and the one entry where a drag would read correctly - the King,
    // who moves rather than multiplies - is not worth the other three being
    // wrong.
    continuous: false,

    brush: (ctx, hex) => (hex ? [hex] : []),

    // The refusal, before the click. Warm for a hex that will take it and red for
    // one that will not, so the tool answers while the cursor is moving instead
    // of after a click that did nothing.
    colorAt: (ctx, hex) => (refusal(ctx.level, chosen(ctx), hex) ? 0xe8a09a : 0xf0dcc0),

    paint: (ctx, hexes) => {
      const hex = hexes[0];
      const entry = chosen(ctx);
      const no = refusal(ctx.level, entry, hex);
      if (no) throw new Error(`Cannot place the ${entry.name} here - ${no}.`);
      return entry.put(ctx.level, hex) ? 1 : 0;
    },

    // Whoever is standing there, and nothing under them: a unit tool that took
    // the ground away with the unit would be two tools. The King is refused out
    // loud rather than ignored - a level with no player start cannot be opened,
    // and a click that silently does nothing reads as the tool being broken.
    erase: (ctx, hexes) => {
      const hex = hexes[0];
      if (entityAt(ctx.level, hex.q, hex.r)?.kind === 'king') {
        throw new Error('The King cannot be removed - place him somewhere else instead.');
      }
      return removeEntityAt(ctx.level, hex.q, hex.r) ? 1 : 0;
    },
  },

  // ---- The environment, in four categories ---------------------------------
  // The categories are the same four the prop types declare - see the note above
  // `PROP_TYPES` - and they are ordered here the way they are ordered there: from
  // the numerous and derived to the singular and placed. That ordering *is* the
  // workflow. Ground cover is painted by the hundred and never touched again; a
  // landmark is one decision with its own settings. What changes between these
  // four tools is how much control the author gets per object, and it goes up as
  // the object gets bigger and matters more.
  //
  // They are four entries in one list rather than four systems: they share the
  // brush, the palette control, the variation vocabulary and the level's own
  // mutators. The only thing each states for itself is what a press means.

  {
    id: 'detail',
    name: 'Terrain detail',
    group: 'Environment',
    hint: 'Drag to paint ground cover. Right-click thins it out.',
    color: 0x8fd8a8,
    icon: `<svg viewBox="0 0 16 16"><path d="M4 13.4c0-2.6.7-4.4 1.6-5.6M8 13.4C8 9.6 8.9 6.7 10 4.8` +
      `M12 13.4c0-2 .5-3.4 1.2-4.5M2.2 13.4h11.6" fill="none" stroke="currentColor" ` +
      `stroke-width="1.2" stroke-linecap="round"/></svg>`,

    // The whole vocabulary of a scatter, and every one of these numbers ends up
    // on the patch rather than on any tuft - which is what keeps a painted hex one
    // line in the file. `seed` is the one worth explaining: it does not add to
    // what is there, it redraws the tile, so nudging it and painting again is how
    // an author says "not like that, again".
    settings: [
      // Several at once, because ground cover is a *mixture* - grass with stones
      // through it is what ground looks like, and painting two passes to get it
      // means the two are laid out independently and stand in each other's way.
      // A hex holds one patch per set, so the sets a brush is holding are the
      // patches it leaves behind.
      {
        key: 'what', label: 'Detail', groups: paletteGroups('detail'),
        multi: true, value: [firstId('detail')],
      },
      { key: 'radius', label: 'Brush', min: 1, max: 4, value: 2 },
      { key: 'density', label: 'Density', min: 1, max: DETAIL_RANGE.density[1], value: 3 },
      { key: 'seed', label: 'Seed', min: DETAIL_RANGE.seed[0], max: DETAIL_RANGE.seed[1] },
      { key: 'size', label: 'Size vary', min: DETAIL_RANGE.size[0], max: DETAIL_RANGE.size[1], value: 2 },
      { key: 'spin', label: 'Turn', min: DETAIL_RANGE.spin[0], max: DETAIL_RANGE.spin[1], value: 2 },
    ],

    // Only the tiles that could take something, so the preview is the ground you
    // are about to paint rather than the circle the brush is.
    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius).filter(h => canStand(ctx.level, h)),

    // Painting a hex that is already painted *updates* its patch, so a drag back
    // over ground you have just done changes how thick it is instead of laying a
    // second scatter over the first - and reports nothing changed when the
    // settings match, which is what keeps a long stroke cheap.
    paint: (ctx, hexes) => {
      let changed = 0;
      for (const h of hexes) {
        for (const set of chosenMany('detail', ctx.s.what)) {
          changed += paintOne(ctx.level, set, h.q, h.r, ctx.s);
        }
      }
      return changed;
    },

    // Less of it, not none of it. There is no individual tuft to take away, so
    // the inverse of a density brush is a lower density - and pressing again gets
    // there in the end.
    erase: (ctx, hexes) => {
      let changed = 0;
      for (const h of hexes) changed += thinDetail(ctx.level, h.q, h.r);
      return changed;
    },
  },

  {
    id: 'props',
    name: 'Props',
    group: 'Environment',
    hint: 'A one-hex brush places one. Wider scatters. Right-click takes them back.',
    color: 0x9fe8b0,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.1" opacity="0.4"/><circle cx="5.4" cy="6.4" r="1.6" fill="currentColor"/>` +
      `<circle cx="10.6" cy="5.6" r="1.1" fill="currentColor"/>` +
      `<circle cx="8.4" cy="10.2" r="1.9" fill="currentColor"/></svg>`,

    // The brush radius is the mode, and the settings that only mean something to
    // a scatter disappear at radius 1. That is the one place this tool is two
    // workflows: a prop is worth placing on purpose *and* worth having a hundred
    // of, and a separate tool for each would be the same palette twice.
    settings: [
      { key: 'what', label: 'Prop', groups: paletteGroups('prop'), value: firstId('prop') },
      { key: 'radius', label: 'Brush', min: 1, max: 4 },
      { key: 'density', label: 'Density', min: 1, max: 4, value: 2, when: (s) => s.radius > 1 },
      { key: 'spacing', label: 'Spacing', min: 1, max: 4, value: 2, when: (s) => s.radius > 1 },
      { key: 'size', label: 'Size vary', min: 0, max: 3, value: 2 },
      { key: 'spin', label: 'Turn', min: 0, max: 2, value: 2 },
    ],

    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius).filter(h => canStand(ctx.level, h)),
    colorAt: (ctx, hex) => (canStand(ctx.level, hex) ? 0x9fe8b0 : 0xe8a09a),

    // A press with a one-hex brush is somebody placing a thing; anything else is
    // a scatter. `step` is how it can tell - see the note at the top of this file
    // - and it is also why the deliberate case cannot run on the drag: one press
    // has to mean one prop, and the pointer reports every move.
    paint: (ctx, hexes) => {
      const entryFor = entry(ctx, 'prop');
      if (ctx.s.radius === 1) {
        if (ctx.step > 1) return 0;
        const hex = hexes[0];
        if (!canStand(ctx.level, hex)) throw new Error('Props need a tile that is not water.');
        return placeOne(ctx.level, entryFor, hex.q, hex.r, ctx.s);
      }
      return scatterProps(ctx.level, entryFor, hexes, ctx.s);
    },

    // The inverse of whichever half just ran: one back off the tile under the
    // cursor, or the props off everything the brush covers. Only props - the tree
    // standing on the same tile is not this tool's business.
    erase: (ctx, hexes) => {
      if (ctx.s.radius === 1) return removeLastPropAt(ctx.level, hexes[0].q, hexes[0].r, 'prop');
      let gone = 0;
      for (const h of hexes) gone += removePropsAt(ctx.level, h.q, h.r, 'prop');
      return gone;
    },
  },

  {
    id: 'trees',
    name: 'Trees',
    group: 'Environment',
    hint: 'Click to plant one. Right-click fells the last. No brush, on purpose.',
    color: 0x86d69a,
    icon: `<svg viewBox="0 0 16 16"><path d="M8 14v-2.6" stroke="currentColor" ` +
      `stroke-width="1.3" stroke-linecap="round"/><path d="M8 1.8 12 8H4Z" fill="currentColor"/>` +
      `<path d="M8 6 11.4 11.6H4.6Z" fill="currentColor"/></svg>`,

    // No radius and no density, and that absence is the category. A tree is tall
    // enough to stand between the camera and a unit, so a board gets one wherever
    // somebody decided to put one - a brush that dropped nine would be a brush for
    // hiding the thing the player is trying to read. Specialised forest painting
    // can come later; it wants its own answer to that problem, not a wider brush.
    settings: [
      { key: 'what', label: 'Tree', groups: paletteGroups('tree'), value: firstId('tree') },
      // Modest: trees are the thing the eye measures the board against, and one
      // twice the size of its neighbour reads as being much closer.
      { key: 'size', label: 'Size vary', min: 0, max: 2, value: 1 },
      { key: 'spin', label: 'Turn', min: 0, max: 2, value: 2 },
    ],

    // One press, one tree. The preview is the brush overlay on the hex under the
    // cursor, in this tool's own colour, and red where it will refuse.
    continuous: false,

    brush: (ctx, hex) => (hex ? [hex] : []),
    colorAt: (ctx, hex) => (canStand(ctx.level, hex) ? 0x86d69a : 0xe8a09a),

    paint: (ctx, hexes) => {
      const hex = hexes[0];
      if (!canStand(ctx.level, hex)) throw new Error('A tree needs a tile that is not water.');
      return placeOne(ctx.level, entry(ctx, 'tree'), hex.q, hex.r, ctx.s);
    },

    erase: (ctx, hexes) => removeLastPropAt(ctx.level, hexes[0].q, hexes[0].r, 'tree'),
  },

  {
    id: 'landmarks',
    name: 'Landmarks',
    group: 'Environment',
    hint: 'Click to set one, again to re-tune it. Right-click takes it away.',
    color: 0xf0c88c,
    icon: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4" fill="currentColor"/>` +
      `<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.1" ` +
      `opacity="0.45"/></svg>`,

    // The one category with per-instance settings, because a landmark *is* its
    // settings: a lamp is a decision about how bright this corner of the board is.
    // The two light controls are the two a level places a light for - what colour
    // it is belongs to the hour and lives in mood.js - and they are hidden for a
    // landmark that carries no light, which the type says and this only reads.
    settings: [
      { key: 'what', label: 'Landmark', groups: paletteGroups('landmark'), value: firstId('landmark') },
      { key: 'height', label: 'Height', min: 1, max: HEIGHTS.length, value: HEIGHT_DEFAULT },
      {
        key: 'intensity', label: 'Bright', min: 2, max: 40, step: 2,
        value: LIGHT_DEFAULTS.intensity, when: (s) => lights(s),
      },
      {
        key: 'distance', label: 'Reach', min: 2, max: 18,
        value: LIGHT_DEFAULTS.distance, when: (s) => lights(s),
      },
    ],

    continuous: false,

    brush: (ctx, hex) => (hex ? [hex] : []),
    colorAt: (ctx, hex) => (canStand(ctx.level, hex) ? 0xf0c88c : 0xe8a09a),

    // One where one already stands is somebody adjusting *that* one, not asking
    // for a second on the same spot. It is the whole of "edit the thing that is
    // already there" in this pass, and for this category it is all that is
    // needed: the numbers are what a placed landmark is for.
    paint: (ctx, hexes) => {
      const hex = hexes[0];
      const it = entry(ctx, 'landmark');
      if (!canStand(ctx.level, hex)) throw new Error('A landmark needs a tile that is not water.');
      const light = it.lights
        ? { intensity: ctx.s.intensity, distance: ctx.s.distance }
        : null;
      const tuned = tuneLandmarks(ctx.level, hex.q, hex.r, it.variants[0],
        { light, scale: HEIGHTS[ctx.s.height - 1] });
      if (tuned) return tuned;
      if (propsAt(ctx.level, hex.q, hex.r, 'landmark').some(o => o.type === it.variants[0])) return 0;
      return placeOne(ctx.level, it, hex.q, hex.r, { light, height: ctx.s.height });
    },

    // The landmarks only. A hex holds a lantern and the tree beside it, and
    // putting the light out is not clearing the corner.
    erase: (ctx, hexes) => removeLastPropAt(ctx.level, hexes[0].q, hexes[0].r, 'landmark'),
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// The palette's headings, in order, taken from the tools themselves so a new
// group is a new `group` string and not a second list to keep in step.
export function toolGroups() {
  const groups = [];
  for (const tool of TOOLS) {
    let group = groups.find(g => g.name === tool.group);
    if (!group) groups.push(group = { name: tool.group, tools: [] });
    group.tools.push(tool);
  }
  return groups;
}

// Each tool's settings at their starting values. Held by the editor rather than
// on the tool, so a tool stays a description of itself and two editors could not
// end up sharing one brush size - which is also why a list-valued setting is
// copied rather than handed over: the descriptor is a description, and one that
// got edited in place would be the default drifting.
export function defaultSettings() {
  const out = {};
  for (const tool of TOOLS) {
    out[tool.id] = {};
    for (const s of tool.settings ?? []) {
      out[tool.id][s.key] = Array.isArray(s.value) ? [...s.value] : s.value ?? s.min;
    }
  }
  return out;
}

// The brush footprint: `radius` 1 is one hex, 2 is seven, 3 is nineteen. Bounded
// by the envelope, which is what stops a wide brush painting off into hexes
// nothing can reach.
function spread(ctx, hex, radius = 1) {
  if (!hex) return [];
  return [...ctx.envelope.hexesInRange(hex.q, hex.r, Math.max(0, radius - 1))];
}

// Take the top layer off a hex: the decoration on it, then whoever is standing on
// it, then the ground itself. One intention - "this goes" - and it is also the
// only order that keeps the level buildable, since nothing may be left standing
// in mid-air. Right-clicking a wood clears the wood; again clears the ground.
//
// The King is skipped rather than refused here: this runs under a brush as well
// as under one press, and a stroke that threw would abandon the rest of it.
function eraseTop(ctx, hexes) {
  let changed = 0;
  for (const h of hexes) {
    if (isKing(ctx.level, h)) continue;
    changed += removePropsAt(ctx.level, h.q, h.r)
      || removeDetailAt(ctx.level, h.q, h.r)
      || (removeEntityAt(ctx.level, h.q, h.r) ? 1 : 0)
      || (removeTile(ctx.level, h.q, h.r) ? 1 : 0);
  }
  return changed;
}

function isKing(level, hex) {
  return level.king.q === hex.q && level.king.r === hex.r;
}

// Which entry the Place tool is holding. A stored setting that no longer names
// anything - a saved choice from a version with one more unit in it - falls back
// to the first, rather than throwing while the mouse moves.
function chosen(ctx) {
  return PLACEABLE_BY_ID[ctx.s.what] ?? PLACEABLES[0];
}

// And which palette entry an environment tool is holding, out of its own
// category's palette. One helper for all four, because the entry shape is the
// same whether it names a grass set or one lantern - see editor/objects.js.
function entry(ctx, category) {
  return palette(category, ctx.s.what);
}

// Whether the landmark currently chosen carries a light, which is what decides
// whether the two light controls are on screen at all.
function lights(s) {
  return !!palette('landmark', s.what).lights;
}
