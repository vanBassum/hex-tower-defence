import { Component } from '../../engine/gameobject.js';
import { provokes } from '../units.js';

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
  // How far a group may walk on one action is `moveRange` on its own type, not a
  // table here. It moved there when the roster grew to six, and the reason is
  // that it stopped being a tuning knob and became half of what a unit *is* -
  // Heavy Infantry at two hexes and Cavalry at seven are two ways of using the
  // board, and a number that describes a unit belongs with the unit. What is
  // left here is the fallback for anything that does not say.
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
    this._sig = null;          // what the reachable set was last computed for
    this._epoch = 0;           // bumped when the board changed under it
  }

  start() {
    // The other side stops thinking for itself. Its decisions are taken here
    // now, in answer to what the player did, and leaving both running would be
    // an enemy that reacts *and* hunts on a timer of its own.
    if (this._enemies) this._enemies.auto = false;
    // How far any one group may be ordered, told to UnitControl once rather than
    // written into it every frame. Every route it draws and every order it takes
    // is cut to this, so the thread on the ground and the walk after the click
    // are the same thing - and a group being held is simply a group whose
    // allowance is nought.
    this._control.limit = (u) => (this.pinnedBy(u) ? 0 : this.allowance(u));
    this._unsub = this._visibility?.onChange(() => { this._epoch++; });
  }

  destroy() {
    this._unsub?.();
    if (this._enemies) this._enemies.auto = true;
    this._control.limit = null;   // back to the real-time game's unbounded move
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
    return unit?.type?.moveRange ?? TACTICS.moveDefault;
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  // The right button is the only one that moves anything.
  //
  // A left click on a reachable hex used to be the commit as well, on the
  // reasoning that the lit field was a set of destinations and clicking one meant
  // going there. It made the safe button dangerous: every game with a mouse and
  // an army has one button that only ever changes what is selected, and a left
  // click that sometimes marched fifteen men is the player having to know which
  // tiles are lit before they dare click. So the left button is selection and
  // nothing else - see the note in unit_control.js - and `handlePick` is gone
  // rather than emptied, so nothing is left looking like a gate that does nothing.
  handleOrder(hex) { return this.commit(hex); }

  // One committed move is one player action - or one per group, when several are
  // picked up - and they stay picked up through it, with the reachable field
  // following a lone group along as it walks.
  //
  // The range is not checked here. UnitControl was told the allowance and cuts
  // every route to it, so whoever comes back from `handleOrder` is exactly
  // whoever could move: one answer rather than two that can disagree.
  commit(hex) {
    const moved = this._control.handleOrder(hex);
    if (!moved.length) return false;
    for (const u of moved) this._movers.add(u);
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
  // And one exception, which is a property of the unit rather than a case here:
  // a group that does not `provoke` is not counted, so a Scout standing three
  // hexes off moves nobody. That is the whole of the Scout's reaction rule and
  // it deliberately says nothing about combat - walk him onto the tile next to
  // something and Battle fights him, because Battle asks where things are
  // standing and has never heard of this.
  //
  // Archers outrange a picket's ring, so without the second half a volley from
  // three hexes is free damage forever and the thing being shot stands there
  // being killed. That is not a difficulty knob, it is a rhythm with a hole in
  // it - the whole model is that what you do makes something relevant, and
  // hurting a thing is the plainest way there is of doing that.
  _relevant(enemy) {
    const ring = TACTICS.react[enemy.type.stance] ?? TACTICS.reactDefault;
    for (const u of this._control?.units ?? []) {
      if (u.dead || !provokes(u)) continue;
      const d = this._grid.hexDistance(enemy.q, enemy.r, u.q, u.r);
      if (d <= Math.max(ring, u.type.range ?? 1)) return true;
    }
    return false;
  }

  // Who a relevant enemy walks at, and it is the same filter for the same
  // reason: a picket that would not set off for a Scout must not set off for
  // somebody else and then pick the Scout as the nearer target on arrival.
  //
  // Both halves are `provokes(u)` and nothing else - no unit is named here, and
  // the day a second kind of thing goes unnoticed it is a field on its type.
  // Nothing about *fighting* reads this: something standing next to a Scout is
  // in a fight with it, because Battle asks where things are standing and never
  // asks this question at all.
  _nearest(enemy) {
    let best = null, bestD = Infinity;
    for (const u of this._control?.units ?? []) {
      if (u.dead || !provokes(u)) continue;
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
  //
  // Only ever for *one* group. "Where may this go" has one answer for one unit
  // and no honest answer for six of different speeds: the union lights tiles only
  // the horsemen can reach and the intersection lights almost nothing, and either
  // way the field would be describing a group rather than a unit. What a group
  // order shows instead is the thing it can be exact about - a thread per unit
  // and a mark on every tile they would end up on - and that is drawn on hover by
  // UnitControl.
  _refreshReach() {
    const many = this._control.selection.length > 1;
    const u = many ? null : this._control.selected;
    const held = this.pinnedBy(u);
    const sig = u ? `${u.id}:${u.q},${u.r}:${held ? 'held' : ''}:${this._epoch}` : '';
    if (sig === this._sig) return;
    this._sig = sig;
    this._setReach(u && !held ? this._reachable(u) : []);
  }

  _setReach(hexes) { this._overlay?.setHexes(hexes); }

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
    const stuck = this._control.selection.filter(u => this.pinnedBy(u));
    this._status.hidden = !stuck.length;
    if (!stuck.length) return;
    // One name while one group is held, a count when several are: the point is
    // that the tiles under them are not lit, and with a mixed selection the
    // player needs to know it is some of them rather than all.
    this._status.textContent = stuck.length === 1
      ? `${stuck[0].type.name} - held in the fight`
      : `${stuck.length} groups - held in the fight`;
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
