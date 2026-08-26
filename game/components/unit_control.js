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
// Pickups are here too, and that is not scope creep: collecting one is the join
// between the two lists this already owns - what the player has, and where it is
// standing. Nothing else in the scene knows both, and a component that did would
// be a third list to keep in step with these two.
//
// What a pickup *contains* is somebody else's problem. This reports the grant
// and stops there, because where a card goes and where it may be played are the
// camp's business - see Deployment. The rule that keeps the two apart is that a
// pickup is an event on the board and a card is not on the board at all.
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
    pickups = [],          // what is out there to be found
    onGrant = null,        // (grants, pickup) => void, when one has been taken
    onSelect = null,       // (unit | null) => void, so a mode elsewhere can end
    pathOverlay  = null,   // the route it would take to the hovered hex
  } = {}) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._visibility = visibility;
    this.units = [];
    this.pickups = [];
    this.selected = null;
    this._path = [];              // the previewed route, start hex included
    this._unknown = null;         // lazily built set of "q,r" nobody has seen
    this._hover = null;
    this._pathOverlay = pathOverlay;
    this.onGrant = onGrant;
    this.onSelect = onSelect;
    this._pending = units;
    this._pendingPickups = pickups;
  }

  start() {
    for (const u of this._pending) this.add(u);
    this._pending = [];
    for (const p of this._pendingPickups) this.addPickup(p);
    this._pendingPickups = [];
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
    unit.onDied(() => this.remove(unit));
    return unit;
  }

  // Off the roster the moment it has nobody left. Everything downstream reads
  // the roster rather than a flag - vision is the union over it, selection is
  // one of its entries, and the deployment zone is whichever of them can anchor
  // - so a dead unit left in the list is a unit that still sees, can still be
  // clicked, and can still be deployed next to.
  remove(unit) {
    const i = this.units.indexOf(unit);
    if (i < 0) return;
    this.units.splice(i, 1);
    if (this.selected === unit) {
      this.selected = null;
      this._refreshPath();
    }
    this.refreshVision();
  }

  unitAt(q, r) {
    return this.units.find(u => u.q === q && u.r === r) ?? null;
  }

  // Registers something on the board as findable. The pickup is told what to do
  // when it has finished being taken rather than being handed the force - it
  // knows how long it takes to be lifted off its pole and nothing else, and this
  // knows what was in it and nothing about banners.
  addPickup(pickup) {
    if (this.pickups.includes(pickup)) return pickup;
    this.pickups.push(pickup);
    pickup.onCollected = () => this._claim(pickup);
    return pickup;
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
    // Having a unit picked up and having a card picked up are two modes, and
    // this is one of the two lines that keep them from both being true. The
    // other is in Deployment.arm.
    if (unit) this.onSelect?.(unit);
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
    this._checkPickups();
  }

  // ── Finding things ───────────────────────────────────────────────────────
  // A pickup is taken by standing on it, and this is asked the moment a unit's
  // hex changes - which on a route is when the march *commits* to the tile
  // rather than when it lands on it. That is the same rule the fog runs on, and
  // it has to be: a unit's position is its hex, the walk is an animation over
  // that, and a reward that waited for the animation would be the one thing on
  // the board that disagreed about where the unit is. What it looks like is a
  // cache that starts being packed up as you walk in, which is not wrong.
  _checkPickups() {
    for (const p of this.pickups) {
      if (p.collected) continue;
      if (!this.units.some(u => u.q === p.q && u.r === p.r)) continue;
      p.collect();
    }
  }

  // What was in it goes out as a grant and nothing here acts on it. The unit it
  // names does *not* appear where the cache stood: a card is played at camp, so
  // finding something on the far shore is a walk back as well as a walk out, and
  // that is the whole reason the deployment zone is a place rather than a rule.
  _claim(pickup) {
    if (pickup.type.grants) this.onGrant?.(pickup.type.grants, pickup);
  }

  // The union of every unit's view. The fog never learns that a Scout exists.
  refreshVision() {
    this._visibility.update(this.units.map(u => u.visionSource));
  }

  destroy() { this._unsub?.(); }
}
