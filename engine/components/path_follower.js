import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Walks the GameObject along a fixed list of world points at a constant speed.
// `travelled` is tracked because "furthest along the path" is the target
// priority towers will want, and it stays comparable between enemies of
// different speeds.
export class PathFollower extends Component {
  constructor(points, { speed = 2, y = 0, faceDirection = true, onArrive = null } = {}) {
    super();
    if (!points.length) throw new Error('PathFollower needs at least one point');
    this._points   = points.map(p => new THREE.Vector2(p.x, p.z));
    this.speed     = speed;
    this.travelled = 0;
    this.arrived   = false;
    this.heading   = new THREE.Vector2(0, 1);
    this._y        = y;
    this._face     = faceDirection;
    this._onArrive = onArrive;
    this._index    = 1;   // point we are walking toward
    this._pos      = new THREE.Vector2();
  }

  start() {
    this._pos.copy(this._points[0]);
    this._write();
    if (this._points.length === 1) this._finish();
  }

  update(dt) {
    if (this.arrived) return;

    // Budget is spent across waypoints so a corner never costs a frame of
    // movement, which matters most for the fastest enemies.
    let budget = this.speed * dt;
    while (budget > 0 && !this.arrived) {
      const target = this._points[this._index];
      const dx = target.x - this._pos.x;
      const dy = target.y - this._pos.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= 1e-6) { this._advance(); continue; }
      this.heading.set(dx / dist, dy / dist);

      if (dist <= budget) {
        this._pos.copy(target);
        this.travelled += dist;
        budget -= dist;
        this._advance();
      } else {
        this._pos.x += this.heading.x * budget;
        this._pos.y += this.heading.y * budget;
        this.travelled += budget;
        budget = 0;
      }
    }
    this._write();
  }

  _advance() {
    this._index++;
    if (this._index >= this._points.length) this._finish();
  }

  _finish() {
    this.arrived = true;
    this._onArrive?.(this.gameObject);
  }

  _write() {
    this.gameObject.position.set(this._pos.x, this._y, this._pos.y);
    // Local +Z is forward.
    if (this._face) this.gameObject.rotation.y = Math.atan2(this.heading.x, this.heading.y);
  }
}
