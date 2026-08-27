import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexOverlay } from '../engine/components/hex_overlay.js';
import { HexPicker } from '../engine/components/hex_picker.js';
import { HexGrid } from '../engine/hex/hex_grid.js';
import { MOOD } from '../game/mood.js';
import { Unit } from '../game/components/unit.js';
import { defaultLevel, buildLevel, parseLevel, stringifyLevel, newId, tileAt } from './level.js';
import { TOOLS, TOOL_BY_ID, toolGroups, defaultSettings } from './tools.js';
import { downloadLevel, readFile } from './files.js';
import { startPlay } from '../game/play.js';
import { buildMap } from '../game/maps.js';
import { fogWanted, setFogWanted } from './prefs.js';
import * as storage from './storage.js';
import { EditorPanel } from './ui/panel.js';
import { ToolBar } from './ui/toolbar.js';
import { LevelLibrary } from './ui/levels.js';

// The level editor: the game's world with the game taken out of it.
//
// This is a second composition root, not a second renderer. Every component in
// the scene below is the one the game uses - same grid, same ground, same
// camera, same picker - and what makes this the editor is only which of them are
// wired up and what the mouse is taken to mean. So a change to how the island
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
// being edited. Everything else is *derived* from it: the grid, the ground mesh,
// the King standing on a tile. So the scene never drifts from the file and has to
// be reconciled with it - it is thrown away and built again whenever the level
// changes, which is what makes import a two-line operation and export honest.
//
// ── And the level is stored, not saved ───────────────────────────────────────
// Local storage is where the level lives, not a backup of it. Every change ends
// in `commit()`, which writes it through immediately, so there is no unsaved
// work, nothing to lose by closing the tab, and no Save button - the editor
// opens again on whatever was on screen last time. Files are for the other
// things: a backup, another machine, a level committed to git.
//
// ── What the mouse means is a tool's business ────────────────────────────────
// This file routes the pointer and knows nothing about what any tool does. Hover
// paints a preview of the active tool's footprint, a left press and drag hands
// that footprint to the tool, and the wheel does the same when the tool wants it.
// The tools are data in tools.js; adding units, enemies or objects later is a new
// entry there and nothing here.
//
// The scene is in two halves because of that. The camera, the light, the brush
// overlay and the picker are built once and outlive every edit - tearing the
// picker down mid-drag would take the listener that is running the drag with it -
// and only what the *level* describes is rebuilt.

const ELEVATION_STEP = 0.22;   // world height of one elevation level, as in the game

// How many rings of empty hexes are drawn beyond the board. Two is enough to
// have somewhere to paint into in every direction without the lattice running
// off to the horizon - and it moves outward as the board grows, so there is
// always room to keep going.
const MARGIN = 2;

const game = new Game();

// ── The parts that are not the level ─────────────────────────────────────────
// The hour, the camera, and the mouse. None of them belong to a level: loading a
// file should not move the camera or change the light, because the person doing
// it is looking at something and expects to still be looking at it afterwards.

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

// ── The level, and the board it describes ────────────────────────────────────

let level = null;            // set by the boot block at the bottom of this file
let world = null;            // grid, elevation and crags, derived from `level`
let envelope = null;         // every hex that can be pointed at, board or not
let terrain = [];            // the GameObjects that belong to this level
let units = [];              // the ones that are people, a subset of the above
let hexGround = null;

// Which lights belong to which type, the same pair the game names. Anything not
// in here carries none, which units.js already decides from `lamp` on the type.
const LAMPS = { king: MOOD.kingFire, scout: MOOD.scoutLamp };

// Geometry only, and it never changes: where a hex sits and what its corners are
// depend on the hex size and nothing else. The overlays are built once against
// this, so they survive every rebuild - what they draw is a list of hexes, and a
// list of hexes does not care how big the board currently is.
const geometry = new HexGrid({ size: 1 });

