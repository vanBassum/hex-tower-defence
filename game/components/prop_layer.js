import { Component } from '../../engine/gameobject.js';
import { buildProp, createPropMaterials } from '../props.js';

// Places a level's decoration and keeps the wind blowing through it. Props are
// purely visual - they do not block building or affect targeting - so this owns
// nothing but meshes and one angle per tree.
//
// Each prop sits on its tile's surface, which is why it needs the ground
// component rather than assuming y = 0.
//
// The sway is the same idea as the water's swell, for the same reason: pure
// functions of position and time, no state to keep. Three terms, because one sine
// is a metronome and a row of metronomes is worse:
//
//   - a **gust** travelling across the island, `sin(k·position - w·t)`, shared by
//     everything, so a breeze visibly crosses the board and the props downwind
//     lean a moment after the ones upwind. Its direction is the water's swell
//     direction: two effects with private weather look like two effects.
//   - a **flutter** at each prop's own rate and phase, which is what stops a
//     stand of trees moving as one object.
//   - a small **crosswind** wobble, so the motion is not a flat swing in one
//     plane. Nothing in wind moves along a line.
//
// Lantern flames are driven the same way and for the same reason: two sines at
// unrelated rates, per lantern, so no two lamps on the level breathe together.
export class PropLayer extends Component {
  constructor({
    grid, ground = null, props = [], colors = {}, tuning = {},
    // Angle in world space, length and period as the water's swell states them:
    // long and slow, because a gust crossing the whole island is one event.
    // `strength` scales every prop's amplitude at once, so "calmer day" is one
    // number rather than an edit to each prop type.
    wind = { angle: 0.55, length: 11, period: 3.4, strength: 1 },
  }) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._props = props;
    this._colors = colors;
    this._tuning = tuning;
    this._wind = wind;
    this._time = 0;
  }

  start() {
    this._mats = createPropMaterials(this._colors);
    this.count = 0;
    this._swaying = [];
    this._flames = [];

    for (const placement of this._props) {
      const { x, z } = this._grid.hexToWorld(placement.q, placement.r);
      const y = this._ground ? this._ground.topY(placement.q, placement.r) : 0;
      const obj = buildProp(placement, this._mats, { x, z, y }, this._tuning);
      this.gameObject.object3D.add(obj);
      this.count++;

      // Whether a prop moves in wind is the prop's business, decided in props.js.
      if (obj.userData.sway) {
        this._swaying.push({
          obj,
          amp: obj.userData.sway * (this._wind.strength ?? 1),
          phase: obj.userData.swayPhase ?? 0,
          rate: obj.userData.swayRate ?? 1,
          x: obj.position.x,
          z: obj.position.z,
        });
      }

      if (obj.userData.flicker) {
        this._flames.push({
          light: obj.userData.light,
          flame: obj.userData.flame,
          halo: obj.userData.halo,
          baseIntensity: obj.userData.lightIntensity ?? obj.userData.light?.intensity ?? 1,
          baseOpacity: obj.userData.haloOpacity ?? obj.userData.halo?.material.opacity ?? 1,
          amp: obj.userData.flicker,
          phase: obj.userData.flickerPhase ?? 0,
          rate: obj.userData.flickerRate ?? 1,
        });
      }
    }

    const { angle, length, period } = this._wind;
    this._dx = Math.cos(angle);
    this._dz = Math.sin(angle);
    this._kx = this._dx * (Math.PI * 2 / length);
    this._kz = this._dz * (Math.PI * 2 / length);
    this._w  = Math.PI * 2 / period;
  }

  // Unscaled time, like the water: the level freezes on a win or a loss and a
  // world that stops dead reads as a crash.
  update(_dt, rawDt) {
    if (!this._swaying.length && !this._flames.length) return;
    this._time += rawDt;

    for (const t of this._swaying) {
      const gust    = Math.sin(this._kx * t.x + this._kz * t.z - this._w * this._time);
      const flutter = Math.sin(this._time * t.rate * 2.6 + t.phase);
      const cross   = Math.sin(this._time * t.rate * 1.7 + t.phase * 2.3);

      const lean = t.amp * (gust * 0.68 + flutter * 0.32);
      const side = t.amp * 0.3 * cross;

      // Downwind is (dx, dz) and across it is (-dz, dx). The prop keeps the random
      // yaw it was built with, since only the two tilt axes are touched.
      t.obj.rotation.x =  lean * this._dz + side * this._dx;
      t.obj.rotation.z = -lean * this._dx + side * this._dz;
    }

    for (const f of this._flames) {
      // Two rates that do not divide into each other, so the flame wanders
      // instead of pulsing. Both are slow: the fast term is what turns a flame
      // into a fault indicator, and the eye is drawn to the fastest thing on
      // screen whether or not it is the thing worth looking at. The halo follows
      // the light exactly - it is supposed to be the same light, seen in the air
      // rather than on the ground.
      const wobble = 0.72 * Math.sin(this._time * f.rate * 0.9 + f.phase)
                   + 0.28 * Math.sin(this._time * f.rate * 2.3 + f.phase * 1.7);
      const k = 1 + wobble * f.amp;
      if (f.light) f.light.intensity = f.baseIntensity * k;
      if (f.halo)  f.halo.material.opacity = f.baseOpacity * k;
      // The flame and its bleed also *swell* slightly, not just brighten. Kept
      // well under the brightness change: a lantern that visibly changes size is
      // reaching for attention, and there are five of them on a board that is
      // supposed to be quiet.
      if (f.flame) f.flame.scale.setScalar(1 + wobble * f.amp * 0.6);
      if (f.halo)  f.halo.scale.setScalar(1 + wobble * f.amp * 1.1);
    }
  }

  destroy() {
    this.gameObject.object3D.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      // A prop that needed a material of its own - an animated one - owns it, so
      // the shared table below will not catch it.
      if (o.userData.ownMaterial) o.material.dispose();
    });
    if (this._mats) for (const m of Object.values(this._mats)) m.dispose();
  }
}
