import { hashHex } from '../engine/hex/hex_noise.js';

// Decoration built from Kenney's CC0 Nature Kit (see assets/nature/LICENSE.txt).
// Every model has its origin at its base and carries plain material colours with
// no textures, which is why they sit on the ground without adjustment and match
// the flat-shaded terrain rather than looking imported from another game.

// name -> file, relative to the cache's basePath.
export const MODEL_FILES = {
  tree_pineRoundC: 'tree_pineRoundC.glb',
  tree_pineTallB:  'tree_pineTallB.glb',
  tree_pineSmallB: 'tree_pineSmallB.glb',
  tree_default:    'tree_default.glb',
  tree_oak:        'tree_oak.glb',
  rock_smallA:     'rock_smallA.glb',
  rock_smallC:     'rock_smallC.glb',
  rock_tallD:      'rock_tallD.glb',
  rock_largeB:     'rock_largeB.glb',
  plant_bush:      'plant_bush.glb',
  plant_bushSmall: 'plant_bushSmall.glb',
  grass:           'grass.glb',
  grass_large:     'grass_large.glb',
  flower_purpleA:  'flower_purpleA.glb',
  flower_redB:     'flower_redB.glb',
  flower_yellowC:  'flower_yellowC.glb',
  stump_round:     'stump_round.glb',
  log:             'log.glb',
};

// The kit is authored against a 1-unit tile while our hexes are 1.73 flat to
// flat, so everything wants scaling up. Small ground detail gets an extra push:
// at the sizes it ships in, a flower is a quarter of a unit tall and simply
// disappears at gameplay zoom.
const KIT_SCALE = 1.4;

// `models` are interchangeable variants - one is picked per hex by hash, so a
// scattered type never repeats the same silhouette across neighbours.
export const PROP_TYPES = {
  tree_pine:  { models: ['tree_pineRoundC', 'tree_pineTallB', 'tree_pineSmallB'], scale: 1.0,  spread: 0.30 },
  tree_broad: { models: ['tree_default', 'tree_oak'],                             scale: 1.0,  spread: 0.30 },
  rock:       { models: ['rock_smallA', 'rock_smallC', 'rock_tallD'],             scale: 1.2,  spread: 0.40 },
  rock_large: { models: ['rock_largeB'],                                          scale: 1.15, spread: 0.25 },
  bush:       { models: ['plant_bush', 'plant_bushSmall'],                        scale: 1.25, spread: 0.40 },
  grass:      { models: ['grass', 'grass_large'],                                 scale: 1.30, spread: 0.45 },
  flower:     { models: ['flower_purpleA', 'flower_redB', 'flower_yellowC'],       scale: 1.35, spread: 0.45 },
  stump:      { models: ['stump_round', 'log'],                                   scale: 1.15, spread: 0.30 },
};

// The models needed to build the given prop types - what the cache must preload.
// Scoped to the types a level actually uses, so unused kit does not get fetched.
export function requiredModels(typeKeys = Object.keys(PROP_TYPES)) {
  const out = {};
  for (const key of typeKeys) {
    const type = PROP_TYPES[key];
    if (!type) throw new Error(`Unknown prop type "${key}"`);
    for (const m of type.models) {
      if (!MODEL_FILES[m]) throw new Error(`Prop type "${key}" wants unknown model "${m}"`);
      out[m] = MODEL_FILES[m];
    }
  }
  return out;
}

// Every prop type a level places, hand-authored or scattered.
export function propTypesUsedBy(level) {
  return [...new Set([
    ...(level.props ?? []).map(p => p.type),
    ...(level.scatter ?? []).map(s => s.type),
  ])];
}

// Builds one placement. All variation is keyed to the hex (plus an index, so
// several props on one tile differ), so the board never reshuffles between loads.
export function buildProp(assets, typeKey, q, r, { x, z, y, index = 0 }) {
  const type = PROP_TYPES[typeKey];
  if (!type) throw new Error(`Unknown prop type "${typeKey}"`);

  const salt = index * 1000;
  const pick = type.models[Math.floor(hashHex(q, r, 211 + salt) * type.models.length)];
  const obj = assets.create(pick);
  if (!obj) return null;

  const jitter = 0.85 + hashHex(q, r, 223 + salt) * 0.3;
  const s = KIT_SCALE * type.scale * jitter;
  obj.scale.setScalar(s);

  const angle = hashHex(q, r, 227 + salt) * Math.PI * 2;
  const dist = (type.spread ?? 0.3) * hashHex(q, r, 229 + salt);
  obj.position.set(x + Math.cos(angle) * dist, y, z + Math.sin(angle) * dist);
  obj.rotation.y = hashHex(q, r, 233 + salt) * Math.PI * 2;

  return obj;
}
