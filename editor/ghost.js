import * as THREE from 'three';
import { Component } from '../engine/gameobject.js';
import { buildProp, createPropMaterials } from '../game/props.js';

// What a click is about to put down, drawn where it would go.
//
// It is the real mesh, built by the game's own `buildProp` out of the same type
// the click will use - not an outline, not a marker. Anything else would be the
// editor drawing its own idea of a tree, and the whole point of a preview is that
// it is not somebody's idea of the thing.
//
// Two things are taken out of it on the way through, and both cost real money:
//
//   - **every light**. three bakes the number of point lights in the scene into
//     the identity of every shader program, so a ghost lantern arriving under the
//     cursor would recompile every material on the board - and again when it left.
//     That is the gotcha in CLAUDE.md, met here at sixty frames a second rather
//     than once when a card is played.
//   - **every shadow**. A shadow under something that is not there yet reads as
//     the thing already being there, and it is six shadow map passes for a
//     preview.
//
// The mesh is rebuilt only when *what* is being previewed changes. Moving it is
// setting a position, which is what happens on almost every pointer move.
export class Ghost extends Component {
  constructor({ colors = {} } = {}) {
    super();
    this._colors = colors;
    this._key = null;
    this._obj = null;
  }

  start() {
    // Its own materials, because they are see-through and the board's are not.
    // `createPropMaterials` hands out a fresh set per call, so this is a copy of
    // the palette rather than a change to it.
    this._mats = createPropMaterials(this._colors);
    for (const m of Object.values(this._mats)) {
      m.transparent = true;
      m.opacity = 0.55;
      m.depthWrite = false;
      // Self-lit, in its own colour. Faded is not enough on this board: the
      // palette is a dusk palette, so a half-transparent tree in the real
      // foliage green is very nearly black on dark ground - a preview nobody can
      // see. Emissive keeps the facets and the colour, and takes the hour out of
      // it, which is also the right reading: a ghost is not standing in the world
      // yet, so the world's light has no business on it.
      if (m.emissive) m.emissive.copy(m.color).multiplyScalar(0.85);
    }
  }

  // `placement` is what content.js would place - type, scale, yaw, spread - or
  // null for a category with nothing to show. `at` is where on the ground.
  show(placement, at) {
    if (!placement || !at) return this.hide();

    // Only the parts that change the mesh are in the key. Position is not: moving
    // the ghost must not rebuild it.
    const key = `${placement.type}|${placement.scale ?? 1}|${placement.yaw ?? 0}`;
    if (key !== this._key) {
      this._drop();
      this._key = key;
      this._obj = buildProp({ ...placement, q: 0, r: 0, salt: 0, dx: 0, dz: 0 },
        this._mats, { x: 0, z: 0, y: 0 });
      this._strip(this._obj);
      this.gameObject.object3D.add(this._obj);
    }
    this._obj.position.set(at.x, at.y, at.z);
    this._obj.visible = true;
  }

  hide() {
    if (this._obj) this._obj.visible = false;
  }

  // Lights out, shadows off - see the note at the top. The lights are collected
  // first and removed after, because taking a child out of the tree being
  // traversed skips its sibling.
  _strip(obj) {
    const lights = [];
    obj.traverse((o) => {
      if (o.isLight) lights.push(o);
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
    for (const l of lights) l.parent?.remove(l);
  }

  _drop() {
    if (!this._obj) return;
    this.gameObject.object3D.remove(this._obj);
    this._obj.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      // A prop that needed a material of its own - the lantern's flame and halo -
      // owns it, so the shared table below will not catch it.
      if (o.userData.ownMaterial) o.material.dispose();
    });
    this._obj = null;
    this._key = null;
  }

  destroy() {
    this._drop();
    if (this._mats) for (const m of Object.values(this._mats)) m.dispose();
  }
}
