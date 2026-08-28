import { PROP_TYPES, propTypesIn } from '../game/props.js';
import { UNIT_TYPES } from '../game/units.js';
import { hashHex } from '../engine/hex/hex_noise.js';
import { detailKinds, coverAt, variedScale, variedYaw } from '../game/detail.js';
import {
  TERRAIN, tileAt, paintTile, removeTile, raiseTile, isStandable,
  entityAt, removeEntityAt, moveKing, placeUnit, whyNot,
  propsAt, addProp, removePropsAt, tuneLandmarks,
  detailAt, paintDetail, thinDetail,
} from './level.js';

// WHAT is being edited, as opposed to HOW - which is a tool, and lives in
// tools.js. The two are independent on purpose, and this file is the half that
// makes that possible.
//
// ── The model ────────────────────────────────────────────────────────────────
// A tool is an *interaction*: one hex, a precise spot, an area, a pick. A content
// category is *what that interaction does to the level*. So there are five tools
// and seven categories and thirty-five combinations, and none of them is a
// special case written somewhere in the UI - each category implements the verbs
// it supports and says which tools it supports, and the editor asks.
//
// That is the whole point of the arrangement. Before it, every category had
// invented its own interaction - one tool for standing a tree, another for
// scattering scrub, a third for a lamp, each with its own brush, its own palette
// and its own idea of what the right button meant - and adding a category meant
// adding an interaction. Now adding a category is an entry in this list.
//
// ── The verbs ────────────────────────────────────────────────────────────────
// Every one of them takes `ctx` and returns how many things changed, so the
// editor can rebuild only when something did. `ctx` is:
//
//   { level, assets, s }
//
// `assets` is what the palette has ticked - always a list, never one thing, and
// a category that needs one item picks from it. That is what makes "three trees
// selected, brush an area" a mixed wood without a mixed-wood type existing.
//
//   place(ctx, hex, at)   an exact spot inside a hex; `at` is {dx, dz} in world
//                         units from the hex centre
//   tile(ctx, hex)        one hex, positioned however the category thinks best
//   brush(ctx, hexes)     an area, distributed however the category thinks best
//   erase(ctx, hexes)     this category's own content, in that area, and nothing
//                         else - which is the whole reason erase is per category
//   wheel(ctx, hexes, d)  the wheel over the board, for a category that has a
//                         use for it (terrain has: it is how height is sculpted)
//
// And three questions:
//
//   has(level, q, r)      is there anything of mine here - for the erase preview
//   refuse(level, hex, a) why this hex will not take it, as a sentence, or null
//   ghost(asset, s)       a prop placement to draw as a see-through preview, or
//                         null for a category with nothing to show before a click
//
// `tools` is which tools make sense, and `settings` is which of the shared
// settings this category understands. Both are read by the panel, so an
// impossible combination is not offered rather than being offered and refused.

// ── Terrain ─────────────────────────────────────────────────────────────────
// The one category that is the board rather than something standing on it, which
// is why it is the one with no `place`: there is no such thing as a bit of ground
// half way into a hex. Height is its wheel, because sculpting is a continuous
// adjustment - up a bit, too far, back down - and no number of clicks does that.
const TERRAIN_NAMES = { land: 'Ground', crag: 'Crag', water: 'Water' };

