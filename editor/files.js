import { stringifyLevel, levelFilename } from './level.js';

// Getting a level out of the page and back into it. Two functions, because
// there is no server and there is not going to be one: a level leaves as a
// download and arrives as a file the person chose, and both of those are four
// lines of DOM that would otherwise be sitting in the middle of the editor's
// wiring.

// Hands the level to the browser as a file. The anchor is made, clicked and
// thrown away in one go - there is nothing to leave on the page, and the object
// URL is released straight after or the blob is held for the life of the tab.
export function downloadLevel(level) {
  const url = URL.createObjectURL(new Blob([stringifyLevel(level)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = levelFilename(level);
  a.click();
  URL.revokeObjectURL(url);
  return a.download;
}

// The other direction, as text. The parse and the validation are the level
// module's job; this only gets the bytes.
export function readFile(file) {
  return file.text();
}
