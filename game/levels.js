import { parseLevel } from '../editor/level.js';
import { MAP_1, buildMap } from './maps.js';

// The levels that ship with the game - system levels - as opposed to the ones
// somebody has made in this browser.
//
// They are files in `levels/`, in exactly the format the editor exports - so a
// level becomes part of the game by being exported, dropped in that folder and
// named below, and there is no second authoring path and no second format. What
// separates a shipped level from a stored one is *where it lives*, and nothing
// else: both pages read them through `parseLevel`, which is the one thing that
// decides what a level is.
//
// The index is a list here rather than a directory listing because there is no
// server to ask - the game is static files - and rather than a manifest JSON
// because that would be a second fetch to find out what to fetch. Adding a level
// is a file and a line.
//
// ── Why this imports from `editor/` ────────────────────────────────────────
// `editor/level.js` is the level *format*, and it is only in that folder because
// that is where it was first needed. Both pages read the format; a copy of the
// parser living in `game/` would be the one thing this project has gone out of
// its way not to have. This module is where that import happens, so it happens
// once.
// In the order they are meant to be met. The first is the one that teaches the
// loop without a word of it; the rest are one idea apiece.
//
// `blurb` is here rather than in the level file because it is a fact about where
// a board sits in a list of boards, not about the board - a level that is nobody's
// second level has nothing to say about being one. The file keeps the name, which
// is the level's own.
export const SYSTEM_LEVELS = [
  { id: 'landing',  file: 'landing.json',
    blurb: 'A beach, a gate in the rock, and every soldier you get is one you find.' },
  { id: 'causeway', file: 'causeway.json',
    blurb: 'Four islands, three doors. Nothing here can be gone around.' },
  { id: 'skirmish', file: 'skirmish.json',
    blurb: 'A ridge with two ways through it, and three pickets who know.' },
];

export const SYSTEM_LEVEL_BY_ID = Object.fromEntries(SYSTEM_LEVELS.map(l => [l.id, l]));

// Resolved against this module rather than against the page, so the same call
// works from `/index.html` and from `/editor/index.html` without either of them
// knowing where the folder is.
const url = (file) => new URL(`../levels/${file}`, import.meta.url).href;

const cache = new Map();

// One shipped level, parsed and checked. Cached because the library asks for all
// of them every time it opens, and a level that has been read once cannot have
// changed underneath a running page.
export async function loadSystemLevel(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = SYSTEM_LEVEL_BY_ID[id];
  if (!entry) throw new Error(`there is no system level called "${id}"`);

  const res = await fetch(url(entry.file));
  if (!res.ok) throw new Error(`could not read levels/${entry.file} (${res.status})`);
  const level = parseLevel(await res.text());
  cache.set(id, level);
  return level;
}

// All of them, and one that will not load does not stop the rest: a library that
// shows nothing because one file was renamed is worse than a library with a
// broken card in it. The shape matches `storage.list()` on purpose - id, level,
// error - plus a `system` flag, so one card renders either kind and the library
// can tell which it is looking at.
// ── The island ──────────────────────────────────────────────────────────────
// The hand-authored board the exploration milestone was built on, kept in the
// menu because it is still the biggest and best-looking thing here. It is the
// other dialect `buildMap` reads - an outline drawn as text, with hills as
// regions - so it has no `tiles` to draw a card from, and `preview` below makes
// some out of the map it builds into. That is the only thing in this file that
// knows there are two dialects, and it is four lines.
export const ISLAND = {
  id: 'island',
  name: 'The Island',
  blurb: 'The whole coast, a lantern chain, and nobody to tell you where to go.',
};

// A built map, as the plan-view card wants it: tiles with a terrain and a height,
// and whoever is standing on them.
function preview(map) {
  const at = (q, r) => `${q},${r}`;
  const tiles = [...map.grid.allHexes()].map(({ q, r }) => ({
    q, r,
    terrain: map.blockedKeys.has(at(q, r)) ? 'crag' : 'land',
    level: map.levels?.get(at(q, r)) ?? 0,
  }));
  for (const w of map.water) tiles.push({ q: w.q, r: w.r, terrain: 'water', level: 0 });
  return { tiles, king: map.king, units: map.units };
}

// Everything the menu can start, in the order it offers them: the system levels
// and then the island.
//
// Each entry carries a `load` rather than a level, because the two kinds are
// loaded differently and nothing downstream should have to care which it has -
// the menu shows a name, a picture and a line, and calling `load()` is the whole
// of starting one.
//
// ── Where progression will go ──────────────────────────────────────────────
// `locked` is false on everything and read by the menu already. When there is a
// reason for a board to be shut - a run finished, a level beaten - it is this
// field being computed from whatever records that, and the menu needs no change:
// a locked card draws itself and refuses the click. Nothing else in the game
// should learn what a lock is.
export async function catalogue() {
  const system = await loadSystemLevels();
  const out = system.map(({ id, level, error }) => ({
    id,
    name: level?.name ?? id,
    blurb: SYSTEM_LEVEL_BY_ID[id]?.blurb ?? '',
    preview: level,
    error,
    locked: false,
    load: async () => buildMap(await loadSystemLevel(id)),
  }));
  const island = buildMap(MAP_1);
  out.push({
    ...ISLAND,
    preview: preview(island),
    error: null,
    locked: false,
    load: async () => island,
  });
  return out;
}

export async function loadSystemLevels() {
  return Promise.all(SYSTEM_LEVELS.map(async ({ id }) => {
    try {
      return { id, level: await loadSystemLevel(id), error: null, system: true };
    } catch (e) {
      return { id, level: null, error: e.message, system: true };
    }
  }));
}
