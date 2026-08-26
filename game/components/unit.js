import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { UNIT_TYPES } from '../units.js';
import { hashHex } from '../../engine/hex/hex_noise.js';

// Something standing on a hex.
//
// The unit's position *is* its hex coordinate. The world position is a
// consequence of it, and the walk between two hexes is an animation over that
// consequence - so an order takes effect the moment it is given and nothing
// downstream has to wait for a tween to finish before it can ask where the unit
// is. That is the whole reason fog lifts as a march sets off along a route rather
// than when it arrives, and it is what keeps a second order mid-stride meaningful.
//
// ── One walk, not a queue of hops ───────────────────────────────────────────
// A route is walked at a constant speed straight through, the way PathFollower
// walks a list of points: a distance budget is spent across waypoints, so a
// corner never costs a frame of movement and a tile boundary is not an event. The
// first version eased each tile separately, which put an accelerate-and-stop in
// the middle of every hex - fifteen people repeatedly coming to rest on their way
// somewhere. The easing that remains is at the two ends of the *whole* route,
// which is where a body actually does start and stop.
//
// The unit holds its hex in the grid's occupancy set, which is how it becomes
// impassable to everything else for free: crags already work that way, and A*
// and `isWalkable` already ask.
//
// ── Strength is the count, and there is no bar over its head ────────────────
// A unit is fifteen people and it loses them. `people` is both the number the
// formation draws and the number damage comes out of, so the health display is
// the unit itself thinning out - already on the board, in the place the player
// is already looking. `Health` and `HealthBar` are still sitting unused in the
// engine and this deliberately does not use them: a pool of hit points behind a
// bar is a second account of the same fact, and the two would drift.
//
// The float behind it matters. Damage arrives as a rate against real time, so
// `_strength` is fractional and `people` is what that rounds up to - otherwise
// the smallest tick of damage either kills somebody or is thrown away, and at
// fifteen people a thrown-away tick is most of the fight.
//
// ── How a fight is drawn ─────────────────────────────────────
// A front line on the shared hex edge, and ranks behind it. Both numbers are
// fractions of the formation's reach so they survive a change of hex size.
const FRONT_WIDTH = 4;   // people abreast on the line - four fills the edge
const FILE_GAP = 0.42;   // between two of them
const RANK_GAP = 0.34;   // and between the line and the rank supporting it
const STANDOFF = 0.16;   // how far short of the edge the line stops

let UNIT_ID = 0;

export class Unit extends Component {
  constructor({
    grid,
    ground = null,          // for tile height - a unit floats without it
    type = 'scout',
    q = 0, r = 0,
    viewDistance = null,    // overrides the type's, for tuning
    colors = {},
    tuning = {},
    speed = 3.4,            // world units per second, held for the whole route
    ramp = 0.8,             // how much of the route is spent getting up to speed
    creep = 0.30,           // and how slowly it may crawl at the very ends
    gait = 0.10,            // how far the formation rises and falls as it walks
    stride = 0.55,          // and how far it travels between two of those
    turnRate = 7.0,         // radians per second the formation may swing round
    // Scale up out of nothing instead of being there. Off for the units a run
    // starts with - they were always there - and on for one that joins partway
    // through, because fifteen people appearing between two frames is the kind
    // of thing the rest of this board goes out of its way not to do. It is the
    // same easing the props use when their tile is found, for the same reason.
    emerge = false,
    emergeRate = 2.2,
    onMoved = null,         // (unit) => void, fired the instant the hex changes
    onDied = null,          // (unit) => void, fired when the last of them is gone
  } = {}) {
    super();
    this.type = UNIT_TYPES[type];
    if (!this.type) throw new Error(`Unknown unit type "${type}"`);
    this._grid = grid;
    this._ground = ground;
    this._colors = colors;
    this._tuning = tuning;
    this.q = q;
    this.r = r;
    this.viewDistance = viewDistance ?? this.type.viewDistance;
    this.selected = false;
    this.speed = speed;
    this._ramp = ramp;
    this._creep = creep;
    this._gait = gait;
    this._stride = stride;
    this._turnRate = turnRate;
    this._emergeRate = emergeRate;
    this._born = emerge ? 0 : 1;   // 0..1, how much of the formation has arrived

    // Whose it is. A fact about the type rather than the placement, because what
    // makes something an enemy is what it is, not where the level put it.
    this.hostile = !!this.type.hostile;
    this.attack = this.type.attack ?? 0;
    this.people = this.type.people ?? 1;
    this._strength = this.people;
    this.dead = false;
    this._deathListeners = new Set();
    this.id = ++UNIT_ID;
    if (onDied) this._deathListeners.add(onDied);

    this._leg = null;       // {from, to, len} - the tile being walked into
    this._along = 0;        // how far along that leg
    this._route = [];       // hexes still to enter, in order
    this._walked = 0;       // distance covered on this route, for the ramps
    this._total = 0;        // and how long the route is in total
    this._facing = 0;       // where the formation is pointed, eased toward the leg

    // Several things want to hear about a step - fog, the route preview, later
    // whatever spends the movement point - so it is a list rather than one slot.
    this._moveListeners = new Set();
    if (onMoved) this._moveListeners.add(onMoved);
  }

