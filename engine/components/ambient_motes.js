import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { hashHex } from '../hex/hex_noise.js';

// Very sparse drifting specks: pollen and dust over the land, sparkle on the
// water. The point is peripheral - something in the corner of the eye that says
// the air is not a vacuum - so anything that draws attention to itself is wrong.
//
// Each mote has a home on one of the tiles it was given and never leaves its
// neighbourhood: it drifts on three sines, one per axis, at unrelated periods.
// That is deliberately not a particle system. Nothing is spawned, nothing dies,
// there is no pool to manage and nothing to wrap around at an edge - and a mote
// crossing a wrap boundary is exactly where a cheap effect gives itself away.
//
// Fading is per mote, through additive blending: black adds nothing, so a mote's
// own colour *is* its opacity. Cubing the fade curve keeps every mote dim most of
// the time and briefly bright, which is what makes them read as occasional
// glints rather than as a field of dots.
//
// A mote can also carry a real light, which is what turns specks into fireflies:
// the ground under one brightens as it flares and goes back to ambient as it
// fades, so the mote stops being a sprite in front of the world and starts being
// something in it. It costs a fragment-shader light per firefly, so the count is
// the knob that matters - a dozen is a warm evening, forty is a shader cost with
// no extra effect, because the eye cannot follow forty blinking things anyway.
export class AmbientMotes extends Component {
  constructor(grid, tiles, {
    count     = 40,
    yRange    = [0.4, 2.4],   // world height, low to high
    drift     = { x: 1.5, y: 0.30, z: 1.1 },   // how far a mote wanders from home
    periods   = { x: 9.0, y: 5.5, z: 11.0 },   // seconds per axis, deliberately unrelated
    twinkle   = [5.0, 9.0],   // seconds per fade cycle, low to high
    sharpness = 3,            // higher means dimmer for longer, brighter for less
    size      = 0.055,
    color     = 0xffe9a8,
    // Set to give the first N motes a real point light. `null` means none.
    light     = null,   // { count?, intensity, distance, decay, color? }
    salt      = 0,
  } = {}) {
    super();
    this._grid = grid;
    this._tiles = tiles ?? [];
    this._count = count;
    this._yRange = yRange;
    this._drift = drift;
    this._periods = periods;
    this._twinkle = twinkle;
    this._sharpness = sharpness;
    this._size = size;
    this._color = new THREE.Color(color);
    this._light = light;
    this._salt = salt;
    this._time = 0;
  }

  start() {
    if (!this._tiles.length || this._count <= 0) return;

    const n = this._count;
    this._home = new Float32Array(n * 3);
    this._phase = new Float32Array(n * 4);   // x, y, z, twinkle
    this._rate = new Float32Array(n);        // twinkle rate

    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const [yLow, yHigh] = this._yRange;
    const [tLow, tHigh] = this._twinkle;

    for (let i = 0; i < n; i++) {
      // Deterministic: the same air on every reload. `i` stands in for a hex
      // coordinate, which is all hashHex needs.
      const h = (k) => hashHex(i, 0, this._salt + k);
      const tile = this._tiles[Math.floor(h(1) * this._tiles.length) % this._tiles.length];
      const { x, z } = this._grid.hexToWorld(tile.q, tile.r);

      this._home[i * 3]     = x + (h(2) - 0.5) * 1.6;
      this._home[i * 3 + 1] = yLow + h(3) * (yHigh - yLow);
      this._home[i * 3 + 2] = z + (h(4) - 0.5) * 1.6;

      this._phase[i * 4]     = h(5) * Math.PI * 2;
      this._phase[i * 4 + 1] = h(6) * Math.PI * 2;
      this._phase[i * 4 + 2] = h(7) * Math.PI * 2;
      this._phase[i * 4 + 3] = h(8) * Math.PI * 2;
      this._rate[i] = (Math.PI * 2) / (tLow + h(9) * (tHigh - tLow));

      pos[i * 3] = this._home[i * 3];
      pos[i * 3 + 1] = this._home[i * 3 + 1];
      pos[i * 3 + 2] = this._home[i * 3 + 2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this._geo = geo;
    this._pos = geo.getAttribute('position');
    this._col = geo.getAttribute('color');

    this._mat = new THREE.PointsMaterial({
      size: this._size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      // Additive, so a mote's colour is its brightness and black is invisible -
      // which is how a shared material gets per-mote fading.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this._points = new THREE.Points(geo, this._mat);
    this.gameObject.object3D.add(this._points);

    this._lights = [];
    if (this._light) {
      const L = { count: n, intensity: 2, distance: 3, decay: 2, ...this._light };
      for (let i = 0; i < Math.min(L.count, n); i++) {
        // Positioned every frame from the mote it belongs to, so it is the same
        // object as the speck rather than a light that happens to be near one.
        const pl = new THREE.PointLight(L.color ?? this._color.getHex(), L.intensity, L.distance, L.decay);
        pl.userData.base = L.intensity;
        this._lights.push(pl);
        this.gameObject.object3D.add(pl);
      }
    }
  }

  // Unscaled time, like the water and the trees: the level freezes on a win or a
  // loss and a world that stops dead reads as a crash.
  update(_dt, rawDt) {
    if (!this._points) return;
    this._time += rawDt;

    const t = this._time;
    const wx = (Math.PI * 2) / this._periods.x;
    const wy = (Math.PI * 2) / this._periods.y;
    const wz = (Math.PI * 2) / this._periods.z;
    const pos = this._pos.array, col = this._col.array;

    for (let i = 0; i < this._count; i++) {
      const p = i * 4, o = i * 3;
      pos[o]     = this._home[o]     + Math.sin(wx * t + this._phase[p])     * this._drift.x;
      pos[o + 1] = this._home[o + 1] + Math.sin(wy * t + this._phase[p + 1]) * this._drift.y;
      pos[o + 2] = this._home[o + 2] + Math.sin(wz * t + this._phase[p + 2]) * this._drift.z;

      const fade = (0.5 + 0.5 * Math.sin(this._rate[i] * t + this._phase[p + 3])) ** this._sharpness;
      col[o]     = this._color.r * fade;
      col[o + 1] = this._color.g * fade;
      col[o + 2] = this._color.b * fade;

      // The light rides the same fade, so the pool on the ground pulses with the
      // speck above it. Floored rather than taken to zero: a firefly that goes
      // fully dark leaves a hole where the ground was just lit, and the eye reads
      // the hole rather than the flare.
      const pl = this._lights[i];
      if (pl) {
        pl.position.set(pos[o], pos[o + 1], pos[o + 2]);
        pl.intensity = pl.userData.base * (0.18 + 0.82 * fade);
      }
    }
    this._pos.needsUpdate = true;
    this._col.needsUpdate = true;
  }

  destroy() {
    this._geo?.dispose();
    this._mat?.dispose();
    for (const pl of this._lights ?? []) { pl.parent?.remove(pl); pl.dispose(); }
  }
}
