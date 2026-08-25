import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { HexOverlay } from '../../engine/components/hex_overlay.js';
import { TOWER_TYPES, buildTower } from '../towers.js';

const OK_COLOR  = 0x55dd66;
const BAD_COLOR = 0xdd4444;

// Mouse-to-hex placement. The cursor is intersected against the ground plane
// rather than raycast against meshes — the board is flat, so a plane hit is both
// cheaper and immune to towers occluding the hex behind them.
//
// The range ring is drawn during hover on purpose: it is the first point in the
// game where the player is asked to think about what a position covers.
export class TowerPlacer extends Component {
  constructor({ level, state, ground = null, towerType = 'gun' }) {
    super();
    this._level = level;
    this._state = state;
    this._ground = ground;
    this.towerType = towerType;
    this.hover = null;         // {q, r} or null
    this.hoverStatus = null;   // 'ok' | 'on-path' | 'blocked' | 'occupied' | 'too-poor' | 'off-board'
    this._ndc = new THREE.Vector2();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._point = new THREE.Vector3();
  }

  get type() { return TOWER_TYPES[this.towerType]; }

  start() {
    this._overlay = this.gameObject.getComponent(HexOverlay);
    this._buildRangeRing();

    const el = this.gameObject.game.renderer.domElement;
    this._el = el;
    this._onMove  = (e) => this._updateHover(e);
    this._onLeave = () => this._clearHover();
    this._onClick = (e) => { if (e.button === 0) this._place(); };
    el.addEventListener('mousemove', this._onMove);
    el.addEventListener('mouseleave', this._onLeave);
    el.addEventListener('click', this._onClick);
  }

  _buildRangeRing() {
    const pts = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(Math.cos(a) * this.type.range, 0, Math.sin(a) * this.type.range);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this._ringMat = new THREE.LineBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.75 });
    this._ring = new THREE.Line(geo, this._ringMat);
    this._ring.visible = false;
    this.gameObject.object3D.add(this._ring);
  }

  _updateHover(e) {
    const { game } = this.gameObject;
    if (!game.camera || !this._state.playing) return this._clearHover();

    const rect = this._el.getBoundingClientRect();
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ndc, game.camera);
    if (!this._ray.ray.intersectPlane(this._plane, this._point)) return this._clearHover();

    const hex = this._level.grid.worldToHex(this._point.x, this._point.z);
    this.hover = hex;
    this.hoverStatus = this._evaluate(hex);
    this._render(hex, this.hoverStatus === 'ok');
  }

  _clearHover() {
    this.hover = null;
    this.hoverStatus = null;
    this._overlay?.setHexes([]);
    if (this._ring) this._ring.visible = false;
  }

  _render(hex, ok) {
    const color = ok ? OK_COLOR : BAD_COLOR;
    this._overlay?.setColor(color);
    this._overlay?.setY(this._surfaceY(hex));
    this._overlay?.setHexes([hex]);

    // Off-board hovers get no ring — there is no position to evaluate.
    if (this.hoverStatus === 'off-board') { this._ring.visible = false; return; }
    const { x, z } = this._level.grid.hexToWorld(hex.q, hex.r);
    this._ring.position.set(x, this._surfaceY(hex), z);
    this._ringMat.color.setHex(color);
    this._ring.visible = true;
  }

  // Tiles are no longer all at y=0: the cursor has to sit on the hovered
  // surface or it disappears inside a hillside.
  _surfaceY(hex) {
    return (this._ground ? this._ground.topY(hex.q, hex.r) : 0) + 0.03;
  }

  _evaluate({ q, r }) {
    const { grid, pathKeys, blockedKeys } = this._level;
    if (!grid.inBounds(q, r))          return 'off-board';
    if (pathKeys.has(`${q},${r}`))     return 'on-path';
    // Before the occupancy check, which crags also fail: "solid rock" is a
    // property of the map and "already taken" is a thing the player did.
    if (blockedKeys?.has(`${q},${r}`)) return 'blocked';
    if (grid.isOccupied(q, r))         return 'occupied';
    if (!this._state.canAfford(this.type.cost)) return 'too-poor';
    return 'ok';
  }

  _place() {
    if (!this.hover || this.hoverStatus !== 'ok') return;
    const { q, r } = this.hover;
    if (!this._state.spend(this.type.cost)) return;

    this._level.grid.occupy(q, r);
    buildTower(this.gameObject.game, this.towerType, { q, r }, this._level.grid,
               { y: this._ground ? this._ground.topY(q, r) : 0 });

    // Re-evaluate in place: the hex is now taken and the purse is lighter.
    this.hoverStatus = this._evaluate(this.hover);
    this._render(this.hover, this.hoverStatus === 'ok');
  }

  destroy() {
    this._el?.removeEventListener('mousemove', this._onMove);
    this._el?.removeEventListener('mouseleave', this._onLeave);
    this._el?.removeEventListener('click', this._onClick);
    this._ring?.geometry.dispose();
    this._ringMat?.dispose();
  }
}
