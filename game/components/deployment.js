import { Component } from '../../engine/gameobject.js';
import { CARD_TYPES } from '../cards.js';

const key = (q, r) => `${q},${r}`;

// The hand, and the ground it can be played onto - which is wherever the Scout
// is standing.
//
// A card is *where* as much as it is *what*. A reinforcement that can appear
// anywhere is a reinforcement with no cost, and the first version of this fixed
// that with a camp: four hexes on the shore, and everything played there. That
// was a rule about a *place*, and it made the far end of the island tedious
// rather than dangerous - the cost of finding something over there was a walk
// home.
//
// It is a rule about a *unit* instead. A card is played on a tile next to a
// Scout, so the deployment zone is wherever you have walked one, and the Scout
// stops being the thing that sees furthest and becomes the thing the army
// arrives behind. Everything follows from that in the direction you want: pushing
// the Scout forward extends where you can reinforce and puts the one unit that
// can do it in front; keeping it back is safe and slow. Nothing enforces any of
// that - it falls out of one field on the unit type.
//
// The zone is therefore never stored. It is computed from the roster every time
// it is asked, because it changes on every step anything takes.
//
// ── Playing a card is a mode, and selection is the other one ────────────────
// Arming a card and having a unit selected are mutually exclusive, and they are
// enforced by cancelling each other rather than by a flag anybody has to read.
// The alternative is a left-click whose meaning depends on two pieces of state
// at once, which is the thing the two-button split exists to avoid.
//
// ── One card, one unit ──────────────────────────────────────────────────────
// A card is spent when it is played and it stays in the hand, greyed. Removing
// it would be tidier and would throw away the one thing the player most needs to
// see on a first run - that the thing they found is the thing now standing on
// the board. When a run can be lost, the hand is rebuilt from the collection and
// the spent flags go with it.
//
// ── A spent card is that unit's readout ─────────────────────────────────────
// The entry keeps the unit it played, so the card goes on saying something after
// it is spent: how many of them are still standing, and then that they are gone.
// That is the whole of the damage display - there is no bar over anybody's head,
// because a formation thinning out on the board already *is* one, and the card
// is where you look to compare it against what it started as.
//
// It is polled rather than pushed. Damage arrives as a rate against real time,
// so `people` changes on some frame or other rather than at an event worth
// subscribing to, and a comparison across a hand of two or three cards is
// cheaper than the bookkeeping that would avoid it.
export class Deployment extends Component {
  constructor({
    grid,
    visibility,
    control,               // the force a played card joins, and anchors the zone
    deploy,                // (unitType, q, r) => Unit
    overlay = null,        // lights the playable hexes up while a card is armed
    onChange = null,       // () => void, whenever the hand or the arming changes
  } = {}) {
    super();
    this._grid = grid;
    this._visibility = visibility;
    this._control = control;
    this._deploy = deploy;
    this._overlay = overlay;
    this._onChange = onChange;

    this.hand = [];        // [{ card, spent }]
    this.armed = null;     // the entry being placed, or null
  }

  start() {
    // Escape is the one binding that has to exist for a mode: a player who has
    // armed something and changed their mind must not have to find a legal
    // square to get out of it.
    this._onKey = (e) => {
      if (e.code === 'Escape') this.cancel();
    };
    window.addEventListener('keydown', this._onKey);
    // Two things change where a card may go, and the second is the one that is
    // easy to miss: a unit *walking out of camp* frees a tile without changing
    // what anybody has discovered, so watching visibility alone leaves the
    // highlight a step behind the board. Occupancy is already a grid fact with a
    // subscription on it, which is the only reason this is two lines.
    this._unsubSeen = this._visibility.onChange(() => this._boardChanged());
    this._unsubHeld = this._grid.onOccupancyChanged(() => this._boardChanged());
  }

  // ── The hand ─────────────────────────────────────────────────────────────
  // Adds a card. This is what a pickup grants, and later what a deployment
  // screen deals at the start of a run - the same call either way.
  addCard(cardKey) {
    const card = CARD_TYPES[cardKey];
    if (!card) throw new Error(`Unknown card "${cardKey}"`);
    const entry = { card, spent: false };
    this.hand.push(entry);
    this._changed();
    return entry;
  }

  // A card for something already standing on the board - the King, and for now
  // only the King. It is spent on arrival because it was never in anybody's hand
  // to play, and `placed` is what keeps that from reading as a move: the hint
  // below asks whether the player has played anything, and a King dealt spent
  // would answer yes before the run had begun.
  addPlacedCard(cardKey, unit) {
    const entry = this.addCard(cardKey);
    entry.spent = true;
    entry.placed = true;
    entry.unit = unit;
    this._changed();
    return entry;
  }

  get playable() { return this.hand.filter(e => !e.spent).length; }

