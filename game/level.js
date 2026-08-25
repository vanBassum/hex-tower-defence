import { HexGrid } from '../engine/hex/hex_grid.js';
import { hashHex } from '../engine/hex/hex_noise.js';

// A level states its path as straight runs meeting at corners rather than as a
// hex list: the runs are what penetrating weapons will want to line up with, so
// the geometry stays readable when levels get edited.
export const LEVEL_1 = {
  name: 'Long Diagonal',
  hexSize: 1,
  // The envelope the board is drawn inside: the island reaches radius 6 and the
  // sea it sits in takes the three rings beyond it.
  radius: 9,
  // The island, drawn rather than listed - see parseShape below for the layout.
  // `radius` is now only the envelope this is drawn inside.
  //
  // The coastline is where the level says what it is. Every cut is a statement
  // about where a stretch of the route can be covered from, and the water drawn
  // against it is what makes the cut visible:
  //
  //   - The bay in the north-east comes right up to the second half of the
  //     diagonal, so that stretch is a causeway with water on its north side and
  //     can only be shot at from the south. The first half keeps its north
  //     shoulder, which is also the high ground, so the two halves of one
  //     straight run play differently.
  //   - The corner is a promontory pointing north-east into that bay. It is the
  //     strongest ground on the level - both legs of the route pass within reach
  //     - and the sea behind it means the strength is finite.
  //   - A bay bites into the middle of the descending run, so its east shore is
  //     two separate pieces: the promontory's flank and the base's headland.
  //   - The spawn sits on a two-hex spit, and the south is one lobe carrying the
  //     small hill as a cape, so neither end of the route is a straight board rim.
  //
  // Nothing else needs to know: a hex that is not land is not on the board, so
  // ground, cliffs, grid lines and placement rejection all follow from this.
  shape: [
    '',
    '',
    '',
    '                   ~',
    '                ~     ~',
    '             ~     ~     ~',
    '          ~     ~     ~     ~',
    '       ~     ~     ~     ~     ~     ~',
    '    ~     ~     ~     ~     ~     ~     ~',
    '       ~     ~     #     ~     ~     ~     ~',
    '    ~     ~     #     #     ~     ~     ~     ~',
    '       ~     #     ^     #     ~     ~     ~     ~',
    '    ~     ~     ^     #     ~     ~     ~     ~',
    '       ~     #     #     #     ~     #     ~     ~',
    '    ~     ~     #     #     ~     ~     ^     ~',
    '       ~     #     #     #     ~     #     ~     ~',
    '    ~     ~     #     #     ~     #     #     ~',
    '       ~     #     #     ~     #     #     ~     ~',
    '    ~     ~     ~     ~     #     #     #     ~',
    ' ~     ~     ~     #     #     ^     #     ~     ~',
    '    ~     ~     #     #     #     #     ~     ~',
    ' ~     ~     #     #     #     #     #     ~     ~',
    '    ~     #     #     #     #     #     ~     ~',
    ' ~     ~     #     #     #     #     #     ~     ~',
    '    ~     #     #     #     #     #     #     ~',
    ' ~     ~     #     #     #     #     #     ~     ~',
    '    ~     ~     #     ^     #     #     #     ~',
    ' ~     ~     ~     #     #     #     #     ~     ~',
    '    ~     ~     ~     #     #     ~     ~     ~',
    '       ~     ~     ~     ~     ~     ~     ~     ~',
    '          ~     ~     ~     ~     ~     ~     ~',
    '             ~     ~     ~     ~     ~     ~',
    '                ~     ~     ~     ~     ~',
    '                   ~     ~     ~     ~',
    '                      ~     ~',
    '',
    '',
  ],

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
  // The route sits flush with the rest of the island. It used to stand a step
  // proud, which drew a raised causeway across the whole level - and a road is a
  // statement that the level is a track to be defended. It is still the route;
  // it just is not architecture any more.
  pathLevel: 0,
  cragLevel: 3,    // height of a crag top, in elevation levels
  waterLevel: -1,  // sea level, one step below the lowest land
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

    // Lanterns, and they are placement rather than decoration: each one is a
    // warm pocket in a cold level, so where they are is where the level says
    // somebody lives. Strung along the route roughly every four hexes, which is
    // close enough that the pools nearly touch and far enough that the dark
    // between them is still dark.
    { type: 'lantern', q: -5, r:  6, spread: 0.2 },   // the spawn spit, where the road starts
    { type: 'lantern', q: -3, r:  2, spread: 0.2 },   // south shoulder of the long diagonal
    { type: 'lantern', q:  2, r: -1, spread: 0.2 },   // inside the corner, so it lights four route hexes
    { type: 'lantern', q:  2, r:  1, spread: 0.2 },   // west of the descending run
    { type: 'lantern', q:  2, r:  3, spread: 0.2 },   // beside the base
  ],

  // Scattered detail, spread from the hex hash rather than placed by hand. `chance`
  // is per tile and `per` is how many draws each tile gets, so grass comes in
  // ones and twos and leaves gaps - a tuft on every tile reads as carpet. It skips
  // the route, the crags and the hand-placed props, which is what keeps the
  // authored composition legible underneath the texture.
  scatter: [
    { type: 'grass', chance: 0.30, per: 2, spread: 0.9 },
    { type: 'bush',  chance: 0.12, spread: 0.55 },
  ],

  // A wave arrives only when the player sends it, so a wave states its shape and
  // nothing about when it happens. `enemy` may be a repeating pattern, which is
  // how a wave is given an ordering rather than just a head count. `bonus` is
  // paid once the wave has finished spawning.
  //
  // Tuned against a simulation of the real components driving the real level.
  // The economy funds about 13 guns in total, and that ceiling is what makes
  // placement matter: covering the corner wins with 28/30 lives, hugging the
  // spawn scrapes in at 1/30, and clustering at the base loses.
  waves: [
    { enemy: 'grunt',                                 count:  8, interval: 1.0,  bonus:  7 },
    { enemy: 'grunt',                                 count: 12, interval: 0.8,  bonus:  8 },
    { enemy: 'runner',                                count: 14, interval: 0.45, bonus: 10 },
    { enemy: ['grunt', 'grunt', 'runner'],            count: 18, interval: 0.6,  bonus: 11 },
    { enemy: ['brute', 'grunt', 'grunt'],             count: 12, interval: 1.2,  bonus: 14 },
    { enemy: ['runner', 'runner', 'runner', 'grunt'], count: 24, interval: 0.35, bonus: 17 },
    { enemy: ['grunt', 'grunt', 'brute'],             count: 24, interval: 0.6,  bonus: 20 },
    { enemy: ['brute', 'brute', 'grunt', 'grunt'],    count: 24, interval: 0.9 },
  ],
};

