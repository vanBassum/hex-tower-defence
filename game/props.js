import * as THREE from 'three';
import { hashHex } from '../engine/hex/hex_noise.js';

// Decoration meshes, built procedurally to match the flat-shaded look: low
// segment counts plus flatShading gives crisp facets without any textures, and
// the colours stay under our control rather than baked into an asset.
//
// Sizes are chosen against the board rather than picked by eye, and the board's
// scale is set in game/units.js: a hex holds an army unit of about fifteen
// people, so it is roughly 12 m of ground and one world unit is about 7 m.
//
// These were all a third larger before a unit was drawn as a formation rather
// than as a single giant figure, and a tree nearly as tall as its tile is wide is
// what had been quietly telling the eye that a hex was three paces across. A tree
// is now ~6 m, a rock is something you step over, and a lantern is a post about
// three times a person's height - tall for a lamp, which is the point, because it
// is meant to be seen from the next tile along.
const HEX_WIDTH = 2;

// Materials are shared across every prop instead of per instance - there is no
// reason for two trees to own separate copies of the same green. Colours come in
// from the outside because vegetation has to be lit by the same hour the ground
// is: a daylight green on a dusk hillside reads as a prop dropped in from
// another scene.
const DEFAULT_COLORS = {
  trunk:    0x5b4632,
  foliage:  0x3f6b32,
  foliage2: 0x4a7a39,
  scrub:    0x4f7a3a,
  blade:    0x6d9143,
  rock:     0x7d838b,
  lantern:  0x2f2921,
  lanternGlow: 0xffc074,
  // Pale rather than warm, and that is the whole reason it works: the level
  // already spends amber on lanterns and on the cache, so a third warm thing
  // would read as a fourth lamp. A bone-coloured pennant is the brightest cloth
  // on a dusk island without being a light.
  pennant:  0xc9bda3,
};

export function createPropMaterials(colors = {}) {
  const c = { ...DEFAULT_COLORS, ...colors };
  const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  return {
    trunk:    lambert(c.trunk),
    foliage:  lambert(c.foliage),
    foliage2: lambert(c.foliage2),
    scrub:    lambert(c.scrub),
    blade:    lambert(c.blade),
    rock:     lambert(c.rock),
    lantern:  lambert(c.lantern),
    pennant:  new THREE.MeshLambertMaterial({ color: c.pennant, flatShading: true, side: THREE.DoubleSide }),
    // Unlit on purpose. A flame is a light source, so it should not get dimmer
    // when the world does - it has to stay the brightest thing in frame, which is
    // the whole reason the eye goes to it.
    lanternGlow: new THREE.MeshBasicMaterial({ color: c.lanternGlow }),
    // The bleed around the flame, standing in for a bloom pass we do not have.
    // Additive, so it brightens whatever is behind it and never draws an edge.
    lanternHalo: new THREE.MeshBasicMaterial({
      color: c.lanternGlow,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

// `girth` scales the crown without touching the height, which is the whole
// difference between one tree and another at this distance: a narrow spire and a
// broad canopy read as two species where two heights read as one tree twice.
function buildTree(mats, height, { girth = 1 } = {}) {
  const group = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.045, height * 0.065, height * 0.32, 5),
    mats.trunk,
  );
  trunk.position.y = height * 0.16;
  group.add(trunk);

  // Two stacked cones read as a conifer and give the silhouette a break, which
  // one cone does not.
  const lower = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.27 * girth, height * 0.5, 7),
    mats.foliage,
  );
  lower.position.y = height * 0.46;
  group.add(lower);

  const upper = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.19 * girth, height * 0.42, 7),
    mats.foliage2,
  );
  upper.position.y = height * 0.76;
  group.add(upper);

  return group;
}

// Two overlapping lumps rather than one, so the silhouette has a notch in it and
// does not read as a green ball.
function buildBush(mats, size) {
  const group = new THREE.Group();
  const lumps = [
    { r: size,        x: 0,            z: 0,           y: size * 0.62 },
    { r: size * 0.68, x: size * 0.72,  z: size * 0.28, y: size * 0.45 },
  ];
  for (const l of lumps) {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(l.r, 0), mats.scrub);
    lump.scale.y = 0.78;
    lump.position.set(l.x, l.y, l.z);
    group.add(lump);
  }
  return group;
}