function buildTerrain() {
  world = buildLevel(level);
  game.hexGrid = world.grid;
  units = [];

  // The board is `world.grid` - what exists, what a unit stands on, what the
  // ground mesh draws. The envelope is the lattice around it: the same hexes
  // continuing past the coast, with no shape, so everything in it is in bounds
  // and the picker will report it. Two grids rather than one because the two
  // answer different questions, and the board must keep answering "is there a
  // tile here" honestly - that is what draws the cliffs at the coast.
  const outer = level.tiles.reduce(
    (m, t) => Math.max(m, Math.abs(t.q), Math.abs(t.r), Math.abs(t.q + t.r)), 0);
  envelope = new HexGrid({ size: level.hexSize, radius: Math.max(level.radius, outer) + MARGIN });

  const groundGO = new GameObject('HexGround');
  hexGround = groundGO.addComponent(new HexGround(world.grid, {
    rockKeys: world.blockedKeys,
    levels: world.levels,
    step: ELEVATION_STEP,
    ...MOOD.ground,
  }));

  const gridGO = new GameObject('HexGrid');
  gridGO.addComponent(new HexGridRenderer(world.grid, { color: MOOD.gridColor, opacity: 0.14 }));

  // And the ground that is not ground yet. Cool and faint rather than the
  // board's own seam colour: MOOD's grid is a dark green because it is drawn
  // *into* grass, and the same line over open water would be invisible. This one
  // is the editor talking rather than the world - the hexes it draws do not
  // exist - so it is in the panel's blue, like the brush.
  const emptyGO = new GameObject('EmptyHexes');
  emptyGO.addComponent(new HexGridRenderer(envelope, {
    color: 0x7fa8c0, opacity: 0.15, y: 0.02,
    hexes: [...envelope.allHexes()].filter(h => !world.grid.inBounds(h.q, h.r)),
  }));

  // Everybody standing on it, the King included, through the same component the
  // game builds them with. There is no editor-side drawing of a unit: what is on
  // screen here is what will be on the board, and a Spearman looks like an enemy
  // because `hostile` is on its type and the palette says so, not because the
  // editor coloured it.
  for (const u of [{ type: 'king', ...level.king }, ...(level.units ?? [])]) {
    const go = new GameObject(`Unit:${u.type}`);
    go.addComponent(new Unit({
      grid: world.grid,
      ground: hexGround,
      type: u.type,
      q: u.q, r: u.r,
      colors: MOOD.units,
      // What a unit carries a light for is a fact about its type; how bright it
      // burns is a fact about the hour. The two halves meet here, which is the
      // only place that knows both - the game says the same thing the same way.
      tuning: { lamp: LAMPS[u.type] },
      emerge: false,
    }));
    units.push(go);
  }

  terrain = [groundGO, gridGO, emptyGO, ...units];
  for (const go of terrain) game.add(go);
}

function clearTerrain() {
  // Removing a GameObject destroys its components, which is what gives the
  // King's hex back to the grid and releases the ground's geometry.
  for (const go of terrain) game.remove(go);
  terrain = [];
  units = [];
  hexGround = null;
}

// ── The mouse ────────────────────────────────────────────────────────────────

let hovered = null;          // the hex under the cursor, or null
let painting = false;        // a left button held down, mid-stroke

// The brush: the footprint the active tool would act on, in that tool's colour.
// One overlay for every tool, because there is only ever one brush - and it is
// the only thing on screen that says what the mouse is about to do.
const brushGO = new GameObject('Brush');
const brush = brushGO.addComponent(new HexOverlay(geometry, [], {
  color: 0x9fd8ee, opacity: 0.34, y: 0.045, additive: true,
  // Off the board there is no surface and `topY` says zero, which is the height
  // a tile would be added at - so the preview sits exactly where the tile will.
  heightAt: (q, r) => hexGround?.topY(q, r) ?? 0,
}));
game.add(brushGO);

