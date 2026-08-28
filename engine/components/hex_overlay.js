import * as THREE from 'three';
import { Component } from '../gameobject.js';

// A flat mark laid over a set of hexes. This one fills them; `HexCorners` and
// `HexRoute` beside it draw the same set as corner brackets and as a line, and
// both are subclasses rather than separate components for two reasons.
//
// The small one is that everything except the geometry is shared - one unlit
// material, one `setHexes`, one `setY`, one disposal - and three copies of that
// is three places to leak a BufferGeometry.
//
// The load-bearing one is that HexPicker finds its cursor with
// `getComponent(HexOverlay)`. What the picker needs is *a marking of the hex
// under the pointer*; which drawing that is has nothing to do with it, and an
// `instanceof` check is how it stays that way. Subclass to add a marking and the
// picker will use it without being told.
//
// Coplanar overlays fight over the depth buffer, so each one sits at its own `y`
// rather than relying on polygon offset.
export class HexOverlay extends Component {
  // `heightAt`, when given, makes `y` a lift above each tile's own surface
  // rather than one height for the whole set. A range highlight crossing a
  // hillside needs that: a single y sinks half the highlight into the ground.
  //
  // `additive` is the difference between marking a tile and covering one. A
  // normally-blended fill mixes toward its own colour, so at any strength worth
  // seeing it reads as a pale hexagon *stuck on* the ground; additive only ever
  // brightens what is already there, so the tile keeps its own grass and its own
  // shading and simply catches more light. On a board this dark that is the only
  // version worth having.
  constructor(grid, hexes = [], {
    color = 0xffffff, opacity = 0.35, y = 0.03, heightAt = null, additive = false,
  } = {}) {
    super();
    this._grid  = grid;
    this._hexes = hexes;
    this._color = color;
    this._opacity = opacity;
    this._y     = y;
    this._heightAt = heightAt;
    this._additive = additive;
    this._mesh  = null;
  }

  start() {
    this._mat = new THREE.MeshBasicMaterial({
      color: this._color, transparent: true, opacity: this._opacity,
      depthWrite: false, side: THREE.DoubleSide,
      blending: this._additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this._rebuild();
  }

  setHexes(hexes) {
    this._hexes = hexes;
    if (this._mat) this._rebuild();
  }

  // Height is rebuildable: tiles are at different heights, so a marker or cursor
  // has to be able to move to the surface it sits on.
  setY(y) {
    if (y === this._y) return;
    this._y = y;
    if (this._mat) this._rebuild();
  }

  // Colour lives on the shared material, so recolouring never rebuilds geometry.
  setColor(color) {
    this._color = color;
    this._mat?.color.setHex(color);
  }

  _rebuild() {
    this._clear();
    if (!this._hexes.length) return;

    const positions = [];
    for (const { q, r } of this._hexes) {
      const c = this._grid.hexToWorld(q, r);
      const corners = this._grid.hexCorners(q, r);
      const y = this._yAt(q, r);
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        positions.push(c.x, y, c.z, a.x, y, a.z, b.x, y, b.z);
      }
    }
    this._emit(positions);
  }

  destroy() {
    this._mesh?.geometry.dispose();
    this._mat?.dispose();
  }

  // What the subclasses hand their triangles to, so the mesh is made, parented
  // and disposed in exactly one place.
  _emit(positions) {
    if (!positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this._mesh = new THREE.Mesh(geo, this._mat);
    this.gameObject.object3D.add(this._mesh);
  }

  _clear() {
    if (!this._mesh) return;
    this.gameObject.object3D.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh = null;
  }

  // The height of one tile's marking, which is the tile's own surface plus this
  // overlay's lift when there is a ground to ask, and a flat height when there
  // is not.
  _yAt(q, r) {
    return this._heightAt ? this._heightAt(q, r) + this._y : this._y;
  }
}

// One flat bar lying on the ground from A to B, `w` wide, as two triangles. Both
// ends carry their own height, so a run across a step slopes with the land
// instead of burying one end of itself.
//
// It is here rather than in either subclass because both of them are made of
// nothing else: a corner bracket is four bars and a route is one per tile it
// crosses. `LineBasicMaterial` is not an option and that is worth writing down -
// its width is always one pixel in WebGL whatever the number says, so a marking
// that has to read at any zoom has to be built out of geometry.
export function flatBar(out, ax, ay, az, bx, by, bz, w) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const px = (-dz / len) * w * 0.5;
  const pz = ( dx / len) * w * 0.5;
  out.push(
    ax - px, ay, az - pz,   bx - px, by, bz - pz,   bx + px, by, bz + pz,
    ax - px, ay, az - pz,   bx + px, by, bz + pz,   ax + px, ay, az + pz,
  );
}
