import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexOverlay } from '../engine/components/hex_overlay.js';
import { HexPicker } from '../engine/components/hex_picker.js';
import { MOOD } from '../game/mood.js';
import { Unit } from '../game/components/unit.js';
import { defaultLevel, buildLevel, parseLevel, stringifyLevel, newId, tileAt } from './level.js';
import { downloadLevel, readFile } from './files.js';
import * as storage from './storage.js';
import { EditorPanel } from './ui/panel.js';
import { LevelLibrary } from './ui/levels.js';

// The level editor: the game's world with the game taken out of it.
//
// This is a second composition root, not a second renderer. Every component in
// the scene below is the one the game uses - same grid, same ground, same
// camera, same picker - and what makes this the editor is only which of them are
// wired up and what a click is taken to mean. So a change to how the island
// looks lands here for free, and there is no version of the board that is only
// true in the editor.
//
// What is deliberately absent is as much of the point as what is here: no fog,
// no visibility map, no cards, no enemies, no pickups, no props, no sea. An
// editor is a view of the level data, and every system that hides part of the
// board or moves something without being asked is a system standing between the
// author and the thing they are editing.
//
// ── The level is the only state ──────────────────────────────────────────────
// `level` is a plain JSON object (see level.js) and it is the whole of what is
// being edited. Everything else in this file is *derived* from it: the grid, the
// ground mesh, the King standing on a tile. So the scene is not something that
// drifts from the file and has to be reconciled with it - it is thrown away and
// built again whenever the level changes, which is what makes import a two-line
// operation and export honest.
//
// That is why the board lives in `buildBoard`/`clearBoard` rather than at the
// top level of the module: an editor whose scene was built once could load a
// file, and could not show it.
//
// ── And the level is stored, not saved ───────────────────────────────────────
// Local storage is where the level lives, not a backup of it. Every change ends
// in `commit()`, which writes it through immediately, so there is no unsaved
// work, nothing to lose by closing the tab, and no Save button - the editor
// opens again on whatever was on screen last time. Files are for the other
// things: a backup, another machine, a level committed to git.

const ELEVATION_STEP = 0.22;   // world height of one elevation level, as in the game

const game = new Game();

// ── The parts that are not the level ─────────────────────────────────────────
// The hour and the camera outlive any level: loading a file should not move the
// camera or change the light, because the person doing it is looking at
// something and expects to still be looking at it afterwards.

// Close in, because the default level is five hexes across and a wide shot of it
// is a wide shot of empty sky. The wheel is there for anybody who disagrees.
const cameraGO = new GameObject('Camera');
const rig = cameraGO.addComponent(new CameraRig({ dist: 12 }));
game.add(cameraGO);

// The same hour as the game, out of the same palette. An editor lit differently
// from the game is an editor that lies about what you are making.
const air = new GameObject('Atmosphere');
air.addComponent(new Atmosphere({
  sky: MOOD.sky,
  fog: MOOD.fog,
  hemisphere: MOOD.hemisphere,
  ambient: MOOD.ambient,
  environmentIntensity: MOOD.environmentIntensity,
  exposure: MOOD.exposure,
}));
game.add(air);

const sun = new GameObject('Sun');
sun.position.set(...MOOD.sun.position);
sun.addComponent(new DirectionalLight({
  color: MOOD.sun.color,
  intensity: MOOD.sun.intensity,
  shadowExtent: MOOD.sun.shadowExtent,
}));
game.add(sun);

// ── The board ────────────────────────────────────────────────────────────────

let level = null;            // set by the boot block at the bottom of this file
let world = null;            // grid, elevation and crags, derived from `level`
let board = [];              // the GameObjects that belong to this level
let hexGround = null;
let selectionOverlay = null;
let selected = null;         // {q, r} or null - the whole of the editor's state

