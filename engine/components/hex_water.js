import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { hashHex, patchNoise } from '../hex/hex_noise.js';

// The sea as hex tiles, drawn the same way the land is: one merged, vertex
// coloured mesh on the same grid. A flat tinted plane is a background - it has no
// relationship to the island standing in it, so the eye reads it as the colour
// behind the board rather than as water.
//
// Colour is a function of *distance to the coast*: tiles touching land are
// shallow and light, two out is mid, beyond that is open water. That gradient is
// the thing a single colour cannot say - that the land continues underwater and
// the water has a bottom.
//
// The motion is two crossing sine trains, and it is deliberately not a
// simulation. Every vertex height is a pure function of where that vertex is and
// what time it is, which buys three things for nothing: neighbouring tiles agree
// about their shared corners because they ask the same question at the same
// point, so the surface never tears; there is no state to step, settle or go
// unstable; and the cost is a couple of sines per vertex.
//
// A ripple spreading from a point - a shell landing in the water - is another
// term in the same function: amplitude that falls off with distance from the
// splash and with time since it, phase driven by `distance - speed * age`. That
// stays a handful of lines and needs no per-tile field, so it is worth waiting
// for something to actually fire it.
export class HexWater extends Component {
  constructor(grid, hexes, {
    y = -0.22,
    // Shallow to deep, indexed by how far the tile is from land. The last entry
    // covers everything further out.
    depthColors = [0x46858c, 0x36717e, 0x2a616f],
    bandScale   = 5.5,    // patch size for the depth wobble - broad, like sandbanks
    patchScale  = 4.0,
    patchAmount = 0.016,
    tileAmount  = 0.008,
    hueAmount   = 0.006,

    // Amplitude in world units, length and angle in world space, period in
    // seconds. Two trains at an angle to each other is enough: they drift in and
    // out of phase, which is what stops the sea looking like corrugated iron. A
    // third mostly cancels the other two and reads as noise.
    swell = [
      { amplitude: 0.045, length: 8.0, angle:  0.55, period: 4.6 },
      { amplitude: 0.028, length: 4.4, angle: -1.15, period: 2.9 },
    ],
    // A wave this size is only a few degrees of tilt and barely catches the
    // light on its own, so the motion you actually see from the game's camera is
    // this: crests take on the colour of the sky they are reflecting and troughs
    // fall back. Not a symmetric brightness swing, because at dusk a dark sea
    // has no headroom to brighten into - the crest has to be told what colour to
    // become, and then a dark base is a feature rather than a problem.
    crestColor   = 0xbfeaf2,
    crestMix     = 0.45,   // how far a full crest goes towards crestColor
    troughDarken = 0.35,   // how far a full trough falls below the base colour
  } = {}) {
    super();
    this._grid = grid;
    this._hexes = hexes ?? [];
    this._y = y;
    this._depthColors = depthColors;
    this._bandScale = bandScale;
    this._patchScale = patchScale;
    this._patchAmount = patchAmount;
    this._tileAmount = tileAmount;
    this._hueAmount = hueAmount;
    // Linear, because that is the space the tile colours end up in below - the
    // blend has to happen between numbers that mean the same thing.
    this._crest = new THREE.Color(crestColor).convertSRGBToLinear();
    this._crestMix = crestMix;
    this._troughDarken = troughDarken;

    // Precomputed into wave numbers, so the per-vertex work is a multiply and a
    // sine rather than a trig call per axis.
    this._swell = swell.map(w => ({
      a: w.amplitude,
      kx: Math.cos(w.angle) * (Math.PI * 2 / w.length),
      kz: Math.sin(w.angle) * (Math.PI * 2 / w.length),
      w: Math.PI * 2 / w.period,
    }));
    this._amplitude = swell.reduce((sum, w) => sum + w.amplitude, 0) || 1;
    this._time = 0;
  }

  get surfaceY() { return this._y; }

