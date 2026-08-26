import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { UNIT_TYPES } from '../units.js';

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
    onMoved = null,         // (unit) => void, fired the instant the hex changes
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
    this._grid.occupy(this.q, this.r);
    this._snap();
    this._facing = this.gameObject.rotation.y;
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

  update(dt) {
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
