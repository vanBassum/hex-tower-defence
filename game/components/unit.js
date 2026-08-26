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
// ── Strength is the count, and there is no bar over its head ────────────
// A unit is fifteen people and it loses them. `people` is both the number the
// formation draws and the number damage comes out of, so the health display is
// the unit itself thinning out - already on the board, in the place the player
// is already looking. `Health` and `HealthBar` are still sitting unused in the
// engine and this deliberately does not use them: a pool of hit points behind a
// bar over the unit is a second account of the same fact, and the two would
// drift.
//
// The hit points that do exist are a man's, not the unit's, and that is a
// different thing: `hp` on each entry in `spots`, a small spread either side of
// one, so a unit of fifteen is still worth fifteen. It buys two things a single
// float could not. Damage lands on the men on the line rather than on the unit,
// so the man who falls is one who was fighting; and because each of them has his
// own constitution and takes his own share of a blow, four men holding the same
// edge against the same enemy do not run out at the same instant, and it is not
// the same place in the line that empties every time.
//
// ── How a fight is drawn ─────────────────────────────────────
// A front line on the shared hex edge, and ranks behind it. Both numbers are
// fractions of the formation's reach so they survive a change of hex size.
const FRONT_WIDTH = 4;   // people abreast on the line - four fills the edge
// Which file the n-th person of a rank takes. Middle out rather than left to
// right, for two reasons: the slot a casualty frees is always the first one, and
// the middle of a line is where it should be - and a rank down to two people is
// then a pair standing together instead of a pair off to one side.
const FILE_ORDER = [1, 2, 0, 3];
const FILE_GAP = 0.42;   // between two of them
const RANK_GAP = 0.34;   // and between the line and the rank supporting it
const STANDOFF = 0.16;   // how far short of the edge the line stops
// How much of a man's beat is the thrust, and how much of the thrust is the way
// out. Quick in and a slower recovery, then he stands there until his next one.
const THRUST_SPAN = 0.34;
const THRUST_OUT = 0.30;
// How long a man wears a blow - a jerk, not a stumble. What triggers it is not
// damage but the spear of the man opposite him reaching full extension; see
// `struck`.
const HIT_TIME = 0.18;

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
    this._clock = 0;        // seconds of fighting, for the thrusts

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
  // as a rate times a frame - and it is spent on the men standing on the line,
  // not on the unit. Each of them takes a share of it weighted by his own
  // `bite`, so the same blow is not the same blow to all four of them.
  //
  // The loop is for the lump case (`hex.enemies.units[0].damage(5)` from the
  // console, one day a volley): a pass spends only as much as it takes to drop
  // the next man, then the line is recounted and the rest is spent on whoever is
  // standing there now. In a frame of a fight the first pass ends it.
  damage(amount) {
    if (this.dead || amount <= 0) return;
    const spots = this._mesh?.userData.spots;
    if (!spots) return;

    let pending = amount;
    let guard = this.people + 1;          // a lump must not spin here
    while (pending > 1e-6 && this.people > 0 && guard-- > 0) {
      const line = this._line(spots);
      let weight = 0;
      for (const i of line) weight += spots[i].bite;

      // How much of `pending` this pass can spend before somebody falls.
      let step = pending, victim = -1;
      for (const i of line) {
        const takes = spots[i].hp * weight / spots[i].bite;
        if (takes < step) { step = takes; victim = i; }
      }
      for (const i of line) spots[i].hp -= step * spots[i].bite / weight;
      pending -= step;
      if (victim >= 0) this._fall(victim, spots);
    }
  }

  // The men who are being hit: the front rank of every fight the unit is in. A
  // unit taking damage while somehow not in one is hit across the whole body,
  // which is only reachable from the console.
  _line(spots) {
    const m = this._fights?.length || 1;
    const line = [];
    for (let i = 0; i < this.people; i++) {
      if (((spots[i].slot / m) | 0) < FRONT_WIDTH) line.push(i);
    }
    if (!line.length) for (let i = 0; i < this.people; i++) line.push(i);
    return line;
  }

  // One man down. His entry is swapped with the last live one so that instances
  // 0..people-1 are always the living: `count` culls the tail and there is no
  // telling it to skip a hole in the middle. The swap moves data, not people -
  // the man who takes the vacated instance keeps his own slot and his own eased
  // position, so nothing of his moves on screen.
  _fall(i, spots) {
    const gap = spots[i].slot;
    this.people--;
    const last = this.people;
    if (i !== last) { const t = spots[i]; spots[i] = spots[last]; spots[last] = t; }
    for (const m of this._ranks) m.count = this.people;
    this._closeUp(gap, spots);
    if (this.people <= 0) this._die();
  }

  // The men behind step into the hole, one rank at a time: the man directly
  // behind the gap takes it, the man behind him closes the rank he just left,
  // and so on to the back. Whoever is left standing on the place the formation
  // no longer has - slot `people`, now one past the end - slides across to close
  // whatever the cascade did not.
  //
  // That last move is what keeps the slots a permutation of 0..people-1, and
  // that is the property the whole layout rests on: nothing else stops holes
  // opening in the middle of the block as the unit is worn down.
  _closeUp(gap, spots) {
    const stride = FRONT_WIDTH * (this._fights?.length || 1);
    const holder = (slot) => {
      for (let i = 0; i < this.people; i++) if (spots[i].slot === slot) return i;
      return -1;
    };
    let s = gap;
    for (let behind = holder(s + stride); behind >= 0; behind = holder(s + stride)) {
      spots[behind].slot = s;
      s += stride;
    }
    if (s !== this.people) {
      const tail = holder(this.people);
      if (tail >= 0) spots[tail].slot = s;
    }
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

  // Somebody opposite just put a spear into the man holding `file`. Called from
  // the attacker's own melee pass on the frame his thrust reaches full
  // extension, which is what makes the two animations one event: he is not
  // reacting to damage arriving, he is reacting to that spear.
  //
  // The pairing is the file and nothing else. Both units lay their line along
  // the same edge counted from the same end - opposite `side`, out of Battle -
  // so file f of one stands opposite file f of the other by construction. A file
  // the enemy has nobody left in is a thrust into air, which is correct.
  struck(file, from) {
    const spots = this._mesh?.userData.spots;
    if (!spots || this.dead) return;
    const m = this._fights?.length || 1;
    // Which of this unit's fights the attacker is, so a flanked unit takes the
    // blow on the front it actually came from.
    const t = m > 1 ? this._fights.findIndex((x) => x.foe === from) : 0;
    if (t < 0) return;
    for (let i = 0; i < this.people; i++) {
      const sp = spots[i];
      if (sp.slot % m !== t) continue;
      const slot = (sp.slot / m) | 0;
      if (slot >= FRONT_WIDTH || FILE_ORDER[slot % FRONT_WIDTH] !== file) continue;
      sp.flinch = HIT_TIME;
      return;
    }
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
  // ── A man owns his place ───────────────────────────────────────────────
  // Each man owns his place - `slot` on his entry in `spots` - rather than
  // having it derived from the instance he is drawn at, because the instance he
  // is drawn at changes when somebody else falls. `damage` picks who goes and
  // `_closeUp` decides who steps into the hole; this only reads the answer.
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
    this._clock += dt;
    let moved = 0;

    for (let i = 0; i < n; i++) {
      const sp = g.spots[i];
      let tx = sp.x, tz = sp.z, tyaw = sp.yaw, lunge = 0;

      // Anyone past `live` is not drawn and waits at their home spot.
      if (f && f.length && i < live) {
        // Flanked units split their people between the fights they are in, so
        // each front gets a thinner line rather than one front getting all of
        // it. Which fight a man is in comes off his slot like everything else,
        // so a casualty on one front leaves the other front standing as it was.
        const m = f.length;
        const e = f[sp.slot % m];
        const slot = (sp.slot / m) | 0;
        const file = FILE_ORDER[slot % FRONT_WIDTH];
        const rank = (slot / FRONT_WIDTH) | 0;

        const dx = e.dir.x * ca - e.dir.z * sa;
        const dz = e.dir.x * sa + e.dir.z * ca;

        // Along the edge. `side` is opposite for the two units in a pair, so
        // both count the line from the same end and file 0 faces file 0.
        // Odd ranks sit half a file over - a rank directly behind a rank is a
        // grid, and a grid is a parade.
        // The jitter is inside the `side` too, or the two lines scatter their
        // men in opposite directions and a pair drifts apart by twice it - the
        // one thing that cannot happen now that one man's spear is the reason
        // the other one flinches.
        const along = (((file - (FRONT_WIDTH - 1) / 2) * FILE_GAP
                       + (rank & 1 ? FILE_GAP * 0.5 : 0)) * reach
                     + (hashHex(e.seed, slot, 3) - 0.5) * reach * 0.16) * e.side;
        // Toward it: the line stops just short of the edge and each rank behind
        // falls back one more step into its own tile.
        const out = e.mid - (STANDOFF + rank * RANK_GAP) * reach
                  + (hashHex(e.seed, slot, 7) - 0.5) * reach * 0.12;

        tx = dx * out - dz * along;
        tz = dz * out + dx * along;
        // Their own wobble is kept on top of it, because a rank machined to the
        // degree is the fence the formation jitter exists to avoid.
        tyaw = Math.atan2(dx, dz) + sp.yaw;

        // Only the men who can reach anybody. Each runs his own beat off a
        // shared clock, so the line goes in raggedly and stays ragged - which is
        // the whole point of it, and the reason the beat is his and not a
        // constant. Nothing here touches damage: this is what a fight looks
        // like, not what it costs.
        if (rank === 0) {
          const t = ((this._clock + sp.phase) % sp.beat) / sp.beat;
          const out = THRUST_SPAN * THRUST_OUT;
          lunge = t >= THRUST_SPAN ? 0
                : t < out ? t / out
                : 1 - (t - out) / (THRUST_SPAN - out);
          // Full extension is where the thrust arrives, so that is the frame the
          // man opposite wears it. Nothing travels between them and nothing is
          // scheduled: one man's animation is the other man's cue.
          const home = t >= out && t < THRUST_SPAN;
          if (home && !sp.landed) e.foe?.struck(file, this);
          sp.landed = home;
        }
      }

      sp.cx += (tx - sp.cx) * k;
      sp.cz += (tz - sp.cz) * k;
      let dy = (tyaw - sp.cyaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      sp.cyaw += dy * k;
      moved = Math.max(moved,
        Math.abs(tx - sp.cx) + Math.abs(tz - sp.cz) + Math.abs(dy));
      // Straight off the clock rather than eased with the rest: a blow lands
      // between two frames and a man knocked back over a quarter of a second
      // has been leaned on, not hit.
      if (sp.flinch > 0) sp.flinch = Math.max(0, sp.flinch - dt);
      g.write(i, sp.cx, sp.cz, sp.cyaw, lunge, sp.flinch / HIT_TIME);
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
