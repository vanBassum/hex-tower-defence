import { HexGrid } from '../engine/hex/hex_grid.js';
import { hashHex } from '../engine/hex/hex_noise.js';

// A map is terrain, and the few places on it that hold something. There is still
// no route through it and nothing scheduled to arrive: where anything goes and
// when is the tactical layer's business, and a map with opinions about that is a
// level rather than a place.
//
// A pickup is the one exception, and it is an exception on purpose. Where a
// reward sits is a statement about the *place* - this corner is worth the walk,
// that one is worth the risk - in exactly the way a spawn timer is not. It is
// the same kind of authoring as where the lanterns go.
//
// There is deliberately no deployment zone here any more. Where the player may
// bring units in is a fact about where their Scout is standing, not about the
// map - see game/components/deployment.js - so a level has no say in it.
export const MAP_1 = {
  name: 'First Island',
  hexSize: 1,
  // The envelope the board is drawn inside: the island reaches radius 6 and the
  // sea it sits in takes the three rings beyond it.
  radius: 9,
  // The island, drawn rather than listed - see parseShape below for the layout.
  // `radius` is now only the envelope this is drawn inside.
  //
  // The coastline is where the map says what it is. Every cut narrows the ground
  // somewhere, and narrow ground is where a tactical decision lives - it is the
  // difference between advancing on a front and advancing in single file:
  //
  //   - The bay in the north-east cuts the middle of the island down to a
  //     causeway. Anything crossing it can be met from one side only.
  //   - The corner beyond it is a promontory pointing into that bay: the
  //     strongest ground here, and finite, because the sea is behind it.
  //   - A second bay bites into the east shore, splitting it into the
  //     promontory's flank and the headland south of it.
  //   - The north-west is a two-hex spit and the south is a single lobe carrying
  //     the small hill as a cape, so no edge of the island is a straight board
  //     rim.
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

  // Integer elevation levels; world height is level * step. Entries apply in
  // order, so author low-to-high and let the later one win.
  cragLevel: 3,    // height of a crag top, in elevation levels
  waterLevel: -1,  // sea level, one step below the lowest land
  elevation: [
    { level: 1, center: { q: -3, r: -1 }, radius: 2 },
    { level: 2, center: { q: -3, r: -1 }, radius: 1 },
    { level: 1, center: { q: -1, r:  5 }, radius: 1 },
  ],

  // Hand-placed props to establish scale. Three sit on the hills so the elevation
  // reads, three sit on flat open ground so a tree and a rock have something
  // known to be measured against.
  props: [
    { type: 'tree', q: -3, r: -1 },   // hill summit, level 2
    { type: 'tree', q: -4, r:  0 },   // hill, level 2
    { type: 'rock', q: -3, r: -3 },   // hill edge, level 1
    { type: 'tree', q: -1, r:  5 },   // small hill, level 1
    { type: 'rock', q:  0, r:  3 },   // flat, east side
    { type: 'rock', q: -5, r:  2 },   // flat, west side

    // Lanterns are placement rather than decoration: each one is a warm pocket in
    // a cold world, so where they are is where the map says somebody lives. They
    // run from the north-west spit across the causeway to the southern headland,
    // close enough together that the pools nearly touch and far enough apart that
    // the dark between them is still dark. What they string together is a route
    // in the only sense this map still has one.
    { type: 'lantern', q: -5, r:  6, spread: 0.2 },   // the north-west spit
    { type: 'lantern', q: -3, r:  2, spread: 0.2 },   // south shoulder of the middle
    { type: 'lantern', q:  2, r: -1, spread: 0.2 },   // the promontory, inside the corner
    { type: 'lantern', q:  2, r:  1, spread: 0.2 },   // the east flank
    { type: 'lantern', q:  2, r:  3, spread: 0.2 },   // the southern headland
  ],

  // Who is out there. Two bodies of Spearmen holding the neck of the island,
  // north of the cache and south of everything the causeway leads to - which is
  // the encounter the concept doc asks the first map to open with. One body of
  // Footmen beats one of these and loses to both, so the first time the player
  // comes up here they lose, and the second time they come up here with more.
  //
  // Where they stand took two corrections, and the second one is the interesting
  // one. They were on the north-east crossing, which *looks* like the neck of the
  // island and is not: pull those two hexes out of the board and nothing at all
  // becomes unreachable, because the coast road through 1,1 and 2,0 goes round
  // them. A picket that blocks nothing is scenery, and it was only reading as an
  // encounter because it used to come and find you.
  //
  // The real cut is on the west shoulder. These two hexes are the whole of the
  // way onto the northern hill - take them out and sixteen hexes go with them,
  // a fifth of the island - and they stand on rising ground looking down the
  // approach, which is what the elevation was drawn for.
  //
  // Three hexes from where the King starts, which is close, and that stopped
  // being a problem when they stopped chasing. It is the first map: walk north,
  // see with your own Scout that the way is held, and go and find something that
  // gets you through it. The cache is the other direction.
  enemies: [
    { type: 'spearmen', q: -3, r: 1 },
    { type: 'spearmen', q: -3, r: 0 },
  ],

  // What is out there to be found. One cache, and where it sits is the whole of
  // the first map's teaching: three hexes east of where the Scout starts, on the
  // small hill by the southern tree, which is a landmark from the moment it is
  // discovered and is on the way to the causeway the map narrows into. The
  // concept doc asks for a first pickup that is "extremely difficult to miss" -
  // this board has no arrows and no signposting to do that with, so it does it
  // with the two things it does have: raised ground, and a light in the dark.
  //
  // Close enough to be found in the first minute; far enough that a step has to
  // be taken to see it at all, because a reward already visible from the start
  // hex is a reward the player was given rather than one they found.
  pickups: [
    { type: 'cache', q: 0, r: 4 },
  ],

  // Scattered detail, spread from the hex hash rather than placed by hand. `chance`
  // is per tile and `per` is how many draws each tile gets, so grass comes in
  // ones and twos and leaves gaps - a tuft on every tile reads as carpet. It skips
  // the crags and the hand-placed props, which is what keeps the authored
  // composition legible underneath the texture.
  scatter: [
    { type: 'grass', chance: 0.30, per: 2, spread: 0.9 },
    { type: 'bush',  chance: 0.12, spread: 0.55 },
  ],

};

