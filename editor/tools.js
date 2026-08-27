import { addTile, removeTile, raiseTile, tileAt, removeEntityAt } from './level.js';
import { PLACEABLES, PLACEABLE_BY_ID, placeableGroups, refusal } from './entities.js';

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
//   settings          [{ key, label, min, max }] for a number, or
//                     [{ key, label, groups }] for a choice - the toolbar builds
//                     whichever it finds
//   continuous        false for a tool that acts on the press only, not on the
//                     hexes a drag crosses afterwards
//   brush(ctx, hex)   the hexes the tool would affect, for preview and for use
//   paint(ctx, hexes) left press and drag; returns how many hexes changed, or
//                     throws with a sentence about why it did nothing
//   wheel(ctx, hexes, dir)  the wheel over the board; returns how many changed
//
// `ctx` is `{ level, envelope, s }` - the level being edited, the lattice of
// hexes that can be pointed at, and this tool's own settings values.

const HEX = 'M8 1.2 13.9 4.6 13.9 11.4 8 14.8 2.1 11.4 2.1 4.6Z';

export const TOOLS = [
  {
    id: 'ground',
    name: 'Ground',
    group: 'Terrain',
    hint: 'Drag to draw ground.',
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
    hint: 'Drag to remove ground.',
    color: 0xe8a09a,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.3" stroke-dasharray="2.4 2" opacity="0.75"/></svg>`,
    settings: [{ key: 'radius', label: 'Brush', min: 1, max: 3 }],

    // What would actually go, which for erase is the honest preview: hexes with
    // nothing on them are not shown, and neither is the King's - so a brush
    // dragged over him visibly parts around the one tile it may not take.
    brush: (ctx, hex) => spread(ctx, hex, ctx.s.radius).filter(h =>
      tileAt(ctx.level, h.q, h.r) && !isKing(ctx.level, h)),

    // Whatever is standing on the hex first, and the ground only once the hex is
    // clear. That is one tool rather than two because it is one intention -
    // "take this away" - and it is also the only order that keeps the level
    // buildable: nothing may be left standing in mid-air, which `removeTile`
    // enforces from its own side.
    paint: (ctx, hexes) => {
      let changed = 0;
      for (const h of hexes) {
        if (isKing(ctx.level, h)) continue;      // the brush already left him out
        if (removeEntityAt(ctx.level, h.q, h.r) || removeTile(ctx.level, h.q, h.r)) changed++;
      }
      return changed;
    },
  },

  {
    id: 'place',
    name: 'Place',
    group: 'Forces',
    hint: 'Click a hex to place. The King moves rather than doubles.',
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
// end up sharing one brush size.
export function defaultSettings() {
  const out = {};
  for (const tool of TOOLS) {
    out[tool.id] = {};
    for (const s of tool.settings ?? []) out[tool.id][s.key] = s.value ?? s.min;
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

function isKing(level, hex) {
  return level.king.q === hex.q && level.king.r === hex.r;
}

// Which entry the Place tool is holding. A stored setting that no longer names
// anything - a saved choice from a version with one more unit in it - falls back
// to the first, rather than throwing while the mouse moves.
function chosen(ctx) {
  return PLACEABLE_BY_ID[ctx.s.what] ?? PLACEABLES[0];
}
