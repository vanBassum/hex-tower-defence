import * as THREE from 'three';

// Things left on the board to be found.
//
// A pickup is the only object on this island that is neither terrain nor a unit,
// and it exists because of the one sentence the concept doc rests on: a run is
// worth making even when it is lost, because something found on it is kept. That
// makes what a pickup *contains* the important half and what it looks like the
// hard half - it has to be legible as "this is for you" from across a dark board
// without a marker floating over it saying so.
//
// The whole visual argument here is that it is *somebody's kit*, not a glowing
// box. A company's colours planted in the ground, their spears stacked beside
// it, a shield propped at the foot: an object with a story, which is the reason
// it does not need a label. The one concession to game-ness is the light, and
// the lanterns already established what a warm pocket means on this board -
// somebody was here. A pickup is the same statement with nobody left standing in
// it.
//
// Sizes are in world units against the scale set in game/units.js: 1 unit ≈ 7 m,
// a person is 0.26. The standard is about four metres, so it clears the heads of
// the fifteen people who come to collect it and stays under the lanterns, which
// are the tallest things the level has.
const DEFAULT_COLORS = {
  pole:    0x2f2721,
  cloth:   0xc07a3c,
  steel:   0x8d97a6,
  leather: 0x4a3b2c,
  glow:    0xffb45c,
};

export const PICKUP_TYPES = {
  // The first one, and for now the only one. What it grants is a card in every
  // sense the game can currently express: a unit type the player did not have.
  cache: {
    key: 'cache',
    name: 'Abandoned colours',
    grants: { unit: 'footman' },
    build: (colors, tuning) => buildCache(colors, tuning),
  },
};

function buildCache(colors = {}, tuning = {}) {
  const c = { ...DEFAULT_COLORS, ...colors };
  const hexSize = tuning.hexSize ?? 1;
  const H = 0.58 * hexSize;             // the standard, pole top to ground

  const group = new THREE.Group();
  const mats = {
    pole:    new THREE.MeshLambertMaterial({ color: c.pole,    flatShading: true }),
    cloth:   new THREE.MeshLambertMaterial({ color: c.cloth,   flatShading: true, side: THREE.DoubleSide }),
    steel:   new THREE.MeshLambertMaterial({ color: c.steel,   flatShading: true }),
    leather: new THREE.MeshLambertMaterial({ color: c.leather, flatShading: true }),
  };

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(H * 0.018, H * 0.028, H, 5),
    mats.pole,
  );
  pole.position.y = H * 0.5;
  group.add(pole);

  // A cap on top, because a bare cut end reads as an unfinished mesh at any
  // distance where the banner is still legible.
  const finial = new THREE.Mesh(new THREE.OctahedronGeometry(H * 0.045, 0), mats.steel);
  finial.position.y = H * 1.02;
  group.add(finial);

  // The banner. It hangs from the top of the pole along local +X, and the whole
  // prop is turned so that +X is downwind - the same breeze the trees and the
  // sea are already answering, because a flag with private weather is the one
  // object on the board that would obviously have it.
  const cw = H * 0.42, ch = H * 0.46;
  const clothGeo = new THREE.PlaneGeometry(cw, ch, 8, 4);
  clothGeo.translate(cw * 0.5 + H * 0.02, -ch * 0.5, 0);
  const cloth = new THREE.Mesh(clothGeo, mats.cloth);
  cloth.position.y = H * 0.94;
  group.add(cloth);

  // A stack of spears, leaning into each other the way a stand of arms is left
  // when nobody is holding them. Three is the fewest that reads as a stack
  // rather than as two sticks that happen to cross.
  const stackAt = { x: -H * 0.26, z: H * 0.06 };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(H * 0.008, H * 0.016, H * 0.62, 3),
      mats.steel,
    );
    // Tilted outward at the foot, so the three tips meet and the butts splay.
    shaft.position.set(stackAt.x + Math.cos(a) * H * 0.07, H * 0.29, stackAt.z + Math.sin(a) * H * 0.07);
    shaft.rotation.z = -Math.cos(a) * 0.22;
    shaft.rotation.x =  Math.sin(a) * 0.22;
    group.add(shaft);
  }

  // A shield propped against the foot of the pole. Nearly flat on its face to
  // the camera's usual angle, which is what makes it the one part of this that
  // catches the light squarely.
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(H * 0.15, H * 0.15, H * 0.025, 8),
    mats.leather,
  );
  shield.position.set(H * 0.13, H * 0.14, -H * 0.13);
  shield.rotation.x = Math.PI * 0.5;
  shield.rotation.z = -0.35;
  group.add(shield);

  const boss = new THREE.Mesh(new THREE.IcosahedronGeometry(H * 0.04, 0), mats.steel);
  boss.position.copy(shield.position);
  boss.position.z -= H * 0.02;
  group.add(boss);

  // The light, and the bleed around it. Both are the lantern's argument at a
  // lower setting: the pool on the ground is what makes the thing findable from
  // the next tile along, and the halo is what explains where the pool comes
  // from. Dimmer and shorter than a lamp on purpose - this is not a place
  // somebody lives, it is a place somebody stopped.
  const L = { color: c.glow, intensity: 6.0, distance: 5.0, decay: 2, ...tuning.light };
  const light = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay);
  light.position.set(0, H * 0.72, 0);
  group.add(light);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(H * 0.3, 8, 6),
    new THREE.MeshBasicMaterial({
      color: c.glow, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  halo.position.copy(light.position);
  halo.userData.noShadow = true;
  group.add(halo);

  group.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.ownMaterial = true;
    if (!o.userData.noShadow) o.castShadow = true;
  });

  group.userData.height = H;
  group.userData.light = light;
  group.userData.lightIntensity = light.intensity;
  group.userData.halo = halo;
  group.userData.haloOpacity = halo.material.opacity;
  group.userData.cloth = cloth;
  // The cloth is waved by writing its vertices every frame, so the flat version
  // of it has to be kept: a displacement applied to already-displaced positions
  // is a cloth that walks away from its pole.
  group.userData.clothRest = clothGeo.attributes.position.array.slice();
  group.userData.clothSize = { w: cw, h: ch };
  return group;
}
