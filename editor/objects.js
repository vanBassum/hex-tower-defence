import { PROP_TYPES } from '../game/props.js';
import { MOOD } from '../game/mood.js';
import { hashHex } from '../engine/hex/hex_noise.js';
import { addProp, propsAt, isStandable, tileAt } from './level.js';

// What can be stood about on a board: the game's own props, and nothing invented
// here.
//
// The list comes out of `PROP_TYPES` the way the unit palette comes out of
// `UNIT_TYPES` - a prop added to the game appears in the editor with its own name
// and its own look, and there is no second, editor-shaped version of a tree to
// keep in step. What this file adds is the two things a *placement* needs that
// the type does not say: how far off centre one may stand, and how thickly they
// come when a brush is dragged.

// How far a prop of each kind may wander from the middle of its tile. These are
// the numbers maps.js already authors with - a lantern almost dead centre because
// it is a marker, grass all over the tile because it is texture - and they are
// here rather than on the type because they are a fact about how a level uses a
// prop rather than about the prop.
const SPREAD = {
  tree: 0.55,
  bush: 0.55,
  grass: 0.9,
  rock: 0.6,
  stake: 0.3,
  lantern: 0.2,
};

// Which of them a mixed brush draws from, and how often. Trees and grass carry a
// wood; a rock or a bush every so often is what stops it reading as a plantation.
// It is a weighted list rather than a generator on purpose: this is a brush, not
// a biome.
const MIX = [
  ['tree', 4],
  ['grass', 4],
  ['bush', 2],
  ['rock', 1],
];

export const OBJECTS = Object.values(PROP_TYPES).map(type => ({
  id: type.key,
  name: type.name ?? type.key,
  // Anything that flickers is something that carries a light, which the game
  // decides and this only reads.
  lights: !!type.flicker,
  spread: SPREAD[type.key] ?? 0.35,
}));

export const OBJECT_BY_ID = Object.fromEntries(OBJECTS.map(o => [o.id, o]));

// The choice a tool offers. Plain props under one heading and the lamps under
// another, because reaching for a light is a different job from reaching for a
// tree - and `mixed` is first among the scatterables since it is what a brush
// wants nine times out of ten.
export function objectGroups({ mixed = false, lights = true } = {}) {
  const groups = [];
  const plain = OBJECTS.filter(o => !o.lights);
  const lamps = OBJECTS.filter(o => o.lights);
  if (mixed) groups.push({ name: 'Mixed', options: [MIXED] });
  if (plain.length) groups.push({ name: 'Props', options: plain });
  if (lights && lamps.length) groups.push({ name: 'Lights', options: lamps });
  return groups;
}

// A brushful of several kinds at once. It is an entry in the palette rather than
// a checkbox because that is what it is: a thing you can choose to paint.
export const MIXED = {
  id: 'mixed',
  name: 'Woodland',
  note: 'Trees, grass, a rock here and there',
  spread: 0.7,
};

// ── The brush ───────────────────────────────────────────────────────────────

// How many props a tile takes at this density, and it is *not* the same number
// for every tile. A count that is exactly the density everywhere is a plantation:
// what makes a scattering read as one is that some tiles are thick, some are thin
// and some are bare. Deterministic per hex, so dragging back over ground already
// painted tops it up to the same number rather than piling more on.
function wanted(q, r, density) {
  const n = Math.round(hashHex(q, r, 901) * density * 1.35);
  return Math.max(0, Math.min(density, n));
}

// Which kind lands on a given tile, out of the weighted mix. Keyed to the hex and
// to which of that tile's props this is, so a thick tile is not three of the same
// thing.
function pick(q, r, index) {
  const total = MIX.reduce((sum, [, w]) => sum + w, 0);
  let roll = hashHex(q, r, 911 + index * 17) * total;
  for (const [type, weight] of MIX) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return MIX[0][0];
}

// Scatters onto one hex, up to what that hex wants. Returns how many arrived.
//
// Anything already standing there counts toward the total, which is what keeps a
// drag from stacking: the second pass over a tile finds it full and adds nothing.
export function scatterOnto(level, entry, q, r, density) {
  if (!isStandable(level, q, r) && tileAt(level, q, r)?.terrain !== 'crag') return 0;
  const target = wanted(q, r, density);
  const here = propsAt(level, q, r).length;
  let added = 0;
  for (let i = here; i < target; i++) {
    const type = entry.id === 'mixed' ? pick(q, r, i) : entry.id;
    addProp(level, type, q, r, { spread: OBJECT_BY_ID[type]?.spread ?? entry.spread });
    added++;
  }
  return added;
}

// One, placed deliberately. `light` is only meant for something that carries one.
export function placeObject(level, entry, q, r, light = null) {
  const type = entry.id === 'mixed' ? pick(q, r, propsAt(level, q, r).length) : entry.id;
  addProp(level, type, q, r, { spread: OBJECT_BY_ID[type]?.spread ?? entry.spread, light });
  return 1;
}

// What a light starts at, so the two steppers open on the hour's own lamp rather
// than on nothing.
export const LIGHT_DEFAULTS = {
  intensity: Math.round(MOOD.lanternLight.intensity),
  distance: Math.round(MOOD.lanternLight.distance),
};