  // Fires once, when the unit has nobody left. Returns an unsubscribe function.
  onDied(fn) {
    this._deathListeners.add(fn);
    return () => this._deathListeners.delete(fn);
  }

  // Takes casualties. `amount` is in people and may be fractional - it arrives
  // as a rate times a frame - and the mesh is only touched when the whole number
  // actually changes, so a fight costs one `count` write per person lost rather
  // than one per frame.
  //
  // *Which* person that is, is decided in `_writeMelee`: a count always drops
  // the highest instance, so the melee hands that index the front line and the
  // one behind it steps up. Nothing here has to know that.
  damage(amount) {
    if (this.dead || amount <= 0) return;
    this._strength -= amount;

    const left = Math.max(0, Math.ceil(this._strength));
    if (left !== this.people) {
      this.people = left;
      for (const m of this._ranks) m.count = left;
    }
    if (this._strength <= 0) this._die();
  }

  // Nobody left. The unit takes itself off the board rather than waiting to be
  // collected: its hex has to be freed and its mesh has to stop being drawn
  // whoever owned it, and `destroy` already does both.
  _die() {
    if (this.dead) return;
    this.dead = true;
    for (const fn of this._deathListeners) fn(this);
    this.gameObject.game?.remove(this.gameObject);
  }

  // Fires the instant the hex coordinate changes, not when the walk finishes.
  // Returns an unsubscribe function.
  onMoved(fn) {
    this._moveListeners.add(fn);
    return () => this._moveListeners.delete(fn);
  }

  _notifyMoved() {
    for (const fn of this._moveListeners) fn(this);
  }

  get hex() { return { q: this.q, r: this.r }; }

  // What this unit contributes to what the player can see. Everything the fog
  // needs and nothing about how it is drawn, so the visibility pass never has to
  // know a Unit exists.
  get visionSource() { return { q: this.q, r: this.r, viewDistance: this.viewDistance }; }

  start() {
    // The hex size goes in with the tuning: a formation is laid out as a
    // fraction of the tile it stands on, so it survives the board changing scale
    // without anything in units.js knowing a number.
    this._mesh = this.type.build(this._colors, { ...this._tuning, hexSize: this._grid.size });
    this.gameObject.object3D.add(this._mesh);
    this._ring = this._mesh.userData.selectionRing ?? null;
    this._ranks = this._mesh.userData.ranks ?? [];
    this._grid.occupy(this.q, this.r);
    this._snap();
    this._facing = this.gameObject.rotation.y;
    if (this._born < 1) this._mesh.scale.setScalar(0.0001);
  }

