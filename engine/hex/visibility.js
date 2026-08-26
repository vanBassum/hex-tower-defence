// What the player has seen of the board.
//
// Three states, and the one rule that matters between them: a hex that has been
// seen never goes back to unseen. Vision is a fact about *now* - it comes and
// goes as units move - while discovery is a fact about the run, and the two have
// to be kept apart or walking away from a hill would un-draw it.
//
// This is deliberately not the fog *renderer*. It is a set of hexes and a state
// each, which means the rule above is enforced in one place and the drawing can
// change without touching it.
export const HEX_VISIBILITY = {
  UNEXPLORED: 0,   // never seen - hidden
  EXPLORED:   1,   // seen before, nothing is looking at it now
  VISIBLE:    2,   // inside some unit's view distance right now
};

const key = (q, r) => `${q},${r}`;

export class VisibilityMap {
  // `hexes` is every hex that *can* be fogged, which on this board is land and
  // sea both: the shape of a coastline is a thing worth discovering, so the sea
  // being unplayable is no reason for it to start visible.
  constructor(grid, hexes) {
    this._grid    = grid;
    this._state   = new Map();
    this._visible = new Set();
    this._listeners = new Set();
    for (const h of hexes) this._state.set(key(h.q, h.r), HEX_VISIBILITY.UNEXPLORED);
  }

  // Fires whenever any hex changes state. Returns an unsubscribe function.
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  stateAt(q, r)   { return this._state.get(key(q, r)) ?? HEX_VISIBILITY.UNEXPLORED; }
  isVisible(q, r) { return this.stateAt(q, r) === HEX_VISIBILITY.VISIBLE; }
  // "Has ever been seen" - true for VISIBLE as well, because the newer state
  // does not undo the older fact.
  isExplored(q, r){ return this.stateAt(q, r) !== HEX_VISIBILITY.UNEXPLORED; }

  *hexes() {
    for (const [k, state] of this._state) {
      const [q, r] = k.split(',');
      yield { q: +q, r: +r, state };
    }
  }

  // Recomputes vision from scratch out of a list of sources, each
  // `{q, r, viewDistance}`. Taking a list rather than a unit is the whole point:
  // what the player can see is the union of what everything they own can see,
  // and a second unit joining later should be a longer array here and nothing
  // else. Recomputing rather than diffing keeps that union honest - two units
  // whose ranges overlap must not un-see a hex when one of them steps away.
  update(sources) {
    const next = new Set();
    for (const s of sources) {
      const d = s.viewDistance ?? 0;
      for (const { q, r } of this._grid.hexesInRange(s.q, s.r, d)) {
        const k = key(q, r);
        // A hex this map does not cover is open ocean: there is nothing there to
        // reveal.
        if (this._state.has(k)) next.add(k);
      }
    }

    let changed = false;
    for (const k of this._visible) {
      if (next.has(k)) continue;
      this._state.set(k, HEX_VISIBILITY.EXPLORED);   // never UNEXPLORED again
      changed = true;
    }
    for (const k of next) {
      if (this._state.get(k) === HEX_VISIBILITY.VISIBLE) continue;
      this._state.set(k, HEX_VISIBILITY.VISIBLE);
      changed = true;
    }
    this._visible = next;

    if (changed) for (const fn of this._listeners) fn(this);
    return changed;
  }

  // Ground the player is taken to already know. The camp is the only thing that
  // uses it and the reason is not a shortcut: a run now begins with nothing
  // standing on the board, so a camp nobody can see is a camp nobody can deploy
  // into, and the game would open unable to start. It is also simply true - you
  // came ashore there.
  //
  // EXPLORED rather than VISIBLE, because nothing is looking at it yet. Which is
  // the right reading anyway: at the first frame the camp is a place you know
  // rather than a place you are watching.
  reveal(hexes) {
    let changed = false;
    for (const h of hexes) {
      const k = key(h.q, h.r);
      if (this._state.get(k) !== HEX_VISIBILITY.UNEXPLORED) continue;
      this._state.set(k, HEX_VISIBILITY.EXPLORED);
      changed = true;
    }
    if (changed) for (const fn of this._listeners) fn(this);
    return changed;
  }

  // Debug: lift the whole map at once. Everything not currently in view is
  // EXPLORED rather than VISIBLE, so the two still read differently.
  revealAll() {
    let changed = false;
    for (const [k, state] of this._state) {
      if (state !== HEX_VISIBILITY.UNEXPLORED) continue;
      this._state.set(k, HEX_VISIBILITY.EXPLORED);
      changed = true;
    }
    if (changed) for (const fn of this._listeners) fn(this);
    return changed;
  }
}
