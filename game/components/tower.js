import { Component, GameObject } from '../../engine/gameobject.js';
import { Health, makeHit } from '../../engine/components/health.js';
import { PathFollower } from '../../engine/components/path_follower.js';
import { ShotTracer } from './shot_tracer.js';

const TAU = Math.PI * 2;

// Shortest signed distance between two angles.
function angleDelta(a, b) {
  let d = (a - b) % TAU;
  if (d >  Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Hitscan turret. Aiming is done in plain radians rather than through quaternion
// maths: the turret only ever yaws, and keeping it scalar makes "is it pointed
// at the target yet" a comparison instead of a dot product.
//
// Target priority is furthest-along-the-path, read off PathFollower.travelled,
// and a target is kept until it dies or leaves range so the turret does not
// jitter between enemies walking abreast.
export class Tower extends Component {
  constructor(type, { turret = null, muzzleLength = 0.5, muzzleY = 0.75 } = {}) {
    super();
    this.type = type;
    this.target = null;
    this._turret = turret;
    this._muzzleLength = muzzleLength;
    this._muzzleY = muzzleY;
    this._aim = 0;
    this._cooldown = 0;
  }

  get range() { return this.type.range; }

  update(dt) {
    this._cooldown -= dt;

    if (!this._isValidTarget(this.target)) this.target = this._acquire();
    if (!this.target) return;

    const pos = this.gameObject.position;
    const t = this.target.position;
    const desired = Math.atan2(t.x - pos.x, t.z - pos.z);

    const delta = angleDelta(desired, this._aim);
    const step  = this.type.turnRate * dt;
    this._aim += Math.max(-step, Math.min(step, delta));
    if (this._turret) this._turret.rotation.y = this._aim;

    // Only fire once roughly on target, so turn rate is a real cost.
    if (Math.abs(delta) > 0.18 || this._cooldown > 0) return;
    this._fire(this.target);
    this._cooldown += 1 / this.type.fireRate;
  }

  _isValidTarget(enemy) {
    if (!enemy || enemy.gameObject._removed) return false;
    return this._inRange(enemy);
  }

  _inRange(enemy) {
    const pos = this.gameObject.position;
    const dx = enemy.position.x - pos.x;
    const dz = enemy.position.z - pos.z;
    return dx * dx + dz * dz <= this.type.range * this.type.range;
  }

  _acquire() {
    const enemies = this.gameObject.game.enemies;
    if (!enemies?.length) return null;

    let best = null, bestProgress = -Infinity;
    for (const e of enemies) {
      if (!this._inRange(e)) continue;
      const follower = e.gameObject.getComponent(PathFollower);
      const progress = follower ? follower.travelled : 0;
      if (progress > bestProgress) { bestProgress = progress; best = e; }
    }
    return best;
  }

  _fire(enemy) {
    const pos = this.gameObject.position;
    const muzzle = {
      x: pos.x + Math.sin(this._aim) * this._muzzleLength,
      y: this._muzzleY,
      z: pos.z + Math.cos(this._aim) * this._muzzleLength,
    };

    const dx = enemy.position.x - muzzle.x;
    const dz = enemy.position.z - muzzle.z;
    const len = Math.hypot(dx, dz) || 1;

    const health = enemy.gameObject.getComponent(Health);
    health?.damage(this.type.damage, makeHit({
      kind: 'bullet',
      direction: { x: dx / len, z: dz / len },
      source: muzzle,
    }));

    const tracer = new GameObject('Tracer');
    tracer.addComponent(new ShotTracer(muzzle, {
      x: enemy.position.x, y: enemy.position.y, z: enemy.position.z,
    }, { color: this.type.tracerColor }));
    this.gameObject.game.add(tracer);
  }
}
