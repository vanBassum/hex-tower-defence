// Flat-top hex grid using axial coordinates (q, r).
// `size` = circumradius (center → corner). Flat-to-flat distance = sqrt(3) * size.

const SQRT3 = Math.sqrt(3);

const NEIGHBORS = [
  [+1,  0], [+1, -1], [ 0, -1],
  [-1,  0], [-1, +1], [ 0, +1],
];

// The same six as axial offsets, for anything that needs a direction rather than
// a neighbour. `neighbors()` only yields hexes that exist, which is the right
// answer for walking a board and the wrong one for growing it.
export const HEX_DIRECTIONS = NEIGHBORS.map(([q, r]) => ({ q, r }));

export class HexGrid {
  // `radius` is the envelope the grid iterates. `hexes`, when given, is the
  // board inside that envelope - the set of hexes that actually exist - which is
  // how a level gets a shape instead of a disc. Everything that asks whether a
  // hex is real goes through inBounds, so a shaped board gets coastline cliffs,
  // grid lines and placement rejection without any of them knowing about it.
  constructor({ size = 1, radius = 16, hexes = null } = {}) {
    this.size      = size;
    this.radius    = radius;
    this._shape    = hexes ? new Set(hexes.map(h => (typeof h === 'string' ? h : `${h.q},${h.r}`))) : null;
    this._occupied = new Set();    // "q,r" keys
    this._occupancyListeners = new Set();
    // Cached A* results, keyed "sq,sr|gq,gr". Flushed on any occupancy change —
    // a cached route stays valid until something on the map blocks it.
    this._pathCache    = new Map();
    this._pathCacheCap = 2000;
  }

  // Subscribe to occupancy changes. Callback receives (q, r).
  // Returns an unsubscribe function.
  onOccupancyChanged(fn) {
    this._occupancyListeners.add(fn);
    return () => this._occupancyListeners.delete(fn);
  }

  _notifyOccupancy(q, r) {
    // Any walkability change invalidates every cached path — a full flush is
    // simpler and correct than maintaining per-hex reverse indexes.
    if (this._pathCache.size > 0) this._pathCache.clear();
    for (const fn of this._occupancyListeners) fn(q, r);
  }

  // ── Coords ────────────────────────────────────────────────────────────────
  hexToWorld(q, r) {
    return {
      x: this.size * 1.5 * q,
      z: this.size * SQRT3 * (r + q / 2),
    };
  }

  worldToHex(x, z) {
    const q = (2 / 3 * x) / this.size;
    const r = (-x / 3 + SQRT3 / 3 * z) / this.size;
    return this._roundAxial(q, r);
  }

