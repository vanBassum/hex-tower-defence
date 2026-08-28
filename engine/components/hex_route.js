import { HexOverlay, flatBar } from './hex_overlay.js';

// A thin line drawn through an *ordered* run of hexes, centre to centre.
//
// It is the one marking here whose hexes are a sequence rather than a set, and
// that is the whole reason it is worth having. A route lit tile by tile says
// which tiles are on the way and nothing about the shape of the walk; a line
// says where it goes, which way it turns and what it goes round - and it says it
// in a tenth of the ink, over ground the player still has to read while they
// decide.
//
// It starts at the first hex it is given rather than the second, so the line
// comes out of the unit that would walk it. Whatever is at the far end is drawn
// by something else: the cursor is already sitting on the destination.
//
// Every run overshoots both ends by half its own width, so the turn between two
// runs is filled rather than notched. On a 120 degree corner that is a couple of
// pixels of overlap and it costs nothing to leave it there.
export class HexRoute extends HexOverlay {
  constructor(grid, hexes = [], { width = 0.075, ...opts } = {}) {
    super(grid, hexes, opts);
    this._width = width * grid.size;
  }

  _rebuild() {
    this._clear();
    if (this._hexes.length < 2) return;

    const w = this._width;
    const pts = this._hexes.map(({ q, r }) => {
      const c = this._grid.hexToWorld(q, r);
      return { x: c.x, y: this._yAt(q, r), z: c.z };
    });

    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ex = (dx / len) * w * 0.5, ez = (dz / len) * w * 0.5;
      flatBar(out, a.x - ex, a.y, a.z - ez, b.x + ex, b.y, b.z + ez, w);
    }
    this._emit(out);
  }
}
