import { Component } from '../../engine/gameobject.js';

const key = (h) => `${h.q},${h.r}`;

// ── EXPERIMENT ──────────────────────────────────────────────────────────────
// The board as one action at a time, instead of as a real-time skirmish.
//
// The whole of the prototype is in this file plus five lines of wiring in
// play.js, and turning it off is `tactical: false` on startPlay - at which point
// EnemyForce drives itself again and the game is exactly the real-time one it
// was. That is deliberate: the question being asked is whether
//
//     select → move → the enemy answers → they fight → select again
//
// is a rhythm worth having, and a question you cannot stop asking is one you
// cannot get an answer to.
//
// ── Why there is no End Turn ────────────────────────────────────────────────
// This is not "player phase, enemy phase". One group moves, and only the enemies
// that move made *relevant* answer it. Nothing across the board takes a step
// because you walked somewhere it cannot see, so the board does not lurch every
// time you spend an action - the consequence stays local to the thing you did,
// which is the whole idea being tested.
//
// ── The one authority ───────────────────────────────────────────────────────
// `canCommand()`. Every input path asks it and nothing else keeps a "busy" flag
// of its own, because two booleans about the same fact is how a game ends up
// accepting an order in the middle of a fight.
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

  // A beat of quiet after the last blow before the board is handed back, so the
  // fight is seen to be over rather than the cursor simply working again.
  settle: 0.35,
};

export class ActionLoop extends Component {
  constructor({
    grid,
    control,             // the player's force
    enemies,             // the other one
    visibility,          // what is known - you may not walk into the dark
    overlay = null,      // where the selected group may go
    status = null,       // the element that says the board is busy
  } = {}) {
    super();
    this._grid = grid;
    this._control = control;
    this._enemies = enemies;
    this._visibility = visibility;
    this._overlay = overlay;
    this._status = status;

    this.state = STATE.READY;
    this._mover = null;        // the group whose action is being resolved
    this._reacting = [];       // and the enemies that answered it
    this._quiet = 0;
    this._reachKeys = new Set();
    this._sig = null;          // what the reachable set was last computed for
    this._epoch = 0;           // bumped when the board changed under it
  }

  start() {
    // The other side stops thinking for itself. Its decisions are taken here
    // now, once per player action, and leaving both running would be an enemy
    // that reacts *and* keeps walking while the player is choosing.
    if (this._enemies) this._enemies.auto = false;
    this._unsub = this._visibility?.onChange(() => { this._epoch++; });
    this._setState(STATE.READY);
  }

  destroy() {
    this._unsub?.();
    if (this._enemies) this._enemies.auto = true;
    this._overlay?.setHexes([]);
    // The pill is the experiment's own DOM and nothing else on either page knows
    // about it, so it leaves with the session that put it there.
    this._status?.remove();
  }

  // ── The authority ─────────────────────────────────────────────────────────
  canCommand() { return this.state === STATE.READY; }