function buildBoard() {
  world = buildLevel(level);
  game.hexGrid = world.grid;

  const groundGO = new GameObject('HexGround');
  hexGround = groundGO.addComponent(new HexGround(world.grid, {
    rockKeys: world.blockedKeys,
    levels: world.levels,
    step: ELEVATION_STEP,
    ...MOOD.ground,
  }));

  const gridGO = new GameObject('HexGrid');
  gridGO.addComponent(new HexGridRenderer(world.grid, { color: MOOD.gridColor, opacity: 0.14 }));

  // The King, and the one thing on the board that is not terrain. He is placed
  // from `level.king` like everything else here is placed from the level - the
  // editor has no opinion about where he goes, the file does.
  const kingGO = new GameObject('King');
  kingGO.addComponent(new Unit({
    grid: world.grid,
    ground: hexGround,
    type: 'king',
    q: level.king.q, r: level.king.r,
    colors: MOOD.units,
    // The King's torch, and the reason a lamp is named here rather than in
    // units.js: what a unit carries a light for is a fact about its type, how
    // bright it burns is a fact about the hour, and this is a place that knows
    // both. The game says the same thing in the same way.
    tuning: { lamp: MOOD.kingFire },
    emerge: false,
  }));

  // What is selected. A separate overlay from the cursor rather than a recolour
  // of it, because the two are true at the same time - the thing being worked on
  // and the thing about to be clicked - and one hexagon cannot say both.
  //
  // Stronger than anything the game draws on a tile, and it has earned that: in
  // the game a highlight is a hint about a move, and here it is the answer to
  // "which tile am I editing", which has to be unmistakable from across the
  // board. Still additive, so the tile keeps its own grass and simply catches
  // much more light - a flat pale hexagon stuck on the ground is the thing
  // MOOD's overlays exist to avoid.
  const selectionGO = new GameObject('Selection');
  selectionOverlay = selectionGO.addComponent(new HexOverlay(world.grid, [], {
    color: 0xbfe8ff, opacity: 0.5, y: 0.045, additive: true,
    heightAt: (q, r) => hexGround.topY(q, r),
  }));

  // The cursor under the mouse. Straight out of the game, including the two-pass
  // plane solve that makes a click on a hillside land on the tile you were
  // aiming at.
  const cursorGO = new GameObject('Cursor');
  cursorGO.addComponent(new HexOverlay(world.grid, [], {
    color: 0x8fd8e8, opacity: 0.16, y: 0.05, additive: true,
  }));
  cursorGO.addComponent(new HexPicker({
    grid: world.grid,
    ground: hexGround,
    onPick: (hex) => select(hex),
  }));

  board = [groundGO, gridGO, kingGO, selectionGO, cursorGO];
  for (const go of board) game.add(go);
}

function clearBoard() {
  // Removing a GameObject destroys its components, which is what takes the
  // picker's listeners off the canvas and gives the King's hex back to the grid.
  for (const go of board) game.remove(go);
  board = [];
  hexGround = null;
  selectionOverlay = null;
}

// The one way the level on screen changes. Everything derived from it is
// rebuilt, and the selection goes with the old board: a hex coordinate that
// meant something on the last level is not a promise about this one.
//
// It stores as well as loads. Every level the editor has open is a level in the
// browser - a board that exists only on screen is one refresh from being gone -
// so this is also what makes a brand new or freshly imported level real.
function loadLevel(next) {
  clearBoard();
  level = next;
  selected = null;
  buildBoard();
  commit();
  storage.setOpenId(level.id);
  refreshPanel();
}

// What every edit ends in, and the reason there is no Save button. It is one
// function so that the day tiles can be painted, elevation raised or a unit
// moved, the persistence is already written and the tool only has to say that it
// changed something.
function commit() {
  try {
    storage.save(level);
  } catch (e) {
    // The one case where the promise this editor makes cannot be kept, so it is
    // said out loud rather than swallowed: a full quota, or a browser with
    // storage switched off, means the work really is only on screen.
    say(e.message, true);
  }
  refreshPanel();
}

function select(hex) {
  selected = hex ? { q: hex.q, r: hex.r } : null;
  selectionOverlay.setHexes(selected ? [selected] : []);
  refreshPanel();
}

// ── The panel and the library ────────────────────────────────────────────────

function levelList() {
  try { return storage.list(); } catch { return []; }
}

function refreshPanel() {
  panel.update({
    level,
    hex: selected,
    tile: selected ? tileAt(level, selected.q, selected.r) : null,
  });
  // The library is repainted out of storage rather than told what changed, so a
  // rename, a duplicate and an import all land the same way.
  if (library.isOpen) library.render(levelList(), level.id);
}

// Every library action is the same three lines - do the thing, say what
// happened, say what went wrong instead - so it is one wrapper rather than seven
// identical try blocks. Nothing inside them reaches past `loadLevel` and
// `commit`.
function act(fn) {
  return async (...args) => {
    try {
      // Nothing back means nothing happened - a cancelled prompt - and the panel
      // is left saying whatever it was already saying.
      const said = await fn(...args);
      if (said != null) say(said);
    } catch (e) {
      say(e.message, true);
    }
    refreshPanel();
  };
}

// Said in whichever of the two is in front of the person. The library covers the
// panel, so a message about an import that went there would be a message nobody
// read.
function say(text, isError = false) {
  (library?.isOpen ? library : panel)?.setStatus(text, isError);
}

const panel = new EditorPanel({
  root: document.getElementById('panel'),
  onLevels: () => library.open(levelList(), level.id),
});

