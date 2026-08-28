import { Component } from '../../engine/gameobject.js';

const key = (q, r) => `${q},${r}`;

// How far from the aim a group order will look for somewhere to put people.
// Two rings is nineteen tiles - a selection is never going to be that big, and
// the third ring is far enough from where the player pointed that arriving there
// would be a surprise rather than a formation.
const GROUP_SPREAD = 2;

// The player's side of the board: which units they own, which one is picked up,
// where it may walk, and - because it is the same list - what the force can see.
//
// Selection is a *list*, and it was built as a concept while there was exactly
// one unit to select - which is the reason it could become a list without
// anything else being found and changed. `selected` is still here and is the
// first of them, for the things that genuinely want one group: the status line,
// the reachable field, the debug console.
//
// ── A group order is one aim and several destinations ───────────────────────
// Only one body of men can stand on a tile, so sending six units to one hex
// cannot mean what it says. It means *towards*: the nearest takes the tile and
// the others take the nearest free tile to it, each walking its own way there
// and each stopping when its own move allowance runs out. `plan` works that out,
// and it is the same call that draws the preview and the one that gives the
// order - so the threads on the ground before the click are exactly the walks
// after it.
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
// It is the arrangement every game with a mouse and an army uses, and for a
// while this one broke it: the tactical loop made a left click on a hex the
// group could reach into the commit, so the safe button sometimes moved fifteen
// men. It is back to the plain rule - **the left button never moves anything** -
// and shift is how a second group joins the selection.
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
    pathOverlay  = null,   // the routes the selection would walk to the hovered hex
    destOverlay  = null,   // and the tiles each of them would end up on
  } = {}) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._visibility = visibility;
    this.units = [];
    this.pickups = [];
    // Who is picked up, in the order they were picked. It is the whole of
    // selection: `selected` below is a reading of it and not a second field.
    this.selection = [];
    this._plan = [];              // the previewed group order, as `plan` returns it
    this._unknown = null;         // lazily built set of "q,r" nobody has seen
    this._hover = null;
    this._pathOverlay = pathOverlay;
    this._destOverlay = destOverlay;
    // How far one order may reach, as a function of the group being ordered.
    // Null - or a null answer - is no limit, which is the real-time game.
    //
    // It is a function rather than the one number it used to be, because a group
    // order moves several units at once and Heavy Infantry and Cavalry do not
    // share an allowance. It still lives here for the reason the number did: the
    // route preview and the order are both drawn from `_pathTo`, so a limit
    // applied anywhere else would be a limit the preview could disagree with.
    this.limit = null;            // (unit) => number | null
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
    const s = this.selection.indexOf(unit);
    if (s >= 0) {
      this.selection.splice(s, 1);
      this._refreshPath();
    }
    this.refreshVision();
  }

  // The first of the picked-up groups, for the things that want one: the status
  // line, the reachable field, `hex.control.selected` from the console. It is a
  // reading of the list rather than a field beside it, because two accounts of
  // what is selected is how a ring gets left on a unit nobody is holding.
  get selected() { return this.selection[0] ?? null; }

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
  //
  // With shift held it *adds* instead of replacing, and a shifted click on a
  // group already held takes it back out - which is the whole of multiple
  // selection. Shift on empty ground does nothing at all rather than clearing:
  // a miss while building a selection should not cost the selection.
  handlePick(hex, add = false) {
    const unit = this.unitAt(hex.q, hex.r);
    if (!unit) { if (!add) this.deselect(); return; }
    this.select(unit, { add });
  }

  // Right button. Everybody picked up walks, each to their own tile near the one
  // that was clicked and each as far as their own allowance takes them. Returns
  // who actually took the order, which is how the thing counting moves knows
  // whose action this was.
  handleOrder(hex) {
    const plan = this.plan(hex);
    for (const { unit, path } of plan) unit.follow(path);
    return plan.map(p => p.unit);
  }

  handleHover(hex) {
    this._hover = hex;
    this._refreshPath();
  }

  // Picks a group up, or adds one to the group already held. `null` clears.
  select(unit, { add = false } = {}) {
    if (!unit) {
      if (!this.selection.length) return;
      for (const u of this.selection) u.setSelected(false);
      this.selection = [];
      this._refreshPath();
      return;
    }
    if (add && this.selection.includes(unit)) {
      unit.setSelected(false);
      this.selection = this.selection.filter(u => u !== unit);
      this._refreshPath();
      return;
    }
    if (!add) {
      for (const u of this.selection) if (u !== unit) u.setSelected(false);
      this.selection = [];
    }
    if (!this.selection.includes(unit)) this.selection.push(unit);
    unit.setSelected(true);
    // Having units picked up and having a card picked up are two modes, and this
    // is one of the two lines that keep them from both being true. The other is
    // in Deployment.arm.
    this.onSelect?.(unit);
    this._refreshPath();
  }

  // The whole selection at once, which is what a drag across the board means.
  // Same rings, same mode-cancel, one refresh instead of one per unit.
  selectMany(units) {
    const next = units.filter(u => this.units.includes(u) && !u.dead);
    if (!next.length) return this.deselect();
    for (const u of this.selection) if (!next.includes(u)) u.setSelected(false);
    for (const u of next) u.setSelected(true);
    this.selection = next;
    this.onSelect?.(next[0]);
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

  // The route one unit would take to a hex, or null if there is not one.
  //
  // Cut to the unit's own allowance rather than refused for exceeding it. That is
  // a change of rule and it is the one a group needs: send Heavy Infantry and
  // Cavalry to the same tile five hexes off and "nobody who cannot make it moves"
  // is an order half the selection ignores, where "everybody sets off and gets as
  // far as they can" is the order that was given. Truncating is safe because A*
  // only ever allows the *goal* to be blocked - every tile before it is walkable,
  // so any prefix of a route is a route.
  _pathTo(hex, unit) {
    const path = this._route(hex, unit);
    if (!path) return null;
    const max = this.limit?.(unit);
    if (max != null && path.length - 1 > max) {
      return max < 1 ? null : path.slice(0, max + 1);
    }
    return path;
  }

  // The whole way there, allowance ignored - which is the question "could this
  // group get there at all", asked separately because a group order has to know
  // who is going to fall short before it decides who stands where.
  _route(hex, unit) {
    if (!unit || !hex) return null;
    if (hex.q === unit.q && hex.r === unit.r) return null;
    // A destination nobody has seen is not a destination. Stated here as well as
    // in the search, because findPath deliberately lets a route end on a blocked
    // goal and that exception is wrong for this one.
    if (!this._visibility.isExplored(hex.q, hex.r)) return null;
    if (!this._grid.isWalkable(hex.q, hex.r)) return null;   // crags, and other units
    return this._grid.findPath(unit.q, unit.r, hex.q, hex.r, this._unknownKeys());
  }

  // ── A group order ────────────────────────────────────────────────────────
  // Who ends up where, and how each of them gets there. One call, used twice:
  // to draw the preview on hover and to give the order on the click, so the two
  // cannot say different things - the same reason the editor hands its area
  // verbs `previewHexes()`.
  //
  // Whoever can actually *get* to the aim gets the aim, nearest of them first;
  // everybody else takes the closest unclaimed free tile to it, out to two rings.
  // Ordering by who can complete the trip rather than by who starts nearest is
  // the difference between Cavalry arriving on the tile that was pointed at and
  // Heavy Infantry claiming it, stopping two hexes short, and leaving it empty.
  //
  // A unit with nowhere to go, or already standing on the tile it was given, is
  // left out of the plan entirely: it keeps its spot and it is not ordered.
  plan(hex) {
    if (!hex || !this.selection.length) return [];
    const max = (u) => this.limit?.(u);
    const wants = this.selection.map((unit) => {
      const full = this._route(hex, unit);
      const cap = max(unit);
      return {
        unit,
        // Sorts first as a number: 0 for the ones who can be there, 1 for the
        // ones who are going to run out of move on the way.
        short: (!full || (cap != null && full.length - 1 > cap)) ? 1 : 0,
        d: this._grid.hexDistance(unit.q, unit.r, hex.q, hex.r),
      };
    });
    wants.sort((a, b) => a.short - b.short || a.d - b.d || a.unit.id - b.unit.id);

    const spots = this._spotsAround(hex);
    const taken = new Set();
    // Where the walks actually finish, which is not the same set: a truncated
    // route ends partway. Two of them ending on one tile would put two bodies of
    // men on one hex, and nothing downstream is expecting that - so the second
    // one gives up a step, and the step before that, until it is somewhere of its
    // own or there is no walk left in it.
    const ends = new Set();
    const out = [];
    for (const { unit } of wants) {
      const dest = spots.find(h => !taken.has(key(h.q, h.r)) &&
        ((h.q === unit.q && h.r === unit.r) || this._reachableTile(h)));
      if (!dest) continue;
      taken.add(key(dest.q, dest.r));
      let path = this._pathTo(dest, unit);
      while (path && path.length > 1 && ends.has(key(path[path.length - 1].q, path[path.length - 1].r))) {
        path = path.slice(0, -1);
      }
      if (!path || path.length < 2) continue;
      const end = path[path.length - 1];
      ends.add(key(end.q, end.r));
      out.push({ unit, path, dest: end });
    }
    return out;
  }

  // The aim first, then the ring round it, then the next - so "closest to where
  // I pointed" is the order they are handed out in. Sorted within a ring, so the
  // same click twice puts the same units in the same places.
  _spotsAround(hex) {
    const out = [...this._grid.hexesInRange(hex.q, hex.r, GROUP_SPREAD, { playableOnly: true })];
    return out.sort((a, b) =>
      this._grid.hexDistance(a.q, a.r, hex.q, hex.r) -
      this._grid.hexDistance(b.q, b.r, hex.q, hex.r) || a.q - b.q || a.r - b.r);
  }

  _reachableTile(h) {
    return this._visibility.isExplored(h.q, h.r) && this._grid.isWalkable(h.q, h.r);
  }

  _refreshPath() {
    this._plan = this._hover ? this.plan(this._hover) : [];
    // One thread per group, each starting on the tile its own group is standing
    // on. That first hex is not part of the walk and it is part of the *line*: a
    // thread that starts one tile out is a thread nobody is holding.
    //
    // The far end used to need nothing, because the cursor was already sitting on
    // it. With several of them only one destination is under the pointer, so the
    // rest are marked - which is the whole of what a group order has to show
    // before it is given: who goes where.
    this._pathOverlay?.setRoutes?.(this._plan.map(p => p.path));
    if (!this._pathOverlay?.setRoutes) {
      this._pathOverlay?.setHexes(this._plan[0]?.path ?? []);
    }
    this._destOverlay?.setHexes(this._plan.map(p => p.dest));
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
