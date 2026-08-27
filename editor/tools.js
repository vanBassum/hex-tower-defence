import { addTile, removeTile, raiseTile, tileAt } from './level.js';

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
//   icon              inline SVG, 16x16, currentColor
//   settings          [{ key, label, min, max }] - the toolbar builds these
//   brush(ctx, hex)   the hexes the tool would affect, for preview and for use
//   paint(ctx, hexes) left press and drag; returns how many hexes changed
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

    paint: (ctx, hexes) => {
      let changed = 0;
      for (const h of hexes) {
        if (isKing(ctx.level, h)) continue;      // the brush already left him out
        if (removeTile(ctx.level, h.q, h.r)) changed++;
      }
      return changed;
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
