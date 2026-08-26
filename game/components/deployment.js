import { Component } from '../../engine/gameobject.js';
import { CARD_TYPES } from '../cards.js';

const key = (q, r) => `${q},${r}`;

// The camp, and the hand of cards that can be played into it.
//
// Two things that look separate and are not: a card is *where* as much as it is
// *what*. A reinforcement that could appear anywhere is a reinforcement with no
// cost to being far from home, and the moment a card can only be played at camp,
// walking away from camp is a decision - the cache you found on the far shore is
// a card you have to come back to spend. So the zone and the hand are one
// component, because neither of them means anything without the other.
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
export class Deployment extends Component {
  constructor({
    grid,
    visibility,
    control,               // the force a played card joins
    deploy,                // (unitType, q, r) => Unit
    zone = [],             // the hexes a card may be played onto
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

    this.zone = zone.map(h => ({ q: h.q, r: h.r }));
    this._zoneKeys = new Set(this.zone.map(h => key(h.q, h.r)));
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

  get playable() { return this.hand.filter(e => !e.spent).length; }

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
  // Inside the camp, on ground that is known, with nothing standing on it. The
  // discovery check is not ceremony: camp goes dim when nobody is looking at it
  // but it never goes unknown, so this only ever refuses a zone hex on a map
  // where the camp has not been reached yet.
  canPlace(q, r) {
    if (!this._zoneKeys.has(key(q, r))) return false;
    if (!this._visibility.isExplored(q, r)) return false;
    return this._grid.isWalkable(q, r);
  }

  openHexes() { return this.zone.filter(h => this.canPlace(h.q, h.r)); }

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
