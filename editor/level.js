import { HexGrid } from '../engine/hex/hex_grid.js';
import { UNIT_TYPES } from '../game/units.js';
import { PROP_TYPES } from '../game/props.js';
import { CARD_TYPES, HAND_LIMIT } from '../game/cards.js';

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
export const LEVEL_VERSION = 5;

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
    // How many cards a run on this level may open with. A level setting, because
    // it is the size of the problem the board is posing.
    deckLimit: HAND_LIMIT,
    // And the army it is being tested against, which is testing metadata rather
    // than a rule: the game is handed it, the player's real hand is their own
    // choice. `null` means nobody has chosen yet, which is different from an
    // empty deck somebody chose on purpose - Play refuses the first and allows
    // the second.
    deck: null,
    king: { q: 0, r: 0 },
    units: [],
    props: [],
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
  const units = (level.units ?? []).map(u =>
    `    { "type": ${JSON.stringify(u.type)}, "q": ${u.q}, "r": ${u.r} }`);
  // A prop is its type, its hex, and the two numbers that make one instance of it
  // itself: `salt` picks its size, its rotation and where in the tile it stands,
  // and `spread` says how far off centre it may be. So the file *is* the seed -
  // a level reloads the same forest down to which way each tree is facing, and
  // nothing has to store four hundred positions to manage it.
  const props = (level.props ?? []).map(o => '    ' + JSON.stringify(o));
  return [
    '{',
    `  "format": ${JSON.stringify(level.format)},`,
    `  "version": ${level.version},`,
    `  "id": ${JSON.stringify(level.id)},`,
    `  "name": ${JSON.stringify(level.name)},`,
    `  "hexSize": ${level.hexSize},`,
    `  "radius": ${level.radius},`,
    `  "deckLimit": ${level.deckLimit ?? HAND_LIMIT},`,
    `  "deck": ${level.deck ? JSON.stringify(level.deck) : 'null'},`,
    `  "king": { "q": ${level.king.q}, "r": ${level.king.r} },`,
    ...block('units', units, ','),
    ...block('props', props, ','),
    ...block('tiles', tiles, ''),
    '}',
    '',
  ].join('\n');
}

