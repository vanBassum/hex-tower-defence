import { Component } from '../../engine/gameobject.js';

const key = (q, r) => `${q},${r}`;

// The player's side of the board: which units they own, which one is picked up,
// where it may walk, and - because it is the same list - what the force can see.
//
// Selection is built as a concept while there is exactly one unit to select, on
// purpose. The alternative is code that assumes the Scout is always the subject,
// and that assumption is invisible until the second unit arrives and every call
// site has to be found again.
//
// Vision is recomputed here rather than by the unit that moved, for the same
// reason: what the player can see is the union over the whole force, and a unit
// that owned its own fog would erase a hex two units were both standing next to.
//
// ── The two buttons ─────────────────────────────────────────────────────────
// Left selects and deselects. Right orders a move. They are separate because
// they answer different questions, and one button doing both is what forces the
// player to keep track of a mode: with a single button, clicking a tile means
// "go there" or "never mind" depending on state they cannot see. Split, the left
// button is always safe and the right button always means go.
//
// A move is a whole route rather than one step. Walking an island a tile at a
// time is a lot of clicking to say one thing, and the *route* is the interesting
// part anyway - which is why hovering a destination draws it before you commit.
//
// ── What you may order ──────────────────────────────────────────────────────
// Only into ground the player has discovered. That is not a restriction bolted
// on; it is what fog *means*. A route that threads perfectly between crags
// nobody has seen is the player reading the level file, and the whole point of
// the Scout is that finding the way is the thing being played.
export class UnitControl extends Component {
  constructor({
    grid,
    ground = null,
    visibility,
    units = [],
    pathOverlay  = null,   // the route it would take to the hovered hex
  } = {}) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._visibility = visibility;
    this.units = [];
    this.selected = null;
    this._path = [];              // the previewed route, start hex included
    this._unknown = null;         // lazily built set of "q,r" nobody has seen
    this._hover = null;
    this._pathOverlay = pathOverlay;
    this._pending = units;
  }

  start() {
    for (const u of this._pending) this.add(u);
    this._pending = [];
    // What is known changes what can be walked to, so the cached set of unseen
    // hexes has to go when it does.
    this._unsub = this._visibility.onChange(() => {
      this._unknown = null;
      this._refreshPath();
    });
    this.refreshVision();
  }

  // Registers a unit as the player's. Adding a second one later is this call and
  // nothing else - vision, selection and pathing all read the roster rather than
  // a field.
  add(unit) {
    if (this.units.includes(unit)) return unit;
    this.units.push(unit);
    unit.onMoved(() => this._afterMove());
    return unit;
  }

  unitAt(q, r) {
    return this.units.find(u => u.q === q && u.r === r) ?? null;
  }

  // ── Input ────────────────────────────────────────────────────────────────
  // Left button. A unit under the cursor is the subject; anywhere else means
  // "never mind". It never moves anything, which is what makes it the safe one.
  handlePick(hex) {
    const unit = this.unitAt(hex.q, hex.r);
    this.select(unit && unit !== this.selected ? unit : null);
  }

  // Right button. Walk there, if there is a way there through ground we know.
  handleOrder(hex) {
    if (!this.selected) return false;
    const path = this._pathTo(hex);
    if (!path) return false;
    this.selected.follow(path);
    return true;
  }

  handleHover(hex) {
    this._hover = hex;
    this._refreshPath();
  }

  select(unit) {
    if (this.selected === unit) return;
    this.selected?.setSelected(false);
    this.selected = unit;
    unit?.setSelected(true);
    this._refreshPath();
  }

  deselect() { this.select(null); }

  // ── Routes ───────────────────────────────────────────────────────────────
  // Everything nobody has seen, as A* wants it. Rebuilt only when what is known
  // changes, because it is asked on every mouse move.
  _unknownKeys() {
    if (this._unknown) return this._unknown;
    const out = new Set();
    for (const h of this._visibility.hexes()) {
      if (!this._visibility.isExplored(h.q, h.r)) out.add(key(h.q, h.r));
    }
    return (this._unknown = out);
  }

  // The route the selection would take to a hex, or null if there is not one.
  _pathTo(hex) {
    const u = this.selected;
    if (!u || !hex) return null;
    if (hex.q === u.q && hex.r === u.r) return null;
    // A destination nobody has seen is not a destination. Stated here as well as
    // in the search, because findPath deliberately lets a route end on a blocked
    // goal and that exception is wrong for this one.
    if (!this._visibility.isExplored(hex.q, hex.r)) return null;
    if (!this._grid.isWalkable(hex.q, hex.r)) return null;   // crags, and other units
    return this._grid.findPath(u.q, u.r, hex.q, hex.r, this._unknownKeys());
  }

  _refreshPath() {
    const path = this._hover ? this._pathTo(this._hover) : null;
    this._path = path ?? [];
    // The hex the unit is standing on is in the path and is not part of the walk,
    // and the destination already has the cursor sitting on it.
    this._pathOverlay?.setHexes(this._path.slice(1));
  }

  _afterMove() {
    this.refreshVision();
    this._refreshPath();
  }

  // The union of every unit's view. The fog never learns that a Scout exists.
  refreshVision() {
    this._visibility.update(this.units.map(u => u.visionSource));
  }

  destroy() { this._unsub?.(); }
}
