import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { HexOverlay } from './hex_overlay.js';

// Mouse to hex, and a cursor sitting on it. Any hex game needs this before it
// needs anything else, so it is a mechanism here and says nothing about what a
// click means - callers get `onHover` and `onPick` and decide.
//
// The pointer is intersected against a flat plane rather than raycast against
// the terrain meshes. The board is a height field of flat tiles, so a plane hit
// is both cheaper and immune to a tree occluding the hex behind it - and picking
// the hex you can see rather than the hex under the pixel is the behaviour you
// want anyway.
//
// A plane at y = 0 while the tiles are not is off by a whole hex on a hill seen
// from a low camera, though, and that stopped being cosmetic the moment a click
// meant something: aiming at high ground and having the unit go somewhere else -
// or nowhere - is the click being wrong, not approximate. So the plane is solved
// twice. The first pass says which tile the ray is roughly over, the second
// re-casts at *that tile's* height and takes the answer. One correction is
// enough for one step of elevation, which is all this board has, and it is still
// two plane intersections rather than a raycast against the merged ground mesh.
export class HexPicker extends Component {
  constructor({
    grid,
    ground = null,            // for tile height - the cursor sinks into hillsides without it
    color = 0x8fd8e8,
    onHover = null,           // (hex | null) => void
    onPick = null,            // (hex) => void, left click
    onOrder = null,           // (hex) => void, right click
  } = {}) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._color = color;
    this._onHover = onHover;
    this._onPick = onPick;
    this._onOrder = onOrder;
    this.hover = null;        // {q, r} or null

    this._ndc = new THREE.Vector2();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._point = new THREE.Vector3();
  }

  start() {
    this._overlay = this.gameObject.getComponent(HexOverlay);
    this._overlay?.setColor(this._color);

    const el = this.gameObject.game.renderer.domElement;
    this._el = el;
    this._onMove  = (e) => this._update(e);
    this._onLeave = () => this._clear();
    this._onClick = (e) => {
      // Alt+drag is the camera's rotate gesture and still ends in a click here.
      if (e.altKey) return;
      if (e.button === 0 && this.hover) this._onPick?.(this.hover);
    };
    // The right button is the order button. It arrives as `contextmenu` rather
    // than as a click, which is also the event that has to be swallowed anyway -
    // taking it here means one listener does both, on every platform, including
    // the ones where a right press is a two-finger tap or a control-click.
    this._onContext = (e) => {
      e.preventDefault();
      if (this.hover) this._onOrder?.(this.hover);
    };
    el.addEventListener('mousemove', this._onMove);
    el.addEventListener('mouseleave', this._onLeave);
    el.addEventListener('click', this._onClick);
    el.addEventListener('contextmenu', this._onContext);
  }

  _update(e) {
    const { game } = this.gameObject;
    if (!game.camera) return this._clear();

    const rect = this._el.getBoundingClientRect();
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ndc, game.camera);
    if (!this._ray.ray.intersectPlane(this._plane, this._point)) return this._clear();

    let hex = this._grid.worldToHex(this._point.x, this._point.z);
    // Off the board is the same as nothing: there is no hex there to talk about.
    if (!this._grid.inBounds(hex.q, hex.r)) return this._clear();

    // Second pass, at the height the first pass found. A hex it lands on off the
    // board is the ray leaving the island over a cliff edge, and the tile it was
    // already over is the better answer than nothing.
    if (this._ground) {
      this._plane.constant = -this._ground.topY(hex.q, hex.r);
      const hit = this._ray.ray.intersectPlane(this._plane, this._point);
      this._plane.constant = 0;
      if (hit) {
        const refined = this._grid.worldToHex(this._point.x, this._point.z);
        if (this._grid.inBounds(refined.q, refined.r)) hex = refined;
      }
    }

    this.hover = hex;
    this._overlay?.setY(this._surfaceY(hex));
    this._overlay?.setHexes([hex]);
    this._onHover?.(hex);
  }

  _clear() {
    if (!this.hover) return;
    this.hover = null;
    this._overlay?.setHexes([]);
    this._onHover?.(null);
  }

  _surfaceY(hex) {
    return (this._ground ? this._ground.topY(hex.q, hex.r) : 0) + 0.03;
  }

  destroy() {
    this._el?.removeEventListener('mousemove', this._onMove);
    this._el?.removeEventListener('mouseleave', this._onLeave);
    this._el?.removeEventListener('click', this._onClick);
    this._el?.removeEventListener('contextmenu', this._onContext);
  }
}