const terrain = {
  id: 'terrain',
  name: 'Terrain',
  assets: () => TERRAIN.map(t => ({ id: t, name: TERRAIN_NAMES[t] ?? t })),
  tools: ['tile', 'brush', 'erase', 'select'],
  settings: ['radius', 'step'],
  // Terrain is the one category whose brush should show its whole footprint
  // rather than only the hexes that would change: a preview that shrinks as it
  // crosses ground already drawn reads as the tool losing its grip.
  showsWholeFootprint: true,

  tile: (ctx, hex) => paintTile(ctx.level, hex.q, hex.r, one(ctx.assets, hex, 0).id),
  brush: (ctx, hexes) => {
    let changed = 0;
    for (const h of hexes) changed += paintTile(ctx.level, h.q, h.r, one(ctx.assets, h, 0).id);
    return changed;
  },

  // Ground goes last and only when nothing is standing on it - `removeTile`
  // refuses a tile that is still carrying something, which is what stops an erase
  // stroke leaving a tree in mid-air. Terrain has to be the chosen category
  // before any of this is reachable at all, which is the other half of not making
  // it easy to do by accident.
  erase: (ctx, hexes) => {
    let changed = 0;
    for (const h of hexes) if (removeTile(ctx.level, h.q, h.r)) changed++;
    return changed;
  },

  wheel: (ctx, hexes, dir) => {
    let changed = 0;
    for (const h of hexes) {
      const was = tileAt(ctx.level, h.q, h.r)?.level ?? 0;
      if (raiseTile(ctx.level, h.q, h.r, dir * (ctx.s.step ?? 1)) !== was) changed++;
    }
    return changed;
  },

  has: (level, q, r) => !!tileAt(level, q, r),
  refuse: () => null,
  ghost: () => null,
};

// ── Ground cover ────────────────────────────────────────────────────────────
// The category whose brush leaves a *rule* behind rather than instances: a hex
// gets one patch saying which kinds grow there and how thickly, and the tufts are
// regenerated from it - see game/detail.js. Which is why its numbers are content
// settings rather than brush settings: density and seed describe the patch, and
// the patch is what this category is.
//
// `place` is the exception that proves the model works. One deliberate tuft is
// not a patch, so it is stored the way every other deliberate thing is - an
// instance in `props` - and the two live on the same tile without either knowing.
const detail = {
  id: 'detail',
  name: 'Terrain detail',
  short: 'Detail',
  assets: () => detailKinds().map(key => ({ id: key, name: PROP_TYPES[key].name })),
  tools: ['place', 'tile', 'brush', 'erase', 'select'],
  settings: ['radius', 'density', 'seed', 'size', 'spin', 'turn', 'scale'],

  place: (ctx, hex, at) => placeInstance(ctx, hex, at, 'detail'),

  tile: (ctx, hex) => paintDetail(ctx.level, ctx.assets.map(a => a.id), hex.q, hex.r, ctx.s),
  brush: (ctx, hexes) => {
    const kinds = ctx.assets.map(a => a.id);
    let changed = 0;
    for (const h of hexes) changed += paintDetail(ctx.level, kinds, h.q, h.r, ctx.s);
    return changed;
  },

  // A patch first, then any deliberate tufts standing on the same tile. Thinning
  // rather than clearing is what erase means for a density: there is no
  // individual scattered tuft to take away, so the inverse of a thicker patch is
  // a thinner one, and pressing again gets to nothing in the end.
  erase: (ctx, hexes) => {
    let changed = 0;
    for (const h of hexes) {
      changed += thinDetail(ctx.level, h.q, h.r) || removePropsAt(ctx.level, h.q, h.r, 'detail');
    }
    return changed;
  },

  has: (level, q, r) => !!detailAt(level, q, r) || propsAt(level, q, r, 'detail').length > 0,
  refuse: (level, hex) => standRefusal(level, hex),
  ghost: (asset, s) => ghostOf(asset, s),
};

