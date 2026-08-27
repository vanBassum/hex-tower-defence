import { LEVEL_FORMAT, stringifyLevel, parseLevel, newId } from './level.js';

// Levels kept in the browser. This is not a backup of the editor's work - it is
// where the work lives. Every change writes through to here, so there is no such
// thing as an unsaved level and nothing to lose by closing the tab.
//
// What is stored is the *file* - the exact text `stringifyLevel` writes and
// `parseLevel` reads - and not a second, more convenient encoding. Two storage
// formats is two places a field can go missing, and the round trip that has to
// hold for a `.json` on disk is then the same round trip that holds here. It
// also means a level in the browser and a level committed to git are the same
// bytes, so one can always become the other.
//
// The key is the level's `id`, not its name. A name is a label somebody renames;
// identity has to survive that, and it has to survive an imported file arriving
// with a name that is already taken.

const LEVELS = `${LEVEL_FORMAT}:`;
// Which level the editor had open. One key holding one id - not an editor state
// format, because the moment there are two fields in here there is a second
// thing to keep in step with the levels themselves.
const OPEN = `${LEVEL_FORMAT}#open`;

// localStorage throws rather than returning null when the browser has it turned
// off, so every path in here goes through this - and the message it throws is
// one the panel can show a person, because there is nothing they can do about it
// except know.
function store() {
  try {
    const s = window.localStorage;
    s.getItem(OPEN);        // private mode refuses on access, not on read
    return s;
  } catch {
    throw new Error('this browser is not letting the page store anything locally');
  }
}

// Every level in the browser, in name order - localStorage hands them back in
// the order they happened to be written, which means nothing to anybody and
// reshuffles the library between two visits.
//
// Each entry is a summary rather than the level, because the library shows a
// dozen cards and needs a name and a tile count from each. A stored level that
// no longer parses still gets an entry with `error` set: it has to be visible to
// be deletable, and a card that cannot be shown is a level nobody can get rid
// of.
export function list() {
  const s = store();
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key?.startsWith(LEVELS)) continue;
    const id = key.slice(LEVELS.length);
    try {
      const level = parseLevel(s.getItem(key));
      out.push({ id, name: level.name, tiles: level.tiles.length, king: level.king, error: null });
    } catch (e) {
      out.push({ id, name: id, tiles: 0, king: null, error: e.message });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function has(id) {
  return store().getItem(LEVELS + id) !== null;
}

// Validated on the way out, the same as a file is. What is in localStorage was
// put there by a version of this editor that may not be this one, and a person
// can edit it by hand - so it is no more trustworthy than something off disk.
export function load(id) {
  const text = store().getItem(LEVELS + id);
  if (text === null) throw new Error('that level is not in this browser any more');
  return parseLevel(text);
}

// The write every edit ends in. It takes the level it is given and does not
// check it: what is on screen is what gets stored, because an editor that
// refuses to remember a board mid-edit is an editor that loses work.
export function save(level) {
  try {
    store().setItem(LEVELS + level.id, stringifyLevel(level));
  } catch (e) {
    // Almost always the quota, and worth saying so: the failure mode of a save
    // that silently did nothing is losing the level.
    throw new Error(`could not store the level: ${e.message}`);
  }
}

export function remove(id) {
  store().removeItem(LEVELS + id);
}

// A copy under a new identity. Same board, new id, and the caller picks the
// name - which is the whole difference between duplicating a level and saving
// over it.
export function duplicate(level, name) {
  const copy = { ...level, id: newId(), name };
  save(copy);
  return copy;
}

// Which level was open, so reopening `/editor` is continuing rather than
// starting. It is only ever a hint: the level it names may have been deleted in
// another tab, and the caller checks.
export function openId() {
  try { return store().getItem(OPEN); } catch { return null; }
}

export function setOpenId(id) {
  try { store().setItem(OPEN, id); } catch { /* nothing to do about it */ }
}

// A name nothing else in the library is using. Not because names have to be
// unique - the id is the identity now - but because two cards reading "Untitled"
// is a library that cannot be used, and this is where "Untitled 2" comes from.
export function uniqueName(base, taken = list().map(l => l.name)) {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const tryName = `${base} ${n}`;
    if (!taken.includes(tryName)) return tryName;
  }
}
