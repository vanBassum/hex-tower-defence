import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Traces the outline of a set of hexes - the border between one terrain type and
// everything around it.
//
// Boundary edges are found by counting: every edge interior to the region is
// shared by two hexes and so appears twice, while a boundary edge appears once.
// That needs no corner-to-neighbour mapping, which is the part that is easy to
// get subtly wrong on a hex grid.
export class HexRegionOutline extends Component {
  // `heightAt`, when given, makes `y` a lift above each tile's own surface
  // rather than one height for the whole region - the same reason HexOverlay
  // takes one. A border is drawn on the ground, and ground that is not flat
  // takes a border drawn at one height and buries half of it.
  //
  // A boundary edge belongs to exactly one hex, which is what makes this well
  // defined: the height is that hex's, so a rim running along the foot of a
  // slope stays on the low side rather than splitting the difference.
  constructor(grid, hexes, {
    color = 0x6b5836, opacity = 0.85, y = 0.01, lineWidth = 1, heightAt = null,
  } = {}) {
    super();
    this._grid    = grid;
    this._hexes   = hexes;
    this._color   = color;
    this._opacity = opacity;
    this._y       = y;
    this._lineWidth = lineWidth;
    this._heightAt = heightAt;
  }

  start() {
    const counts = new Map();
    // Quantised so the two hexes sharing an edge agree on its key.
    const key = (p) => `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;

    for (const { q, r } of this._hexes) {
      const corners = this._grid.hexCorners(q, r);
      const y = (this._heightAt ? this._heightAt(q, r) : 0) + this._y;
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        const ka = key(a), kb = key(b);
        // Order-independent, so the same edge from either hex hashes alike.
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const seen = counts.get(k);
        if (seen) seen.n++;
        else counts.set(k, { n: 1, a, b, y });
      }
    }

    const pos = [];
    for (const { n, a, b, y } of counts.values()) {
      if (n !== 1) continue;
      pos.push(a.x, y, a.z, b.x, y, b.z);
    }
    this.segmentCount = pos.length / 6;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this._mat = new THREE.LineBasicMaterial({
      color: this._color,
      transparent: this._opacity < 1,
      opacity: this._opacity,
      linewidth: this._lineWidth,
    });
    this._lines = new THREE.LineSegments(geo, this._mat);
    this.gameObject.object3D.add(this._lines);
  }

  destroy() {
    this._lines?.geometry.dispose();
    this._mat?.dispose();
  }
}
