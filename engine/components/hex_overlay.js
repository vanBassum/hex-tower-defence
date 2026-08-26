import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Fills a set of hexes with a flat translucent colour. Coplanar overlays fight
// over the depth buffer, so each one sits at its own `y` rather than relying on
// polygon offset.
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
    if (this._mesh) {
      this.gameObject.object3D.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh = null;
    }
    if (!this._hexes.length) return;

    const positions = [];
    for (const { q, r } of this._hexes) {
      const c = this._grid.hexToWorld(q, r);
      const corners = this._grid.hexCorners(q, r);
      const y = this._heightAt ? this._heightAt(q, r) + this._y : this._y;
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        positions.push(c.x, y, c.z, a.x, y, a.z, b.x, y, b.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this._mesh = new THREE.Mesh(geo, this._mat);
    this.gameObject.object3D.add(this._mesh);
  }

  destroy() {
    this._mesh?.geometry.dispose();
    this._mat?.dispose();
  }
}