// Expands a level definition into the runtime pieces the scene needs.
export function buildLevel(def) {
  const { hexes, crags, water } = parseShape(def);
  const grid = new HexGrid({ size: def.hexSize, radius: def.radius, hexes });

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
  for (const p of def.props ?? []) {
    if (!grid.inBounds(p.q, p.r)) {
      throw new Error(`Level "${def.name}": ${p.type} prop is off the board at ${p.q},${p.r}`);
    }
  }
  // Solid rock: marked occupied so it is impassable as well as unbuildable, and
  // so the one rule lives in the grid rather than in every consumer.
  const blockedKeys = new Set(crags.map(c => `${c.q},${c.r}`));
  for (const h of path) {
    if (blockedKeys.has(`${h.q},${h.r}`)) {
      throw new Error(`Level "${def.name}": crag sits on the route at ${h.q},${h.r}`);
    }
  }
  for (const c of crags) grid.occupy(c.q, c.r);

  checkConnected(def, grid, path[0]);

  // The path is off-limits for building. Kept as keys so placement checks are a
  // set lookup rather than a scan.
  const pathKeys = new Set(path.map(h => `${h.q},${h.r}`));

  return {
    def,
    grid,
    path,
    pathKeys,
    levels: buildElevation(def, grid, path, crags),
    blocked: crags,
    blockedKeys,
    water,
    // Sea level, in the same elevation units as the land, so the coast is a real
    // step down from the lowest tile rather than a coincidence of two numbers.
    waterLevel: def.waterLevel ?? -1,
    props: def.props ?? [],
    scatter: buildScatter(def, grid, new Set([
      ...pathKeys, ...blockedKeys, ...(def.props ?? []).map(p => `${p.q},${p.r}`),
    ])),
    worldPath: path.map(h => grid.hexToWorld(h.q, h.r)),
    spawn: path[0],
    goal:  path[path.length - 1],
    waves: def.waves,
  };
}

