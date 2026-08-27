import { HexGrid } from '../engine/hex/hex_grid.js';

// What a level *is*, as data, and how that data becomes the pieces the scene
// needs.
//
// The object below is not a serialisation of some other, realer level living
// somewhere else - it is the level, and the file on disk is the same object with
// newlines in it. There is deliberately no in-memory shape and on-disk shape to
// map between: two shapes is two places for a field to be forgotten, and a round
// trip that loses something is the one bug this file exists to not have. So
// `defaultLevel()` carries the format header too, `stringifyLevel` only decides
// where the newlines go, and `parseLevel` only checks and copies.
//
// This is the editor's answer to `maps.js` `parseShape`, and it is a separate
// answer for a reason. A map's outline is authored as text because a silhouette
// is judged by looking at it, and text is the shape a person can edit. An editor
// edits one tile at a time, so its level is a list of tiles - the same board, in
// the form the thing doing the editing works in.

// Stamped into every file, and checked on the way back in. The name is here so a
// stray JSON file is refused with a sentence rather than by throwing somewhere
// in the middle of building a scene; the version is here so the day the shape
// changes, a file written before it can say so.
export const LEVEL_FORMAT = 'hex-tower-defence.level';
export const LEVEL_VERSION = 2;

// A level's identity, and the reason it is not the name: a name is a label a
// person changes their mind about, and everything that has to keep pointing at
// the same level across a rename - which one is open, which one an imported file
// collides with - needs something that does not move. It is minted once and then
// travels with the level, into local storage and into the file.
export function newId() {
  return crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The terrain a tile can be. The three the ground renderer already draws
// differently, and no more: a fourth kind is a fourth thing to draw, not a
// fourth string here.
export const TERRAIN = ['land', 'crag', 'water'];

// What a tile is when nothing has been said about it. A new tile is plain
// ground at the height the board starts from, because sketching a shape and
// choosing what is on it are two different jobs and only the first one exists
// yet.
export const DEFAULT_TERRAIN = 'land';
export const DEFAULT_ELEVATION = 0;

// How far a tile may be pushed. Elevation is an integer count of steps and the
// renderer will draw any of them, so this is only here to keep a held-down
// button from putting a tile a hundred steps up where nothing can be seen -
// generous enough that no hill anybody draws will meet it.
export const ELEVATION_RANGE = [-8, 12];

// The level the editor opens on: a small patch of plain ground with the King
// standing in the middle of it. Small because the first thing anybody does with
// an editor is click a tile, and a board you have to fly across to find one is
// answering a question nobody asked yet.
export function defaultLevel(name = 'Untitled') {
  return {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id: newId(),
    name,
    hexSize: 1,
    // The envelope, not the board - `tiles` is the board. Two rings of margin,
    // so growing the patch later is a tile the editor adds rather than a number
    // here that has to be found first.
    radius: 4,
    king: { q: 0, r: 0 },
    tiles: discTiles(2).map(({ q, r }) => ({ q, r, terrain: 'land', level: 0 })),
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

// ── The file ────────────────────────────────────────────────────────────────

// The level as text. Hand-formatted rather than `JSON.stringify(l, null, 2)`,
// for the one reason that matters about a file meant to be committed: a tile is
// one line, so a diff that moved a tile is one line long instead of five, and a
// board of a few hundred tiles is still something a person can read.
export function stringifyLevel(level) {
  const tiles = level.tiles.map(t =>
    `    { "q": ${t.q}, "r": ${t.r}, "terrain": ${JSON.stringify(t.terrain)}, "level": ${t.level ?? 0} }`);
  return [
    '{',
    `  "format": ${JSON.stringify(level.format)},`,
    `  "version": ${level.version},`,
    `  "id": ${JSON.stringify(level.id)},`,
    `  "name": ${JSON.stringify(level.name)},`,
    `  "hexSize": ${level.hexSize},`,
    `  "radius": ${level.radius},`,
    `  "king": { "q": ${level.king.q}, "r": ${level.king.r} },`,
    '  "tiles": [',
    tiles.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

// What to call the file. The level's own name, reduced to something every
// filesystem will take.
export function levelFilename(level) {
  const slug = String(level.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'level'}.json`;
}

// Text back to a level, or a thrown error saying what was wrong with it.
//
// It checks every field it is about to hand to the scene, because the
// alternative is a stack trace out of the middle of building a mesh - and the
// person who sees it is holding a file they wrote by hand, so the message has to
// be about the file. It also *copies*: what comes back has exactly the fields
// this version knows about and nothing else, so an unknown key in the file
// cannot end up being carried along and written back out.
export function parseLevel(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a JSON object');

  if (raw.format !== LEVEL_FORMAT) {
    throw new Error(`not a level file (format is ${JSON.stringify(raw.format ?? null)}, ` +
                    `expected ${JSON.stringify(LEVEL_FORMAT)})`);
  }
  // Version 1 is read and brought forward. It is the same board - it only
  // predates levels having an identity of their own - and refusing a file this
  // editor wrote last week would be the version number doing harm rather than
  // work. Anything older than that does not exist, and anything newer was
  // written by an editor that knows something this one does not, so it is
  // refused rather than guessed at.
  if (raw.version !== 1 && raw.version !== LEVEL_VERSION) {
    throw new Error(`level version ${JSON.stringify(raw.version ?? null)} is not supported ` +
                    `(this editor reads version ${LEVEL_VERSION})`);
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : newId();

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : null;
  if (!name) throw new Error('"name" must be a non-empty string');
  const hexSize = raw.hexSize;
  if (typeof hexSize !== 'number' || !(hexSize > 0)) throw new Error('"hexSize" must be a positive number');
  const radius = raw.radius;
  if (!Number.isInteger(radius) || radius < 0) throw new Error('"radius" must be a whole number ≥ 0');

  if (!Array.isArray(raw.tiles) || !raw.tiles.length) throw new Error('"tiles" must be a non-empty array');
  const seen = new Set();
  const tiles = raw.tiles.map((t, i) => {
    const at = `tiles[${i}]`;
    if (!t || typeof t !== 'object') throw new Error(`${at} is not an object`);
    if (!Number.isInteger(t.q) || !Number.isInteger(t.r)) throw new Error(`${at} needs whole "q" and "r"`);
    // Off the envelope is a tile nothing will ever draw, which is worth saying
    // out loud rather than quietly dropping.
    if (Math.max(Math.abs(t.q), Math.abs(t.r), Math.abs(t.q + t.r)) > radius) {
      throw new Error(`${at} at ${t.q},${t.r} is outside radius ${radius}`);
    }
    const key = `${t.q},${t.r}`;
    if (seen.has(key)) throw new Error(`two tiles at ${key}`);
    seen.add(key);
    if (!TERRAIN.includes(t.terrain)) {
      throw new Error(`${at} has terrain ${JSON.stringify(t.terrain ?? null)} - expected one of ${TERRAIN.join(', ')}`);
    }
    const level = t.level ?? 0;
    if (!Number.isInteger(level)) throw new Error(`${at} has a non-integer "level"`);
    return { q: t.q, r: t.r, terrain: t.terrain, level };
  });

  const king = raw.king;
  if (!king || typeof king !== 'object' || !Number.isInteger(king.q) || !Number.isInteger(king.r)) {
    throw new Error('"king" needs whole "q" and "r"');
  }
  // He has to be standing on something he could stand on. Water is not ground
  // and a crag is solid rock the grid refuses to walk onto, so both are the file
  // being wrong rather than the board being interesting.
  const kingTile = tiles.find(t => t.q === king.q && t.r === king.r);
  if (!kingTile) throw new Error(`the king is at ${king.q},${king.r}, where there is no tile`);
  if (kingTile.terrain !== 'land') throw new Error(`the king is standing on ${kingTile.terrain}`);

  return {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id, name, hexSize, radius,
    king: { q: king.q, r: king.r },
    tiles,
  };
}

// ── The scene's view of it ──────────────────────────────────────────────────

// The level data expanded into what the scene reads: a grid whose bounds are the
// land, the per-hex elevation, and which tiles are solid rock.
//
// Nothing here validates - `parseLevel` did, on the way in. `buildMap` refuses a
// bad placement because a map is authored once and has to be right; an editor is
// mid-edit almost all the time, and a level object that throws while it is being
// changed is an editor that cannot be used.
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

// ── Editing ─────────────────────────────────────────────────────────────────
// Every change the editor makes to a board is one of these three. They live here
// rather than in main.js because they are what a level *is* - the same file that
// says a tile has a terrain and a height says how one is added, so the two
// cannot describe different shapes. Each one changes the level object and
// nothing else; putting the result on screen and in storage is the caller's job.

// A new tile, or null if that hex is taken. Two tiles at one coordinate is the
// one thing this model cannot represent - the grid, the ground and every lookup
// key it by q,r - so the refusal is here rather than in whatever asked.
//
// The envelope grows to hold it. `radius` is the box the board is drawn inside,
// not the board, and a level that refused to be extended past the radius it
// happened to start with would be a level with an invisible wall around it.
export function addTile(level, q, r) {
  if (tileAt(level, q, r)) return null;
  const tile = { q, r, terrain: DEFAULT_TERRAIN, level: DEFAULT_ELEVATION };
  level.tiles.push(tile);
  level.radius = Math.max(level.radius, ring(q, r));
  return tile;
}

export function removeTile(level, q, r) {
  const i = level.tiles.findIndex(t => t.q === q && t.r === r);
  if (i < 0) return false;
  level.tiles.splice(i, 1);
  // The envelope is deliberately *not* shrunk. It costs nothing to leave it
  // wide - it is a bound, not a board - and pulling it in behind a delete would
  // silently drop tiles on the far side of the level.
  return true;
}

// Up or down by whole steps, clamped, and it returns the height it ended at.
// Terrain is untouched: raising a crag leaves a crag, which is what makes this
// an elevation tool rather than a tile tool.
export function raiseTile(level, q, r, by) {
  const tile = tileAt(level, q, r);
  if (!tile) return null;
  const [lo, hi] = ELEVATION_RANGE;
  tile.level = Math.min(hi, Math.max(lo, (tile.level ?? 0) + by));
  return tile.level;
}

// How far a hex is from the middle, which is what `radius` bounds.
function ring(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}
