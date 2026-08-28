import { PROP_TYPES, propTypesIn } from '../game/props.js';
import {
  DETAIL_SET_LIST, DETAIL_DEFAULTS, coverAt, variedScale, variedYaw,
} from '../game/detail.js';
import { MOOD } from '../game/mood.js';
import { hashHex } from '../engine/hex/hex_noise.js';
import { addProp, propsAt, paintDetail, isStandable, tileAt } from './level.js';

// What can be stood about on a board, in the four kinds it comes in.
//
// The categories are *how a thing is authored*, and they are declared on the prop
// types themselves - see the note above `PROP_TYPES`. So this file invents
// nothing: it reads the game's own list, groups it by category, and adds the two
// things a *placement* needs that a type does not say - how far off centre one
// may stand, and which variants a single brushful may draw from.
//
// ── Palettes are sets, always ────────────────────────────────────────────────
// Every entry here, from a whole grass set down to one lantern, has a `variants`
// list. A lantern's has one entry in it. That is on purpose: the difference
// between "place this" and "place one of these" then lives in the data rather
// than in two code paths, so a category gets richer by growing a list. The right
// answer to "there is only one kind of rock" is a second key in `variants`, never
// a second click somewhere in the editor.

// How far a placement of each category may wander from the middle of its tile.
// A landmark sits nearly dead centre because it is a marker and a row of them
// has to read as a row; a prop wanders, because a rock in the middle of every
// tile draws the grid.
const SPREAD = { prop: 0.55, tree: 0.45, landmark: 0.2 };

// What a lamp's Height stepper is worth. A landmark's scale is the one place a
// placement is allowed to change how big something is by hand - everywhere else
// size is variation rather than a decision - because how high a lamp stands is a
// thing a level says on purpose.
export const HEIGHTS = [0.7, 0.85, 1, 1.15, 1.3];
export const HEIGHT_DEFAULT = 3;             // the middle one, 1:1

const entry = (id, name, variants, category, extra = {}) => ({
  id, name, variants, category,
  spread: SPREAD[category] ?? 0.35,
  ...extra,
});

// One entry per type, plus the mixed sets. A mixed set is not a mode on the
// brush - it is a thing you can choose to paint, which is why it sits in the
// palette beside the single kinds.
const PROPS = [
  entry('scrub', 'Scrub', ['bush', 'rock', 'log', 'stump'], 'prop',
    { note: 'Bushes, a rock, the odd log' }),
  entry('rubble', 'Rubble', ['rock', 'boulder', 'pebble_flat'], 'prop',
    { note: 'Stone, in several sizes' }),
  ...propTypesIn('prop').map(t => entry(t.key, t.name, [t.key], 'prop')),
];

const TREES = [
  entry('wood', 'Mixed', propTypesIn('tree').map(t => t.key), 'tree',
    { note: 'A different kind each time' }),
  ...propTypesIn('tree').map(t => entry(t.key, t.name, [t.key], 'tree')),
];

// No mixed set here, and that is the category saying what it is: a landmark is a
// decision about one object, so "one of these at random" is not a thing anybody
// wants. `lights` comes off the type, which is what makes the extra controls
// appear without this file knowing what they are.
const LANDMARKS = propTypesIn('landmark').map(t =>
  entry(t.key, t.name, [t.key], 'landmark', { lights: !!t.lights }));

// And the ground cover, whose sets are declared in game/detail.js because they
// are what the scatter draws from rather than something the editor decides.
const DETAIL = DETAIL_SET_LIST.map(set => ({
  id: set.key,
  name: set.name,
  note: set.note,
  category: 'detail',
  variants: set.variants,
  spread: set.spread,
}));

export const PALETTES = { detail: DETAIL, prop: PROPS, tree: TREES, landmark: LANDMARKS };

const BY_ID = {};
for (const [category, list] of Object.entries(PALETTES)) {
  BY_ID[category] = Object.fromEntries(list.map(e => [e.id, e]));
}

// The choice one tool offers, as the toolbar's grouped options. Sets first,
// because a brushful of several kinds is what a scatter wants most of the time,
// and the single kinds under their own heading for when it is not.
export function paletteGroups(category) {
  const list = PALETTES[category] ?? [];
  const sets = list.filter(e => e.variants.length > 1);
  const singles = list.filter(e => e.variants.length === 1);
  const groups = [];
  if (sets.length) groups.push({ name: 'Sets', options: sets });
  if (singles.length) groups.push({ name: singles.length > 1 ? 'Kinds' : 'Kind', options: singles });
  return groups;
}