// A tuft: a few tapered blades splayed out from one point. Cheap, and at this
// scale the only thing that matters is that the top moves and the base does not.
//
// Four numbers rather than one builder per kind of grass, because the difference
// between a tall reed and a low mat *is* those numbers - and a detail set is only
// worth having if its variants are genuinely different silhouettes rather than
// the same tuft at three sizes, which the per-instance size jitter already does.
function buildGrass(mats, size, { blades = 4, tall = 1, splay = 0.3, thick = 0.16 } = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + size * 3;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(size * thick, size * 1.6 * tall, 3),
      mats.blade,
    );
    blade.position.set(Math.cos(a) * size * 0.3, size * 0.8 * tall, Math.sin(a) * size * 0.3);
    // Splayed outward, so the tuft has a shape instead of being a spike.
    blade.rotation.z = -Math.cos(a) * splay;
    blade.rotation.x =  Math.sin(a) * splay;
    group.add(blade);
  }
  return group;
}

// A lamp on a post: the one warm thing on the level. Kept to roughly the height
// of the things that walk past it, so it reads as something somebody put there
// rather than as scenery.
//
// The pool of light on the ground is the point; the mesh is only what explains
// where the pool comes from. That is why the flame is unlit, the halo is
// additive, and the actual PointLight is part of the prop rather than something
// the level places separately - a lantern without its light is a decoration, and
// a light without its lantern is a mystery.
function buildLantern(mats, height, { lanternLight } = {}) {
  const group = new THREE.Group();
  const headY = height * 0.9;

  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.08, height * 0.095, height * 0.07, 6),
    mats.rock,
  );
  foot.position.y = height * 0.035;
  group.add(foot);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.026, height * 0.038, height * 0.8, 5),
    mats.lantern,
  );
  post.position.y = height * 0.44;
  group.add(post);

  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.075, height * 0.058, height * 0.15, 6),
    mats.lantern,
  );
  housing.position.y = headY;
  group.add(housing);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.1, height * 0.085, 6),
    mats.lantern,
  );
  cap.position.y = headY + height * 0.115;
  group.add(cap);

  // Its own copy of the bulb material, for the reason the halo below has one:
  // a lantern is lit *when its tile is found*, so the flame's brightness is a
  // per-lantern number now rather than one shared colour.
  const flame = new THREE.Mesh(
    new THREE.IcosahedronGeometry(height * 0.052, 0),
    mats.lanternGlow.clone(),
  );
  flame.position.y = headY;
  flame.userData.noShadow = true;
  flame.userData.ownMaterial = true;
  group.add(flame);

  // Its own copy of the halo material, because the opacity is animated per
  // lantern - sharing it would make every lantern on the level flicker in step,
  // which is the one thing a flame never does.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(height * 0.3, 8, 6),
    mats.lanternHalo.clone(),
  );
  halo.position.y = headY;
  halo.userData.noShadow = true;
  halo.userData.ownMaterial = true;
  group.add(halo);

  // No shadow from a point light: six shadow maps per lantern to darken the far
  // side of a post nobody is looking at. The long shadow that matters is the one
  // the post throws in the last of the directional light.
  // The light it throws can be warmer than the bulb it comes out of, and usually
  // should be: the flame is the colour you see, the pool is the colour it lands
  // as. Falls back to the bulb when nothing says otherwise.
  const L = { intensity: 12, distance: 9, decay: 2, ...lanternLight };
  const light = new THREE.PointLight(
    L.color ?? mats.lanternGlow.color.getHex(), L.intensity, L.distance, L.decay,
  );
  light.position.y = headY;
  group.add(light);

  group.userData.light = light;
  group.userData.flame = flame;
  group.userData.halo = halo;
  group.userData.lightIntensity = light.intensity;
  group.userData.haloOpacity = halo.material.opacity;
  group.userData.flameColor = flame.material.color.clone();
  return group;
}

