import { stringifyLevel } from './level.js';

// Handing a level to the game, and getting the view back afterwards.
//
// The whole of the mechanism is: write the level where the game page can read it,
// remember where the camera was, and navigate. The game parses what it finds and
// puts it through `buildMap` exactly as it does an authored level - there is no
// runtime here, no simplified simulation, and nothing that only a playtest uses.
//
// Session storage rather than a query string: a board is kilobytes of JSON, and
// it has to survive the reload somebody presses mid-fight. Per-tab, which is also
// right - two tabs testing two levels do not fight over one key.
//
// Nothing is ever written back. The game has no save path, so the level the
// editor is holding cannot be touched by anything that happens in the fight: the
// dead come back, the fog closes, and the board is the board because the copy
// that was played was always a copy.
const LEVEL = 'hex-tower-defence#playtest';
const VIEW = 'hex-tower-defence#view';

export function play(level, view = null) {
  try {
    sessionStorage.setItem(LEVEL, stringifyLevel(level));
    if (view) sessionStorage.setItem(VIEW, JSON.stringify(view));
  } catch (e) {
    throw new Error(`could not start the playtest: ${e.message}`);
  }
  // Up one, because the editor is served out of /editor/ - the game is the page
  // above it, and every path in this project is relative so the same link works
  // from a checkout and from the /hex-tower-defence/ subpath Pages serves under.
  location.href = '../index.html?playtest=1';
}

// Where the camera was when Play was pressed, taken once and then forgotten - so
// coming back is the same view, and a later visit that did not come from a
// playtest opens wherever the editor normally would.
export function takeView() {
  try {
    const raw = sessionStorage.getItem(VIEW);
    sessionStorage.removeItem(VIEW);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