// ── Everything placed one at a time ─────────────────────────────────────────
// Props, trees and landmarks are one implementation with three sets of numbers,
// and that is not a shortcut - it is the finding. They differ in what they are
// made of and how much control the author wants per object, and not at all in
// what placing one *means*. Three copies of this would be three places for the
// salt on a hex to collide.
function placedContent({ id, name, category, tools, settings, spread }) {
  return {
    id,
    name,
    category,
    spread,
    tools,
    settings,
    assets: () => propTypesIn(category).map(t => ({
      id: t.key,
      name: t.name,
      lights: !!t.lights,
    })),

    place: (ctx, hex, at) => placeInstance(ctx, hex, at, category, spread),
    tile: (ctx, hex) => standOne(ctx, hex, category, spread),

    // What a scatter is, and none of it is "everywhere":
    //
    //   - `density` is a ceiling per tile, and how many actually arrive comes out
    //     of the same clump field the ground cover uses, so scattered rocks
    //     thicken where the grass thickens instead of reading as a second,
    //     unrelated system drawn over the first.
    //   - `spacing` is the minimum distance in hexes between occupied tiles,
    //     which is what turns a scatter into a distribution.
    //   - anything already standing counts toward the tile's total, so dragging
    //     back over ground already scattered tops it up rather than piling on.
    brush: (ctx, hexes) => {
      const density = ctx.s.density ?? 2;
      const spacing = ctx.s.spacing ?? 1;
      let added = 0;
      for (const h of hexes) {
        if (!isStandable(ctx.level, h.q, h.r) && tileAt(ctx.level, h.q, h.r)?.terrain !== 'crag') continue;
        const want = Math.min(density, Math.round(density * coverAt(h.q, h.r, 3)));
        const here = propsAt(ctx.level, h.q, h.r, category).length;
        if (want <= here) continue;
        if (spacing > 1 && crowded(ctx.level, h, spacing, category)) continue;
        for (let i = here; i < want; i++) added += standOne(ctx, h, category, spread);
      }
      return added;
    },

    erase: (ctx, hexes) => {
      let gone = 0;
      for (const h of hexes) gone += removePropsAt(ctx.level, h.q, h.r, category);
      return gone;
    },

    has: (level, q, r) => propsAt(level, q, r, category).length > 0,
    refuse: (level, hex) => standRefusal(level, hex),
    ghost: (asset, s) => ghostOf(asset, s, spread),
  };
}

// ── Forces ──────────────────────────────────────────────────────────────────
// Both sides are one implementation and the only difference between them is which
// types they offer, which comes from `hostile` on the type - see the invariant in
// CLAUDE.md. There is no side field anywhere in here to disagree with it.
//
// Tile only. A body of men occupies its hex, so there is no sub-hex position to
// place one at, and a brush that dropped nine of them over an area is not
// something anybody would want to undo.
function forceContent({ id, name, hostile, extra = [] }) {
  const types = Object.keys(UNIT_TYPES).filter(k => !!UNIT_TYPES[k].hostile === hostile && k !== 'king');
  return {
    id,
    name,
    tools: ['tile', 'select', 'erase'],
    settings: [],
    assets: () => [
      ...extra,
      ...types.map(k => ({
        id: k,
        name: UNIT_TYPES[k].name,
        note: `${UNIT_TYPES[k].people} men · sees ${UNIT_TYPES[k].viewDistance}`,
      })),
    ],

    tile: (ctx, hex) => {
      const asset = one(ctx.assets, hex, 0);
      const no = whyNot(ctx.level, asset.id === 'king' ? 'king' : 'unit', hex.q, hex.r);
      if (no) throw new Error(`Cannot place the ${asset.name} here - ${no}.`);
      // There is one `king` field in a level, so there is one King: placing him
      // again moves him, and the singleton is the shape of the data rather than a
      // rule somebody has to remember.
      return asset.id === 'king'
        ? (moveKing(ctx.level, hex.q, hex.r) ? 1 : 0)
        : (placeUnit(ctx.level, asset.id, hex.q, hex.r) ? 1 : 0);
    },

    erase: (ctx, hexes) => {
      let gone = 0;
      for (const h of hexes) if (removeEntityAt(ctx.level, h.q, h.r)) gone++;
      return gone;
    },

    has: (level, q, r) => {
      const here = entityAt(level, q, r);
      if (!here) return false;
      return here.kind === 'king' ? !hostile : !!UNIT_TYPES[here.unit.type]?.hostile === hostile;
    },
    refuse: (level, hex, asset) =>
      whyNot(level, asset?.id === 'king' ? 'king' : 'unit', hex.q, hex.r),
    ghost: () => null,
  };
}