  allowance(unit) {
    return TACTICS.move[unit?.type?.key] ?? TACTICS.moveDefault;
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  // A left click on a hex the selection can reach is the commit. Anywhere else
  // and this says so, and the click goes on to mean what it always meant -
  // picking a group up, or putting it down.
  handlePick(hex) {
    if (!this.canCommand() || !this._control.selected) return false;
    if (!this._reachKeys.has(key(hex))) return false;
    return this.commit(hex);
  }

  // The right button still orders, through the same gate and the same range.
  handleOrder(hex) {
    if (!this.canCommand()) return false;
    if (!this._reachKeys.has(key(hex))) return false;
    return this.commit(hex);
  }

  // One committed move is one player action, and the group stays picked up
  // through it. A second order cannot get in - `canCommand()` is false for the
  // whole of the resolution - so the selection costs nothing while the board is
  // busy and buys the thing that matters when it is not: the group you just
  // moved is still the group in your hand, with its new reach already lit, so
  // moving the same troops twice is one click rather than three.
  commit(hex) {
    const unit = this._control.selected;
    if (!unit || !this._control.handleOrder(hex)) return false;
    this._mover = unit;
    this._setState(STATE.MOVING);
    return true;
  }

  // ── Resolution ────────────────────────────────────────────────────────────
  update(dt) {
    switch (this.state) {
      // A fight can start without anybody having moved - a card played onto a
      // tile beside something, or Archers whose range reaches further than the
      // last action took them. It is still the player's doing, so it is still an
      // action's worth of consequence: the enemies it concerns answer it and the
      // board resolves, rather than a fight quietly running while nobody is
      // being asked anything.
      case STATE.READY:
        if (this._engaged()) this._react();
        break;

      case STATE.MOVING:
        if (this._mover && !this._mover.dead && this._mover.isMoving) break;
        this._react();
        break;

      case STATE.REACTING:
        if (this._reacting.some(e => !e.dead && e.isMoving)) break;
        this._setState(STATE.COMBAT);
        this._quiet = 0;
        break;

      case STATE.COMBAT:
        // A fight ends by somebody dying - nothing here stops it early, because
        // the existing combat is a rate applied while two units are alongside
        // and cutting it short would be a second, different combat model.
        if (this._engaged() || this._anyMoving()) { this._quiet = 0; break; }
        this._quiet += dt;
        if (this._quiet >= TACTICS.settle) this._setState(STATE.READY);
        break;
    }
    if (this.state === STATE.READY) this._refreshReach();
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
    this._setState(STATE.REACTING);
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

  // Whether anybody is still hurting anybody, which is Battle's rule read back:
  // a pair is fighting while either of them can reach the other. Archers three
  // hexes out are an encounter that has not finished, so control does not come
  // back while they are still shooting.
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

  _anyMoving() {
    for (const u of this._control.units) if (!u.dead && u.isMoving) return true;
    for (const e of this._enemies?.units ?? []) if (!e.dead && e.isMoving) return true;
    return false;
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this._epoch++;
    if (next === STATE.READY) { this._mover = null; this._reacting = []; }
    else {
      // The reachable set and the route preview both go the moment an action
      // commits. The selection does not - see `commit` - but a route drawn from
      // a group that is halfway along one is describing a move nobody can make.
      this._setReach([]);
      this._sig = null;
      this._control.handleHover(null);
    }
    if (this._status) this._status.hidden = (next === STATE.READY);
  }

  // ── Where you may go ──────────────────────────────────────────────────────
  // Recomputed when the answer could have changed and not otherwise: the
  // selection, where it is standing, or the board itself.
  _refreshReach() {
    const u = this._control.selected;
    const sig = u ? `${u.id}:${u.q},${u.r}:${this._epoch}` : '';
    if (sig === this._sig) return;
    this._sig = sig;
    this._setReach(u ? this._reachable(u) : []);
    // The route preview and the right-button order both go through
    // UnitControl's own pathing, so the allowance is told to it rather than
    // checked twice - which is what keeps a highlighted hex and an orderable
    // hex the same set of hexes.
    this._control.maxSteps = u ? this.allowance(u) : null;
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
}

// The one piece of UI the experiment adds, and it is a word in a corner. There
// are no turns to announce - a banner saying whose turn it is would be
// describing a game this is not - so all it says is that the board is busy
// finishing what you asked for.
//
// Built here rather than in either page's HTML because it belongs to the
// experiment: deleting this file should take it with it.
export function makeStatus(text = 'Resolving…') {
  const el = document.createElement('div');
  el.id = 'resolving';
  el.textContent = text;
  el.hidden = true;
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
    'padding:6px 14px', 'border-radius:99px',
    'background:rgba(9,16,30,0.55)', 'border:1px solid rgba(143,216,232,0.14)',
    'color:#b9cfe0', 'font:12px/1 system-ui,sans-serif',
    'letter-spacing:0.12em', 'text-transform:uppercase',
    'pointer-events:none', 'user-select:none', 'z-index:5',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