  _roundAxial(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz)      rx = -ry - rz;
    else if (dy > dz)            ry = -rx - rz;
    else                         rz = -rx - ry;
    return { q: rx, r: rz };
  }

  hexDistance(aq, ar, bq, br) {
    return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
  }

  inBounds(q, r) {
    const s = -q - r;
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > this.radius) return false;
    return this._shape ? this._shape.has(`${q},${r}`) : true;
  }

  *neighbors(q, r) {
    for (const [dq, dr] of NEIGHBORS) {
      const nq = q + dq, nr = r + dr;
      if (this.inBounds(nq, nr)) yield { q: nq, r: nr };
    }
  }

  // Every hex within `n` steps of (q, r), the centre included. Vision, a blast
  // radius and a move range are all the same question, so it is the grid's to
  // answer rather than each caller's - and it is asked in hex steps, because a
  // world-space radius on a hex grid gives a different shape depending on which
  // way the ring runs.
  //
  // It yields hexes inside the *envelope* rather than inside the board, because
  // the sea is drawn and is not playable: fog has to be able to lift off a
  // stretch of water, and a coastline you cannot discover is a coastline the
  // map has already told you about. Pass `playableOnly` when the answer has to
  // be somewhere a unit could stand.
  *hexesInRange(q, r, n, { playableOnly = false } = {}) {
    for (let dq = -n; dq <= n; dq++) {
      const lo = Math.max(-n, -dq - n);
      const hi = Math.min( n, -dq + n);
      for (let dr = lo; dr <= hi; dr++) {
        const hq = q + dq, hr = r + dr;
        const s = -hq - hr;
        if (Math.max(Math.abs(hq), Math.abs(hr), Math.abs(s)) > this.radius) continue;
        if (playableOnly && !this.inBounds(hq, hr)) continue;
        yield { q: hq, r: hr };
      }
    }
  }

  // Every hex on the board, which on a shaped board is not every hex in the
  // envelope.
  *allHexes() {
    for (let q = -this.radius; q <= this.radius; q++) {
      const r1 = Math.max(-this.radius, -q - this.radius);
      const r2 = Math.min( this.radius, -q + this.radius);
      for (let r = r1; r <= r2; r++) {
        if (this._shape && !this._shape.has(`${q},${r}`)) continue;
        yield { q, r };
      }
    }
  }

  hexCorners(q, r) {
    const { x, z } = this.hexToWorld(q, r);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      out.push({ x: x + this.size * Math.cos(a), z: z + this.size * Math.sin(a) });
    }
    return out;
  }

  // Straight run of hexes from a to b, both ends included. Used to describe
  // paths as runs and, later, to walk a firing line across the board.
  hexLine(aq, ar, bq, br) {
    const n = this.hexDistance(aq, ar, bq, br);
    if (n === 0) return [{ q: aq, r: ar }];
    // Tiny unequal nudges so a sample landing exactly between two hexes
    // resolves consistently instead of flip-flopping with the direction.
    const aqn = aq + 1e-6, arn = ar + 2e-6;
    const bqn = bq + 1e-6, brn = br + 2e-6;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(this._roundAxial(aqn + (bqn - aqn) * t, arn + (brn - arn) * t));
    }
    return out;
  }

  // ── Occupancy ─────────────────────────────────────────────────────────────
  _key(q, r)       { return `${q},${r}`; }
  occupy(q, r)     { this._occupied.add(this._key(q, r));    this._notifyOccupancy(q, r); }
  free(q, r)       { this._occupied.delete(this._key(q, r)); this._notifyOccupancy(q, r); }
  isOccupied(q, r) { return this._occupied.has(this._key(q, r)); }
  isWalkable(q, r) { return this.inBounds(q, r) && !this.isOccupied(q, r); }

  // ── A* pathfinding (returns array of {q, r} including start) ─────────────
  // extraBlocked: optional Set of "q,r" keys treated as impassable except for
  // the goal itself. Queries with extraBlocked bypass the cache.
  findPath(sq, sr, gq, gr, extraBlocked = null) {
    if (extraBlocked) return this._findPathUncached(sq, sr, gq, gr, extraBlocked);

    const cacheKey = sq + ',' + sr + '|' + gq + ',' + gr;
    const cached = this._pathCache.get(cacheKey);
    // Paths are returned as fresh arrays — callers shouldn't share the
    // cached objects. `null` is cached too (a known-unreachable route).
    if (cached !== undefined) return cached === null ? null : cached.map(p => ({ q: p.q, r: p.r }));

    const path = this._findPathUncached(sq, sr, gq, gr, null);

    // Bounded cache. On overflow just flush — paths are cheap to recompute and
    // the next round of queries re-warms it.
    if (this._pathCache.size >= this._pathCacheCap) this._pathCache.clear();
    this._pathCache.set(cacheKey, path);
    return path === null ? null : path.map(p => ({ q: p.q, r: p.r }));
  }

  _findPathUncached(sq, sr, gq, gr, extraBlocked) {
    const open   = new Map();   // key → node
    const closed = new Set();
    const startK = this._key(sq, sr);
    open.set(startK, { q: sq, r: sr, g: 0, f: this.hexDistance(sq, sr, gq, gr), parent: null });

    while (open.size > 0) {
      // Pop lowest f (linear scan — grid is small)
      let bestK = null, best = null;
      for (const [k, v] of open) {
        if (best === null || v.f < best.f) { best = v; bestK = k; }
      }
      open.delete(bestK);

      if (best.q === gq && best.r === gr) {
        const path = [];
        for (let cur = best; cur; cur = cur.parent) path.unshift({ q: cur.q, r: cur.r });
        return path;
      }
      closed.add(bestK);

      for (const { q, r } of this.neighbors(best.q, best.r)) {
        const k = this._key(q, r);
        if (closed.has(k))       continue;
        if (this.isOccupied(q, r) && !(q === gq && r === gr)) continue;
        if (extraBlocked?.has(k) && !(q === gq && r === gr))  continue;
        const g = best.g + 1;
        const existing = open.get(k);
        if (existing && existing.g <= g) continue;
        open.set(k, { q, r, g, f: g + this.hexDistance(q, r, gq, gr), parent: best });
      }
    }
    return null;
  }
}
