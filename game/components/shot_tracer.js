import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';

// A one-frame-ish line from muzzle to target that fades out and removes itself.
// Hitscan damage is invisible without it; it is also the only way to see which
// tower is shooting what.
export class ShotTracer extends Component {
  constructor(from, to, { color = 0xffe9a0, life = 0.08 } = {}) {
    super();
    this._from = from;
    this._to   = to;
    this._color = color;
    this._life = life;
    this._maxLife = life;
  }

  start() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      this._from.x, this._from.y, this._from.z,
      this._to.x,   this._to.y,   this._to.z,
    ], 3));
    this._mat = new THREE.LineBasicMaterial({
      color: this._color, transparent: true, opacity: 1, depthWrite: false,
    });
    this._line = new THREE.Line(geo, this._mat);
    this.gameObject.object3D.add(this._line);
  }

  update(dt) {
    this._life -= dt;
    if (this._life <= 0) {
      this.gameObject.game.remove(this.gameObject);
      return;
    }
    this._mat.opacity = this._life / this._maxLife;
  }

  destroy() {
    this._line?.geometry.dispose();
    this._mat?.dispose();
  }
}
