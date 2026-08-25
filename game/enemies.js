import * as THREE from 'three';
import { GameObject } from '../engine/gameobject.js';
import { Health } from '../engine/components/health.js';
import { HealthBar } from '../engine/components/health_bar.js';
import { PathFollower } from '../engine/components/path_follower.js';
import { Enemy } from './components/enemy.js';

// Health and speed are the two axes that exist so far. They are deliberately
// spread wide — a Brute is 6x a Runner's health at a third of its speed — so it
// is obvious when a defence is tuned for the wrong one. bounty is paid on kill;
// leakDamage is what reaching the base costs the player.
export const ENEMY_TYPES = {
  grunt:  { key: 'grunt',  name: 'Grunt',  health: 190, speed: 2.0, radius: 0.30, height: 0.85, color: 0xcc4433, bounty: 2, leakDamage: 1 },
  runner: { key: 'runner', name: 'Runner', health: 105, speed: 4.2, radius: 0.22, height: 0.65, color: 0xd9b038, bounty: 1, leakDamage: 1 },
  brute:  { key: 'brute',  name: 'Brute',  health: 780, speed: 1.3, radius: 0.44, height: 1.10, color: 0x8b4bb0, bounty: 5, leakDamage: 3 },
};

function buildMesh(type) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.55, metalness: 0.1 });

  const bodyLen = Math.max(0.05, type.height - type.radius * 2);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(type.radius, bodyLen, 4, 12), mat);
  body.castShadow = true;
  group.add(body);

  // Nose cone along local +Z, which PathFollower keeps pointed down the path.
  // Facing is cosmetic now and load-bearing once mirrors arrive.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(type.radius * 0.55, type.radius * 1.2, 10), mat);
  nose.geometry.rotateX(Math.PI / 2);
  nose.position.z = type.radius * 1.1;
  nose.castShadow = true;
  group.add(nose);

  return group;
}

export function spawnEnemy(game, typeKey, worldPath, { onLeak = null, onDeath = null } = {}) {
  const type = ENEMY_TYPES[typeKey];
  if (!type) throw new Error(`Unknown enemy type "${typeKey}"`);

  const go = new GameObject(`Enemy:${typeKey}`);
  go.object3D.add(buildMesh(type));

  const enemy = go.addComponent(new Enemy(type));
  go.addComponent(new Health({
    max: type.health,
    onDeath: () => { onDeath?.(enemy); game.remove(go); },
  }));
  go.addComponent(new PathFollower(worldPath, {
    speed: type.speed,
    y: (game.pathY ?? 0) + type.height / 2,
    onArrive: () => { onLeak?.(enemy); game.remove(go); },
  }));
  go.addComponent(new HealthBar({ y: type.height * 0.9, width: 0.55 + type.radius }));

  game.add(go);
  return enemy;
}
