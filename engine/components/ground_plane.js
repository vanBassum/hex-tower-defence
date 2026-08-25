import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Flat shadow-receiving ground at y = 0. Sized to cover the hex grid with a
// margin so the board edge stays out of frame at normal camera angles.
export class GroundPlane extends Component {
  constructor({ size = 100, color = 0x5a7a42 } = {}) {
    super();
    this._size  = size;
    this._color = color;
  }

  start() {
    const geo = new THREE.PlaneGeometry(this._size, this._size);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: this._color }));
    mesh.receiveShadow = true;
    this.gameObject.object3D.add(mesh);
  }
}