// The editor's mouse. It survives every *edit* - tearing the picker down mid-drag
// would take the listener running the drag with it - and it is taken off the page
// entirely while a playtest is on, because the game puts its own picker there and
// two things reading every click is one too many.
//
// Built by a function rather than held in a variable for a reason that cost a
// bug: removing a GameObject destroys its components, so the same object cannot
// be added back. It is made again instead.
//
// It is handed views of the current envelope and ground rather than the objects
// themselves, because both are replaced on every edit and a captured reference
// would be pointing at the board as it was two tiles ago.
let cursorGO = null;

function buildCursor() {
  cursorGO = new GameObject('EditorCursor');
  cursorGO.addComponent(new HexPicker({
    grid: {
      worldToHex: (x, z) => envelope.worldToHex(x, z),
      inBounds: (q, r) => envelope.inBounds(q, r),
    },
    ground: { topY: (q, r) => hexGround?.topY(q, r) ?? 0 },
    onHover: (hex) => {
      hovered = hex;
      // A drag is the hexes it crosses - for the tools that want it. Place does
      // not: dropping a unit on every hex the cursor passed over is not a stroke,
      // it is a mess to undo.
      if (painting && tool().continuous !== false) apply();
      else refreshBrush();
      refreshPanel();
    },
    onDown: (hex) => {
      hovered = hex;
      painting = true;
      apply();
    },
    onUp: () => { painting = false; },
    // The wheel is the tool's only if the tool wants it and there is something
    // under the cursor to use it on. Everything else - which is every notch spent
    // off the board, and every notch spent with a tool that has no use for one -
    // falls through to the camera's zoom.
    onWheel: (hex, deltaY) => {
      if (!hex || !tool().wheel) return false;
      hovered = hex;
      const hexes = tool().brush(ctx(), hex);
      if (!hexes.length) return false;
      edited(tool().wheel(ctx(), hexes, deltaY < 0 ? +1 : -1));
      return true;                    // consumed: the camera does not zoom
    },
  }));
  game.add(cursorGO);
}

function editorMouse(on) {
  if (on && !cursorGO) buildCursor();
  else if (!on && cursorGO) {
    game.remove(cursorGO);
    cursorGO = null;
    hovered = null;
    painting = false;
  }
  brush.setHexes(on ? brushHexes() : []);
}

function tool() {
  return TOOL_BY_ID[activeTool];
}

// What a tool is given: the level to change, the lattice to stay inside, and its
// own settings. Rebuilt per call because `level` and `envelope` are both replaced
// out from under it.
function ctx() {
  return { level, envelope, s: settings[activeTool] };
}

function brushHexes() {
  return hovered ? tool().brush(ctx(), hovered) : [];
}

function refreshBrush() {
  // A tool that has something to say about the hex under the cursor says it in
  // the brush's colour, which is the only feedback that arrives before the click.
  brush.setColor(tool().colorAt?.(ctx(), hovered) ?? tool().color);
  brush.setHexes(brushHexes());
}

// One stroke's worth of work: hand the tool its footprint and rebuild if it
// changed anything. A drag across ground that is already drawn reports zero and
// costs nothing, which is what keeps a long stroke cheap.
function apply() {
  if (session) return;
  const hexes = brushHexes();
  if (!hexes.length) { refreshBrush(); return; }
  try {
    edited(tool().paint?.(ctx(), hexes) ?? 0);
    panel.clearError();
  } catch (e) {
    // A tool that will not do something says why. The brush was already showing
    // the refusal in its colour; this is the sentence behind it, for the click
    // that went ahead anyway.
    say(e.message, true);
  }
}

// ── Changing things ──────────────────────────────────────────────────────────

// The one way the level on screen changes. Everything derived from it is rebuilt,
// and the board is stored: every level the editor has open is a level in the
// browser, so this is also what makes a brand new or freshly imported level real.
function loadLevel(next) {
  clearTerrain();
  level = next;
  buildTerrain();
  commit();
  storage.setOpenId(level.id);
  refreshBrush();
  refreshPanel();
}

