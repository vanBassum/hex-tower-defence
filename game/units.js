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
// ── Casualties are the count, and that is the only health there is ──────────
// A unit *is* fifteen people, so it loses them. There is no hit-point pool
// hidden behind a bar over its head: `people` is the number the mesh draws and
// the number it takes damage out of, and the two cannot drift apart because they
// are one field. A formation thinning out as it fights is a health bar that is
// already on the board, in the place the player is already looking, and it needs
// no UI at all.
//
// `attack` is the other half and it is a *rate* - people killed per second while
// two units stand next to each other. Not a die roll and not a turn's worth of
// damage, because there are no turns yet and a number that assumed them would be
// a number that has to be rewritten the day they arrive.
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
    // It can defend itself and that is all. A Scout that fights is a Scout being
    // used wrong, and the number says so without a rule having to.
    attack: 0.4,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.scout, colors, tuning),
  },

  // The one the army arrives around, and the one thing on the board that is
  // always there. A run begins with a King and a Scout and nothing else.
  //
  // He is a *base*, and a base that walks. Every card is played onto a tile next
  // to him, so where he is standing is the whole of the force's reach - and
  // because he can be walked, that reach is a thing the player pushes forward
  // and has to defend rather than a corner of the map they return to. The rule
  // used to live on a camp (a place, so the far shore was tedious) and then on
  // the Scout (a viewpoint, so the one unit that had to survive was the one sent
  // ahead to look). On the King it is neither: the Scout goes back to seeing
  // things and the King goes where the army needs to be able to appear.
  //
  // He is worth nothing else yet. Losing him will one day lose the run, and that
  // is a rule to write when there is something on this island that could kill
  // him - today it would be a sentence nobody could test.
  king: {
    key: 'king',
    name: 'King',
    // One ring, like the Footmen. He is not here to see; he is here to be
    // somewhere, and a base that scouted as well as a Scout would make the Scout
    // a card nobody plays.
    viewDistance: 1,
    // A retinue rather than a company - nine guards and the man himself, which
    // reads as fewer people than a unit and is exactly the point.
    people: 9,
    formation: 'rings',
    jitter: 0.18,
    // The two things that make him readable at ten pixels, and both are
    // silhouette rather than colour: a figure half again as tall as anyone else
    // at the middle of the group, and a standard flying over the whole tile. The
    // standard is the taller of the two and is what actually finds him on a dark
    // board - a Scout is found by its lamp, Footmen by their spears, and the
    // King by the flag.
    leader: true,
    standard: true,
    // And a torch, which is the one place the palette rule gets bent on purpose.
    // The King replaced a camp, and a camp was the warm thing on this board -
    // so the warm pocket did not disappear when the camp did, it started
    // walking. It is wider and deeper-orange than the Scout's lamp and does the
    // same job for the opposite reason: the Scout carries a light because it is
    // out alone in the dark, and the King carries one because he is the place
    // everything comes back to.
    lamp: true,
    deployAnchor: true,
    // A retinue of nine that can hold for a moment. He is not a fighting unit
    // and the day he has to be one is the day the run was already lost.
    attack: 1.4,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.king, colors, tuning),
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
    // What they are for. One body of Footmen beats one body of Spearmen with a
    // third of itself left standing, and loses to two - which is the encounter
    // the concept doc asks the first map to open with.
    attack: 2.2,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.footman, colors, tuning),
  },

  // ── The other side ─────────────────────────────────────────────────────────
  // The first thing on this island that is not the player's, and the shape the
  // rest of them will be poured into: a type with `hostile` on it and a
  // behaviour, so a second kind that keeps its distance or runs for help is a
  // new entry here and a new branch in EnemyForce, not a new system.
  //
  // Spearmen hold. They do not come for you, they do not follow you, and nothing
  // happens until something is standing on the tile next to them - at which
  // point Battle costs both sides people for as long as that stays true.
  //
  // They chased, for one version, and it was wrong for a reason worth keeping:
  // the whole job of a Scout is to see a thing before the thing is a problem, and
  // an enemy that starts walking the moment you are three hexes out takes that
  // away. Seeing them, deciding not to touch them, and going somewhere else has
  // to be a move the player can make. The machinery for the other kind is still
  // in EnemyForce under `stance: 'hunt'`, because the next sort along will want
  // it - this one is `'hold'`.
  spearmen: {
    key: 'spearmen',
    name: 'Spearmen',
    hostile: true,
    viewDistance: 1,
    people: 12,
    attack: 1.8,
    stance: 'hold',
    // A mob rather than a formation, and that is the read. Everything the player
    // owns stands in rings or in ranks; this stands in a crowd, with its spears
    // going every way at once. It works at any zoom and in any light, which
    // colour alone does not.
    formation: 'rings',
    jitter: 0.55,
    spears: true,
    spearTilt: 0.7,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.spearmen, colors, tuning),
  },
};