  // Where this unit stands, in world space.
  _worldAt(q, r) {
    const { x, z } = this._grid.hexToWorld(q, r);
    return new THREE.Vector3(x, this._ground ? this._ground.topY(q, r) : 0, z);
  }

  _snap() {
    this.gameObject.position.copy(this._worldAt(this.q, this.r));
  }

  // Drops the unit onto a hex with no animation - starting position, or a
  // teleport from the debug console.
  placeAt(q, r) {
    if (this._grid.isOccupied(this.q, this.r)) this._grid.free(this.q, this.r);
    this.q = q; this.r = r;
    this._grid.occupy(q, r);
    this._clearRoute();
    if (this._mesh) this._snap();
    this._notifyMoved();
  }

  // Walks a route. `hexes` is a path as HexGrid.findPath returns one - the hex
  // the unit is standing on first, then every hex it enters.
  //
  // The coordinate advances one tile at a time as the march reaches it, rather
  // than jumping to the far end when the order is given. That is the difference
  // between an order and a teleport, and it is what makes a long walk *reveal* a
  // long walk: the fog lifts a tile at a time along the route, so where you chose
  // to go is what you find out about.
  follow(hexes) {
    if (!hexes || hexes.length < 2) return;
    this._route = hexes.slice(1);
    this._walked = 0;
    // Measured from where the unit actually *is*, not from the tile it belongs
    // to, so a new order given mid-stride cuts the corner instead of snapping
    // back to the tile centre first.
    this._total = this._routeLength(this.gameObject.position);
    this._openLeg(this.gameObject.position.clone());
  }

  // One hex, which is a route of one.
  moveTo(q, r) { this.follow([{ q: this.q, r: this.r }, { q, r }]); }

  _routeLength(from) {
    let total = 0;
    let p = from;
    for (const h of this._route) {
      const w = this._worldAt(h.q, h.r);
      total += Math.hypot(w.x - p.x, w.z - p.z);
      p = w;
    }
    return total;
  }

  // Starts walking into the next tile of the route. The coordinate changes here,
  // at the moment the formation commits to the tile rather than when it lands on
  // it - which is what keeps the fog opening in front of the march.
  //
  // `from` is passed in rather than read off the transform, and that is not a
  // detail. Mid-route it is the centre of the tile just reached - the exact point
  // the previous leg ended at - because the transform still holds *last frame's*
  // position at the moment a boundary is crossed. Anchoring to it instead put the
  // new leg's origin behind the boundary, so the unit re-walked the overlap and
  // stalled for a frame at every single hex. Only the first leg of a route starts
  // from the transform, which is what lets a new order given mid-stride cut the
  // corner rather than snapping back to a tile centre.
  _openLeg(from) {
    const next = this._route.shift();
    if (!next) { this._clearRoute(); this._snap(); return false; }

    this._grid.free(this.q, this.r);
    this.q = next.q; this.r = next.r;
    this._grid.occupy(this.q, this.r);

    const to = this._worldAt(this.q, this.r);
    // Length is measured flat. Height is a separate curve below, so counting the
    // climb here would make a unit walk slower up a hill than across it for no
    // reason anybody asked for.
    this._leg = { from, to, len: Math.max(1e-4, Math.hypot(to.x - from.x, to.z - from.z)) };
    this._along = 0;
    this._notifyMoved();
    return true;
  }

  _clearRoute() {
    this._route.length = 0;
    this._leg = null;
    this._along = 0;
  }

  // Drops the order. What has already been walked stays walked.
  stop() {
    if (this._leg) this._snap();
    this._clearRoute();
  }

  get isMoving() { return this._leg !== null; }
  get stepsLeft() { return this._route.length + (this._leg ? 1 : 0); }

  setSelected(on) {
    this.selected = on;
    if (this._ring) this._ring.visible = on;
  }

  // The fights this unit is in this frame, as Battle describes them, or null.
  setMelee(fights) {
    if (fights) this._settling = true;
    this._fights = fights;
  }