// An edit to the board rather than a change of board. The terrain is thrown away
// and built again from the level - a tile added at the coast changes the cliff
// faces of the three tiles beside it, and a partial update is where stale side
// walls and holes in the ground come from. On boards this size the whole mesh is
// cheaper to rebuild than to reason about.
//
// Nothing happens when nothing changed, which is the difference between a drag
// that feels immediate and one that rebuilds the world sixty times a second.
function edited(changed) {
  if (!changed) return;
  clearTerrain();
  buildTerrain();
  commit();
  refreshBrush();
}

// What every edit ends in, and the reason there is no Save button. It is one
// function so that the day units are placed or terrain is painted, the
// persistence is already written and the tool only has to say that it changed
// something.
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

// ── The tools, the panel and the library ─────────────────────────────────────

let activeTool = TOOLS[0].id;
const settings = defaultSettings();

function levelList() {
  try { return storage.list(); } catch { return []; }
}

function refreshPanel() {
  panel.update({
    level,
    hex: hovered,
    tile: hovered ? tileAt(level, hovered.q, hovered.r) : null,
    fog: fogWanted(),
    playing: !!session,
  });
  document.getElementById('tools').classList.toggle('is-hidden', !!session);
  toolbar.update(tool(), settings[activeTool]);
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
      // Nothing back means the action had nothing to report - a cancelled
      // prompt, or an edit that speaks for itself by changing the board. The
      // panel keeps whatever it was saying, except a refusal: that one is about
      // an action that has now been replaced by one that worked.
      const said = await fn(...args);
      if (said != null) say(said);
      else ui()?.clearError();
    } catch (e) {
      say(e.message, true);
    }
    refreshPanel();
  };
}

// Whichever of the two is in front of the person. The library covers the panel,
// so a message about an import that went to the panel would be a message nobody
// read.
function ui() {
  return library?.isOpen ? library : panel;
}

function say(text, isError = false) {
  ui()?.setStatus(text, isError);
}

const toolbar = new ToolBar({
  root: document.getElementById('tools'),
  groups: toolGroups(),
  onSelect: (id) => {
    if (!TOOL_BY_ID[id]) return;
    activeTool = id;
    refreshBrush();
    refreshPanel();
  },
  // A change arrives as a nudge or as a value, and which one it is comes from the
  // control the toolbar drew - so the toolbar never has to know a setting's
  // bounds or its options. Both are declared on the tool and checked here.
  onSetting: (key, change) => {
    const spec = tool().settings?.find(s => s.key === key);
    if (!spec) return;
    if (change.value !== undefined) {
      const known = (spec.groups ?? []).some(g => g.options.some(o => o.id === change.value));
      if (!known) return;
      settings[activeTool][key] = change.value;
    } else {
      const at = settings[activeTool][key] ?? spec.min;
      settings[activeTool][key] = Math.min(spec.max, Math.max(spec.min, at + change.by));
    }
    refreshBrush();
    refreshPanel();
  },
});

const panel = new EditorPanel({
  root: document.getElementById('panel'),
  onLevels: () => { if (!session) library.open(levelList(), level.id); },
  onPlay: act(() => { start(); return null; }),
  // Whether the board is hidden is decided when a session starts, so flipping it
  // mid-fight starts one again rather than doing nothing until the next Play -
  // which is what it did, and it read exactly like a broken switch.
  onFog: (on) => {
    setFogWanted(on);
    if (session) restart();
    else refreshPanel();
  },
});