// Expands a map definition into the runtime pieces the scene needs.
export function buildMap(def) {
  const { hexes, crags, water } = parseShape(def);
  const grid = new HexGrid({ size: def.hexSize, radius: def.radius, hexes });

  for (const p of def.props ?? []) {
    if (!grid.inBounds(p.q, p.r)) {
      throw new Error(`Map "${def.name}": ${p.type} prop is off the board at ${p.q},${p.r}`);
    }
  }
  // Solid rock: marked occupied so it is impassable, and so the one rule lives in
  // the grid rather than in every consumer that has to ask.
  const blockedKeys = new Set(crags.map(c => `${c.q},${c.r}`));
  for (const c of crags) grid.occupy(c.q, c.r);

  // A pickup has to be *reachable*, which is a stronger claim than a prop makes
  // and worth checking: it is on the land, and it is not standing on a crag. A
  // reward that cannot be walked onto is a reward that is never collected, and
  // finding that out by ordering a move at it is finding it out late.
  for (const p of def.pickups ?? []) {
    if (!grid.inBounds(p.q, p.r) || blockedKeys.has(`${p.q},${p.r}`)) {
      throw new Error(`Map "${def.name}": ${p.type} pickup cannot be reached at ${p.q},${p.r}`);
    }
  }

  // Anything the level stands on the board has to be somewhere a unit can be.
  for (const e of def.enemies ?? []) {
    if (!grid.inBounds(e.q, e.r) || blockedKeys.has(`${e.q},${e.r}`)) {
      throw new Error(`Map "${def.name}": ${e.type} cannot stand at ${e.q},${e.r}`);
    }
  }

  checkConnected(def, grid, hexes?.[0] ?? { q: 0, r: 0 });

  return {
    def,
    grid,
    levels: buildElevation(def, grid, crags),
    blocked: crags,
    blockedKeys,
    water,
    // Sea level, in the same elevation units as the land, so the coast is a real
    // step down from the lowest tile rather than a coincidence of two numbers.
    waterLevel: def.waterLevel ?? -1,
    props: def.props ?? [],
    pickups: def.pickups ?? [],
    enemies: def.enemies ?? [],
    scatter: buildScatter(def, grid, new Set([
      ...blockedKeys,
      ...(def.props ?? []).map(p => `${p.q},${p.r}`),
      // Nothing grows through the colours either: a pickup is the one thing on
      // the board the player is meant to pick out of the dark, and a tuft of
      // grass drawn over its foot is the composition arguing with itself.
      ...(def.pickups ?? []).map(p => `${p.q},${p.r}`),
      ...(def.enemies ?? []).map(e => `${e.q},${e.r}`),
    ])),
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
// A map with no `shape` is the full disc of `radius`: all land, no crags, no sea.
function parseShape(def) {
  if (!def.shape) return { hexes: null, crags: [], water: [] };

  const R = def.radius;
  const expected = 4 * R + 1;
  if (def.shape.length !== expected) {
    throw new Error(`Map "${def.name}": shape has ${def.shape.length} rows, expected ${expected} for radius ${R}`);
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

// An outline is easy to mis-draw into two islands, and a hex nothing can walk to
// is a hex that may as well not be there. Cheaper to refuse it here than to
// notice it in a screenshot.
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
    throw new Error(`Map "${def.name}": ${stranded.length} hex(es) cut off from the rest: ` +
                    stranded.slice(0, 8).join(' ') + (stranded.length > 8 ? ' ...' : ''));
  }
}

// Expands the elevation spec into a per-hex integer level.
function buildElevation(def, grid, crags = []) {
  const levels = new Map();
  for (const { q, r } of grid.allHexes()) levels.set(`${q},${r}`, 0);

  for (const region of def.elevation ?? []) {
    for (const h of elevationHexes(region, grid)) {
      if (!grid.inBounds(h.q, h.r)) {
        throw new Error(`Map "${def.name}": elevation region leaves the board at ${h.q},${h.r}`);
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
