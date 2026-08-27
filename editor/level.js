import { HexGrid } from '../engine/hex/hex_grid.js';

// What a level *is*, as data, and how that data becomes the pieces the scene
// needs. Two halves on purpose: the top half is a plain object with nothing in
// it but numbers and strings, so the day the editor writes a file it is
// `JSON.stringify(level)` and nothing else; the bottom half is the one place
// that turns it into a grid.
//
// This is the editor's answer to `maps.js` `parseShape`, and it is a separate
// answer for a reason. A map's outline is authored as text because a silhouette
// is judged by looking at it, and text is the shape a person can edit. An
// editor edits one tile at a time, so its level is a list of tiles - the same
// board, in the form the thing doing the editing works in.

// The terrain a tile can be. The three the ground renderer already draws
// differently, and no more: a fourth kind is a fourth thing to draw, not a
// fourth string here.
export const TERRAIN = ['land', 'crag', 'water'];

// The level the editor opens on: a small patch of plain ground with the King
// standing in the middle of it. Small because the first thing anybody does with
// an editor is click a tile, and a board you have to fly across to find one is
// answering a question nobody asked yet.
export function defaultLevel() {
  return {
    name: 'Untitled',
    hexSize: 1,
    // The envelope, not the board - `tiles` is the board. Two rings of margin,
    // so growing the patch later is a tile the editor adds rather than a number
    // here that has to be found first.
    radius: 4,
    tiles: discTiles(2).map(({ q, r }) => ({ q, r, terrain: 'land', level: 0 })),
    units: [{ type: 'king', q: 0, r: 0 }],
  };
}

// Every hex within `radius` of the origin, in axial coordinates.
export function discTiles(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r++) out.push({ q, r });
  }
  return out;
}

// The level data expanded into what the scene reads: a grid whose bounds are the
// land, the per-hex elevation, and which tiles are solid rock.
//
// Nothing here validates. `buildMap` refuses a bad placement because a map is
// authored once and has to be right; an editor is mid-edit almost all the time,
// and a level object that throws while it is being changed is an editor that
// cannot be used.
export function buildLevel(level) {
  const land = level.tiles.filter(t => t.terrain !== 'water');
  const grid = new HexGrid({
    size: level.hexSize,
    radius: level.radius,
    hexes: land.map(({ q, r }) => ({ q, r })),
  });

  const levels = new Map();
  const blockedKeys = new Set();
  const water = [];
  for (const t of level.tiles) {
    if (t.terrain === 'water') { water.push({ q: t.q, r: t.r }); continue; }
    levels.set(`${t.q},${t.r}`, t.level ?? 0);
    // Solid rock is occupancy in the grid, which is where the one rule lives -
    // see the invariant in CLAUDE.md.
    if (t.terrain === 'crag') { blockedKeys.add(`${t.q},${t.r}`); grid.occupy(t.q, t.r); }
  }

  return { grid, levels, blockedKeys, water };
}

// The tile at a coordinate, or null. The editor asks this on every selection, so
// it is here rather than open-coded at the call site.
export function tileAt(level, q, r) {
  return level.tiles.find(t => t.q === q && t.r === r) ?? null;
}