// Off to the game with whatever is on screen. The level is already stored - every
// edit ends in `commit()` - so this stores it once more only to be certain the
// bytes the game reads are the bytes this editor is holding, and hands the camera
// over with it so coming back is not a flight back.
//
// No confirmation, no dialog, no loading screen. The loop this exists for is
// change something, fight for twenty seconds, change it again, and every step
// that has to be dismissed is spent twice a minute.
// ── Playing it ──────────────────────────────────────────────────────────────
// The game, started in this page, in this scene, through the same `startPlay`
// the game page calls - so there is no second simulation and nothing about a
// playtest that a real run does not do. What it plays is a *copy*, parsed out of
// the level's own JSON: the same bytes a file would carry, so nothing that
// happens in the fight can reach back into what is being edited. The dead come
// back and the fog closes because the board that was played was never this one.
//
// The camera, the sky and the sun are not touched. They belong to the page rather
// than to the level, which is why they are built once at the top of this file -
// and it is what makes Play a change of what is on the board rather than a
// journey. Stop puts the editor's board back where it was, at the same zoom, with
// the same tool still held.
let session = null;

function start() {
  if (session) return stop();
  commit();
  clearTerrain();
  editorMouse(false);
  begin();
  refreshPanel();
}

function stop() {
  if (!session) return;
  session.teardown();
  session = null;
  buildTerrain();
  editorMouse(true);
  refreshPanel();
}

// A new session in place of the one running, for the settings that are decided
// when a session starts and cannot be changed inside one. The editor's board is
// not rebuilt in between - it was never put back - so this is a blink, which is
// the only reason it is an acceptable answer to a switch being flipped.
function restart() {
  if (!session) return;
  session.teardown();
  begin();
  refreshPanel();
}

function begin() {
  session = startPlay({
    game, map: buildMap(parseLevel(stringifyLevel(level))), rig,
    fog: fogWanted(),
    hand: document.getElementById('hand'),
    // `window.hex` is the editor's here, and the developer keys are the game
    // page's business - R and V would fight the tools for the keyboard.
    debug: false,
    // Stay exactly where the board is being looked at. Flying to the King is
    // right when a run opens and wrong when this is the fifth time in a minute.
    focus: false,
  });
}

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
  editorMouse(true);
}

// Open looking at the middle of the board. Nothing ever moves the camera again -
// not a load, not a playtest - because where somebody is looking is a fact about
// them and not about the level.
{
  const { x, z } = geometry.hexToWorld(0, 0);
  rig.focusOn(x, z);
}

// P to play, Escape to stop. Ignored while a field or the library has the
// keyboard, so typing a level name does not launch a playtest halfway through the
// word - except Escape while playing, which has nothing else to mean.
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (session && e.code === 'Escape') { stop(); return; }
  if (e.code !== 'KeyP') return;
  if (library.isOpen || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  start();
});

// The same hook the game exposes, and for the same reason: tools/check.py drives
// the page through it, and a screenshot of a hex has to be able to ask where
// that hex is on screen. The terrain is rebuilt on every edit, so what it hands
// out are getters rather than the objects that were current when it was written.
// Not editor UI - the editor's UI is the toolbar and the panel.
window.hex = {
  game, rig,
  get level()    { return level; },
  get world()    { return world; },
  get grid()     { return world.grid; },
  get envelope() { return envelope; },
  get ground()   { return hexGround; },
  get hovered()  { return hovered; },
  get tool()     { return activeTool; },
  settings,
  loadLevel,
  commit,
  play: start,
  stop,
  get session() { return session; },
  storage,
  panel, toolbar, library,
  // The tools, driven the way the mouse drives them, so a shape can be sketched
  // from the console or the check script without a drag: point at a hex and use
  // whatever is active.
  pick: (id) => { activeTool = id; refreshBrush(); refreshPanel(); },
  at: (q, r) => { hovered = { q, r }; refreshBrush(); refreshPanel(); },
  use: () => { apply(); },
  scroll: (dir) => {
    const hexes = brushHexes();
    if (hexes.length && tool().wheel) edited(tool().wheel(ctx(), hexes, dir));
  },
  // The file format, reachable from the console and from the check script, so a
  // round trip can be asserted without a download dialog in the way.
  stringifyLevel: () => stringifyLevel(level),
  parseLevel,
  lookAt: (q, r) => { const { x, z } = geometry.hexToWorld(q, r); rig.focusOn(x, z); },
};

game.start();
