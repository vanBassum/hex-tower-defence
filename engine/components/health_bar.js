import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { Health } from './health.js';

// Camera-facing bar above the owner. Depth testing is off so bars are never
// swallowed by the geometry they belong to, and a full bar stays hidden to keep
// an untouched group from looking like a wall of UI.
export class HealthBar extends Component {
  constructor({ width = 0.7, height = 0.1, y = 1.0, hideWhenFull = true } = {}) {
    super();
    this._w = width;
    this._h = height;
    this._y = y;
    this._hideWhenFull = hideWhenFull;
    this._q = new THREE.Quaternion();
  }

  start() {
    this._health = this.gameObject.getComponent(Health);

    this._group = new THREE.Group();
    this._group.position.y = this._y;
    this._group.renderOrder = 10;

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(this._w, this._h),
      new THREE.MeshBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.7,
                                    depthTest: false, depthWrite: false }),
    );
    back.renderOrder = 10;
    this._group.add(back);

    // Origin shifted to the left edge so scaling drains the bar rightward.
    const fillGeo = new THREE.PlaneGeometry(1, this._h * 0.72);
    fillGeo.translate(0.5, 0, 0);
    this._fillMat = new THREE.MeshBasicMaterial({ color: 0x4fc94f, transparent: true,
                                                  depthTest: false, depthWrite: false });
    this._fill = new THREE.Mesh(fillGeo, this._fillMat);
    this._fill.position.x = -this._w / 2;
    this._fill.position.z = 0.001;
    this._fill.renderOrder = 11;
    this._group.add(this._fill);

    this.gameObject.object3D.add(this._group);
  }

  update() {
    const frac = this._health ? this._health.fraction : 1;
    this._group.visible = !(this._hideWhenFull && frac >= 1);
    if (!this._group.visible) return;

    this._fill.scale.x = Math.max(0, frac) * this._w;
    // Green through amber to red as it drains.
    this._fillMat.color.setHSL(0.33 * frac, 0.75, 0.45);

    const cam = this.gameObject.game.camera;
    if (!cam) return;
    // The owner yaws to face its heading, so undo the parent rotation to get a
    // bar that stays square to the camera.
    this._q.copy(this.gameObject.object3D.quaternion).invert();
    this._group.quaternion.copy(this._q).multiply(cam.quaternion);
  }

  destroy() {
    this._fill?.geometry.dispose();
    this._fillMat?.dispose();
  }
}
