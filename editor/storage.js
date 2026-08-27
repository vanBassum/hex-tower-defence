import { LEVEL_FORMAT, stringifyLevel, parseLevel } from './level.js';

// Levels kept in the browser, so normal use of the editor is not a series of
// downloads.
//
// What is stored is the *file* - the exact text `stringifyLevel` writes and
// `parseLevel` reads - and not a second, more convenient encoding. Two storage
// formats is two places a field can go missing, and the round trip that has to
// hold for a `.json` on disk is then the same round trip that holds here. It
// also means a level saved locally and a level committed to git are the same
// bytes, so one can always become the other.
//
// The name is the identity: saving under a name that already exists replaces it,
// which is what a save button does everywhere else.

const PREFIX = `${LEVEL_FORMAT}:`;

// localStorage throws rather than returning null when the browser has it turned
// off, so every path in here goes through this - and the message it throws is
// one the panel can show a person, because there is nothing they can do about it
// except know.
function store() {
  try {
    const s = window.localStorage;
    s.getItem(PREFIX);      // private mode refuses on access, not on read
    return s;
  } catch {
    throw new Error('this browser is not letting the page save anything locally');
  }
}

// The names of every level saved here, alphabetically. Sorted so the list does
// not reshuffle itself between two visits - localStorage keeps insertion order,
// which is the order they happened to be saved in and means nothing to anybody.
export function listSaved() {
  const s = store();
  const names = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key?.startsWith(PREFIX)) names.push(key.slice(PREFIX.length));
  }
  return names.sort((a, b) => a.localeCompare(b));
}

// The stored text for a name, or null. The editor compares it against the
// current level to know whether there is anything unsaved, which is the one
// question a save button has to be able to answer.
export function savedText(name) {
  return store().getItem(PREFIX + name);
}

export function save(level) {
  if (!level.name?.trim()) throw new Error('a level needs a name before it can be saved');
  try {
    store().setItem(PREFIX + level.name, stringifyLevel(level));
  } catch (e) {
    // Almost always the quota, and worth saying so: the failure mode of a save
    // button that silently did nothing is losing the level.
    throw new Error(`could not save: ${e.message}`);
  }
}

// Validated on the way out, the same as a file is. What is in localStorage was
// put there by a version of this editor that may not be this one, and a person
// can edit it by hand - so it is no more trustworthy than something off disk.
export function load(name) {
  const text = savedText(name);
  if (text === null) throw new Error(`there is no level saved as "${name}"`);
  return parseLevel(text);
}

export function remove(name) {
  store().removeItem(PREFIX + name);
}