export const CONTENT = [
  terrain,
  detail,
  placedContent({
    id: 'props', name: 'Props', category: 'prop', spread: 0.55,
    tools: ['place', 'tile', 'brush', 'erase', 'select'],
    settings: ['radius', 'density', 'spacing', 'size', 'spin', 'turn', 'scale'],
  }),
  placedContent({
    // Trees keep the brush, but they keep it with a low density ceiling and a
    // spacing that starts above one: a wood you can see through is a wood a unit
    // can be seen through, and a tree tall enough to hide a body of men is the
    // one kind of decoration that can make a board unreadable.
    id: 'trees', name: 'Trees', category: 'tree', spread: 0.45,
    tools: ['place', 'tile', 'brush', 'erase', 'select'],
    settings: ['radius', 'density', 'spacing', 'size', 'spin', 'turn', 'scale'],
  }),
  placedContent({
    // No brush. A landmark is a decision about one object - where the lamp goes
    // is where the map says somebody lives - and scattering decisions is not a
    // thing.
    id: 'landmarks', name: 'Landmarks', category: 'landmark', spread: 0.2,
    tools: ['place', 'tile', 'erase', 'select'],
    settings: ['size', 'spin', 'turn', 'scale', 'height', 'intensity', 'distance'],
  }),
  forceContent({
    id: 'friendly',
    name: 'Friendly',
    hostile: false,
    // The King is not a unit in the file - he is one hex on his own - so he is the
    // one asset with a hand-written entry. A level that stands friendly units on
    // the board hands them to the player's roster when it opens; see play.js.
    extra: [{ id: 'king', name: 'King', note: 'The player start - moves the existing King' }],
  }),
  forceContent({ id: 'enemy', name: 'Enemy', hostile: true }),
];

export const CONTENT_BY_ID = Object.fromEntries(CONTENT.map(c => [c.id, c]));

// ── The shared machinery ────────────────────────────────────────────────────

// One asset out of what the palette has ticked. Keyed to the hex and to which of
// that hex's things this is, so a tile that takes three of them takes three
// different ones - and so the same board comes back the same way.
//
// This is the whole of multi-selection as far as a category is concerned: ask for
// one, get one of the ones that are ticked. Nothing has to know how many are.
function one(assets, hex, salt) {
  if (assets.length === 1) return assets[0];
  const roll = hashHex(hex.q, hex.r, 911 + salt * 17);
  return assets[Math.min(assets.length - 1, Math.floor(roll * assets.length))];
}

// A deliberate instance at an exact spot. `at` is where in the tile the cursor
// was, and it is stored, because that is what the author was saying: not "one of
// these on this tile" but "one of these *there*".
function placeInstance(ctx, hex, at, category, spread = 0.55) {
  const index = propsAt(ctx.level, hex.q, hex.r).length;
  const asset = one(ctx.assets, hex, index);
  return put(ctx, hex, asset, category, spread, index, {
    dx: at?.dx ?? 0,
    dz: at?.dz ?? 0,
  }) ? 1 : 0;
}

// And one positioned however the category thinks best, which is the slot layout
// in `buildProp`: off centre, and never on top of whatever is already there.
function standOne(ctx, hex, category, spread) {
  const index = propsAt(ctx.level, hex.q, hex.r).length;
  const asset = one(ctx.assets, hex, index);

  // A landmark where one of its own kind already stands is somebody adjusting
  // that one, not asking for a second on the same post. It is the whole of "edit
  // the thing that is already there" for this category, and it is all that is
  // needed: the numbers are what a placed landmark is for.
  if (category === 'landmark') {
    const tuned = tuneLandmarks(ctx.level, hex.q, hex.r, asset.id, landmarkTuning(ctx, asset));
    if (tuned) return tuned;
  }
  return put(ctx, hex, asset, category, spread, index, {}) ? 1 : 0;
}