// A stake with a pennant on it: the cheapest object that says somebody claimed
// this ground. It is not a lantern and deliberately carries no light - the camp
// is marked, not lit, and a fourth pool of amber on this board would say a
// fourth family lives here.
//
// The pennant is two triangles' worth of one, double-sided, and it is the only
// part that matters: a bare post is a stick, and a post with a rag on it is a
// boundary.
function buildStake(mats, height) {
  const group = new THREE.Group();

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.022, height * 0.035, height, 5),
    mats.lantern,
  );
  post.position.y = height * 0.5;
  group.add(post);

  // A pennant, hanging off the top and tapering to a point. Flown along local
  // +X; PropLayer leaves the yaw it was built with alone, so which way it points
  // is the hex's own hash and a row of them does not line up.
  const w = height * 0.34, h = height * 0.2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    0, -h, 0,
    w, -h * 0.42, 0,
  ], 3));
  geo.computeVertexNormals();
  const flag = new THREE.Mesh(geo, mats.pennant);
  flag.position.set(height * 0.03, height * 0.94, 0);
  group.add(flag);

  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(height * 0.04, 0), mats.rock);
  cap.position.y = height * 1.01;
  group.add(cap);

  return group;
}

function buildRock(mats, size, { squash = 0.62 } = {}) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mats.rock);
  // Squashed and slightly sunk, so it sits like a boulder rather than floating
  // like a ball.
  rock.scale.y = squash;
  rock.position.y = size * squash * 0.55;
  return rock;
}

// A cut trunk lying where it fell. Sunk to just under half its radius so it sits
// *in* the ground rather than balancing on it - a cylinder resting exactly on the
// surface reads as a pipe somebody delivered.
function buildLog(mats, size) {
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(size, size * 0.86, size * 6.5, 6),
    mats.trunk,
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = size * 0.8;
  return log;
}

// What is left where a tree was taken. Wider than it is tall, which is the only
// thing that stops it reading as a very short log standing on end.
function buildStump(mats, size) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.82, size, size * 1.1, 7),
    mats.trunk,
  );
  trunk.position.y = size * 0.5;
  group.add(trunk);
  // One root breaking the outline, so the base is not a clean circle.
  const root = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.5, 0), mats.trunk);
  root.scale.y = 0.4;
  root.position.set(size * 0.75, size * 0.14, size * 0.3);
  group.add(root);
  return group;
}

