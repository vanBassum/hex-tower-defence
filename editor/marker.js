import * as THREE from 'three';
import { Component } from '../engine/gameobject.js';

// A ring on the ground around one *thing*, as opposed to the overlay that fills a
// whole hex.
//
// The two exist because they say different things, and telling them apart is the
// point: a highlighted hex means the tile is selected and a ring means the object
// standing on it is. Before this there was only the hex, so clicking a tree and
// clicking the ground under it looked identical, and the editor had no way to
// admit that they are two different selections.
//
// It is a ring rather than an outline around the mesh because an outline needs a
// second pass over the geometry and this needs to be legible at a glance on a dark
// board. A ring at the foot of something also reads as *on the ground*, which is
// where a thing on a hex is.
export class SelectionMarker extends Component {
  constructor({ color = 0xf0dcc0 } = {}) {
    super();
    this._color = color;
  }

  start() {
    // Unlit and additive, like the hex overlays: it is the editor talking, not
    // something standing in the world, so the hour has no say in how bright it is.
    this._mat = new THREE.MeshBasicMaterial({
      color: this._color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Built at radius one and scaled, so one geometry serves a tuft and a tree.
    this._ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 24), this._mat);
    this._ring.rotation.x = -Math.PI / 2;
    this._ring.visible = false;
    this.gameObject.object3D.add(this._ring);
  }

  // `radius` is in world units - whatever the thing being marked is about as wide
  // as. Lifted a little off the surface, for the same reason the hex overlays are:
  // a ring drawn exactly on the ground fights the ground for the same pixels.
  show(x, y, z, radius = 0.3) {
    this._ring.position.set(x, y + 0.03, z);
    this._ring.scale.setScalar(Math.max(0.12, radius));
    this._ring.visible = true;
  }

  hide() {
    if (this._ring) this._ring.visible = false;
  }

  destroy() {
    this._ring?.geometry.dispose();
    this._mat?.dispose();
  }
}
