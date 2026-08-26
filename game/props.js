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

function buildTree(mats, height) {
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
    new THREE.ConeGeometry(height * 0.27, height * 0.5, 7),
    mats.foliage,
  );
  lower.position.y = height * 0.46;
  group.add(lower);

  const upper = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.19, height * 0.42, 7),
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
function buildGrass(mats, size, blades = 4) {
  const group = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + size * 3;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.16, size * 1.6, 3),
      mats.blade,
    );
    blade.position.set(Math.cos(a) * size * 0.3, size * 0.8, Math.sin(a) * size * 0.3);
    // Splayed outward, so the tuft has a shape instead of being a spike.
    blade.rotation.z = -Math.cos(a) * 0.3;
    blade.rotation.x =  Math.sin(a) * 0.3;
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

function buildRock(mats, size) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mats.rock);
  // Squashed and slightly sunk, so it sits like a boulder rather than floating
  // like a ball.
  rock.scale.y = 0.62;
  rock.position.y = size * 0.34;
  return rock;
}

// `sway` is the tilt amplitude in radians, and it is a property of the prop
// because it is the prop that says whether it is the kind of thing wind moves. A
// rock has none. A tree at ~1.4 tall tilting 0.055 rad moves its tip about 0.08
// units - small enough to read as a breeze rather than as a storm.
export const PROP_TYPES = {
  tree: {
    key: 'tree',
    sway: 0.042,
    build: (mats, n) => buildTree(mats, HEX_WIDTH * (0.36 + n * 0.10)),   // ~0.72 to ~0.92 tall, so ~5 to ~6.5 m
  },
  // Shorter things get a bigger angle, because what the eye reads is how far the
  // top travels: a tuft leaning 0.2 rad moves its tip about as far as a tree
  // leaning 0.04, which is why one number for everything would leave the small
  // stuff looking bolted down.
  bush: {
    key: 'bush',
    sway: 0.075,
    build: (mats, n) => buildBush(mats, HEX_WIDTH * (0.055 + n * 0.028)),  // ~0.11 to ~0.17 radius
  },
  grass: {
    key: 'grass',
    sway: 0.2,
    // A tuft is smaller than a shadow map texel at this range, so casting from it
    // costs a draw call per blade and buys a flicker.
    shadow: false,
    build: (mats, n) => buildGrass(mats, HEX_WIDTH * (0.036 + n * 0.019)),  // ~0.12 to ~0.18 tall
  },
  rock: {
    key: 'rock',
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.085 + n * 0.038)),   // ~0.17 to ~0.25 radius
  },
  // Taller than a person and thinner than everything else, so it reads at a
  // distance without taking any room. It sways more than a tree does: a light
  // post with a rag on it is the thing on this board a breeze would actually
  // move.
  stake: {
    key: 'stake',
    sway: 0.055,
    build: (mats, n) => buildStake(mats, HEX_WIDTH * (0.19 + n * 0.03)),   // ~0.38 to ~0.44 tall
  },
  lantern: {
    key: 'lantern',
    // `flicker` is the swing in the light's output, as a fraction. Small: a lamp
    // that visibly pulses reads as a fault, not as a flame.
    flicker: 0.09,
    build: (mats, n, tuning) =>
      buildLantern(mats, HEX_WIDTH * (0.30 + n * 0.045), tuning),   // ~0.60 to ~0.69 tall, so ~4.5 m
  },
};

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
  const obj = type.build(mats, size, tuning);

  const spread = placement.spread ?? 0.35;
  obj.position.x = x + (hashHex(q, r, 23 + salt) - 0.5) * spread;
  obj.position.z = z + (hashHex(q, r, 27 + salt) - 0.5) * spread;
  obj.position.y += y;
  obj.rotation.y = hashHex(q, r, 31 + salt) * Math.PI * 2;

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