  // The one line of text the game says to the player, and it lives here rather
  // than in the bar that draws it because every condition it turns on is a fact
  // this component owns. It exists only while it is true - a hint that is always
  // up is furniture, and furniture is not read.
  get hint() {
    // The opening, and it is said once. A King standing alone with a card in
    // hand is a board where nothing has happened yet, and the one thing that is
    // not obvious about this game is that the bar at the bottom is where units
    // come from. The moment anything has been played the player knows, so the
    // condition is "nothing has been played" rather than a timer or a flag.
    if (!this.armed) {
      return this.playable && !this.hand.some(e => e.spent && !e.placed)
        ? 'Click a card to bring it onto the board'
        : '';
    }
    const name = this.armed.card.name ?? this.armed.card.key;
    const anchors = this.anchors();
    // Losing every anchor is a real end state rather than a guard: nothing can
    // be brought in, and the cards in hand are worth nothing until something
    // that can bring them is back on the board.
    if (!anchors.length) return `Nothing on the board can bring the ${name} in`;
    const beside = `beside the ${anchors[0].type.name}`;
    return this.openHexes().length
      ? `Place the ${name} ${beside} - Esc to cancel`
      : `No room ${beside} - move it somewhere clearer`;
  }

  // ── Arming ───────────────────────────────────────────────────────────────
  arm(entry) {
    if (!entry || entry.spent || this.armed === entry) return this.cancel();
    this.armed = entry;
    // Two modes, and this is the whole of keeping them apart.
    this._control?.deselect();
    this._refreshOverlay();
    this._changed();
  }

  cancel() {
    if (!this.armed) return;
    this.armed = null;
    this._refreshOverlay();
    this._changed();
  }

  // ── Where a card may be played ───────────────────────────────────────────
  // Which units the force can bring somebody in beside. A property of the unit
  // type rather than a list here, so a second kind of anchor is one field on a
  // type and no change at all to this.
  anchors() {
    return (this._control?.units ?? []).filter(u => u.type.deployAnchor);
  }

  // Next to an anchor, on ground that is known, with nothing standing on it.
  canPlace(q, r) {
    if (!this._grid.isWalkable(q, r)) return false;
    if (!this._visibility.isExplored(q, r)) return false;
    return this.anchors().some(u => this._grid.hexDistance(u.q, u.r, q, r) === 1);
  }

  // Computed, never stored: the zone moves every time anything takes a step, and
  // a cached copy of it would be one more thing to remember to invalidate on a
  // board where units are the only thing that ever moves.
  openHexes() {
    const out = [], seen = new Set();
    for (const u of this.anchors()) {
      for (const n of this._grid.neighbors(u.q, u.r)) {
        const k = key(n.q, n.r);
        if (seen.has(k)) continue;
        seen.add(k);
        if (this.canPlace(n.q, n.r)) out.push(n);
      }
    }
    return out;
  }

  // ── Input ────────────────────────────────────────────────────────────────
  // Each returns whether it consumed the click, so the force below only hears
  // about the ones that were not about deployment.
  handlePick(hex) {
    if (!this.armed) return false;
    if (!hex || !this.canPlace(hex.q, hex.r)) {
      // A click that is not a placement is a change of mind. It has to be, or
      // the player is stuck in a mode they entered with one click.
      this.cancel();
      return true;
    }
    this.play(this.armed, hex);
    return true;
  }

  handleOrder(_hex) {
    if (!this.armed) return false;
    this.cancel();
    return true;
  }

  handleHover(_hex) { return !!this.armed; }

  // ── Playing it ───────────────────────────────────────────────────────────
  play(entry, hex) {
    if (!entry || entry.spent || !this.canPlace(hex.q, hex.r)) return null;

    const unit = this._deploy?.(entry.card.unit, hex.q, hex.r);
    if (!unit) return null;
    entry.spent = true;
    entry.unit = unit;
    this.armed = null;

    this._control?.add(unit);
    this._control?.refreshVision();
    // Selected on arrival, because the next thing the player wants is almost
    // always to move the thing they just put down.
    this._control?.select(unit);

    this._refreshOverlay();
    this._changed();
    return unit;
  }

  // The board moved while a card was armed, so what may be played onto has
  // changed under it. Both halves are stale, and the second one is the half that
  // is easy to forget: the hand's own line of text is written from this count -
  // "no room in the camp" has to stop being true the moment somebody walks out
  // of it, or the player is told to do the thing they have just done.
  // Watches what the played cards are doing, and tells the bar when it changes.
  update() {
    let changed = false;
    for (const e of this.hand) {
      const now = e.unit ? (e.unit.dead ? -1 : e.unit.people) : null;
      if (now === e.shown) continue;
      e.shown = now;
      changed = true;
    }
    if (changed) this._changed();
  }

  _boardChanged() {
    if (!this.armed) return;
    this._refreshOverlay();
    this._changed();
  }

  _refreshOverlay() {
    this._overlay?.setHexes(this.armed ? this.openHexes() : []);
  }

  _changed() { this._onChange?.(this); }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    this._unsubSeen?.();
    this._unsubHeld?.();
  }
}
