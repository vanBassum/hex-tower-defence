import * as THREE from 'three';
import { Component } from '../gameobject.js';

// A rectangle dragged across the canvas, and whatever ends up inside it.
//
// It is the other half of the left button. A click picks one thing; a drag picks
// everything it crosses, which is the gesture every game with an army has used
// since the mouse had two buttons - and the reason it belongs in the engine is
// that it says nothing about units. It is handed a list of things with positions,
// it projects them, and it reports the ones inside the box.
//
// ── It is a drag, so the click that follows it is not meant ─────────────────
// A press, a move and a release also produce a `click`, which is the event the
// picker turns into "select what is under the pointer" - so a box drag that ended
// over empty ground would clear the selection it had just made. `consumedPress`
// is how the caller finds out, and it follows `CameraRig.consumedRightPress`
// exactly: set the moment a press becomes a drag, cleared on the next press.
// Same problem, same shape of answer, and worth being identical rather than
// merely similar.
//
// ── The box is DOM ─────────────────────────────────────────────────────────
// One absolutely-positioned div with a border. Drawing it in the scene would
// mean a screen-space quad, a camera-facing plane and a material, to produce a
// rectangle that is definitionally in screen space - the same reason the card bar
// and the menu are DOM.
const SLOP = 6;   // pixels of travel before a press is a drag rather than a click

export class Marquee extends Component {
  constructor({
    // () => [{ item, position }], where position is a world-space Vector3. A
    // function rather than a list, because what can be selected changes as the
    // board does and this only asks at the moment of the release.
    items = () => [],
    onSelect = null,        // (items) => void, the ones inside the box
    color = '#ffd24a',      // MOOD.interact, when the game passes its own
  } = {}) {
    super();
    this._items = items;
    this._onSelect = onSelect;
    this._color = color;
    this._press = null;     // {x, y} - a press that has not travelled yet
    this._box = null;       // {x, y} - the anchor of a drag in progress
    // Whether the last left press turned into a drag. The game reads it to know
    // whether the click that follows was meant.
    this.consumedPress = false;
  }

  start() {
    const el = this.gameObject.game.renderer.domElement;
    this._el = el;

    this._rect = document.createElement('div');
    this._rect.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:7', 'display:none',
      `border:1px solid ${this._color}`,
      // The fill is almost nothing on purpose: the board underneath is what is
      // being aimed at, and a wash over it hides the units being chosen.
      'background:rgba(255,210,74,0.07)',
    ].join(';');
    document.body.appendChild(this._rect);

    this._onDown = (e) => {
      if (e.button !== 0 || e.altKey) return;   // alt+left is the camera's rotate
      this._press = { x: e.clientX, y: e.clientY };
      this.consumedPress = false;
    };
    this._onMove = (e) => {
      if (!this._press) return;
      if (!this._box) {
        const dx = e.clientX - this._press.x, dy = e.clientY - this._press.y;
        if (Math.hypot(dx, dy) < SLOP) return;
        this._box = { ...this._press };
        this.consumedPress = true;
        this._rect.style.display = 'block';
      }
      this._draw(e.clientX, e.clientY);
    };
    this._onUp = (e) => {
      if (e.button !== 0) return;
      const box = this._box;
      this._press = null;
      this._box = null;
      this._rect.style.display = 'none';
      if (box) this._onSelect?.(this._inside(box, { x: e.clientX, y: e.clientY }));
    };

    el.addEventListener('mousedown', this._onDown);
    // On the window, so a drag that leaves the canvas still draws and still ends.
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
  }

  _draw(x, y) {
    const a = this._box;
    this._rect.style.left = `${Math.min(a.x, x)}px`;
    this._rect.style.top = `${Math.min(a.y, y)}px`;
    this._rect.style.width = `${Math.abs(x - a.x)}px`;
    this._rect.style.height = `${Math.abs(y - a.y)}px`;
  }

  // Everything whose own position projects into the box. The *position*, not the
  // bounding box of what is drawn there: a body of men is a tile's worth of
  // figures and testing all of them would let a box clip a formation's elbow and
  // take the unit - which is not what the player drew the rectangle around.
  _inside(a, b) {
    const camera = this.gameObject.game.camera;
    if (!camera) return [];
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
    const rect = this._el.getBoundingClientRect();
    const v = new THREE.Vector3();
    const out = [];
    for (const { item, position } of this._items() ?? []) {
      if (!position) continue;
      v.copy(position).project(camera);
      if (v.z < -1 || v.z > 1) continue;        // behind the camera, or past it
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      if (x < lo.x || x > hi.x || y < lo.y || y > hi.y) continue;
      out.push(item);
    }
    return out;
  }

  destroy() {
    this._el?.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    this._rect?.remove();
  }
}
