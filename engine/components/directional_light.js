import * as THREE from 'three';
import { Component } from '../gameobject.js';

export class DirectionalLight extends Component {
  constructor({ color = 0xffffff, intensity = 1, shadowExtent = 30 } = {}) {
    super();
    this._color     = color;
    this._intensity = intensity;
    this._extent    = shadowExtent;
  }

  start() {
    const light = new THREE.DirectionalLight(this._color, this._intensity);
    light.position.copy(this.gameObject.position);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near   =  0.5;
    light.shadow.camera.far    =  120;
    light.shadow.camera.left   = -this._extent;
    light.shadow.camera.right  =  this._extent;
    light.shadow.camera.top    =  this._extent;
    light.shadow.camera.bottom = -this._extent;
    this.gameObject.game.scene.add(light);
  }
}
