import { Component } from '../../engine/gameobject.js';
import { PICKUP_TYPES } from '../pickups.js';

// Something on a hex that is worth walking to.
//
// It is deliberately built like a Unit rather than like a prop: one component on
// one GameObject, holding a hex coordinate and a state, because a pickup is a
// thing the game reasons about and not decoration that happens to be placed.
// Props are a layer for the opposite reason - there are four hundred of them and
// none of them is ever asked a question.
//
// ── It does not occupy its hex ──────────────────────────────────────────────
// Crags and units hold a place in the grid's occupancy set and are therefore
// impassable for free. A pickup must not: the way you take it is by standing on
// it, and a reward you cannot walk onto is a reward you have to work out the
// rule for. Nothing else has to change for that - not occupying is not a rule,
// it is the absence of one.
//
// ── Found before lit ────────────────────────────────────────────────────────
// Like everything else on the board it scales up out of nothing when its tile
// stops being unexplored, and its light comes up with it. That is the lantern's
// lesson repeated rather than a flourish: a real PointLight burning on an
// undiscovered tile lights the *inside* of the fog bank standing over it, and
// puts a warm bloom on cloud above ground nobody has been to.
//
// ── Taking it is an animation, and granting it happens at the end ───────────
// `collect()` marks it taken immediately - so it can never be taken twice, even
// if two units step on it in the same frame - and then plays out over most of a
// second: the colours are lifted, the light flares and goes out. Whatever the
// pickup grants is handed over when that finishes rather than when it starts,
// which is what lets the arriving unit appear as the banner leaves rather than
// beside it.
export class Pickup extends Component {
  constructor({
    grid,
    ground = null,          // for tile height - it floats without one
    visibility = null,      // what the player has found; without it, always lit
    type = 'cache',
    q = 0, r = 0,
    colors = {},
    tuning = {},
    wind = { angle: 0.55, length: 13, period: 4.8, strength: 1 },
    revealRate = 3.4,       // scaling up out of the clearing mist, as props do
    lightUpRate = 1.3,      // and the light behind it, slower, as lanterns do
    takeTime = 0.85,        // how long the colours take to be lifted
    onCollected = null,     // () => void, fired when that finishes
  } = {}) {
    super();
    this.type = PICKUP_TYPES[type];
    if (!this.type) throw new Error(`Unknown pickup type "${type}"`);
    this._grid = grid;
    this._ground = ground;
    this._visibility = visibility;
    this.q = q;
    this.r = r;
    this._colors = colors;
    this._tuning = tuning;
    this._wind = wind;
    this._revealRate = revealRate;
    this._lightUpRate = lightUpRate;
    this._takeTime = takeTime;
    this.onCollected = onCollected;

    this.collected = false;
    this._taking = null;     // seconds into the take, or null
    this._time = 0;
    this._reveal = 0;
    this._lit = 0;
  }

  get hex() { return { q: this.q, r: this.r }; }

  start() {
    this._mesh = this.type.build(this._colors, { ...this._tuning, hexSize: this._grid.size });
    // Turned so the banner streams downwind. The level has one breeze and every
    // effect on it reads the same angle - see mood.js - which is the difference
    // between a day with a wind on it and three components each having weather.
    this._mesh.rotation.y = -this._wind.angle;
    this.gameObject.object3D.add(this._mesh);

    const { x, z } = this._grid.hexToWorld(this.q, this.r);
    this.gameObject.position.set(x, this._ground ? this._ground.topY(this.q, this.r) : 0, z);

    this._light = this._mesh.userData.light ?? null;
    this._halo = this._mesh.userData.halo ?? null;
    this._baseIntensity = this._mesh.userData.lightIntensity ?? this._light?.intensity ?? 0;
    this._baseOpacity = this._mesh.userData.haloOpacity ?? this._halo?.material.opacity ?? 0;
    this._cloth = this._mesh.userData.cloth ?? null;
    this._clothRest = this._mesh.userData.clothRest ?? null;
    this._clothSize = this._mesh.userData.clothSize ?? { w: 1, h: 1 };
    this._height = this._mesh.userData.height ?? 1;

    const found = !this._visibility || this._visibility.isExplored(this.q, this.r);
    this._reveal = found ? 1 : 0;
    this._lit = found ? 1 : 0;
    if (!found) this._mesh.scale.setScalar(0.0001);
    this._applyLight();
  }

  // Takes it. Returns false if it has already been taken, so two units arriving
  // together cannot both collect it.
  collect() {
    if (this.collected) return false;
    this.collected = true;
    this._taking = 0;
    return true;
  }

