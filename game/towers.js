import * as THREE from 'three';
import { GameObject } from '../engine/gameobject.js';
import { Tower } from './components/tower.js';

// One tower for now, and it is the machine gun Phase 2 asks for rather than a
// throwaway placeholder. Range is in world units; neighbouring hex centres are
// sqrt(3) apart, so 3.6 reaches a little past the second ring.
export const TOWER_TYPES = {
  gun: {
    key: 'gun',
    name: 'Machine Gun',
    cost: 40,
    range: 3.6,
    damage: 9,
    fireRate: 3.5,     // shots per second
    turnRate: 7,       // radians per second
    color: 0x7d858f,
    tracerColor: 0xffe9a0,
  },
};

function buildMesh(type) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.6, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, roughness: 0.5, metalness: 0.35 });

  // Hex-shaped plinth so towers read as sitting in the grid, not on it.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.3, 6), darkMat);
  base.rotation.y = Math.PI / 6;
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const turret = new THREE.Group();
  turret.position.y = 0.3;
  group.add(turret);

  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.56), bodyMat);
  housing.position.y = 0.17;
  housing.castShadow = true;
  turret.add(housing);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8), darkMat);
  barrel.geometry.rotateX(Math.PI / 2);   // local +Z is forward
  barrel.position.set(0, 0.19, 0.45);
  barrel.castShadow = true;
  turret.add(barrel);

  return { group, turret, muzzleLength: 0.76, muzzleY: 0.49 };
}

export function buildTower(game, typeKey, hex, grid, { y = 0 } = {}) {
  const type = TOWER_TYPES[typeKey];
  if (!type) throw new Error(`Unknown tower type "${typeKey}"`);

  const { x, z } = grid.hexToWorld(hex.q, hex.r);
  const go = new GameObject(`Tower:${typeKey}`);
  go.position.set(x, y, z);

  const { group, turret, muzzleLength, muzzleY } = buildMesh(type);
  go.object3D.add(group);

  const tower = go.addComponent(new Tower(type, { turret, muzzleLength, muzzleY }));
  tower.hex = hex;

  game.add(go);
  return tower;
}