const library = new LevelLibrary({
  root: document.getElementById('levels'),

  onOpen: act((id) => {
    loadLevel(storage.load(id));
    library.close();
    return null;                    // the panel already says which level it is
  }),

  // A fresh starter board under a name nothing else is using, open immediately.
  onNew: act(() => {
    loadLevel(defaultLevel(storage.uniqueName('Untitled')));
    library.close();
    return null;
  }),

  // `prompt` rather than an editable card. It is the whole of the interaction -
  // one string, once - and a field that has to be committed, cancelled and
  // validated is three more things on a card that is mostly a name already.
  onRename: act((id) => {
    const before = storage.load(id);
    const name = window.prompt('Name for this level', before.name)?.trim();
    if (!name || name === before.name) return null;
    if (id === level.id) {
      level.name = name;
      commit();
    } else {
      storage.save({ ...before, name });
    }
    return `Renamed to "${name}"`;
  }),

  onDuplicate: act((id) => {
    const from = storage.load(id);
    const copy = storage.duplicate(from, storage.uniqueName(`${from.name} copy`));
    return `Duplicated as "${copy.name}"`;
  }),

  // The one place a click is asked to confirm itself: everything else here can
  // be undone by doing it again, and this is the only button that destroys work.
  //
  // Deleting the level that is open leaves the editor with nothing to show, so
  // it moves to another one - and makes a starter level if that was the last.
  onDelete: act((id) => {
    const entry = levelList().find(l => l.id === id);
    const name = entry ? storage.entryName(entry) : 'this level';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return null;
    storage.remove(id);
    if (id === level.id) loadLevel(anyStoredLevel() ?? defaultLevel());
    return `Deleted "${name}"`;
  }),

  // With an id it is that card's level; without one it is the footer button and
  // means the level that is open.
  onExport: act((id) => `Exported ${downloadLevel(id ? storage.load(id) : level)}`),

  // Validated before anything is stored or torn down, because a file off disk is
  // the one input here that nothing in this editor wrote.
  //
  // An arriving level never lands on top of one already here. A file carrying an
  // id this browser already holds is a second copy of that level rather than a
  // newer version of it - there is no way to tell which is newer, and guessing
  // wrong loses work - so it comes in under a fresh identity. A name already
  // taken is made unique so the library stays readable. Both are reported: a
  // level quietly renamed is a level you cannot find again.
  onImport: act(async (file) => {
    let next;
    try {
      next = parseLevel(await readFile(file));
    } catch (e) {
      throw new Error(`${file.name}: ${e.message}`);
    }
    const notes = [];
    if (storage.has(next.id)) {
      next.id = newId();
      notes.push('a level with that id is already here, so this is a copy');
    }
    const name = storage.uniqueName(next.name);
    if (name !== next.name) {
      notes.push(`renamed to "${name}"`);
      next.name = name;
    }
    loadLevel(next);
    return `Imported "${next.name}"${notes.length ? ` - ${notes.join('; ')}` : ''}`;
  }),
});

// The first level in the library that can actually be read, or null.
function anyStoredLevel() {
  for (const entry of levelList()) {
    if (entry.error) continue;
    try { return storage.load(entry.id); } catch { /* try the next one */ }
  }
  return null;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// Carry on from where the last session stopped: the level that was open, or any
// other level in the browser if that one has gone, or a starter board if this is
// the first visit. `loadLevel` stores whichever it ends up being, so a first
// visit leaves a level behind rather than an empty library.
{
  const wanted = storage.openId();
  let opening = null;
  if (wanted) {
    try { opening = storage.load(wanted); } catch { /* deleted, or no longer reads */ }
  }
  loadLevel(opening ?? anyStoredLevel() ?? defaultLevel());
}

// Open looking at the middle of the board.
{
  const { x, z } = world.grid.hexToWorld(0, 0);
  rig.focusOn(x, z);
}

// The same hook the game exposes, and for the same reason: tools/check.py drives
// the page through it, and a screenshot of a hex has to be able to ask where
// that hex is on screen. The board is rebuilt on every load, so what it hands
// out are getters rather than the objects that were current when it was written.
// Not editor UI - the editor's UI is the panel.
window.hex = {
  game, rig,
  get level()    { return level; },
  get world()    { return world; },
  get grid()     { return world.grid; },
  get ground()   { return hexGround; },
  get selected() { return selected; },
  select,
  loadLevel,
  commit,
  storage,
  panel, library,
  // The file format, reachable from the console and from the check script, so a
  // round trip can be asserted without a download dialog in the way.
  stringifyLevel: () => stringifyLevel(level),
  parseLevel,
  lookAt: (q, r) => { const { x, z } = world.grid.hexToWorld(q, r); rig.focusOn(x, z); },
};

game.start();
