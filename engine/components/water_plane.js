import * as THREE from 'three';
import { Component } from '../gameobject.js';

// The open ocean: one flat plane running out to the fog, sitting a hair below the
// water tiles it continues.
//
// It is deliberately dumb. Everything that makes water read as water - the
// shallows against the coast, the tone patches, the sheen - happens in the hex
// tiles near the island, because that is where the eye is. This is only here so
// the sea has no edge and the tiles need no rim: it hides the underside of the
// board and the far end of the water field in one flat colour.
export class WaterPlane extends Component {
  constructor({ size = 400, y = 0, color = 0x2a616f, roughness = 0.46 } = {}) {
    super();
    this._size = size;
    this._y = y;
    this._color = color;
    this._roughness = roughness;
  }

  start() {
    const geo = new THREE.PlaneGeometry(this._size, this._size);
    geo.rotateX(-Math.PI / 2);
    // Matches the deep end of the tiles' palette, so the field and the ocean are
    // the same body of water rather than two surfaces that happen to meet.
    this._mat = new THREE.MeshStandardMaterial({
      color: this._color, roughness: this._roughness, metalness: 0.05,
    });
    this._mesh = new THREE.Mesh(geo, this._mat);
    this._mesh.position.y = this._y;
    this.gameObject.object3D.add(this._mesh);
  }

  destroy() {
    this._mesh?.geometry.dispose();
    this._mat?.dispose();
  }
}
