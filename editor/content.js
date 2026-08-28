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
// and eight categories and forty combinations, and none of them is a
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
  // `preview` is what the palette draws a picture of - see editor/thumbnails.js.
  // Terrain is a colour rather than a shape, so its picture is a piece of board.
  assets: () => TERRAIN.map(t => ({
    id: t, name: TERRAIN_NAMES[t] ?? t, preview: { kind: 'terrain', terrain: t },
  })),
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
  assets: () => detailKinds().map(key => ({
    id: key, name: PROP_TYPES[key].name, preview: { kind: 'prop', type: key },
  })),
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
      preview: { kind: 'prop', type: t.key },
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

// ── Where the player starts ─────────────────────────────────────────────────
// One asset, and it is not a troop. The player's army is a hand they choose - six
// cards, played beside the King wherever he happens to be standing - so a level
// says where they *start* and what is waiting for them, and never what they bring.
// See the invariant in CLAUDE.md and the note at the top of cards.js.
//
// This category exists because the King is the one figure the game places itself,
// and a board with nowhere to arrive cannot be opened. It has no erase for the
// same reason: he moves, and there is nothing to take away.
const playerStart = {
  id: 'start',
  name: 'Player start',
  short: 'Start',
  assets: () => [{
    id: 'king',
    name: 'King',
    note: 'Where the army arrives - placing him again moves him',
    preview: { kind: 'unit', type: 'king' },
  }],
  tools: ['tile', 'select'],
  settings: [],

  // There is one `king` field in a level, so there is one King: placing him again
  // moves him, and the singleton is the shape of the data rather than a rule
  // somebody has to remember.
  tile: (ctx, hex) => {
    const no = whyNot(ctx.level, 'king', hex.q, hex.r);
    if (no) throw new Error(`The King cannot stand here - ${no}.`);
    return moveKing(ctx.level, hex.q, hex.r) ? 1 : 0;
  },

  has: (level, q, r) => level.king.q === q && level.king.r === r,
  refuse: (level, hex) => whyNot(level, 'king', hex.q, hex.r),
  ghost: () => null,
};

// ── What is waiting on the board ────────────────────────────────────────────
// The other side, and only the other side. Which side a type is on comes from
// `hostile` on it - see the invariant in CLAUDE.md - so there is no side field in
// here to disagree with the game about.
//
// Tile only. A body of men occupies its hex, so there is no sub-hex position to
// place one at, and a brush that dropped nine of them over an area is not
// something anybody would want to undo.
const enemy = {
  id: 'enemy',
  name: 'Enemy',
  tools: ['tile', 'select', 'erase'],
  settings: [],
  assets: () => Object.entries(UNIT_TYPES)
    .filter(([key, type]) => type.hostile && key !== 'king')
    .map(([key, type]) => ({
      id: key,
      name: type.name,
      note: `${type.people} men · sees ${type.viewDistance}`,
      preview: { kind: 'unit', type: key },
    })),

  tile: (ctx, hex) => {
    const asset = one(ctx.assets, hex, 0);
    const no = whyNot(ctx.level, 'unit', hex.q, hex.r);
    if (no) throw new Error(`Cannot place the ${asset.name} here - ${no}.`);
    return placeUnit(ctx.level, asset.id, hex.q, hex.r) ? 1 : 0;
  },

  erase: (ctx, hexes) => {
    let gone = 0;
    for (const h of hexes) if (removeEntityAt(ctx.level, h.q, h.r)) gone++;
    return gone;
  },

  // Anything standing there that is not the King. A level out of an older editor
  // may have friendly units on it - the format still carries them, because the
  // game still knows what to do with one - so this answers for whatever is there
  // rather than only for what this palette can place.
  has: (level, q, r) => entityAt(level, q, r)?.kind === 'unit',
  refuse: (level, hex) => whyNot(level, 'unit', hex.q, hex.r),
  ghost: () => null,
};

// ── Troops the level leaves standing to be found ────────────────────────────
// The one palette of the player's own kind of unit, and it exists without
// breaking the rule that says there should not be one. That rule - the editor
// has no palette for the player's army, because which army comes is the player's
// answer to the level - is about the *hand*. These are not a hand: they are men
// standing in a field who join the force when somebody walks close enough to see
// them, which is exactly "what is waiting for it" and squarely the level's side
// of that line. See game/components/garrison.js.
//
// Which is why `dormant` opens at 1. Turned off, this palette really would be
// standing the player's army on the board for them, and that is the thing the
// rule is against - the setting is there because a level format that carries an
// always-active friendly still exists and can still be authored, not because it
// is the ordinary case.
//
// Tile only, for the reason Enemy is: a body of men occupies its hex, so there is
// no sub-hex spot to place one at.
const troops = {
  id: 'troops',
  name: 'Troops',
  tools: ['tile', 'select', 'erase'],
  settings: ['dormant'],
  // Everything that is not the other side and not the King - the same one line
  // Enemy uses, read the other way round, so a new friendly unit type appears in
  // here the day it appears in UNIT_TYPES.
  assets: () => Object.entries(UNIT_TYPES)
    .filter(([key, type]) => !type.hostile && key !== 'king')
    .map(([key, type]) => ({
      id: key,
      name: type.name,
      note: `${type.people} men · sees ${type.viewDistance}`,
      preview: { kind: 'unit', type: key },
    })),

  tile: (ctx, hex) => {
    const asset = one(ctx.assets, hex, 0);
    const no = whyNot(ctx.level, 'unit', hex.q, hex.r);
    if (no) throw new Error(`Cannot place the ${asset.name} here - ${no}.`);
    return placeUnit(ctx.level, asset.id, hex.q, hex.r, { dormant: ctx.s.dormant === 1 }) ? 1 : 0;
  },

  erase: (ctx, hexes) => {
    let gone = 0;
    for (const h of hexes) if (removeEntityAt(ctx.level, h.q, h.r)) gone++;
    return gone;
  },

  // Whatever is standing there that is not the King, the same as Enemy answers -
  // both palettes place into one `units` array and the type is what sorts them,
  // so erase takes what is on the hex rather than only what this palette makes.
  has: (level, q, r) => entityAt(level, q, r)?.kind === 'unit',
  refuse: (level, hex) => whyNot(level, 'unit', hex.q, hex.r),
  ghost: () => null,
};

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
  playerStart,
  troops,
  enemy,
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
