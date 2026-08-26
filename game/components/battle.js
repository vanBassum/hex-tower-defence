import { Component } from '../../engine/gameobject.js';

// What happens when two sides end up next to each other.
//
// The whole of it: any two opposing units on adjacent hexes take casualties off
// each other, at each one's own rate, for as long as they are still adjacent.
// There is no attack order, no target selection and no turn - a fight is a fact
// about where things are standing, and it starts and stops by units walking.
//
// That is minimal on purpose. Combat is the next milestone rather than this one,
// and every part of it that could be decided now would be decided without an
// enemy that has ever been fought, a turn to spend, or a reason to retreat. What
// is here is the smallest thing that makes an encounter mean something: walking
// into one costs you people, and people are what a unit is.
//
// ── No zone of control ──────────────────────────────────────────────────────
// Nothing stops a player unit walking away, or walking straight past. It bleeds
// while it is alongside and then it is gone. A rule that pinned units in place
// is a rule about turns, and holding somebody still in a game with no turn to
// spend is holding them still forever.
//
// ── Flanking falls out ──────────────────────────────────────────────────────
// Pairs are resolved independently, so a unit with two enemies beside it takes
// from both and gives to both. Nobody wrote a flanking rule; being surrounded is
// simply being in more pairs.
export class Battle extends Component {
  constructor({ grid, sides = [] } = {}) {
    super();
    this._grid = grid;
    // Each side is anything with a `units` array - UnitControl and EnemyForce
    // both are, without either of them being told about this.
    this._sides = sides;
  }

  update(dt) {
    if (dt <= 0) return;
    this._fights = new Map();
    for (let a = 0; a < this._sides.length; a++) {
      for (let b = a + 1; b < this._sides.length; b++) {
        this._clash(this._sides[a].units, this._sides[b].units, dt);
      }
    }
    for (const side of this._sides) {
      for (const u of side.units) u.setMelee(this._fights.get(u) ?? null);
    }
  }

  // Both sides of a pair get the same seed and opposite `side`, so the two
  // front lines are counted from the same end of the shared edge and end up
  // opposite each other rather than interleaved.
  //
  // This is a description of where the fight *is* - the direction of the enemy
  // and how far it is to the edge between them - and nothing about who hits
  // whom. Unit turns it into a front line and ranks behind it; the casualties
  // above do not read any of it.
  _engage(u, v) {
    const a = this._grid.hexToWorld(u.q, u.r);
    const b = this._grid.hexToWorld(v.q, v.r);
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const seed = Math.min(u.id, v.id) * 97 + Math.max(u.id, v.id);
    const put = (who, dir, side) => {
      const list = this._fights.get(who) ?? [];
      list.push({ dir, side, seed, mid: d * 0.5 });
      this._fights.set(who, list);
    };
    const first = u.id < v.id ? 1 : -1;
    put(u, { x: dx / d, z: dz / d }, first);
    put(v, { x: -dx / d, z: -dz / d }, -first);
  }

  _clash(ours, theirs, dt) {
    for (const u of ours) {
      if (u.dead) continue;
      for (const v of theirs) {
        if (v.dead) continue;
        if (this._grid.hexDistance(u.q, u.r, v.q, v.r) !== 1) continue;
        this._engage(u, v);
        // Both at once, so two units that would kill each other do, rather than
        // whichever this loop reaches first surviving on a technicality.
        const fromU = u.attack * dt;
        const fromV = v.attack * dt;
        v.damage(fromU);
        u.damage(fromV);
        if (u.dead) break;
      }
    }
  }
}