// Which entry a tool is holding. A stored choice that no longer names anything -
// a saved setting from a version with one more kind in it - falls back to the
// first rather than throwing while the mouse moves.
export function chosen(category, id) {
  return BY_ID[category]?.[id] ?? PALETTES[category][0];
}

export function firstId(category) {
  return PALETTES[category][0].id;
}

// ---- Placing ----------------------------------------------------------------

// Which variant this one draws. Keyed to the hex and to how many are already
// standing on it, so pressing twice on one tile gives two different trees rather
// than the same tree twice.
function variantAt(entry, q, r, index) {
  if (entry.variants.length === 1) return entry.variants[0];
  const roll = hashHex(q, r, 911 + index * 17);
  return entry.variants[Math.floor(roll * entry.variants.length)];
}

// One, placed deliberately. `size` and `spin` are variation steps in the same
// vocabulary the ground cover uses - see game/detail.js - so a hand-placed tree
// and a scattered one vary the same way and by the same amount.
export function placeOne(level, entry, q, r, { size = 0, spin = 2, light = null, height = null } = {}) {
  const index = propsAt(level, q, r).length;
  const type = variantAt(entry, q, r, index);
  if (!PROP_TYPES[type]) return 0;
  const scale = height != null
    ? HEIGHTS[height - 1] ?? 1
    : variedScale(size, q, r, 1 + index * 11);
  addProp(level, type, q, r, {
    spread: entry.spread,
    scale,
    yaw: variedYaw(spin, q, r, 1 + index * 11),
    light,
  });
  return 1;
}

// A brushful, scattered. Unlike the ground cover this leaves real instances
// behind - every one of them is a line in the level that can be picked up, moved
// or deleted afterwards - which is the whole difference between this category and
// that one, and the reason the settings are nearly the same and the result is
// not.
//
// Three things decide where they land, and none of them is "everywhere":
//
//   - `density` is a ceiling per tile, and how many actually arrive comes out of
//     the same clump field the ground cover uses. So a scatter of rocks thickens
//     where the grass thickens, which is what stops the two reading as unrelated
//     systems drawn over one another.
//   - `spacing` is the minimum distance in hexes between occupied tiles. It is
//     what turns a scatter into a *distribution*: at 1 anything may sit anywhere,
//     at 3 the brush leaves two clear tiles around whatever it drops.
//   - anything already standing counts toward the tile's total, so dragging back
//     over ground you have just scattered tops it up rather than piling on.
export function scatterProps(level, entry, hexes, { density = 2, spacing = 1, size = 1, spin = 2 } = {}) {
  let added = 0;
  for (const h of hexes) {
    const want = Math.min(density, Math.round(density * coverAt(h.q, h.r, 3)));
    if (want <= 0) continue;
    const here = propsAt(level, h.q, h.r, entry.category).length;
    if (here >= want) continue;
    if (spacing > 1 && crowded(level, h, spacing, entry.category)) continue;
    for (let i = here; i < want; i++) added += placeOne(level, entry, h.q, h.r, { size, spin });
  }
  return added;
}

// Is there already one of this category too close? The hex itself does not count
// - a tile is allowed to hold two rocks, that is what density is for - so this is
// about how far apart the *occupied* tiles are.
function crowded(level, hex, spacing, category) {
  for (const o of level.props ?? []) {
    if (PROP_TYPES[o.type]?.category !== category) continue;
    const d = hexDistance(hex, o);
    if (d > 0 && d < spacing) return true;
  }
  return false;
}

function hexDistance(a, b) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((a.q + a.r) - (b.q + b.r)));
}

// ---- Painting ground cover --------------------------------------------------

// One hex's worth of ground cover. Everything the brush knows goes into the
// patch; nothing about the tufts themselves is decided here, because nothing
// about them is stored - see game/detail.js.
export function paintOne(level, entry, q, r, settings = {}) {
  return paintDetail(level, entry.id, q, r, {
    density: settings.density ?? DETAIL_DEFAULTS.density,
    seed: settings.seed ?? DETAIL_DEFAULTS.seed,
    size: settings.size ?? DETAIL_DEFAULTS.size,
    spin: settings.spin ?? DETAIL_DEFAULTS.spin,
  });
}

// Somewhere a thing can be stood. Land or bare rock; not water, and not a hex
// with no tile on it - a tree in the sea is the level saying something it did not
// mean.
export function canStand(level, hex) {
  if (!hex) return false;
  return isStandable(level, hex.q, hex.r) || tileAt(level, hex.q, hex.r)?.terrain === 'crag';
}

// What a light starts at, so the two steppers open on the hour's own lamp rather
// than on nothing.
export const LIGHT_DEFAULTS = {
  intensity: Math.round(MOOD.lanternLight.intensity),
  distance: Math.round(MOOD.lanternLight.distance),
};
