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
// ── Zone of control, and where it lives ─────────────────────────────────────
// Nothing *here* stops a unit walking away: this file only ever asks where
// things are standing and takes people off them for it. Being unable to leave a
// fight is a rule about orders, so it is a rule in ActionLoop - `pinnedBy` - and
// it arrived only once there was a move to spend. That order matters. In the
// real-time game there was no turn, so a unit held in place was held forever and
// the rule could not exist; now a move is an action with a cost, and not being
// able to spend it is a price rather than a sentence.
//
// ── Flanking falls out ──────────────────────────────────────────────────────
// Pairs are resolved independently, so a unit with two enemies beside it takes
// from both and gives to both. Nobody wrote a flanking rule; being surrounded is
// simply being in more pairs.
//
// ── Reach, and the first exchange that is not even ──────────────────────────
// `range` on a unit type is how far its attack carries, and it defaults to the
// one hex everything used to assume. It changes the shape of the rule less than
// it looks: a fight is still a fact about where two units are standing, still
// starts and stops by walking, and still needs nobody's permission. What it
// changes is that the two halves of a pair are now decided *separately* - each
// side hurts the other only if it can reach it - so a body of Archers three
// hexes off takes nothing back until the thing it is shooting walks in.
//
// That asymmetry is the whole of ranged combat here. There is no volley to
// order, no arrow to draw and no cover: walk them within three and they are
// killing it, walk them out and they have stopped. Whether the thing being shot
// is allowed to notice is somebody else's rule - see `_relevant` in
// action_loop.js - and deliberately so, because it is a question about the enemy
// rather than about the fight.
//
// ── What a blow is worth is the unit's answer, not this file's ──────────────
// `u.strike(v, dt)` rather than `u.attack * dt`, and the difference is that the
// rate can now depend on the pair and on the moment: Spearmen hit a *mounted*
// target harder, and Cavalry that has just ridden two hexes hits anything
// harder for a second. Neither of those is a fact about where things are
// standing, which is the only kind of fact this file is willing to hold - so
// both live on the type and on the unit, and adjacency-with-casualties is still
// the whole of what is written down here.
//
// Only a pair standing next to each other forms a front line. At range there is
// nothing to form one against, so the shooters are handed a *direction* instead
// and do nothing with it but turn onto it - which is the only thing on screen
// that says where the casualties over there are coming from.
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
    this._aims = new Map();
    for (let a = 0; a < this._sides.length; a++) {
      for (let b = a + 1; b < this._sides.length; b++) {
        this._clash(this._sides[a].units, this._sides[b].units, dt);
      }
    }
    for (const side of this._sides) {
      for (const u of side.units) {
        u.setMelee(this._fights.get(u) ?? null);
        u.setAim(this._aims.get(u) ?? null);
      }
    }
  }

  // How far this one's attack carries. One hex unless its type says otherwise,
  // which is every unit that existed before Archers did.
  _reach(u) { return u.type.range ?? 1; }

  // Both sides of a pair get the same seed and opposite `side`, so the two
  // front lines are counted from the same end of the shared edge and end up
  // opposite each other rather than interleaved.
  //
  // This is a description of where the fight *is* - the direction of the enemy,
  // how far it is to the edge between them, and who is over there. Unit turns it
  // into a front line and ranks behind it, and uses `foe` to tell the man
  // opposite that a thrust has landed on him. The casualties above read none of
  // it: what a fight costs and what it looks like are still two separate
  // accounts of it, and only the second one knows about individuals.
  _engage(u, v) {
    const a = this._grid.hexToWorld(u.q, u.r);
    const b = this._grid.hexToWorld(v.q, v.r);
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const seed = Math.min(u.id, v.id) * 97 + Math.max(u.id, v.id);
    const put = (who, dir, side, foe) => {
      const list = this._fights.get(who) ?? [];
      list.push({ dir, side, seed, mid: d * 0.5, foe });
      this._fights.set(who, list);
    };
    const first = u.id < v.id ? 1 : -1;
    put(u, { x: dx / d, z: dz / d }, first, v);
    put(v, { x: -dx / d, z: -dz / d }, -first, u);
  }

  // Where one unit is shooting another: the way, how far, and how high the thing
  // being shot is standing. Kept only for the first target it finds - a body of
  // men can only face one way, and which of two is nearer is not worth working
  // out for a pose.
  //
  // The height comes off the target's transform rather than the grid, because
  // the arrow has to land on the man and the man is standing on whatever
  // elevation his tile is at.
  _takeAim(who, at) {
    if (this._aims.has(who)) return;
    const a = this._grid.hexToWorld(who.q, who.r);
    const b = this._grid.hexToWorld(at.q, at.r);
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    this._aims.set(who, {
      x: dx / d, z: dz / d, dist: d, y: at.gameObject?.position.y ?? 0,
    });
  }

  _clash(ours, theirs, dt) {
    for (const u of ours) {
      if (u.dead) continue;
      for (const v of theirs) {
        if (v.dead) continue;
        const d = this._grid.hexDistance(u.q, u.r, v.q, v.r);
        // Each half of the pair asked separately. When both reach - which is
        // every pair standing next to each other - this is the rule it has
        // always been.
        const uReaches = d <= this._reach(u);
        const vReaches = d <= this._reach(v);
        if (!uReaches && !vReaches) continue;
        if (d === 1) this._engage(u, v);
        else {
          if (uReaches) this._takeAim(u, v);
          if (vReaches) this._takeAim(v, u);
        }
        // Both at once, so two units that would kill each other do, rather than
        // whichever this loop reaches first surviving on a technicality.
        //
        // What a frame of it costs is asked of the unit rather than read off it:
        // a rate can depend on the kind of thing being hit and on how the
        // attacker arrived, and neither of those is a fact this file has any
        // business knowing. See `Unit.strike`.
        const fromU = uReaches ? u.strike(v, dt) : 0;
        const fromV = vReaches ? v.strike(u, dt) : 0;
        if (fromU) v.damage(fromU);
        if (fromV) u.damage(fromV);
        if (u.dead) break;
      }
    }
  }
}