// `sway` is the tilt amplitude in radians, and it is a property of the prop
// because it is the prop that says whether it is the kind of thing wind moves. A
// rock has none. A tree at ~1.4 tall tilting 0.055 rad moves its tip about 0.08
// units - small enough to read as a breeze rather than as a storm.
// `category` is how a type is *authored*, and it is the only thing that decides
// which editor tool a type turns up under. It is on the type rather than in the
// editor because it is a fact about the thing: a tuft of grass is ground texture
// wherever it is used, and a lantern is a decision somebody made. Four of them,
// from numerous-and-derived to singular-and-placed:
//
//   detail    ground cover. Not stored one at a time - a painted hex stores a
//             patch and the tufts are regenerated from it. See game/detail.js.
//   prop      a thing you notice but may see again. Placed or scattered, and
//             either way it becomes a real instance in the level.
//   tree      large enough to hide a unit behind, so it is placed and never
//             scattered.
//   landmark  a decision: a lamp, a marker. Placed one at a time, and the only
//             category with per-instance settings of its own.
//
// A new kind of thing is an entry here with a category, and it appears in the
// right tool's palette with no editor-side change at all.
export const PROP_TYPES = {
  tree: {
    key: 'tree',
    name: 'Pine',
    category: 'tree',
    sway: 0.042,
    build: (mats, n) => buildTree(mats, HEX_WIDTH * (0.36 + n * 0.10)),   // ~0.72 to ~0.92 tall, so ~5 to ~6.5 m
  },
  // The same tree twice more, once narrow and once wide. Height alone does not
  // make a second species - see the note on `girth`.
  tree_spire: {
    key: 'tree_spire',
    name: 'Spire',
    category: 'tree',
    sway: 0.05,
    build: (mats, n) => buildTree(mats, HEX_WIDTH * (0.44 + n * 0.12), { girth: 0.66 }),
  },
  tree_broad: {
    key: 'tree_broad',
    name: 'Broadleaf',
    category: 'tree',
    sway: 0.034,
    build: (mats, n) => buildTree(mats, HEX_WIDTH * (0.32 + n * 0.08), { girth: 1.45 }),
  },
  // Shorter things get a bigger angle, because what the eye reads is how far the
  // top travels: a tuft leaning 0.2 rad moves its tip about as far as a tree
  // leaning 0.04, which is why one number for everything would leave the small
  // stuff looking bolted down.
  bush: {
    key: 'bush',
    name: 'Bush',
    category: 'prop',
    sway: 0.075,
    build: (mats, n) => buildBush(mats, HEX_WIDTH * (0.055 + n * 0.028)),  // ~0.11 to ~0.17 radius
  },
  rock: {
    key: 'rock',
    name: 'Rock',
    category: 'prop',
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.085 + n * 0.038)),   // ~0.17 to ~0.25 radius
  },
  boulder: {
    key: 'boulder',
    name: 'Boulder',
    category: 'prop',
    // Something to walk round rather than over, and no larger: at a third of a
    // hex across a boulder stops reading as a rock and starts reading as a
    // building nobody can enter.
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.105 + n * 0.032), { squash: 0.85 }),
  },
  log: {
    key: 'log',
    name: 'Log',
    category: 'prop',
    build: (mats, n) => buildLog(mats, HEX_WIDTH * (0.028 + n * 0.014)),
  },
  stump: {
    key: 'stump',
    name: 'Stump',
    category: 'prop',
    build: (mats, n) => buildStump(mats, HEX_WIDTH * (0.055 + n * 0.022)),
  },

  // Ground cover. Five tufts out of one builder, and the numbers are the whole
  // difference between them - a set whose variants are one shape at three sizes
  // is a set that reads as repetition, which is the thing a scatter is for
  // avoiding. Flowers and mushrooms are the obvious next entries and want a
  // colour each in mood.js, which is why they are not here yet.
  //
  // A tuft is smaller than a shadow map texel at this range, so casting from one
  // costs a draw call per blade and buys a flicker. None of them do.
  grass: {
    key: 'grass',
    name: 'Short tuft',
    category: 'detail',
    sway: 0.2,
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019)),  // ~0.12 to ~0.18 tall
  },
  grass_tall: {
    key: 'grass_tall',
    name: 'Tall tuft',
    category: 'detail',
    sway: 0.24,
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019),
      { blades: 4, tall: 1.55, splay: 0.16, thick: 0.13 }),
  },
  grass_broad: {
    key: 'grass_broad',
    name: 'Broad tuft',
    category: 'detail',
    sway: 0.16,
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019),
      { blades: 6, tall: 0.85, splay: 0.5, thick: 0.22 }),
  },
  grass_low: {
    key: 'grass_low',
    name: 'Low mat',
    category: 'detail',
    sway: 0.12,
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019),
      { blades: 5, tall: 0.5, splay: 0.66, thick: 0.2 }),
  },
  grass_fine: {
    key: 'grass_fine',
    name: 'Sparse tuft',
    category: 'detail',
    sway: 0.26,
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019),
      { blades: 3, tall: 0.85, splay: 0.2, thick: 0.1 }),
  },
  pebble: {
    key: 'pebble',
    name: 'Pebble',
    category: 'detail',
    shadow: false,
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.022 + n * 0.014)),
  },
  pebble_flat: {
    key: 'pebble_flat',
    name: 'Flat stone',
    category: 'detail',
    shadow: false,
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.03 + n * 0.016), { squash: 0.3 }),
  },

  lantern: {
    key: 'lantern',
    name: 'Lantern',
    category: 'landmark',
    // What a placement of this type may say about itself, beyond where it is.
    // The editor reads it to decide which extra controls to offer, so a landmark
    // with settings of its own is a word here and not a branch over there.
    lights: true,
    // `flicker` is the swing in the light's output, as a fraction. Small: a lamp
    // that visibly pulses reads as a fault, not as a flame.
    flicker: 0.09,
    build: (mats, n, tuning) =>
      buildLantern(mats, HEX_WIDTH * (0.30 + n * 0.045), tuning),   // ~0.60 to ~0.69 tall, so ~4.5 m
  },
  // Taller than a person and thinner than everything else, so it reads at a
  // distance without taking any room. It sways more than a tree does: a light
  // post with a rag on it is the thing on this board a breeze would actually
  // move.
  stake: {
    key: 'stake',
    name: 'Marker',
    category: 'landmark',
    sway: 0.055,
    build: (mats, n) => buildStake(mats, HEX_WIDTH * (0.19 + n * 0.03)),   // ~0.38 to ~0.44 tall
  },
};

// The types in one category, in the order they are declared here - which is the
// order a palette shows them in.
export function propTypesIn(category) {
  return Object.values(PROP_TYPES).filter(t => t.category === category);
}

