import { Component } from '../../engine/gameobject.js';

const key = (h) => `${h.q},${h.r}`;

// ── EXPERIMENT ──────────────────────────────────────────────────────────────
// The board as one action at a time, without ever taking the board away.
//
// The whole of the prototype is in this file plus a few lines of wiring in
// play.js, and turning it off is `tactical: false` on startPlay - at which point
// EnemyForce drives itself again and the game is the real-time one it was.
//
// ── What a move costs, and what it does not ─────────────────────────────────
// Committing a move spends an allowance - a group walks so many hexes and no
// further, which is the whole of what makes a move a decision - and it makes the
// enemies it concerns answer. What it does *not* do is stop the player playing.
// Orders can be given while a walk is still happening, while enemies are
// answering, and in the middle of a fight.
//
// It used to lock the board for the whole of that, on the reasoning that one
// action at a time means one action *finishing* at a time. That was wrong in
// practice for a plain reason: a fight is five to fifteen seconds of watching,
// and a game that takes the cursor away for fifteen seconds every time two units
// touch is a game about waiting. Nothing about the rhythm needed it - a group
// still gets one move, an enemy still only answers what concerns it - so the
// lock is gone, and the phases below are a *description* of what the board is
// doing rather than a gate on what the player may do.
//
// ── The one thing that does hold you ────────────────────────────────────────
// A group standing next to a living enemy cannot be ordered. That is the only
// restriction left, it is per-group rather than global, and it is a rule about
// adjacency rather than about combat: Archers shooting something three hexes off
// are not being held by it and may fall back and keep shooting, and the moment
// something reaches them they are in the same fight as everybody else and stay
// in it. It is the first zone of control this game has had, and it is only
// coherent because a move is now a thing you spend - see the note in battle.js
// about why pinning a unit used to mean pinning it forever.
export const STATE = {
  READY:    'PLAYER_READY',
  MOVING:   'PLAYER_MOVING',
  REACTING: 'ENEMY_REACTING',
  COMBAT:   'COMBAT_RESOLVING',
};

// Everything worth turning while playing it, in one place - the reaction rules
// are expected to be rewritten several times before this is either kept or
// deleted, and hunting them through the methods below is not the way to do that.
export const TACTICS = {
  // How far a group may walk on one action, by unit type. A Scout goes furthest
  // because looking is what it is for; the King the least, because the whole
  // force is deployed around him and moving him moves where the army can arrive.
  move: { scout: 5, king: 3, footman: 4, archers: 3, spearmen: 4 },
  moveDefault: 4,

  // How close you have to come before an enemy answers, by stance. This is the
  // single most important number in the experiment and the first one to turn.
  //
  // `hold` is 2 rather than 4 on purpose: a picket that comes for you the moment
  // you are anywhere near it means the Scout can never look at one and decide to
  // go round, and being able to decide that is what makes a move a decision. At
  // 2 the threat ring is exactly one step wider than the fight, so stepping into
  // it *is* the choice to start one.
  react: { hold: 2, hunt: 4 },
  reactDefault: 3,
};

export class ActionLoop extends Component {
  constructor({
    grid,
    control,             // the player's force
    enemies,             // the other one
    visibility,          // what is known - you may not walk into the dark
    overlay = null,      // where the selected group may go
    status = null,       // and why it may not, when it may not
  } = {}) {
    super();
    this._grid = grid;
    this._control = control;
    this._enemies = enemies;
    this._visibility = visibility;
    this._overlay = overlay;
    this._status = status;

    this._movers = new Set();  // groups whose action has not finished playing out
    this._reacting = [];       // and the enemies answering the last one
    this._fighting = false;    // whether anybody was engaged a frame ago
    this._reachKeys = new Set();
    this._sig = null;          // what the reachable set was last computed for
    this._epoch = 0;           // bumped when the board changed under it
  }

  start() {
    // The other side stops thinking for itself. Its decisions are taken here
    // now, in answer to what the player did, and leaving both running would be
    // an enemy that reacts *and* hunts on a timer of its own.
    if (this._enemies) this._enemies.auto = false;
    this._unsub = this._visibility?.onChange(() => { this._epoch++; });
  }

  destroy() {
    this._unsub?.();
    if (this._enemies) this._enemies.auto = true;
    this._overlay?.setHexes([]);
    // The notice is the experiment's own DOM and nothing else on either page
    // knows about it, so it leaves with the session that put it there.
    this._status?.remove();
  }