// Expands the scatter rules into placements. Deterministic, because a board that
// reshuffles its grass on every reload is a board you cannot photograph twice -
// and because editing one hex should not move the tuft on the next one.
function buildScatter(def, grid, skip) {
  const out = [];
  (def.scatter ?? []).forEach((rule, index) => {
    const per = rule.per ?? 1;
    for (const { q, r } of grid.allHexes()) {
      if (skip.has(`${q},${r}`)) continue;
      for (let i = 0; i < per; i++) {
        if (hashHex(q, r, 200 + index * 13 + i * 3) >= rule.chance) continue;
        // `salt` is what separates several props sharing one tile - without it
        // they would draw the same size, jitter and rotation.
        out.push({ type: rule.type, q, r, salt: index * 4 + i, spread: rule.spread ?? 0.7 });
      }
    }
  });
  return out;
}

// A level's outline, drawn rather than listed: the rows are the board as
// tools/map.mjs prints it, so a silhouette can be judged and edited in the shape
// it will actually have. Columns are q in three-character cells, rows are 2r+q -
// which is how flat-top hexes stagger. Cells where (row - q) is odd have no hex
// on them and are always blank.
//
//   ' '  nothing - open ocean, drawn by the plane that runs to the horizon
//   '~'  a water tile: shown, but not board, so nothing stands or walks there
//   '#'  land
//   '^'  crag: land, standing at `cragLevel`, and solid - nothing is built there
//
// Water is drawn and not board on purpose. `inBounds` means "playable", so a sea
// tile is excluded from it and every rule that already asks - building, walking,
// the coast cliffs the ground mesh draws at the board edge - follows for free.
//
// A level with no `shape` is the full disc of `radius`: all land, no crags, no sea.
function parseShape(def) {
  if (!def.shape) return { hexes: null, crags: [], water: [] };

  const R = def.radius;
  const expected = 4 * R + 1;
  if (def.shape.length !== expected) {
    throw new Error(`Level "${def.name}": shape has ${def.shape.length} rows, expected ${expected} for radius ${R}`);
  }

  const hexes = [], crags = [], water = [];
  def.shape.forEach((line, i) => {
    const row = i - 2 * R;
    for (let j = 0; j <= 2 * R; j++) {
      const q = j - R;
      if (Math.abs(row - q) % 2 !== 0) continue;          // no hex sits here
      const r = (row - q) / 2;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
      const glyph = line.slice(j * 3, j * 3 + 3).trim();
      if (!glyph) continue;
      if (glyph === '~') { water.push({ q, r }); continue; }
      hexes.push({ q, r });
      if (glyph === '^') crags.push({ q, r });
    }
  });
  return { hexes, crags, water };
}

// An outline is easy to mis-draw into two islands, and a hex cut off from the
// route is a build position nothing can ever threaten. Cheaper to refuse it here
// than to notice it in a screenshot.
function checkConnected(def, grid, from) {
  const seen = new Set([`${from.q},${from.r}`]);
  const stack = [from];
  while (stack.length) {
    const h = stack.pop();
    for (const n of grid.neighbors(h.q, h.r)) {
      const key = `${n.q},${n.r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(n);
    }
  }

  const stranded = [];
  for (const { q, r } of grid.allHexes()) {
    if (!seen.has(`${q},${r}`)) stranded.push(`${q},${r}`);
  }
  if (stranded.length) {
    throw new Error(`Level "${def.name}": ${stranded.length} hex(es) cut off from the route: ` +
                    stranded.slice(0, 8).join(' ') + (stranded.length > 8 ? ' ...' : ''));
  }
}

// Expands the elevation spec into a per-hex integer level.
function buildElevation(def, grid, path, crags = []) {
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

  // Crags stand above whatever hill they are on, so a crag drawn on the summit
  // still reads as a crag rather than as more summit.
  const cragLevel = def.cragLevel ?? 3;
  for (const c of crags) {
    levels.set(`${c.q},${c.r}`, Math.max(cragLevel, levels.get(`${c.q},${c.r}`) ?? 0));
  }

  // Stamped last so neither a mis-authored hill nor a crag can flatten the route.
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
