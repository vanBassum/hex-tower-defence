import * as THREE from 'three';
import { hashHex } from '../engine/hex/hex_noise.js';

// What kinds of thing can stand on a hex.
//
// The table is deliberately almost empty. A unit right now is a position, a type
// and how far it can see, because that is every stat the exploration milestone
// can actually spend - and a `health: 10` written down before anything can take
// damage is a number nobody has ever had to defend. Combat stats arrive with
// combat, in this table, without moving anything else.
//
// There are two entries now rather than one, and the second is the whole point
// of the first pickup: the Scout finds a set of colours somebody left on the
// island and the Footmen who follow them join the force. What separates them is
// what a unit is *for* - the Scout sees two rings and the Footmen see one - and
// that is the entire difference the game can express today. It is enough to make
// the pair behave differently on the board, which is what a second unit type has
// to earn before it is worth having.
//
// ── Scale ────────────────────────────────────────────────────────────────────
// A hex holds an army unit - about fifteen people - and that single fact sets
// the scale of everything on the board. It has to be stated somewhere, so it is
// stated here:
//
//   a hex is 1.73 across flat to flat, and that is roughly 12 m of ground
//   → 1 world unit ≈ 7 m
//   → a person is ~1.8 m, so 0.26 units tall
//   → a tree at ~1.4 units is a ~10 m tree, which is what it should be
//
// The first pass got this badly wrong by drawing a unit as *one* figure at 0.84
// units - a five-metre soldier - which quietly told the eye that a hex was about
// three paces across. Nothing else on the board was at fault; the fix is that a
// unit is a formation of people, and each of them is small.
const SOLDIER = 0.26;        // a person, in world units, per unit of hex size
const FOOTPRINT = 0.72;      // how much of the tile's inradius the formation fills

export const UNIT_TYPES = {
  scout: {
    key: 'scout',
    name: 'Scout',
    // The one gameplay stat this milestone has. Two rings is enough to see a
    // step past where you are standing, which is what makes moving feel like it
    // buys something, and short enough that the island still takes a walk to
    // learn.
    viewDistance: 2,
    // How many people are in it. Today this is only what the mesh draws - there
    // is nothing to spend it on - but it is the number that makes the board read
    // at the right size, so it belongs to the type rather than to the model.
    people: 15,
    // How they stand, and what they carry. Both are silhouette rather than
    // decoration: at this size a formation is read by its outline and by nothing
    // else, so the shape of the crowd and whether anything sticks up out of it
    // are the only two things that can tell one unit from another at a glance.
    formation: 'rings',
    jitter: 0.22,
    lamp: true,
    // Reinforcements arrive next to it, and this one field is the whole of that
    // rule. It is what turns the Scout from the unit that sees furthest into the
    // unit the rest of the force depends on: where you have walked it is where
    // anything you find can be brought in, so its position is a *commitment*
    // rather than a viewpoint. Fielding a second one is fielding a second place
    // the army can appear.
    deployAnchor: true,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.scout, colors, tuning),
  },

  // The first thing the player finds, and the first unit that is not a Scout.
  //
  // It sees one ring rather than two, and that is only part of its cost. The
  // rest is that it cannot bring anyone in - only a Scout anchors a deployment -
  // so Footmen marched off on their own are Footmen with nothing behind them,
  // and the Scout keeps a job long after the escort has arrived.
  // Everything else about them - what they hit, what they can take - waits for
  // combat, because a number written before there is anything to spend it on is
  // a number nobody has had to defend.
  footman: {
    key: 'footman',
    name: 'Footmen',
    viewDistance: 1,
    people: 15,
    // Ranks rather than rings, tighter jitter, and spears. A hooded crowd and a
    // helmeted block are nearly the same shape at 0.26 units tall; the bristle
    // of shafts standing above the heads is what actually reads from the game's
    // camera, and it reads instantly.
    formation: 'block',
    jitter: 0.12,
    spears: true,
    lamp: false,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.footman, colors, tuning),
  },
};

const DEFAULT_COLORS = {
  cloak: 0x5a6b84,
  trim:  0x323c4c,
  skin:  0x8c8377,
  steel: 0x99a3b3,
  lampGlow: 0xffb45c,
  select:   0x8fd8e8,
};

