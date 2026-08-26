import { Component } from '../../engine/gameobject.js';

// The other side of the board: who is out there, and what they do about you.
//
// It is the mirror of UnitControl and deliberately much thinner. The player's
// side has selection, routes, vision and a hand; this side has a roster and one
// question asked a few times a second - is anybody near enough to come for?
//
// ── Behaviour belongs to the type ───────────────────────────────────────────
// `aggro` on a unit type is the whole of what Spearmen do. The next kind will
// want something else - hold a tile whatever happens, fall back to a friend,
// shout for one - and the shape that has to survive is that each of those is a
// field on the type and a branch here, rather than a new component per enemy.
// Nothing about this is written as "the Spearmen behaviour"; it is written as
// what a unit with an `aggro` number does.
//
// ── They are not fogged, and that is not a cheat ────────────────────────────
// An enemy thinks whether or not the player can see it. It lives here; being
// unobserved does not make it asleep. What the fog does is hide it - the same
// `field.patch` sweep every other layer goes through - so the first you know of
// a picket you walked too close to is that it is already moving. That is the
// tension the aggro range exists to produce, and it only works if the range is
// wider than a Scout can see.
export class EnemyForce extends Component {
  constructor({
    grid,
    control,             // the player's force: what they are looking for
    rethink = 0.4,       // seconds between decisions - not every frame
  } = {}) {
    super();
    this._grid = grid;
    this._control = control;
    this._rethink = rethink;
    this._since = 0;
    this.units = [];
  }

  add(unit) {
    if (this.units.includes(unit)) return unit;
    this.units.push(unit);
    // Where the level stood it. A picket that chases and then stays wherever the
    // chase ended is not a picket - it is a wandering mob, and a player who
    // pokes it and backs off would drag it across the island a hex at a time.
    // Holding a post is what makes "get close and they come" a thing you can
    // decide *not* to do twice.
    unit.post = { q: unit.q, r: unit.r };
    unit.onDied(() => this.remove(unit));
    return unit;
  }

  remove(unit) {
    const i = this.units.indexOf(unit);
    if (i >= 0) this.units.splice(i, 1);
  }

  update(dt) {
    // A decision every frame would be a hundred path searches a second to
    // produce the same answer, and it would also make an enemy re-order itself
    // mid-step forever - the route is recomputed from where it *is*, so asking
    // again immediately is asking a unit that has not moved yet.
    this._since += dt;
    if (this._since < this._rethink) return;
    this._since = 0;

    for (const e of this.units) {
      if (e.dead || !e.type.aggro) continue;

      const target = this._nearest(e);
      if (!target) { this._goHome(e); continue; }

      const d = this._grid.hexDistance(e.q, e.r, target.q, target.r);
      // Already in reach: stand and fight. Battle does the rest, and a unit that
      // kept walking would spend the fight shuffling around its own target.
      if (d <= 1) { if (e.isMoving) e.stop(); continue; }

      // Stop one hex short. `findPath` will happily end on an occupied goal -
      // that exception exists so a route can be drawn *to* something - and
      // walking onto the target is not what "engage" means.
      const path = this._grid.findPath(e.q, e.r, target.q, target.r);
      if (!path || path.length < 3) continue;
      e.follow(path.slice(0, -1));
    }
  }

  // Back to its post once nothing is near enough to bother with. It walks rather
  // than snapping, so a player watching from two hexes away sees the picket give
  // up and re-form - which is the only way they learn that backing off works.
  _goHome(e) {
    if (!e.post || e.isMoving) return;
    if (e.q === e.post.q && e.r === e.post.r) return;
    const path = this._grid.findPath(e.q, e.r, e.post.q, e.post.r);
    if (path && path.length > 1) e.follow(path);
  }

  // The nearest thing worth going for, if it is inside this one's aggro range.
  _nearest(enemy) {
    let best = null, bestD = Infinity;
    for (const u of this._control?.units ?? []) {
      if (u.dead) continue;
      const d = this._grid.hexDistance(enemy.q, enemy.r, u.q, u.r);
      if (d < bestD) { bestD = d; best = u; }
    }
    return bestD <= enemy.type.aggro ? best : null;
  }
}
