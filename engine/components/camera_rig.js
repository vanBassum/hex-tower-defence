import * as THREE from 'three';
import { Component } from '../gameobject.js';

const DIST_MIN  = 5;
const DIST_MAX  = 60;

// Pitch is not a free axis - it is a function of distance. Far out the camera
// looks almost straight down, because that is the view you want when you are
// reading the board; close in it drops toward the horizon, because that is the
// view you want when you are watching a fight. One wheel gesture is therefore a
// dive, not a dolly. DIVE < 1 front-loads the climb, so the camera is already
// near top-down for most of the range and the drop to horizontal happens in the
// last stretch of zooming in - which is what makes it read as a swoop.
const ELEV_NEAR = 0.30;           // ~17 deg at DIST_MIN
const ELEV_FAR  = 1.30;           // ~75 deg at DIST_MAX
const DIVE      = 0.65;

const ZOOM_RATE = 0.0015;         // per wheel unit, applied exponentially
const TILT_FREE = 0.30;           // rad the player may lean off the dive curve
const SNAP      = Math.PI / 3;    // one hex face
const SMOOTH    = 14;             // ease rate, per second
const PAN_SPEED = 12;             // keyboard only - the mouse pans in world units

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Orbit/pan/zoom rig.
//   middle drag  pan, grabbing the ground point under the cursor
//   wheel        zoom toward the cursor, diving as it closes in
//   alt + drag   rotate, and lean off the dive curve
//   Q / E        rotate one hex face at a time
//   WASD/arrows  pan
// The right button is deliberately unbound; it belongs to the game, not the camera.
export class CameraRig extends Component {
  constructor({ dist = 24, azimuth = 0 } = {}) {
    super();
    this._target  = new THREE.Vector3();
    this._dist    = dist;
    this._distGo  = dist;         // where the wheel wants to be; _dist eases toward it
    this._azimuth = azimuth;
    this._aziGo   = azimuth;
    this._tilt    = 0;            // offset from the dive curve
    this._keys    = {};
    this._orbit   = null;
    this._pan     = null;         // {anchor} - world point held under the cursor
    this._zoomAt  = null;         // world point the wheel is pulling toward

    this._ndc   = new THREE.Vector2();
    this._ray   = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit   = new THREE.Vector3();
  }

  start() {
    const { game } = this.gameObject;

    const el = game.renderer.domElement;
    this._el  = el;
    this._cam = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight || 1, 0.1, 500);
    game.camera = this._cam;
    this._apply();

    el.addEventListener('wheel', (e) => {
      // Multiplicative, so every notch is the same proportional step. Linear
      // zoom crawls when you are far out and lurches when you are close.
      this._distGo = clamp(this._distGo * Math.exp(e.deltaY * ZOOM_RATE), DIST_MIN, DIST_MAX);
      this._zoomAt = this._groundAt(e.clientX, e.clientY)?.clone() ?? null;
    }, { passive: true });

    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        const anchor = this._groundAt(e.clientX, e.clientY);
        if (anchor) this._pan = { anchor: anchor.clone() };
        e.preventDefault();       // else Chrome opens autoscroll
      } else if (e.button === 0 && e.altKey) {
        this._orbit = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this._pan = null;
      if (e.button === 0) this._orbit = null;
    });

    window.addEventListener('mousemove', (e) => {
      if (this._pan) {
        // Grab-the-world: keep the point you grabbed under the cursor. Pan speed
        // then falls out of the projection for free - correct at every zoom and
        // pitch, with no speed constant to tune.
        const hit = this._groundAt(e.clientX, e.clientY);
        if (hit) {
          this._target.x += this._pan.anchor.x - hit.x;
          this._target.z += this._pan.anchor.z - hit.z;
          this._apply();
        }
      } else if (this._orbit) {
        this._azimuth -= (e.clientX - this._orbit.x) * 0.005;
        this._aziGo    = this._azimuth;
        this._tilt     = clamp(this._tilt + (e.clientY - this._orbit.y) * 0.004, -TILT_FREE, TILT_FREE);
        this._orbit.x  = e.clientX;
        this._orbit.y  = e.clientY;
        this._apply();
      }
    });

    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      // Snap to the face grid rather than stepping from wherever a drag left us,
      // so Q and E always land on one of the six orientations the board has.
      if (e.code === 'KeyQ') this._aziGo = (Math.round(this._aziGo / SNAP) + 1) * SNAP;
      if (e.code === 'KeyE') this._aziGo = (Math.round(this._aziGo / SNAP) - 1) * SNAP;
    });
    window.addEventListener('keyup', (e) => { this._keys[e.code] = false; });
  }

  // Puts a world point in the middle of the view. Where the player is looking
  // when a level opens is the game's decision, not the rig's - the rig only
  // knows how to look at whatever it is pointed at.
  focusOn(x, z) {
    this._target.x = x;
    this._target.z = z;
    if (this._cam) this._apply();
    return this;
  }

  update(_dt, rawDt) {
    let fx = 0, fz = 0;
    if (this._keys['KeyW'] || this._keys['ArrowUp'])    fz -= 1;
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  fz += 1;
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  fx -= 1;
    if (this._keys['KeyD'] || this._keys['ArrowRight']) fx += 1;

    if (fx || fz) {
      const speed = PAN_SPEED * (this._dist / 20) * rawDt;
      this._target.x += (fx * Math.cos(this._azimuth) + fz * Math.sin(this._azimuth)) * speed;
      this._target.z += (fz * Math.cos(this._azimuth) - fx * Math.sin(this._azimuth)) * speed;
    }

    const k = 1 - Math.exp(-SMOOTH * rawDt);
    const moved = this._ease(k);
    if (fx || fz || moved) this._apply();
  }

  // Eases distance and azimuth toward their goals; returns whether anything moved.
  _ease(k) {
    let moved = false;

    const dd = this._distGo - this._dist;
    if (Math.abs(dd) > 1e-4) {
      const prev = this._dist;
      this._dist += dd * k;
      // Hold the point under the cursor still while the dolly runs: the target
      // slides toward it by exactly the fraction the distance shrank.
      if (this._zoomAt) this._target.lerp(this._zoomAt, 1 - this._dist / prev);
      moved = true;
    } else {
      this._zoomAt = null;
    }

    const da = this._aziGo - this._azimuth;
    if (Math.abs(da) > 1e-4) { this._azimuth += da * k; moved = true; }

    return moved;
  }

  _elevation() {
    const t = (this._dist - DIST_MIN) / (DIST_MAX - DIST_MIN);
    const e = ELEV_NEAR + (ELEV_FAR - ELEV_NEAR) * Math.pow(clamp(t, 0, 1), DIVE);
    return clamp(e + this._tilt, 0.12, Math.PI / 2 - 0.05);
  }

  // Where the pointer meets the ground plane, or null if it misses it.
  _groundAt(clientX, clientY) {
    const rect = this._el.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ndc, this._cam);
    return this._ray.ray.intersectPlane(this._plane, this._hit) ? this._hit : null;
  }

  _apply() {
    const elev = this._elevation();
    const h = this._dist * Math.cos(elev);
    const y = this._dist * Math.sin(elev);
    this._cam.position.set(
      this._target.x + h * Math.sin(this._azimuth),
      this._target.y + y,
      this._target.z + h * Math.cos(this._azimuth)
    );
    this._cam.lookAt(this._target);
  }
}
