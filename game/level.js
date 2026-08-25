import { HexGrid } from '../engine/hex/hex_grid.js';

// A level states its path as straight runs meeting at corners rather than as a
// hex list: the runs are what penetrating weapons will want to line up with, so
// the geometry stays readable when levels get edited.
export const LEVEL_1 = {
  name: 'Long Diagonal',
  hexSize: 1,
  radius: 6,
  waypoints: [
    { q: -6, r:  6 },   // spawn, bottom-left edge
    { q:  3, r: -3 },   // one long diagonal straight through the middle
    { q:  3, r:  3 },   // 120 degree corner, then a short run down to the base
  ],
  // Integer elevation levels; world height is level * step. Entries apply in
  // order, so author low-to-high and let the later one win. Path hexes are
  // stamped last at `pathLevel`, so the route always keeps its own height.
  //
  // Hill footprints are kept clear of the path on purpose - a hill running into
  // the path would swallow the step that makes the route readable.
  pathLevel: 1,
  elevation: [
    { level: 1, center: { q: -3, r: -1 }, radius: 2 },
    { level: 2, center: { q: -3, r: -1 }, radius: 1 },
    { level: 1, center: { q: -1, r:  5 }, radius: 1 },
  ],

  // Hand-placed props to establish scale. Every one of these hexes covers zero
  // path hexes, so none of them takes a build position worth having. Three sit on
  // the hills to read the elevation, three sit on flat ground near the route so
  // tree and rock have something known to be measured against.
  props: [
    { type: 'tree', q: -3, r: -1 },   // hill summit, level 2
    { type: 'tree', q: -4, r:  0 },   // hill, level 2
    { type: 'rock', q: -3, r: -3 },   // hill edge, level 1
    { type: 'tree', q: -1, r:  5 },   // small hill, level 1
    { type: 'rock', q:  0, r:  3 },   // flat, beside the descending run
    { type: 'rock', q: -5, r:  2 },   // flat, beside the long diagonal
  ],

  // delay = lead-in before the wave's first enemy, counted from the moment the
  // previous wave finished spawning, so waves overlap if the board is not
  // clearing. `enemy` may be a repeating pattern, which is how a wave is given
  // an ordering rather than just a head count. `bonus` is paid once the wave has
  // finished spawning.
  //
  // Tuned against a simulation of the real components driving the real level.
  // The economy funds about 13 guns in total, and that ceiling is what makes
  // placement matter: covering the corner wins with 28/30 lives, hugging the
  // spawn scrapes in at 1/30, and clustering at the base loses.
  waves: [
    { enemy: 'grunt',                              count:  8, interval: 1.0,  delay: 4, bonus:  7 },
    { enemy: 'grunt',                              count: 12, interval: 0.8,  delay: 7, bonus:  8 },
    { enemy: 'runner',                             count: 14, interval: 0.45, delay: 7, bonus: 10 },
    { enemy: ['grunt', 'grunt', 'runner'],         count: 18, interval: 0.6,  delay: 7, bonus: 11 },
    { enemy: ['brute', 'grunt', 'grunt'],          count: 12, interval: 1.2,  delay: 8, bonus: 14 },
    { enemy: ['runner', 'runner', 'runner', 'grunt'], count: 24, interval: 0.35, delay: 7, bonus: 17 },
    { enemy: ['grunt', 'grunt', 'brute'],          count: 24, interval: 0.6,  delay: 8, bonus: 20 },
    { enemy: ['brute', 'brute', 'grunt', 'grunt'], count: 24, interval: 0.9,  delay: 9 },
  ],
};

// Expands a level definition into the runtime pieces the scene needs.
export function buildLevel(def) {
  const grid = new HexGrid({ size: def.hexSize, radius: def.radius });

  const path = [];
  for (let i = 0; i < def.waypoints.length - 1; i++) {
    const a = def.waypoints[i], b = def.waypoints[i + 1];
    const run = grid.hexLine(a.q, a.r, b.q, b.r);
    // Drop the joint: the next run starts on the hex this one ended on.
    for (const h of (i === 0 ? run : run.slice(1))) path.push(h);
  }

  for (const h of path) {
    if (!grid.inBounds(h.q, h.r)) {
      throw new Error(`Level "${def.name}": path leaves the board at ${h.q},${h.r}`);
    }
  }

  // The path is off-limits for building. Kept as keys so placement checks are a
  // set lookup rather than a scan.
  const pathKeys = new Set(path.map(h => `${h.q},${h.r}`));

  return {
    def,
    grid,
    path,
    pathKeys,
    levels: buildElevation(def, grid, path),
    props: def.props ?? [],
    worldPath: path.map(h => grid.hexToWorld(h.q, h.r)),
    spawn: path[0],
    goal:  path[path.length - 1],
    waves: def.waves,
  };
}

// Expands the elevation spec into a per-hex integer level.
function buildElevation(def, grid, path) {
  const levels = new Map();
  for (const { q, r } of grid.allHexes()) levels.set(`${q},${r}`, 0);

  for (const region of def.elevation ?? []) {
    for (const h of elevationHexes(region, grid)) {
      if (!grid.inBounds(h.q, h.r)) {
        throw new Error(`Level "${def.name}": elevation region leaves the board at ${h.q},${h.r}`);
      }
      levels.set(`${h.q},${h.r}`, region.level);
    }
  }

  // Stamped last so a mis-authored hill can never flatten the route.
  const pathLevel = def.pathLevel ?? 0;
  for (const h of path) levels.set(`${h.q},${h.r}`, pathLevel);

  return levels;
}

function elevationHexes(region, grid) {
  if (region.hexes) return region.hexes;
  if (region.center && region.radius !== undefined) {
    const out = [];
    for (const h of grid.allHexes()) {
      if (grid.hexDistance(region.center.q, region.center.r, h.q, h.r) <= region.radius) out.push(h);
    }
    return out;
  }
  if (region.from && region.to) {
    return grid.hexLine(region.from.q, region.from.r, region.to.q, region.to.r);
  }
  throw new Error('Elevation region needs {center,radius}, {from,to} or {hexes}');
}