// A formation, and knowingly a placeholder: fifteen figures built out of the
// same low-segment flat-shaded primitives the props are, so they sit in the
// scene instead of on top of it.
//
// Two InstancedMeshes rather than thirty objects - a body pass and a head pass -
// so a unit costs two draw calls whatever it is made of, and so the day a
// formation has to lose people it is a `count`. A type that carries spears adds
// a third pass and nothing else.
//
// The Scout's lamp is not decoration. It is the one thing that makes a unit
// findable on a board lit at blue hour, and a scout carrying its own light is
// also the reason it is the thing that reveals the map. The Footmen do not get
// one: two lamps walking the island would say the two units do the same job, and
// the thing that makes them findable instead is the steel above their heads.
//
// Colours come in per type as well as per scene - `colors[type.key]` wins over
// `colors` - so the mood file can say what a Scout looks like and what Footmen
// look like without a second palette being threaded through the constructor.
function buildSquad(type, colors = {}, tuning = {}) {
  const c = { ...DEFAULT_COLORS, ...colors, ...(colors[type.key] ?? {}) };
  const hexSize = tuning.hexSize ?? 1;
  const inradius = hexSize * Math.sqrt(3) / 2;
  const reach = inradius * FOOTPRINT;
  const h = SOLDIER * hexSize;
  const n = type.people ?? 12;

  const group = new THREE.Group();
  const own = [];

  // Body and head are separate passes rather than one merged person, because at
  // this size the head is a third of what reads as a silhouette and it wants its
  // own colour.
  const bodyGeo = new THREE.CylinderGeometry(h * 0.13, h * 0.22, h * 0.66, 4);
  bodyGeo.translate(0, h * 0.33, 0);
  const headGeo = new THREE.IcosahedronGeometry(h * 0.15, 0);
  headGeo.translate(0, h * 0.80, 0);

  const bodyMat = new THREE.MeshLambertMaterial({ color: c.cloak, flatShading: true });
  const headMat = new THREE.MeshLambertMaterial({ color: c.trim, flatShading: true });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
  const heads  = new THREE.InstancedMesh(headGeo, headMat, n);
  group.add(bodies, heads);
  own.push(bodies, heads);

  // A spear is drawn as one tapered shaft with no head on it: a tip at this
  // scale is a third of a pixel, and what carries is the line and the fact that
  // it catches light the cloaks do not.
  let spears = null;
  if (type.spears) {
    const spearGeo = new THREE.CylinderGeometry(h * 0.008, h * 0.022, h * 1.7, 3);
    spearGeo.translate(0, h * 0.85, 0);
    const spearMat = new THREE.MeshLambertMaterial({ color: c.steel, flatShading: true });
    spears = new THREE.InstancedMesh(spearGeo, spearMat, n);
    group.add(spears);
    own.push(spears);
  }

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Euler();

  const spread = type.jitter ?? 0.22;
  for (let i = 0; i < n; i++) {
    const { x, z } = formationSpot(i, n, reach, type.formation);
    // A rank that is exactly a rank reads as a fence. Jitter is keyed to the
    // index so a squad looks the same every time it is drawn, and how much of it
    // a unit gets is the type's business: a scouting party stands about, and a
    // line of Footmen is supposed to look like it was told where to stand.
    const jx = (hashHex(i, 0, 11) - 0.5) * reach * spread;
    const jz = (hashHex(i, 0, 17) - 0.5) * reach * spread;
    // They face the way the unit does, but not to the degree - people in a
    // formation are pointed the same way, not machined into it.
    const yaw = (hashHex(i, 0, 23) - 0.5) * 0.7;
    // A little variation in height, because fifteen identical people is a
    // colonnade.
    const s = 0.88 + hashHex(i, 0, 29) * 0.26;

    pos.set(x + jx, 0, z + jz);
    quat.setFromAxisAngle(up, yaw);
    scale.set(s, s, s);
    m.compose(pos, quat, scale);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);

    if (spears) {
      // Shouldered rather than planted, and each at its own angle. Fifteen
      // shafts at one angle is a comb; the spread is what makes it a crowd
      // carrying spears. Held off the shoulder so the shaft does not grow out of
      // the middle of anyone's head.
      pos.x += Math.cos(yaw) * h * 0.16;
      pos.z -= Math.sin(yaw) * h * 0.16;
      tilt.set((hashHex(i, 0, 31) - 0.5) * 0.26, yaw, (hashHex(i, 0, 37) - 0.5) * 0.26);
      quat.setFromEuler(tilt);
      m.compose(pos, quat, scale);
      spears.setMatrixAt(i, m);
    }
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (spears) spears.instanceMatrix.needsUpdate = true;

  // A figure this small is well under a shadow-map texel at this range, so
  // casting from it costs a draw call and buys a flicker - the same trade the
  // grass tufts already made.
  bodies.castShadow = heads.castShadow = false;
  if (spears) spears.castShadow = false;

  // The lamp-bearer stands at the front of the formation. An unlit bead plus a
  // real point light, for the reason the lanterns have one each: a glow with no
  // source is a mystery and a source with no glow is a decoration.
  let light = null;
  if (type.lamp) {
    const bead = new THREE.Mesh(
      new THREE.IcosahedronGeometry(h * 0.22, 0),
      new THREE.MeshBasicMaterial({ color: c.lampGlow }),
    );
    bead.position.set(reach * 0.18, h * 1.05, reach * 0.92);
    bead.userData.noShadow = true;
    group.add(bead);
    own.push(bead);

    light = new THREE.PointLight(
      tuning.lamp?.color ?? c.lampGlow,
      tuning.lamp?.intensity ?? 2.6,
      tuning.lamp?.distance ?? 3.4,
      tuning.lamp?.decay ?? 2,
    );
    light.position.copy(bead.position);
    group.add(light);
  }

  // Selection is a ring on the ground rather than a tint on the people: they are
  // small and dark by design, and recolouring the one readable thing on the board
  // to say "chosen" costs the thing that made it readable. It is sized off the
  // *tile* rather than off the formation, because what is selected is the unit
  // standing on that hex.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(inradius * 0.86, inradius * 0.032, 4, 30),
    new THREE.MeshBasicMaterial({
      color: c.select, transparent: true, opacity: 0.85, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  ring.userData.noShadow = true;
  group.add(ring);
  own.push(ring);

  for (const o of own) o.userData.ownMaterial = true;

  group.userData.selectionRing = ring;
  group.userData.lamp = light;
  group.userData.people = n;
  return group;
}

// Where the i-th person stands. Sizes are fractions of the tile's reach rather
// than absolute, so a layout survives a change of hex size, and both layouts
// keep their shape at any count - which is what lets a formation that has lost
// people still be the same formation.
function formationSpot(i, n, reach, layout = 'rings') {
  return layout === 'block' ? blockSpot(i, n, reach) : ringSpot(i, n, reach);
}

// Concentric rings, filled outward: a party standing around rather than drawn
// up. Local +Z is the way the unit faces, and a ring has no front, which is
// exactly right for the people whose job is looking at things.
function ringSpot(i, n, reach) {
  const RINGS = [
    { count: 1, radius: 0.00 },
    { count: 5, radius: 0.44 },
    { count: 9, radius: 0.85 },
  ];
  let seen = 0;
  for (const ring of RINGS) {
    if (i < seen + ring.count) {
      const k = i - seen;
      // Each ring is turned off the one inside it, so people do not line up
      // along radial spokes.
      const a = (Math.PI * 2 * k) / ring.count + seen * 0.7;
      const r = ring.radius * reach;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }
    seen += ring.count;
  }
  // More people than the rings hold: spiral outward rather than refuse.
  const k = i - seen;
  const a = k * 2.399;
  return { x: Math.cos(a) * reach, z: Math.sin(a) * reach };
}

// Ranks abreast, front rank toward +Z, which is the direction the unit walks and
// turns to face. A block has a front, and that is the point of it: the Footmen
// are the thing you put between the Scout and whatever is out there, so which
// way they are pointed has to be visible before there is any combat to prove it.
function blockSpot(i, n, reach) {
  const cols = 5;
  const rows = Math.max(1, Math.ceil(n / cols));
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: (col - (cols - 1) / 2) * (reach * 2 / cols),
    // Rows run back from the front, and the whole block is centred on the tile.
    z: ((rows - 1) / 2 - row) * (reach * 1.6 / rows),
  };
}
