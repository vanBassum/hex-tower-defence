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
//
// **Nothing on a tile exists until the tile is found.** Every prop is scaled from
// nothing when its hex stops being unexplored, and that is not only a flourish:
// it is what lets the fog layer be a *thin* blanket of cloud instead of a bank
// tall enough to swallow a tree. Hiding what stands on a tile is the prop's own
// business, and it is much cheaper here than as a metre of extra cloud over the
// whole board. What it buys as a flourish is worth having anyway - a stand of
// trees rising out of the clearing cloud is the island being found rather than
// being switched on.
//
// A lantern also has to be *found* before it burns. Given a visibility map, each
// one holds a `lit` value that eases toward one the moment its tile stops being
// unexplored, and everything the lamp does - its pool of light, its bulb, its
// bleed - is scaled by it. That is worth more than it costs in two separate ways.
// It is the board answering the player: walk into a corner of the island and the
// lamp somebody left there comes up as you arrive, rather than having been on all
// along in a place nobody had been. And it fixes something that was simply wrong
// before it - an undiscovered lantern was still casting a real PointLight, which
// lit the *inside* of the fog bank standing over it and put a warm bloom on the
// cloud above a tile the player had never seen.
export class PropLayer extends Component {
  constructor({
    grid, ground = null, props = [], colors = {}, tuning = {},
    // What the player has seen. Optional: without it every lamp is simply lit,
    // which is what a level with no fog on it wants.
    visibility = null,
    // Slow enough to read as a lamp being lit rather than as a light switch. The
    // props come up faster, because they are following the cloud off the tile and
    // a tree that lags behind the weather reads as a loading artefact.
    lightUpRate = 1.3,
    revealRate = 3.4,
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
    this._visibility = visibility;
    this._lightUpRate = lightUpRate;
    this._revealRate = revealRate;
    this._wind = wind;
    this._time = 0;
  }

  start() {
    this._mats = createPropMaterials(this._colors);
    this.count = 0;
    this._swaying = [];
    this._flames = [];
    this._hidden = [];      // props still waiting for their tile to be found

    for (const placement of this._props) {
      const { x, z } = this._grid.hexToWorld(placement.q, placement.r);
      const y = this._ground ? this._ground.topY(placement.q, placement.r) : 0;
      const obj = buildProp(placement, this._mats, { x, z, y }, this._tuning);
      this.gameObject.object3D.add(obj);
      this.count++;

      // The base scale is kept because it is not always one - a rock is built
      // squashed - so growing in has to be a multiple of what the prop already is
      // rather than a scale of its own.
      if (this._visibility && !this._visibility.isExplored(placement.q, placement.r)) {
        obj.userData.baseScale = obj.scale.clone();
        obj.userData.reveal = 0;
        obj.scale.set(0, 0, 0);
        this._hidden.push({ obj, q: placement.q, r: placement.r });
      }

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
          baseColor: obj.userData.flameColor ?? obj.userData.flame?.material.color,
          amp: obj.userData.flicker,
          phase: obj.userData.flickerPhase ?? 0,
          rate: obj.userData.flickerRate ?? 1,
          // Where it stands, so it can ask whether it has been found yet.
          q: placement.q, r: placement.r,
          lit: this._visibility ? 0 : 1,
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
    // Exponential ease, so the rate is a rate rather than a frame count and the
    // lamp comes up the same way whatever the machine is doing.
    const k = this._visibility ? 1 - Math.exp(-this._lightUpRate * rawDt) : 1;

    // Props coming up out of the clearing cloud. The list shrinks as they arrive,
    // so a board that has been walked costs nothing here.
    if (this._hidden.length) {
      const kr = 1 - Math.exp(-this._revealRate * rawDt);
      for (let i = this._hidden.length - 1; i >= 0; i--) {
        const h = this._hidden[i];
        if (h.obj.userData.reveal <= 0 && !this._visibility.isExplored(h.q, h.r)) continue;
        const v = h.obj.userData.reveal + (1 - h.obj.userData.reveal) * kr;
        h.obj.userData.reveal = v;
        h.obj.scale.copy(h.obj.userData.baseScale).multiplyScalar(v);
        if (v > 0.998) {
          h.obj.scale.copy(h.obj.userData.baseScale);
          this._hidden.splice(i, 1);
        }
      }
    }

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
      // Found yet? A lantern never goes back out: what is known about the board
      // does not un-know itself, and a lamp that switched off behind you would
      // say it had.
      if (this._visibility && f.lit < 1 && this._visibility.isExplored(f.q, f.r)) {
        f.lit += (1 - f.lit) * k;
        if (f.lit > 0.999) f.lit = 1;
      }
      if (f.lit <= 0) {
        if (f.light) f.light.intensity = 0;
        if (f.halo)  f.halo.material.opacity = 0;
        if (f.flame) f.flame.material.color.setRGB(0, 0, 0);
        continue;
      }

      const k2 = (1 + wobble * f.amp) * f.lit;
      if (f.light) f.light.intensity = f.baseIntensity * k2;
      if (f.halo)  f.halo.material.opacity = f.baseOpacity * k2;
      // The bulb dims with the rest of it. It is `MeshBasicMaterial`, so its
      // colour *is* how bright it looks - there is no light on it to turn down.
      if (f.flame && f.baseColor) {
        f.flame.material.color.copy(f.baseColor).multiplyScalar(f.lit);
      }
      // The flame and its bleed also *swell* slightly, not just brighten. Kept
      // well under the brightness change: a lantern that visibly changes size is
      // reaching for attention, and there are five of them on a board that is
      // supposed to be quiet.
      // The flame grows into being as well as brightening, which is what makes it
      // read as being lit rather than as fading up.
      if (f.flame) f.flame.scale.setScalar((1 + wobble * f.amp * 0.6) * (0.35 + 0.65 * f.lit));
      if (f.halo)  f.halo.scale.setScalar((1 + wobble * f.amp * 1.1) * (0.35 + 0.65 * f.lit));
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
