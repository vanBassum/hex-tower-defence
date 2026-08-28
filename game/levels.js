import { parseLevel } from '../editor/level.js';

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
export const SYSTEM_LEVELS = [
  { id: 'landing',  file: 'landing.json' },
  { id: 'causeway', file: 'causeway.json' },
  { id: 'skirmish', file: 'skirmish.json' },
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
export async function loadSystemLevels() {
  return Promise.all(SYSTEM_LEVELS.map(async ({ id }) => {
    try {
      return { id, level: await loadSystemLevel(id), error: null, system: true };
    } catch (e) {
      return { id, level: null, error: e.message, system: true };
    }
  }));
}