const DEFAULT_COLORS = {
  cloak: 0x5a6b84,
  trim:  0x323c4c,
  skin:  0x8c8377,
  steel: 0x99a3b3,
  gold:  0xc9a55e,
  banner: 0xb8894a,
  pole:  0x2f2721,
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

  // Each person's own yaw, size and spear tilt, kept so the melee can move them
  // without rebuilding any of it. `x/z` is where they stand in formation and
  // `cx/cz` is where they actually are.
  const spots = [];
  // `yaw` is passed rather than read off the spot because a fight turns people:
  // in formation everyone points the way the unit does, and in a fight they
  // point at whoever is opposite them. The spear follows it - a shouldered shaft
  // that stayed pointed the old way is the tell that a man only slid sideways.
  const write = (i, x, z, yaw = spots[i].yaw) => {
    const sp = spots[i];
    pos.set(x, 0, z);
    quat.setFromAxisAngle(up, yaw);
    scale.set(sp.s, sp.s, sp.s);
    m.compose(pos, quat, scale);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    if (spears) {
      pos.x += Math.cos(yaw) * h * 0.16;
      pos.z -= Math.sin(yaw) * h * 0.16;
      tilt.set(sp.tilt.x, yaw, sp.tilt.z);
      quat.setFromEuler(tilt);
      m.compose(pos, quat, scale);
      spears.setMatrixAt(i, m);
    }
  };

  const spread = type.jitter ?? 0.22;
  for (let i = 0; i < n; i++) {
    // A formation with a leader in it leaves the middle spot for him rather than
    // standing somebody where he goes, so the ranks are filled from one place
    // further along.
    const { x, z } = formationSpot(type.leader ? i + 1 : i, n, reach, type.formation);
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

    // Spears are shouldered rather than planted, each at its own angle: fifteen
    // shafts at one angle is a comb.
    const t = type.spearTilt ?? 0.26;
    spots.push({
      x: x + jx, z: z + jz, cx: x + jx, cz: z + jz, yaw, cyaw: yaw, s,
      tilt: new THREE.Euler((hashHex(i, 0, 31) - 0.5) * t, yaw, (hashHex(i, 0, 37) - 0.5) * t),
    });
    write(i, x + jx, z + jz);
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (spears) spears.instanceMatrix.needsUpdate = true;

  // A figure this small is well under a shadow-map texel at this range, so
  // casting from it costs a draw call and buys a flicker - the same trade the
  // grass tufts already made.
  bodies.castShadow = heads.castShadow = false;
  if (spears) spears.castShadow = false;

  // The man himself: the same shapes as everyone else and half again as big,
  // because a leader drawn from a different kit reads as a different game. The
  // crown is three facets of gold and is not really visible at the game's
  // camera - it is there for the one moment somebody zooms in, and the height is
  // what does the work the rest of the time.
  if (type.leader) {
    const scale = 1.45;
    const kingBody = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.13, h * 0.24, h * 0.66, 5),
      new THREE.MeshLambertMaterial({ color: c.cloak, flatShading: true }),
    );
    kingBody.position.y = h * 0.33 * scale;
    kingBody.scale.setScalar(scale);

    const kingHead = new THREE.Mesh(
      new THREE.IcosahedronGeometry(h * 0.15, 0),
      new THREE.MeshLambertMaterial({ color: c.skin, flatShading: true }),
    );
    kingHead.position.y = h * 0.80 * scale;
    kingHead.scale.setScalar(scale);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.15, h * 0.13, h * 0.09, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: c.gold, flatShading: true, side: THREE.DoubleSide }),
    );
    crown.position.y = h * 0.93 * scale;
    group.add(kingBody, kingHead, crown);
    own.push(kingBody, kingHead, crown);
  }

  // The standard. Tall enough to clear every head on the tile and then some,
  // because it is the thing that has to be picked out from across a fogged
  // board - the King is the one unit the player must always be able to find, on
  // account of being the only place anything can be brought in.
  //
  // The cloth is furled in the geometry rather than animated. Everything else
  // that flies on this island waves on the shared wind, and a Unit has no wind
  // plumbing; a flat rectangle would read as dead where a curved one reads as
  // caught, and that is the whole of what the curve is buying.
  if (type.standard) {
    const H = h * 2.4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.022, h * 0.032, H, 5),
      new THREE.MeshLambertMaterial({ color: c.pole, flatShading: true }),
    );
    pole.position.set(-reach * 0.12, H * 0.5, -reach * 0.24);
    group.add(pole);

    const cw = h * 0.62, ch = h * 0.78;
    const clothGeo = new THREE.PlaneGeometry(cw, ch, 6, 2);
    const pos = clothGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = pos.getX(i) + cw * 0.5;          // 0 at the pole, cw at the fly
      pos.setZ(i, Math.sin((bx / cw) * Math.PI * 1.4) * cw * 0.16 * (bx / cw));
    }
    clothGeo.translate(cw * 0.5 + h * 0.03, -ch * 0.5, 0);
    const cloth = new THREE.Mesh(
      clothGeo,
      new THREE.MeshLambertMaterial({ color: c.banner, flatShading: true, side: THREE.DoubleSide }),
    );
    cloth.position.set(pole.position.x, H * 0.96, pole.position.z);
    group.add(cloth);

    const finial = new THREE.Mesh(
      new THREE.OctahedronGeometry(h * 0.055, 0),
      new THREE.MeshLambertMaterial({ color: c.gold, flatShading: true }),
    );
    finial.position.set(pole.position.x, H * 1.03, pole.position.z);
    group.add(finial);

    own.push(pole, cloth, finial);
  }

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
  // The passes whose `count` is the unit's strength. Losing people is lowering a
  // number here and nothing else - which is what the two-pass instanced build
  // was for in the first place, written down long before there was anything on
  // this island that could take somebody out of a formation.
  group.userData.ranks = spears ? [bodies, heads, spears] : [bodies, heads];
  group.userData.spots = spots;
  group.userData.write = write;
  group.userData.reach = reach;
  group.userData.flush = () => {
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (spears) spears.instanceMatrix.needsUpdate = true;
  };
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