// One array, one entry per line, and collapsed to `[]` when it is empty - an
// empty array written open-and-closed over three lines is two lines of nothing in
// every file that has no units in it yet.
function block(name, entries, comma) {
  if (!entries.length) return [`  "${name}": []${comma}`];
  return [`  "${name}": [`, entries.join(',\n'), `  ]${comma}`];
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
  // Earlier versions are read and brought forward. They are the same board - one
  // predates levels having an identity of their own, the next predates anybody
  // standing on them - and refusing a file this editor wrote last week would be
  // the version number doing harm rather than work. Anything newer was written by
  // an editor that knows something this one does not, so that is refused rather
  // than guessed at.
  if (![1, 2, 3, 4, LEVEL_VERSION].includes(raw.version)) {
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

  const deckLimit = raw.deckLimit ?? HAND_LIMIT;
  if (!Number.isInteger(deckLimit) || deckLimit < 0 || deckLimit > 12) {
    throw new Error('"deckLimit" must be a whole number between 0 and 12');
  }
  let deck = null;
  if (raw.deck !== undefined && raw.deck !== null) {
    if (!Array.isArray(raw.deck)) throw new Error('"deck" must be an array or null');
    for (const key of raw.deck) {
      if (!CARD_TYPES[key] || key === 'king') {
        throw new Error(`the deck holds ${JSON.stringify(key)}, which is not a card that can be dealt`);
      }
    }
    if (raw.deck.length > deckLimit) {
      throw new Error(`the deck holds ${raw.deck.length} cards and the limit is ${deckLimit}`);
    }
    deck = [...raw.deck];
  }

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

  // Who is standing on it. `hostile` on the type is what makes one an enemy - see
  // the invariant in CLAUDE.md - so there is no side field here to disagree with
  // it, and the King is not in this list: he is one hex on his own further down,
  // which is how "exactly one player start" is a fact about the shape of the file
  // rather than a rule something has to enforce.
  const units = [];
  if (raw.units !== undefined && !Array.isArray(raw.units)) throw new Error('"units" must be an array');
  const standing = new Set();
  for (const [i, u] of (raw.units ?? []).entries()) {
    const at = `units[${i}]`;
    if (!u || typeof u !== 'object') throw new Error(`${at} is not an object`);
    if (!UNIT_TYPES[u.type]) {
      throw new Error(`${at} is a ${JSON.stringify(u.type ?? null)}, which is not a unit type`);
    }
    if (!Number.isInteger(u.q) || !Number.isInteger(u.r)) throw new Error(`${at} needs whole "q" and "r"`);
    const tile = tiles.find(t => t.q === u.q && t.r === u.r);
    if (!tile) throw new Error(`${at} is at ${u.q},${u.r}, where there is no tile`);
    if (tile.terrain !== 'land') throw new Error(`${at} is standing on ${tile.terrain}`);
    const key = `${u.q},${u.r}`;
    // A unit holds its hex in the grid's occupancy set, so two on one tile is a
    // board the game cannot build.
    if (standing.has(key)) throw new Error(`two units at ${key}`);
    standing.add(key);
    units.push({ type: u.type, q: u.q, r: u.r });
  }

  // What is standing about on it. Validated the same way everything else is,
  // because a file off disk is the one input nothing in this editor wrote - and
  // an unknown prop type is a crash inside `buildProp` if it gets that far.
  const props = [];
  if (raw.props !== undefined && !Array.isArray(raw.props)) throw new Error('"props" must be an array');
  for (const [i, o] of (raw.props ?? []).entries()) {
    const at = `props[${i}]`;
    if (!o || typeof o !== 'object') throw new Error(`${at} is not an object`);
    if (!PROP_TYPES[o.type]) {
      throw new Error(`${at} is a ${JSON.stringify(o.type ?? null)}, which is not a prop type`);
    }
    if (!Number.isInteger(o.q) || !Number.isInteger(o.r)) throw new Error(`${at} needs whole "q" and "r"`);
    const tile = tiles.find(t => t.q === o.q && t.r === o.r);
    if (!tile) throw new Error(`${at} is at ${o.q},${o.r}, where there is no tile`);
    if (tile.terrain === 'water') throw new Error(`${at} is standing in the water`);
    const prop = { type: o.type, q: o.q, r: o.r, salt: o.salt ?? 0, spread: o.spread ?? 0.35 };
    if (!Number.isInteger(prop.salt)) throw new Error(`${at} has a non-integer "salt"`);
    if (typeof prop.spread !== 'number' || !(prop.spread >= 0)) throw new Error(`${at} has a bad "spread"`);
    if (o.light !== undefined) {
      if (!o.light || typeof o.light !== 'object') throw new Error(`${at} has a bad "light"`);
      const light = {};
      for (const key of ['intensity', 'distance']) {
        if (o.light[key] === undefined) continue;
        if (typeof o.light[key] !== 'number' || !(o.light[key] >= 0)) {
          throw new Error(`${at} light "${key}" must be a number`);
        }
        light[key] = o.light[key];
      }
      if (Object.keys(light).length) prop.light = light;
    }
    props.push(prop);
  }

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
  if (standing.has(`${king.q},${king.r}`)) throw new Error('a unit is standing on the king');

  return {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id, name, hexSize, radius, deckLimit, deck,
    king: { q: king.q, r: king.r },
    units, props, tiles,
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
  // Nothing is left standing in mid-air. Erase takes what is on a hex first and
  // the ground on the next pass, which is also the order that reads correctly:
  // you clear a tile before you remove it.
  if (entityAt(level, q, r) || propsAt(level, q, r).length) return false;
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

// ── The deck it is tested against ───────────────────────────────────────────
// A list of card keys rather than a table of counts, because two Footmen cards
// are two bodies of Footmen - see the note at the top of cards.js. Duplicates are
// the point.

export function deckLimit(level) {
  return level.deckLimit ?? HAND_LIMIT;
}

// Adds one, up to the limit. Returns whether it fit - a deck that is full has to
// say so rather than quietly staying the same size.
export function addCard(level, key) {
  level.deck ??= [];
  if (level.deck.length >= deckLimit(level)) return false;
  level.deck.push(key);
  return true;
}

// Removes one of that kind - the last, so clicking a chip takes the chip you
// clicked rather than reshuffling the row.
export function removeCard(level, key) {
  const i = (level.deck ?? []).lastIndexOf(key);
  if (i < 0) return false;
  level.deck.splice(i, 1);
  return true;
}

// The limit, and the deck trimmed to fit it. Lowering the limit under a deck that
// is already bigger has to do something, and dropping the newest cards is the one
// answer nobody has to think about.
export function setDeckLimit(level, limit) {
  level.deckLimit = Math.max(0, Math.min(12, limit));
  if (level.deck && level.deck.length > level.deckLimit) {
    level.deck.length = level.deckLimit;
  }
  return level.deckLimit;
}

// ── What stands on it ───────────────────────────────────────────────────────
// The same arrangement as the tile mutators above: they change the level and
// report whether anything moved, and the caller draws and stores the result.
//
// `entityAt` is the one to extend. Everything that can occupy a hex answers
// through it - today the King and a unit, tomorrow a pickup, an objective, a
// building - so the rules that matter ("is this hex free", "what does erase
// take") are written once against whatever it returns rather than once per kind.
export function entityAt(level, q, r) {
  if (level.king.q === q && level.king.r === r) return { kind: 'king' };
  const unit = (level.units ?? []).find(u => u.q === q && u.r === r);
  if (unit) return { kind: 'unit', unit };
  return null;
}

// Ground somebody could be standing on. A crag is solid rock the grid refuses to
// walk onto and water is not ground at all, so plain land is the whole of it.
export function isStandable(level, q, r) {
  return tileAt(level, q, r)?.terrain === 'land';
}

// Why this hex will not take that entity, or null if it will. It is a sentence
// rather than a boolean because the answer is shown to a person - a placement
// that fails silently is a tool that looks broken.
export function whyNot(level, kind, q, r) {
  if (!isStandable(level, q, r)) {
    const tile = tileAt(level, q, r);
    return tile ? `cannot stand on ${tile.terrain}` : 'no ground there';
  }
  const here = entityAt(level, q, r);
  if (!here) return null;
  // Moving the King onto himself is not an error, it is a no-op; and a unit may
  // not share a hex with anything, the King included.
  if (kind === 'king') return here.kind === 'king' ? null : 'a unit is standing there';
  return here.kind === 'king' ? 'the King is standing there' : 'a unit is standing there';
}

// The player start, moved rather than added. There is one `king` field, so there
// is one King - the singleton is the shape of the data and not a rule anybody has
// to remember.
export function moveKing(level, q, r) {
  if (level.king.q === q && level.king.r === r) return false;
  level.king = { q, r };
  return true;
}

export function placeUnit(level, type, q, r) {
  level.units ??= [];
  level.units.push({ type, q, r });
  return true;
}

// Takes whatever is standing here, and refuses the King: a level without a player
// start is a level the game cannot open, and the Place tool moves him anyway.
export function removeEntityAt(level, q, r) {
  const here = entityAt(level, q, r);
  if (!here || here.kind === 'king') return false;
  level.units.splice(level.units.indexOf(here.unit), 1);
  return true;
}

// ── What is standing about on it ────────────────────────────────────────────
// Props are the one layer where a hex holds *several* things, which is the whole
// reason they are keyed by nothing: a tile has a list, and what separates two
// trees on one tile is their `salt`. Everything else about them - which way they
// face, how big they are, where in the tile they stand - falls out of that number
// in `buildProp`, so the level stores a seed rather than a transform.

export function propsAt(level, q, r) {
  return (level.props ?? []).filter(o => o.q === q && o.r === r);
}

// A new one, on a hex that already has any number of them. The salt is one past
// the highest already there rather than the count, so deleting one and adding
// another does not put the new one exactly where the old one stood.
export function addProp(level, type, q, r, { spread = 0.35, light = null } = {}) {
  level.props ??= [];
  const salt = propsAt(level, q, r).reduce((m, o) => Math.max(m, o.salt ?? 0), -1) + 1;
  const prop = { type, q, r, salt, spread };
  if (light) prop.light = { ...light };
  level.props.push(prop);
  return prop;
}

// Everything on a hex, in one go. Erase takes a hex rather than an object,
// because at this size picking one tree out of a clump is a gizmo and this is a
// brush.
export function removePropsAt(level, q, r) {
  const before = (level.props ?? []).length;
  level.props = (level.props ?? []).filter(o => !(o.q === q && o.r === r));
  return before - level.props.length;
}

// Re-tunes the lights already on a hex instead of adding another lamp to it.
// Placing a light where one stands is somebody adjusting that light, which is
// the only bit of "edit the thing that is already there" this pass needs.
export function tuneLights(level, q, r, light) {
  let changed = 0;
  for (const o of propsAt(level, q, r)) {
    if (!PROP_TYPES[o.type]?.flicker) continue;      // not something that carries a light
    const next = { ...o.light, ...light };
    if (JSON.stringify(next) === JSON.stringify(o.light)) continue;
    o.light = next;
    changed++;
  }
  return changed;
}

// How far a hex is from the middle, which is what `radius` bounds.
function ring(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}