  // ── What the board is doing ───────────────────────────────────────────────
  // Derived rather than stored, now that nothing is waiting on it: there is no
  // machine left to get out of step with the board when it is read off the
  // board. It is kept because it is still the right vocabulary for
  // `hex.loop.state` and for whatever eventually wants to say what is going on.
  get state() {
    if (this._movers.size) return STATE.MOVING;
    if (this._reacting.some(e => !e.dead && e.isMoving)) return STATE.REACTING;
    if (this._fighting) return STATE.COMBAT;
    return STATE.READY;
  }

  // ── Who may be ordered ────────────────────────────────────────────────────
  // The enemy holding this group in place, if one is. Adjacency and nothing
  // else - see the note at the top of the file for why that is the whole rule,
  // and why Archers need no exception written for them.
  pinnedBy(unit) {
    if (!unit || unit.dead) return null;
    for (const e of this._enemies?.units ?? []) {
      if (e.dead) continue;
      if (this._grid.hexDistance(unit.q, unit.r, e.q, e.r) === 1) return e;
    }
    return null;
  }

  canOrder(unit) { return !!unit && !unit.dead && !this.pinnedBy(unit); }

  // Kept for anything still asking the old question. There is no global lock any
  // more, so the answer is always yes and the real question is `canOrder`.
  canCommand() { return true; }