// Builds one placement into an Object3D positioned on the tile surface. Jitter is
// keyed to the hex, so props never look pinned to the exact centre of a cell and
// never move between loads.
//
// `salt` separates several props sharing one hex: without it, two tufts on the
// same tile would draw the same size, the same jitter and the same rotation, and
// sit exactly on top of each other.
export function buildProp(placement, mats, { x, z, y }, tuning = {}) {
  const type = PROP_TYPES[placement.type];
  if (!type) throw new Error(`Unknown prop type "${placement.type}"`);

  const { q, r } = placement;
  const salt = (placement.salt ?? 0) * 7;
  const size = hashHex(q, r, 21 + salt);

  // A placement may carry its own light, which is the difference between "there
  // is a lamp here" and "this corner is lit". It is merged *over* the hour's
  // default rather than replacing it, so a lantern that says nothing still looks
  // like every other lantern - and so a level only has to state the numbers it
  // actually meant to change.
  //
  // Colour is deliberately not among them. What colour a light is belongs to the
  // hour and lives in mood.js; how bright it is and how far it reaches is what a
  // level is placing it for.
  const local = placement.light
    ? { ...tuning, lanternLight: { ...tuning.lanternLight, ...placement.light } }
    : tuning;
  const obj = type.build(mats, size, local);

  // Where in the tile it stands, and it is a *slot* rather than a free jitter.
  // Two draws from the hash land on top of each other often enough to see it -
  // with six tufts on a tile it is not a rare accident, it is most tiles - and two
  // tufts in one place read as one bigger tuft, so the density the author asked
  // for is not the density they get.
  //
  // The golden angle plus three radial bands gives every slot its own place: turn
  // 137.5 degrees and change how far out you are, and consecutive slots cannot
  // coincide however many there are. The hash is still in there, but only as a
  // small nudge, so a tile does not read as a pattern either.
  //
  // The slot is the placement's own number and never depends on how many share
  // the tile. That is what lets a second tree be stood on a hex without the first
  // one moving - which it would, if this were a division of the tile between
  // however many are currently on it.
  const spread = placement.spread ?? 0.35;
  const slot = placement.slot ?? placement.salt ?? 0;
  const angle = slot * 2.399963 + hashHex(q, r, 23 + salt) * 0.7;
  const band = ((slot % 3) + 0.5) / 3;
  const dist = spread * 0.5 * (0.35 + 0.65 * band) * (0.94 + hashHex(q, r, 27 + salt) * 0.12);
  obj.position.x = x + Math.cos(angle) * dist;
  obj.position.z = z + Math.sin(angle) * dist;
  obj.position.y += y;
  // Which way it faces is its hash unless the placement says otherwise, which is
  // what lets a whole scattering be turned the same way without storing an angle
  // per instance - the default costs no data and is already varied.
  obj.rotation.y = placement.yaw ?? hashHex(q, r, 31 + salt) * Math.PI * 2;
  // And how big, on top of the size its hash already gave it. Applied to the
  // built object rather than folded into that hash because a placement is
  // scaling *this instance* of something, not choosing a different one.
  if (placement.scale !== undefined && placement.scale !== 1) {
    obj.scale.multiplyScalar(placement.scale);
  }

  // Taller props lean further, and the amplitude is settled here because this is
  // where the size that decided the height is known. The phase and rate are the
  // reason a stand of trees does not move as one object: each one is at its own
  // point in its own slightly different cycle.
  if (type.sway) {
    obj.userData.sway = type.sway * (0.75 + size * 0.5);
    obj.userData.swayPhase = hashHex(q, r, 37 + salt) * Math.PI * 2;
    obj.userData.swayRate = 0.8 + hashHex(q, r, 43 + salt) * 0.45;
  }

  // Anything that is itself light - a flame, its halo - is excluded: a glow that
  // casts a shadow is a contradiction the eye notices immediately.
  const casts = type.shadow !== false;
  obj.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = casts; });

  // The type states a sensible flicker; the mood is allowed to overrule it,
  // because how restless a flame looks is part of the hour, not of the lamp.
  const flicker = tuning.flicker?.[placement.type] ?? type.flicker;
  if (flicker) {
    obj.userData.flicker = flicker;
    obj.userData.flickerPhase = hashHex(q, r, 47 + salt) * Math.PI * 2;
    obj.userData.flickerRate = 0.85 + hashHex(q, r, 53 + salt) * 0.5;
  }
  return obj;
}
