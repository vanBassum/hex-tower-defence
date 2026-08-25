import * as THREE from 'three';
import { hashHex } from '../engine/hex/hex_noise.js';

// Decoration meshes, built procedurally to match the flat-shaded look: low
// segment counts plus flatShading gives crisp facets without any textures, and
// the colours stay under our control rather than baked into an asset.
//
// Sizes are chosen against the board rather than picked by eye. A hex is 2 wide
// (1.73 flat to flat), enemies stand 0.65 to 1.10 tall and a tower is about 0.6,
// so a tree at ~1.4 reads as scenery you look past and a rock at ~0.4 reads as
// something you could step over.
const HEX_WIDTH = 2;

// Materials are shared across every prop instead of per instance - there is no
// reason for two trees to own separate copies of the same green.
export function createPropMaterials() {
  const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  return {
    trunk:    lambert(0x5b4632),
    foliage:  lambert(0x3f6b32),
    foliage2: lambert(0x4a7a39),
    rock:     lambert(0x7d838b),
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

function buildRock(mats, size) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mats.rock);
  // Squashed and slightly sunk, so it sits like a boulder rather than floating
  // like a ball.
  rock.scale.y = 0.62;
  rock.position.y = size * 0.34;
  return rock;
}

export const PROP_TYPES = {
  tree: {
    key: 'tree',
    build: (mats, n) => buildTree(mats, HEX_WIDTH * (0.62 + n * 0.16)),   // ~1.24 to ~1.56 tall
  },
  rock: {
    key: 'rock',
    build: (mats, n) => buildRock(mats, HEX_WIDTH * (0.13 + n * 0.06)),   // ~0.26 to ~0.38 radius
  },
};

// Builds one placement into an Object3D positioned on the tile surface. Jitter is
// keyed to the hex, so props never look pinned to the exact centre of a cell and
// never move between loads.
export function buildProp(placement, mats, { x, z, y }) {
  const type = PROP_TYPES[placement.type];
  if (!type) throw new Error(`Unknown prop type "${placement.type}"`);

  const { q, r } = placement;
  const size = hashHex(q, r, 21);
  const obj = type.build(mats, size);

  const spread = placement.spread ?? 0.35;
  obj.position.x = x + (hashHex(q, r, 23) - 0.5) * spread;
  obj.position.z = z + (hashHex(q, r, 27) - 0.5) * spread;
  obj.position.y += y;
  obj.rotation.y = hashHex(q, r, 31) * Math.PI * 2;

  obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return obj;
}