  allowance(unit) {
    return TACTICS.move[unit?.type?.key] ?? TACTICS.moveDefault;
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  // A left click on a hex the selection can reach is the commit. Anywhere else
  // and this says so, and the click goes on to mean what it always meant -
  // picking a group up, or putting it down.
  //
  // Neither of these tests being held or being out of range. A group that cannot
  // move has an empty reachable set, so the rule is applied in the one place
  // that computes it and there is no second answer to disagree with the first.
  handlePick(hex) {
    if (!this._control.selected) return false;
    if (!this._reachKeys.has(key(hex))) return false;
    return this.commit(hex);
  }

  // The right button still orders, through the same gate and the same range.
  handleOrder(hex) {
    if (!this._reachKeys.has(key(hex))) return false;
    return this.commit(hex);
  }

  // One committed move is one player action, and the group stays picked up
  // through it - the group you just moved is still the group in your hand, with
  // its reachable set following it along as it walks.
  commit(hex) {
    const unit = this._control.selected;
    if (!unit || !this._control.handleOrder(hex)) return false;
    this._movers.add(unit);
    return true;
  }

  // ── Consequences ──────────────────────────────────────────────────────────
  // Two things make the enemy think, and both are edges rather than states: an
  // action that has finished playing out, and a fight that was not happening a
  // frame ago. Edges because nothing is waiting for a phase to end any more - on
  // a state, this would re-order the same enemies sixty times a second.
  update() {
    for (const u of this._movers) {
      if (!u.dead && u.isMoving) continue;
      this._movers.delete(u);
      this._react();
    }

    // A fight can start without anybody having moved - a card played beside
    // something, or Archers whose range reaches further than the last action
    // took them - and it is still the player's doing.
    const fighting = this._engaged();
    if (fighting && !this._fighting) this._react();
    this._fighting = fighting;

    this._refreshReach();
    this._say();
  }

  // Who answers, and it is deliberately the plainest rule that can be written:
  // an enemy that has been made relevant walks at the nearest player group and
  // stops a hex short, and every other enemy on the island does nothing at all.
  // No line of sight, no memory, no coordination - all of which are things to
  // try *after* the rhythm is known to be worth keeping.
  //
  // In id order, so the same board and the same move give the same answer twice.
  _react() {
    this._reacting = [];
    const roster = [...(this._enemies?.units ?? [])].sort((a, b) => a.id - b.id);
    for (const e of roster) {
      if (e.dead) continue;
      // One already on its way finishes what it started. Re-issuing its route
      // every time anything happens is how a picket ends up stuttering between
      // two targets - and the player can now keep acting throughout, which is
      // what makes this line necessary rather than tidy.
      if (e.isMoving) { this._reacting.push(e); continue; }
      if (!this._relevant(e)) continue;
      const target = this._nearest(e);
      if (!target) continue;

      const d = this._grid.hexDistance(e.q, e.r, target.q, target.r);
      if (d <= 1) continue;        // already alongside: Battle is its answer

      // `findPath` will happily end on the target's own hex - that exception is
      // there so a route can be drawn *to* something - and walking onto it is
      // not what closing means.
      const path = this._grid.findPath(e.q, e.r, target.q, target.r);
      if (!path || path.length < 3) continue;
      const steps = Math.min(path.length - 2, this.allowance(e));
      if (steps < 1) continue;
      e.follow(path.slice(0, steps + 1));
      this._reacting.push(e);
    }
  }

  // What makes an enemy the business of the action that just happened. Two
  // things, and the second is not a nicety: somebody has come inside its own
  // threat ring, *or* somebody is close enough to be shooting it.
  //
  // Archers outrange a picket's ring, so without the second half a volley from
  // three hexes is free damage forever and the thing being shot stands there
  // being killed. That is not a difficulty knob, it is a rhythm with a hole in
  // it - the whole model is that what you do makes something relevant, and
  // hurting a thing is the plainest way there is of doing that.
  _relevant(enemy) {
    const ring = TACTICS.react[enemy.type.stance] ?? TACTICS.reactDefault;
    for (const u of this._control?.units ?? []) {
      if (u.dead) continue;
      const d = this._grid.hexDistance(enemy.q, enemy.r, u.q, u.r);
      if (d <= Math.max(ring, u.type.range ?? 1)) return true;
    }
    return false;
  }

  _nearest(enemy) {
    let best = null, bestD = Infinity;
    for (const u of this._control?.units ?? []) {
      if (u.dead) continue;
      const d = this._grid.hexDistance(enemy.q, enemy.r, u.q, u.r);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  // Whether anybody is hurting anybody, which is Battle's rule read back: a pair
  // is fighting while either of them can reach the other.
  _engaged() {
    for (const u of this._control.units) {
      if (u.dead) continue;
      for (const e of this._enemies?.units ?? []) {
        if (e.dead) continue;
        const d = this._grid.hexDistance(u.q, u.r, e.q, e.r);
        if (d <= Math.max(u.type.range ?? 1, e.type.range ?? 1)) return true;
      }
    }
    return false;
  }

  // ── Where you may go ──────────────────────────────────────────────────────
  // Recomputed when the answer could have changed and not otherwise: the
  // selection, where it is standing, whether it is being held, or the board
  // itself. A group's own coordinate is in there, so the reachable set follows
  // it along as it walks - which is what lets an order be changed halfway
  // through the last one.
  _refreshReach() {
    const u = this._control.selected;
    const held = this.pinnedBy(u);
    const sig = u ? `${u.id}:${u.q},${u.r}:${held ? 'held' : ''}:${this._epoch}` : '';
    if (sig === this._sig) return;
    this._sig = sig;
    this._setReach(u && !held ? this._reachable(u) : []);
    // The route preview and the right-button order both go through UnitControl's
    // own pathing, so the allowance is told to it rather than checked twice -
    // which is what keeps a highlighted hex and an orderable hex the same set of
    // hexes. Zero is how a group being held has nowhere to go.
    this._control.maxSteps = !u ? null : held ? 0 : this.allowance(u);
  }

  _setReach(hexes) {
    this._reachKeys = new Set(hexes.map(key));
    this._overlay?.setHexes(hexes);
  }

  // A flood out to the allowance over ground that is walkable and known. Both
  // conditions are the ones UnitControl already puts on a route, so anything lit
  // up here is somewhere the order will actually be taken.
  _reachable(unit) {
    const max = this.allowance(unit);
    const seen = new Set([key(unit)]);
    const out = [];
    let edge = [{ q: unit.q, r: unit.r }];
    for (let step = 0; step < max && edge.length; step++) {
      const next = [];
      for (const h of edge) {
        for (const n of this._grid.neighbors(h.q, h.r)) {
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!this._grid.isWalkable(n.q, n.r)) continue;
          if (!this._visibility.isExplored(n.q, n.r)) continue;
          out.push(n);
          next.push(n);
        }
      }
      edge = next;
    }
    return out;
  }

  // The one line of UI, and it says the one thing the board cannot. A group you
  // have picked up with nothing lit around it might be walled in by crags, or
  // out of allowance, or held in a fight, and all three look identical. It is
  // off the rest of the time: there is nothing to announce when the answer is
  // yes.
  _say() {
    if (!this._status) return;
    const u = this._control.selected;
    const held = this.pinnedBy(u);
    this._status.hidden = !held;
    if (held) this._status.textContent = `${u.type.name} - held in the fight`;
  }
}

// The one piece of UI the experiment adds, and it is a line in a corner. It said
// "Resolving…" while the board used to take the cursor away; it says who cannot
// leave now, which is the only thing left that the player can be told and cannot
// see. Yellow, because it is about a group they are holding - see MOOD.interact.
//
// Built here rather than in either page's HTML because it belongs to the
// experiment: deleting this file should take it with it.
export function makeStatus() {
  const el = document.createElement('div');
  el.id = 'held';
  el.hidden = true;
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
    'padding:6px 14px', 'border-radius:99px',
    'background:rgba(9,16,30,0.55)', 'border:1px solid rgba(255,210,74,0.28)',
    'color:#ffd24a', 'font:12px/1 system-ui,sans-serif',
    'letter-spacing:0.12em', 'text-transform:uppercase',
    'pointer-events:none', 'user-select:none', 'z-index:5',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
