import { HexOverlay, flatBar } from './hex_overlay.js';

// A hex marked at its corners instead of filled: six short brackets sitting just
// inside the tile's own boundary, with the middle of every edge left open.
//
// It exists because a filled hex is the wrong shape for what these markings
// mean. A fill says *this ground is different* - which is what terrain and fog
// are for - and everything drawn in the interaction colour is saying something
// else: this tile is one you can act on. A bracket points at a tile without
// claiming any of it, so the grass, the height and the things standing there all
// stay readable underneath, and a field of twenty of them still reads as twenty
// separate tiles rather than as one pale region.
//
// The gap in the middle of each edge is the whole effect and it is what `arm`
// buys: at 0.5 the brackets meet and it is an outline again.
//
// Inset for a reason worth knowing: two tiles that are both marked share a
// corner, and brackets drawn on the boundary would land on top of each other
// there and read as one bright dot between two tiles rather than as a corner of
// each. Pulled in, every tile's marking is unmistakably its own.
export class HexCorners extends HexOverlay {
  constructor(grid, hexes = [], {
    // All three are fractions: `arm` of an edge, `inset` of the way from the
    // centre to a corner, `width` of the hex's own size - so a marking keeps its
    // proportions on a board built at any scale.
    // Short. The first pass ran the arms to a third of each edge, which leaves a
    // gap of about a third in the middle - and a hexagon with three small gaps in
    // it is a dashed outline, not a corner mark. Two dozen of those and the board
    // is wearing a wireframe. A fifth of an edge is where it stops being an
    // outline and starts being six ticks pointing at a tile.
    arm = 0.19,
    inset = 0.90,
    width = 0.045,
    ...opts
  } = {}) {
    super(grid, hexes, opts);
    this._arm = arm;
    this._inset = inset;
    this._width = width * grid.size;
  }

  _rebuild() {
    this._clear();
    if (!this._hexes.length) return;

    const out = [];
    for (const { q, r } of this._hexes) {
      const c = this._grid.hexToWorld(q, r);
      const y = this._yAt(q, r);
      const p = this._grid.hexCorners(q, r).map(k => ({
        x: c.x + (k.x - c.x) * this._inset,
        z: c.z + (k.z - c.z) * this._inset,
      }));
      for (let i = 0; i < 6; i++) {
        const a = p[i];
        // Both ways round the tile from this corner. The two arms start at the
        // same point, so they overlap by half a width there - which is what
        // closes the outside of the angle and makes the corner read as a corner
        // rather than as two separate ticks.
        for (const j of [(i + 1) % 6, (i + 5) % 6]) {
          const b = p[j];
          flatBar(out, a.x, y, a.z,
                  a.x + (b.x - a.x) * this._arm, y, a.z + (b.z - a.z) * this._arm,
                  this._width);
        }
      }
    }
    this._emit(out);
  }
}