// The one place a placement is written, whichever verb asked for it. Everything
// that varies between the categories has already been decided by the time it gets
// here, which is what stops "place a tree" and "scatter a tree" drifting apart.
function put(ctx, hex, asset, category, spread, index, where) {
  const { q, r } = hex;
  if (!PROP_TYPES[asset.id]) return false;
  const salt = 1 + index * 11;
  const lights = category === 'landmark' && asset.lights;
  addProp(ctx.level, asset.id, q, r, {
    spread,
    ...where,
    scale: category === 'landmark' && ctx.s.height
      ? HEIGHTS[ctx.s.height - 1] ?? 1
      : chosenScale(ctx, q, r, salt),
    yaw: chosenYaw(ctx, q, r, salt),
    light: lights ? { intensity: ctx.s.intensity, distance: ctx.s.distance } : null,
  });
  return true;
}

// How big. `scale` is a number the author set and `size` is how much to vary
// around it, so the two compose: a stated scale with free variation on top is a
// stand of trees that are all roughly the size you asked for.
function chosenScale(ctx, q, r, salt) {
  const stated = (ctx.s.scale ?? 10) / 10;
  return stated * variedScale(ctx.s.size ?? 0, q, r, salt);
}

// Which way it faces. `turn` is a compass step the author set and `spin` is the
// variation around it - and a free spin ignores the stated facing, because
// "whatever the hash says" is what free means.
function chosenYaw(ctx, q, r, salt) {
  const varied = variedYaw(ctx.s.spin ?? 2, q, r, salt);
  if (varied === null) return null;
  return (ctx.s.turn ?? 0) * (Math.PI / 6) + varied;
}

function landmarkTuning(ctx, asset) {
  return {
    light: asset.lights ? { intensity: ctx.s.intensity, distance: ctx.s.distance } : null,
    scale: ctx.s.height ? HEIGHTS[ctx.s.height - 1] : null,
  };
}

// What a lamp's Height stepper is worth. A landmark's scale is the one place a
// placement changes how big something is by decision rather than by variation,
// because how high a lamp stands is a thing a level says on purpose.
const HEIGHTS = [0.7, 0.85, 1, 1.15, 1.3];

// Is there already one of this category too close? The hex itself does not count -
// a tile may hold two rocks, that is what density is for - so this is about how
// far apart the occupied tiles are.
function crowded(level, hex, spacing, category) {
  for (const o of level.props ?? []) {
    if (PROP_TYPES[o.type]?.category !== category) continue;
    const d = Math.max(
      Math.abs(hex.q - o.q), Math.abs(hex.r - o.r), Math.abs((hex.q + hex.r) - (o.q + o.r)));
    if (d > 0 && d < spacing) return true;
  }
  return false;
}

// Somewhere a thing can be stood: land or bare rock. Not water, and not a hex
// with no tile on it - a tree in the sea is the level saying something it did not
// mean.
function standRefusal(level, hex) {
  if (!hex) return 'nothing under the cursor';
  if (isStandable(level, hex.q, hex.r)) return null;
  const tile = tileAt(level, hex.q, hex.r);
  if (tile?.terrain === 'crag') return null;
  return tile ? `cannot stand on ${tile.terrain}` : 'no ground there';
}

// The see-through preview, as a placement `buildProp` can build. It carries the
// stated scale and facing but not the per-instance variation: what the ghost is
// for is answering "what, and how big, and which way round", and a ghost that
// jittered as the cursor crossed a tile boundary would be answering a different
// question every frame.
function ghostOf(asset, s, spread = 0.55) {
  if (!PROP_TYPES[asset?.id]) return null;
  return {
    type: asset.id,
    spread,
    scale: (s.scale ?? 10) / 10,
    yaw: (s.turn ?? 0) * (Math.PI / 6),
    light: asset.lights ? { intensity: 0 } : null,
  };
}