  // A fight is a front line and the people behind it.
  //
  // The first few of a unit's people walk out to the edge it shares with the
  // enemy and stand along it, so the two sides meet on one line instead of each
  // milling about its own tile. Everyone else falls in behind them in loose,
  // half-staggered ranks, and all of them - line and ranks alike - turn to face
  // the enemy, which is what makes a crowd read as one body supporting its
  // fighters rather than as fifteen people who happen to be nearby.
  //
  // Nobody paths anywhere. A person eases from their formation spot to the spot
  // the fight hands them and eases back when it ends, so this is a layout the
  // formation is bent into and not a second movement system. It is also why
  // there is nothing to undo: `setMelee(null)` and the same easing walks them
  // home.
  //
  // ── The line is filled from the back ────────────────────────────────────
  // Casualties are a `count` on an InstancedMesh, and a count draws instances
  // 0..count-1 - so the person a casualty takes off the board is always the
  // *highest* live index, and there is no choosing otherwise short of a second
  // index buffer nobody needs. The people doing the dying are supposed to be the
  // people doing the fighting, so the slots are handed out backwards: the
  // highest live index stands on the front line and index 0 stands at the back.
  //
  // The replacement falls out of that and costs nothing. `live` drops by one, so
  // every remaining person's slot drops by one, so the whole body steps up a
  // place - and because a slot is a target eased toward rather than a position
  // written, that step reads as the ranks closing over the gap.
  _writeMelee(dt) {
    const g = this._mesh.userData;
    if (!g.write) return;
    const f = this._fights;
    const n = g.spots.length;
    const live = this.people;
    const reach = g.reach;
    const k = 1 - Math.exp(-4 * dt);
    // Battle describes the fight in world space; people are placed in the mesh's
    // local space, which the unit's own facing has already turned. Without this
    // the line forms on whichever edge the unit happened to walk in along.
    const a = this.gameObject.rotation.y;
    const ca = Math.cos(a), sa = Math.sin(a);
    let moved = 0;

    for (let i = 0; i < n; i++) {
      const sp = g.spots[i];
      let tx = sp.x, tz = sp.z, tyaw = sp.yaw;

      // Counted from the back, so the front line sits at the high indices - see
      // above. Anyone past `live` is not drawn; they wait at their home spot so
      // there is somewhere sane to come back from if the unit is ever refilled.
      const j = live - 1 - i;

      if (f && f.length && j >= 0) {
        // Flanked units split their people between the fights they are in, so
        // each front gets a thinner line rather than one front getting all of it.
        const e = f[j % f.length];
        const slot = (j / f.length) | 0;
        const file = slot % FRONT_WIDTH;
        const rank = (slot / FRONT_WIDTH) | 0;

        const dx = e.dir.x * ca - e.dir.z * sa;
        const dz = e.dir.x * sa + e.dir.z * ca;

        // Along the edge. `side` is opposite for the two units in a pair, so
        // both count the line from the same end and file 0 faces file 0.
        // Odd ranks sit half a file over - a rank directly behind a rank is a
        // grid, and a grid is a parade.
        const along = ((file - (FRONT_WIDTH - 1) / 2) * FILE_GAP
                      + (rank & 1 ? FILE_GAP * 0.5 : 0)) * reach * e.side
                    + (hashHex(e.seed, slot, 3) - 0.5) * reach * 0.16;
        // Toward it: the line stops just short of the edge and each rank behind
        // falls back one more step into its own tile.
        const out = e.mid - (STANDOFF + rank * RANK_GAP) * reach
                  + (hashHex(e.seed, slot, 7) - 0.5) * reach * 0.12;

        tx = dx * out - dz * along;
        tz = dz * out + dx * along;
        // Their own wobble is kept on top of it, because a rank machined to the
        // degree is the fence the formation jitter exists to avoid.
        tyaw = Math.atan2(dx, dz) + sp.yaw;
      }

      sp.cx += (tx - sp.cx) * k;
      sp.cz += (tz - sp.cz) * k;
      let dy = (tyaw - sp.cyaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      sp.cyaw += dy * k;
      moved = Math.max(moved,
        Math.abs(tx - sp.cx) + Math.abs(tz - sp.cz) + Math.abs(dy));
      g.write(i, sp.cx, sp.cz, sp.cyaw);
    }
    g.flush();
    if (!f && moved < 0.002) this._settling = false;
  }

  update(dt) {
    if (this._fights || this._settling) this._writeMelee(dt);
    if (this._born < 1) {
      this._born = Math.min(1, this._born + this._emergeRate * dt);
      const s = this._born * this._born * (3 - 2 * this._born);
      this._mesh.scale.setScalar(Math.max(0.0001, s));
    }
    if (!this._leg) return;

    // Spend the frame's distance across as many tiles as it reaches, so a tile
    // boundary costs nothing and the speed through a corner is the speed along a
    // straight.
    let budget = this.speed * this._pace() * dt;
    while (budget > 0 && this._leg) {
      const remain = this._leg.len - this._along;
      if (budget < remain) { this._along += budget; this._walked += budget; budget = 0; }
      else {
        this._along = this._leg.len;
        this._walked += remain;
        budget -= remain;
        // The leg ended exactly here, so the next one starts exactly here.
        if (!this._openLeg(this._leg.to.clone())) return;   // route done, _snap ran
      }
    }
    this._write(dt);
  }

  // Ease in at the start of the route and out at the end, and nowhere else. The
  // floor matters: without it a long route crawls off the mark and a short one
  // never gets going at all.
  _pace() {
    if (this._total <= 0) return 1;
    const ends = Math.min(this._walked, this._total - this._walked);
    const t = Math.min(1, Math.max(0, ends / this._ramp));
    return this._creep + (1 - this._creep) * (t * t * (3 - 2 * t));
  }

  _write(dt) {
    const { from, to, len } = this._leg;
    const u = this._along / len;
    const pos = this.gameObject.position;
    pos.x = from.x + (to.x - from.x) * u;
    pos.z = from.z + (to.z - from.z) * u;

    // Height is on its own curve, because interpolating it with the rest walks
    // the unit straight through the cliff face between two elevations: halfway
    // along the leg the unit is exactly on the shared edge, and a plain lerp puts
    // it half a step *inside* the drop. Climbing, height arrives by the halfway
    // point - you step up onto the ledge and then walk. Descending, it waits
    // until then - you walk to the edge and then step down. Either way the value
    // at the end of a leg is the start of the next, so there is no seam.
    const eY = to.y >= from.y ? Math.min(1, u * 2) : Math.max(0, u * 2 - 1);
    pos.y = from.y + (to.y - from.y) * eY;

    // A gait, driven by distance covered rather than by progress through a tile -
    // otherwise it resets at every hex and reads as a stumble. Raised rather than
    // swung, because half a swing is a formation walking through the ground.
    // Small, too: fifteen people a quarter of a unit tall, and anything you can
    // pick out individually is far too much.
    const bob = 0.5 - 0.5 * Math.cos((this._walked / this._stride) * Math.PI * 2);
    pos.y += bob * this._gait * 0.5 * this._pace();

    // Turn toward the leg rather than snapping to it, so a corner is taken rather
    // than pivoted on. Local +Z is forward, as it is for PathFollower.
    const want = Math.atan2(to.x - from.x, to.z - from.z);
    let d = (want - this._facing) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    const step = this._turnRate * dt;
    this._facing += Math.abs(d) <= step ? d : Math.sign(d) * step;
    this.gameObject.rotation.y = this._facing;
  }

  destroy() {
    this._clearRoute();
    this._grid.free(this.q, this.r);
    this._mesh?.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.userData.ownMaterial) o.material.dispose();
    });
  }
}