  start() {
    const pos = [];
    const col = [];
    const vertexTile = [];      // which tile a vertex takes its base colour from
    const rgb = [];             // one base colour per tile
    const c = new THREE.Color();
    const depth = this._depths();

    this._hexes.forEach(({ q, r }, i) => {
      const { x, z } = this._grid.hexToWorld(q, r);
      this._shade(c, q, r, x, z, this._depthColors[this._band(q, r, x, z, depth)]);
      rgb.push(c.r, c.g, c.b);

      const corners = this._grid.hexCorners(q, r);
      for (let k = 0; k < 6; k++) {
        const a = corners[k], b = corners[(k + 1) % 6];
        // Wound (centre, b, a) so the normal points +Y, matching HexGround.
        pos.push(x, this._y, z, b.x, this._y, b.z, a.x, this._y, a.z);
        vertexTile.push(i, i, i);
        for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
      }
    });

    this._vertexTile = new Int32Array(vertexTile);
    this._baseRGB = new Float32Array(rgb);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this._geo = geo;
    this._pos = geo.getAttribute('position');
    this._col = geo.getAttribute('color');

    // Standard rather than Lambert, and smoother than the ground: the broad
    // sheen the sun leaves on it is what separates water from painted floor.
    this._mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.46, metalness: 0.05,
    });
    this._mesh = new THREE.Mesh(geo, this._mat);
    this.gameObject.object3D.add(this._mesh);
  }

  // Unscaled time on purpose: the level freezes on a win or a loss so the player
  // can look the board over, and a frozen sea reads as a crash.
  update(_dt, rawDt) {
    this._time += rawDt;

    const pos = this._pos.array, col = this._col.array;
    const scale = 1 / this._amplitude;
    for (let v = 0; v < this._vertexTile.length; v++) {
      const o = v * 3;
      // x and z never move, so the vertex carries its own sample position.
      const h = this._heightAt(pos[o], pos[o + 2]);
      pos[o + 1] = this._y + h;

      // Crests blend towards the sky colour, troughs just darken. Both operate
      // on linear numbers, which is what the base colours already are.
      const t = this._vertexTile[v] * 3;
      const n = Math.max(-1, Math.min(1, h * scale));
      if (n > 0) {
        const k = n * this._crestMix;
        col[o]     = this._baseRGB[t]     + (this._crest.r - this._baseRGB[t])     * k;
        col[o + 1] = this._baseRGB[t + 1] + (this._crest.g - this._baseRGB[t + 1]) * k;
        col[o + 2] = this._baseRGB[t + 2] + (this._crest.b - this._baseRGB[t + 2]) * k;
      } else {
        const dim = 1 + n * this._troughDarken;
        col[o]     = this._baseRGB[t] * dim;
        col[o + 1] = this._baseRGB[t + 1] * dim;
        col[o + 2] = this._baseRGB[t + 2] * dim;
      }
    }
    this._pos.needsUpdate = true;
    this._col.needsUpdate = true;
    // Faces are flat shaded, so recomputing normals is what turns the height
    // field into light moving across the water.
    this._geo.computeVertexNormals();
  }

  _heightAt(x, z) {
    let h = 0;
    for (const w of this._swell) h += w.a * Math.sin(w.kx * x + w.kz * z - w.w * this._time);
    return h;
  }

  // Distance from the coast decides the band, then a broad noise field pushes it
  // one step either way. Without that, the bands are a perfect offset of the
  // coastline and the shallows read as a ring drawn around the island rather than
  // as water that happens to be shallower near it. The wobble is patch-scaled, so
  // it makes sandbanks and deep pockets instead of per-tile speckle.
  _band(q, r, x, z, depth) {
    const last = this._depthColors.length - 1;
    let band = Math.min(last, (depth.get(`${q},${r}`) ?? 1) - 1);
    const wobble = patchNoise(x / this._bandScale + 3.1, z / this._bandScale - 8.7);
    if (wobble > 0.68) band += 1;
    else if (wobble < 0.3) band -= 1;
    return Math.max(0, Math.min(last, band));
  }

  // Breadth-first from every tile that touches land, so "depth" means distance
  // through the water and an inlet stays shallow along its whole length.
  _depths() {
    const water = new Set(this._hexes.map(h => `${h.q},${h.r}`));
    const depth = new Map();
    const queue = [];

    for (const h of this._hexes) {
      for (const n of this._ring(h)) {
        // A neighbour that is neither water nor off-grid is land.
        if (!water.has(`${n.q},${n.r}`) && this._grid.inBounds(n.q, n.r)) {
          depth.set(`${h.q},${h.r}`, 1);
          queue.push(h);
          break;
        }
      }
    }

    for (let i = 0; i < queue.length; i++) {
      const h = queue[i];
      const d = depth.get(`${h.q},${h.r}`);
      for (const n of this._ring(h)) {
        const key = `${n.q},${n.r}`;
        if (!water.has(key) || depth.has(key)) continue;
        depth.set(key, d + 1);
        queue.push(n);
      }
    }
    return depth;
  }

  // The grid's own neighbour walk stops at the board, and water is off it.
  _ring({ q, r }) {
    return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
      .map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
  }

  _shade(c, q, r, x, z, hex) {
    const patch = patchNoise(x / this._patchScale + 11.3, z / this._patchScale + 5.9) - 0.5;
    const tile  = hashHex(q, r, 23) - 0.5;
    const hue   = hashHex(q, r, 41) - 0.5;
    // Offsets in sRGB, then converted, so an amount means the same visible step
    // whatever the base colour - the same reason HexGround does it this way.
    c.setHex(hex, THREE.LinearSRGBColorSpace);
    c.offsetHSL(
      hue * 2 * this._hueAmount,
      0,
      patch * 2 * this._patchAmount + tile * 2 * this._tileAmount,
    );
    c.convertSRGBToLinear();
  }

  destroy() {
    this._mesh?.geometry.dispose();
    this._mat?.dispose();
  }
}