  update(dt, rawDt) {
    if (this._done) return;

    // Weather runs on unscaled time, like the water and the trees: a world that
    // stops dead when the game pauses reads as a crash.
    this._time += rawDt;

    // Arriving out of the mist keeps running even while it is being taken. That
    // is not a case worth designing for so much as one worth not breaking: a
    // pickup can only be walked onto through ground the player has discovered,
    // so it has always been seen first - but a unit put on top of an undiscovered
    // one from the console would otherwise take a banner that never appeared.
    if (this._reveal < 1 && this._visibility?.isExplored(this.q, this.r)) {
      this._reveal += (1 - this._reveal) * (1 - Math.exp(-this._revealRate * rawDt));
      if (this._reveal > 0.998) this._reveal = 1;
    }

    // How lit it is, though, is driven from both ends - so once it is going out
    // the coming-on ramp stops, rather than spending every frame arguing with it.
    if (this._taking === null) {
      if (this._reveal > 0 && this._lit < 1) {
        this._lit += (1 - this._lit) * (1 - Math.exp(-this._lightUpRate * rawDt));
        if (this._lit > 0.999) this._lit = 1;
      }
      this._mesh.scale.setScalar(this._reveal);
    } else {
      this._advanceTake(dt);
    }

    this._waveCloth();
    this._applyLight();
  }

  // Lifted and taken up rather than faded out. A pickup that dissolves in place
  // says the object was never there; one that rises off its pole says somebody
  // took it, which is the fiction the whole thing rests on.
  _advanceTake(dt) {
    this._taking += dt;
    const t = Math.min(1, this._taking / this._takeTime);
    const rise = t * t * (3 - 2 * t);

    this._mesh.position.y = rise * this._height * 0.5;
    // It holds its shape for the first third and then goes, so what the eye
    // follows is the lift rather than a shrink starting from the first frame.
    this._mesh.scale.setScalar(this._reveal * (1 - smoothstep(0.3, 1, t)));

    // One flare on the way out. The light is the part that says a thing happened
    // - a formation of fifteen appearing in silence a second later would
    // otherwise be the first the player heard of it.
    this._flare = Math.sin(Math.min(1, t / 0.45) * Math.PI) * 0.7;
    this._lit = Math.max(0, 1 - smoothstep(0.35, 1, t));

    if (t >= 1) {
      this._done = true;
      this._mesh.visible = false;
      if (this._light) this._light.intensity = 0;
      this.onCollected?.(this);
    }
  }

  // The banner, waved by writing its vertices - the water's trick and the
  // vegetation's, for the third time and the same reasons: a pure function of
  // position and time has no state to keep, cannot go unstable, and costs two
  // sines per vertex on forty-five vertices.
  //
  // The ripple grows along the cloth so the attached edge stays on the pole and
  // the free edge does the moving, and the whole amplitude rides the same gust
  // that crosses the island - so the banner goes quiet when the trees do.
  _waveCloth() {
    if (!this._cloth || !this._clothRest || !this._mesh.visible) return;
    const geo = this._cloth.geometry;
    const arr = geo.attributes.position.array;
    const rest = this._clothRest;
    const { w } = this._clothSize;

    const p = this.gameObject.position;
    const gust = Math.sin(
      (Math.cos(this._wind.angle) * p.x + Math.sin(this._wind.angle) * p.z) * (Math.PI * 2 / this._wind.length)
      - (Math.PI * 2 / this._wind.period) * this._time,
    );
    const amp = w * 0.22 * (this._wind.strength ?? 1) * (0.68 + 0.32 * gust);
    // A flag ripples faster than a tree leans. Its own rate rather than the
    // wind's period, because the gust is what decides how *hard* it is blowing
    // and the cloth decides how quickly it answers.
    const phase = this._time * 4.4;
    const k = Math.PI * 2 / (w * 1.25);

    for (let i = 0; i < arr.length; i += 3) {
      const bx = rest[i], by = rest[i + 1];
      const along = Math.max(0, bx) / w;
      arr[i + 2] = amp * along * along * Math.sin(bx * k + by * 5.0 - phase);
      // The free edge is pulled back in as it waves, because cloth does not
      // stretch: without it the banner grows longer the harder it flaps.
      arr[i] = bx - amp * 0.35 * along * along;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // The flare is spent almost entirely on the *light* and hardly at all on the
  // halo, and that split is the whole of what keeps it from looking cheap. The
  // halo stands in for a bloom pass: a small additive sphere reads as air around
  // a flame, and the same sphere at half again the size reads as a pale disc
  // pasted over the scene - the identical mistake the fog's wisps were shrunk to
  // fix. What the eye should see brighten is the grass, not the sphere.
  _applyLight() {
    const flare = this._flare ?? 0;
    if (this._light) this._light.intensity = this._baseIntensity * this._lit * (1 + flare);
    if (this._halo) {
      this._halo.material.opacity = this._baseOpacity * this._lit * (1 + flare * 0.3);
      this._halo.scale.setScalar(0.4 + 0.6 * this._lit + flare * 0.12);
    }
  }

  destroy() {
    this._mesh?.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.userData.ownMaterial) o.material.dispose();
    });
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
