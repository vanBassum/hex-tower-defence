import * as THREE from 'three';
import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexOverlay } from '../engine/components/hex_overlay.js';
import { HexPicker } from '../engine/components/hex_picker.js';
import { HexGrid } from '../engine/hex/hex_grid.js';
import { MOOD, WIND } from '../game/mood.js';
import { PROP_TYPES } from '../game/props.js';
import { UNIT_TYPES } from '../game/units.js';
import { Unit } from '../game/components/unit.js';
import { PropLayer } from '../game/components/prop_layer.js';
import {
  defaultLevel, buildLevel, parseLevel, stringifyLevel, newId, tileAt,
  addCard, removeCard, setDeckLimit, deckLimit, moveProp, moveUnit, moveKing,
  isStandable, detailAt, entityAt, topPropAt, removePropsAt, removeEntityAt,
  thinDetail,
} from './level.js';
import { detailPlacements } from '../game/detail.js';
import { CONTENT, CONTENT_BY_ID } from './content.js';
import {
  TOOLS, TOOL_BY_ID, SETTINGS, defaultSettings, visibleSettings, toolsFor,
} from './tools.js';
import { Ghost } from './ghost.js';
import { SelectionMarker } from './marker.js';
import { thumbnails, thumbnailStats, forgetThumbnails } from './thumbnails.js';
import { downloadLevel, readFile } from './files.js';
import { startPlay } from '../game/play.js';
import { loadSystemLevels } from '../game/levels.js';
import { buildMap } from '../game/maps.js';
import { fogWanted, setFogWanted } from './prefs.js';
import * as storage from './storage.js';
import { EditorPanel } from './ui/panel.js';
import { EditBar } from './ui/editbar.js';
import { LevelLibrary } from './ui/levels.js';
import { LevelSettings } from './ui/settings.js';

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
// ── What the mouse means is a tool crossed with a content ───────────────────
// Two independent choices: a *tool* is how you are editing - one hex, an exact
// spot, an area, a pick - and a *content* is what you are editing. This file owns
// the crossing and neither half of it. Hover previews the tool's footprint, a
// press hands that footprint to whichever verb the tool names, and the content
// decides what that means.
//
// So there is no branch anywhere below on what is being placed. The tools are in
// tools.js, the categories are in content.js, and adding a kind of thing to the
// board is an entry in one of them - never a new interaction, and never a line
// here.
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

// ── The level, and the board it describes ────────────────────────────────────

let level = null;            // set by the boot block at the bottom of this file
let world = null;            // grid, elevation and crags, derived from `level`
let envelope = null;         // every hex that can be pointed at, board or not
let terrain = [];            // the GameObjects that belong to this level
let units = [];              // the ones that are people, a subset of the above
let propsGO = null;          // the decoration, kept so a click can hit-test it
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

  // The trees, the rocks and the lamps, through the game's own layer. No
  // visibility, so every lamp is simply lit - which is what an editor wants, and
  // what PropLayer already does when nothing tells it about fog. The wind is the
  // level's one breeze, so a wood sways here exactly as it will in the fight.
  //
  // The ground cover is expanded here rather than stored, exactly as the game
  // expands it in `buildMap` - same function, same seeds, same tufts. That is
  // what makes the editor's board and the playtest's board the same board: if
  // this drew its own idea of grass, the fight would open on a different island.
  // Ground cover is marked as *derived* on the way in. Both lists become meshes
  // the same way, and the difference only matters when one is clicked: a placed
  // prop is an entry in the level that can be picked up, and a scattered tuft is
  // a consequence of the patch under it, so clicking one selects the patch.
  const cover = detailPlacements(level.detail ?? []);
  for (const c of cover) c.derived = true;

  propsGO = new GameObject('Props');
  propsGO.addComponent(new PropLayer({
    grid: world.grid, ground: hexGround,
    props: [...(level.props ?? []), ...cover],
    colors: MOOD.props, wind: WIND,
    tuning: {
      lanternLight: MOOD.lanternLight,
      flicker: { lantern: MOOD.lanternFlickerAmount },
    },
  }));

  // Everybody standing on it, the King included, through the same component the
  // game builds them with. There is no editor-side drawing of a unit: what is on
  // screen here is what will be on the board, and a Spearman looks like an enemy
  // because `hostile` is on its type and the palette says so, not because the
  // editor coloured it.
  for (const u of [{ type: 'king', ...level.king }, ...(level.units ?? [])]) {
    const go = new GameObject(`Unit:${u.type}`);
    // Which entry in the level this figure is, for the same reason a prop's mesh
    // carries its placement: a click hit-tests the scene and has to get back to
    // the thing in the level. The King is not in `units`, so he is marked as
    // himself.
    go.object3D.userData.unit = level.units?.includes(u) ? u : null;
    go.object3D.userData.king = u.type === 'king' && !level.units?.includes(u);
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

  terrain = [groundGO, gridGO, emptyGO, propsGO, ...units];
  for (const go of terrain) game.add(go);
}

function clearTerrain() {
  // Removing a GameObject destroys its components, which is what gives the
  // King's hex back to the grid and releases the ground's geometry.
  for (const go of terrain) game.remove(go);
  terrain = [];
  units = [];
  propsGO = null;
  hexGround = null;
}

// ---- The mouse --------------------------------------------------------------

let hovered = null;          // the hex under the cursor, or null
let spot = null;             // where in the world the cursor is, or null
let painting = false;        // a left button held down, mid-stroke
// What the arrow has picked, or null. Not a hex: a hex is one of the things it
// can be. `{ kind, q, r, ... }` where kind is 'prop', 'cover', 'unit', 'king' or
// 'tile' - because clicking a tree and clicking the ground under it are two
// different selections and the editor used to have no way to say so.
let selected = null;
// How far into the current stroke we are: 1 on the press, counting up while the
// button is held. A tool that acts on the press only says so with `continuous`,
// and this is what lets the drag be told from the press it started with.
let step = 0;
// And what the arrow has hold of while the button is down: the thing the press
// landed on, plus its mesh, so a drag can move both without rebuilding the board.
// Null for a press that landed on bare ground, and then a drag does nothing rather
// than the camera being fought over.
let carried = null;
// Whether the current drag actually moved anything, so the release knows whether
// there is something to store.
let dragged = false;
// Whether a real pointer aimed the cursor. It matters for one thing only: with a
// ray, a click can tell a tree from the grass beside it, and without one - the
// console and tools/check.py drive the editor by coordinates - the only question
// that can be answered is what is on the hex. So the fallback is not a lesser
// version of picking, it is the honest answer to a different question.
let aimed = false;

// The footprint the active tool would act on, in that tool's colour. One overlay
// for every tool, because there is only ever one - and it is the only thing on
// screen that says what the mouse is about to do.
const brushGO = new GameObject('Brush');
const brush = brushGO.addComponent(new HexOverlay(geometry, [], {
  color: 0x9fd8ee, opacity: 0.34, y: 0.045, additive: true,
  // Off the board there is no surface and `topY` says zero, which is the height a
  // tile would be added at - so the preview sits exactly where the tile will.
  heightAt: (q, r) => hexGround?.topY(q, r) ?? 0,
}));
game.add(brushGO);

// And what the arrow has picked. A second overlay rather than a second colour on
// the brush: the two say different things - what the mouse is about to do, and
// what is being held - and they are usually on different hexes. It is the only
// thing on screen that outlives the cursor leaving the canvas.
const selectGO = new GameObject('Selection');
const selection = selectGO.addComponent(new HexOverlay(geometry, [], {
  color: 0xf0dcc0, opacity: 0.2, y: 0.05, additive: true,
  heightAt: (q, r) => hexGround?.topY(q, r) ?? 0,
}));
game.add(selectGO);

// A ring round whatever single thing is selected. The hex overlay above says "this
// tile", this says "this object on it", and having both is the whole of being able
// to select the two separately.
const markGO = new GameObject('SelectionMark');
const mark = markGO.addComponent(new SelectionMarker());
game.add(markGO);

// The see-through preview of what a precise placement would leave behind. Built
// once and reused, because it outlives every edit - and because building it is the
// expensive half.
const ghostGO = new GameObject('Ghost');
const ghost = ghostGO.addComponent(new Ghost({ colors: MOOD.props }));
game.add(ghostGO);

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
let picker = null;

function buildCursor() {
  cursorGO = new GameObject('EditorCursor');
  picker = cursorGO.addComponent(new HexPicker({
    grid: {
      worldToHex: (x, z) => envelope.worldToHex(x, z),
      inBounds: (q, r) => envelope.inBounds(q, r),
    },
    ground: { topY: (q, r) => hexGround?.topY(q, r) ?? 0 },
    onHover: (hex) => {
      hovered = hex;
      aimed = true;
      // Where in the tile, not just which tile. The Place tool is the reason the
      // picker keeps this: everything else rounds it off to a hex immediately.
      spot = picker?.point ?? null;
      if (painting && tool().continuous) apply();
      else refreshBrush();
      refreshPanel();
    },
    onDown: (hex) => {
      hovered = hex;
      aimed = true;
      spot = picker?.point ?? null;
      painting = true;
      step = 0;
      apply();
    },
    // The end of a drag is where it is stored. Nothing is committed while the
    // pointer is moving: a drag used to rebuild the whole board *and* write the
    // level to local storage on every pointer move, which on a full board is ten
    // milliseconds and a serialise per frame for the whole gesture.
    onUp: () => {
      painting = false;
      carried = null;
      if (dragged) {
        dragged = false;
        // One rebuild at the end, which settles everything a moved thing touches -
        // the ground it was standing on, the slots on the hex it left.
        edited(1);
        refreshPanel();
      }
    },
    // The right button, and it is the same intention whatever the tool: take away
    // what this *content* puts down. A right drag is the camera's rotate and a
    // right press is the removal, and the rig is the one that knows which just
    // happened - so a press at the end of a drag is thrown away here.
    onOrder: (hex) => {
      if (rig.consumedRightPress) return;
      hovered = hex;
      removeAt();
      refreshPanel();
    },
    // The wheel is the content's only if the content has a use for one - which
    // terrain does, because sculpting height is a continuous adjustment and no
    // number of clicks is. Everything else falls through to the camera's zoom.
    onWheel: (hex, deltaY) => {
      if (!hex || !content().wheel || !tool().verb) return false;
      hovered = hex;
      const hexes = footprint();
      if (!hexes.length) return false;
      edited(content().wheel(ctx(), hexes, deltaY < 0 ? +1 : -1));
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
    picker = null;
    hovered = null;
    spot = null;
    painting = false;
  }
  if (!on) ghost.hide();
  brush.setHexes(on ? footprint() : []);
  refreshSelection();
}

function tool() {
  return TOOL_BY_ID[activeTool];
}

function content() {
  return CONTENT_BY_ID[activeContent];
}

// What the palette has ticked, as the category's own asset entries. Always a list,
// and never empty: a selection that fell to nothing would be a tool that silently
// does nothing, so the first asset stands in.
function assets() {
  const all = content().assets();
  const want = chosen[activeContent] ?? new Set();
  const picked = all.filter(a => want.has(a.id));
  return picked.length ? picked : all.slice(0, 1);
}

// What a content verb is given: the level to change, its own settings, and what
// is selected. Rebuilt per call because `level` is replaced out from under it.
function ctx() {
  return { level, envelope, assets: assets(), s: toolSettings[activeTool] };
}

// The hexes the press would act on. A tool that works in hex units gets the one
// under the cursor; an area tool gets the ring the radius asks for, bounded by the
// envelope so a wide brush cannot paint off into hexes nothing can reach.
function footprint() {
  if (!hovered) return [];
  if (tool().footprint !== 'area') return [hovered];
  const radius = Math.max(0, (toolSettings[activeTool].radius ?? 1) - 1);
  return [...envelope.hexesInRange(hovered.q, hovered.r, radius)];
}

// And the same list narrowed to what the press would actually touch, which is the
// honest preview for everything except terrain. A terrain brush shows its whole
// footprint on purpose: a preview that shrinks as it crosses ground already drawn
// reads as the tool losing its grip.
function previewHexes() {
  const hexes = footprint();
  const c = content();
  if (tool().id === 'erase') return hexes.filter(h => c.has(level, h.q, h.r));
  if (c.showsWholeFootprint || !c.refuse) return hexes;
  return hexes.filter(h => !c.refuse(level, h, assets()[0]));
}

function refreshBrush() {
  const c = content();
  // Red where the press would be refused, so the tool answers while the cursor is
  // moving instead of after a click that did nothing.
  const no = tool().verb && hovered && c.refuse?.(level, hovered, assets()[0]);
  brush.setColor(no ? 0xe8a09a : tool().color);
  brush.setHexes(tool().verb || tool().id === 'select' ? previewHexes() : []);
  refreshGhost();
}

// The ghost only belongs to the one tool that places something at a point. Under
// every other tool the footprint overlay is the preview, and a second answer to
// the same question would be two answers.
function refreshGhost() {
  if (activeTool !== 'place' || !hovered || !spot || session) return ghost.hide();
  const c = content();
  if (c.refuse?.(level, hovered, assets()[0])) return ghost.hide();
  const placement = c.ghost?.(assets()[0], toolSettings[activeTool]);
  if (!placement) return ghost.hide();
  ghost.show(placement, {
    x: spot.x, z: spot.z, y: hexGround?.topY(hovered.q, hovered.r) ?? 0,
  });
}

// One stroke's worth of work: hand the footprint to the content and rebuild if it
// changed anything. A drag across ground that already says what the tool would say
// reports zero and costs nothing, which is what keeps a long stroke cheap.
function apply() {
  if (session) return;
  step++;
  // The arrow changes nothing, so it never reaches a category. The press picks
  // something up and the rest of the stroke carries it.
  if (!tool().verb) return step === 1 ? pick() : carry();
  if (step > 1 && !tool().continuous) return;

  const c = content();
  const verb = c[tool().verb];
  if (!verb) { say(`${tool().name} does nothing to ${c.name.toLowerCase()}.`, true); return; }
  try {
    if (tool().footprint === 'area') {
      // The *preview's* list, not the whole footprint. The two being the same
      // list is the rule rather than a nicety: a brush that acted on hexes it had
      // not highlighted painted ground cover into the sea, which is a level the
      // editor then refused to reopen. What is shown is what happens.
      const hexes = previewHexes();
      if (!hexes.length) { refreshBrush(); return; }
      edited(verb(ctx(), hexes));
    } else {
      if (!hovered) { refreshBrush(); return; }
      // One hex, so the refusal is worth saying out loud rather than by drawing
      // nothing - a press that lands on a tile that cannot take the thing should
      // say why.
      const no = c.refuse?.(level, hovered, assets()[0]);
      if (no) throw new Error(`Cannot put that here - ${no}.`);
      edited(verb(ctx(), hovered, offsetIn(hovered)));
    }
    panel.clearError();
  } catch (e) {
    // A refusal the brush was already showing in its colour; this is the sentence
    // behind it, for the click that went ahead anyway.
    say(e.message, true);
  }
}

// Where in the hex the cursor is, in world units from the tile centre. This is the
// whole of what the Place tool adds over the Tile tool, and it is why the picker
// keeps a world point at all.
function offsetIn(hex) {
  if (!spot) return null;
  const { x, z } = world.grid.hexToWorld(hex.q, hex.r);
  return { dx: spot.x - x, dz: spot.z - z };
}

// The right button: the content's own erase, on the hex under the cursor. Every
// category's own inverse rather than one shared delete, so taking a lamp back does
// not fell the tree beside it - and terrain has to be the chosen category before a
// right-click can take ground away at all.
function removeAt() {
  if (session || !hovered) return;
  try {
    // The arrow is the one tool that works on a *thing* rather than on a category,
    // so its right button takes away the thing under the cursor whatever kind it
    // is. Every other tool keeps its category's own erase, which is what stops a
    // lamp being taken back felling the tree beside it.
    edited(!tool().verb ? removeUnder() : (content().erase?.(ctx(), [hovered]) ?? 0));
    panel.clearError();
  } catch (e) {
    say(e.message, true);
  }
}

// Whatever the cursor is pointing at, in the order the layers stack: the object
// standing there first, then the ground cover, and the tile itself last and only
// once it is carrying nothing - which is `removeTile`'s own rule.
function removeUnder() {
  const hit = aimed ? pickObject() : pickByHex();
  if (hit?.kind === 'prop') {
    const i = level.props.indexOf(hit.prop);
    if (i < 0) return 0;
    level.props.splice(i, 1);
    return 1;
  }
  if (hit?.kind === 'unit') return removeEntityAt(level, hit.q, hit.r) ? 1 : 0;
  if (hit?.kind === 'king') throw new Error('The King cannot be removed - move him instead.');
  if (hit?.kind === 'cover') return thinDetail(level, hit.q, hit.r);
  // Nothing was hit, so this is a click on bare ground: take whatever the hex has
  // in the same order, which is what makes one right button enough.
  return removePropsAt(level, hovered.q, hovered.r)
    || thinDetail(level, hovered.q, hovered.r)
    || (removeEntityAt(level, hovered.q, hovered.r) ? 1 : 0);
}

// What the arrow does. A hex with something on it becomes the selection and a bare
// one clears it; the level is not touched, so there is nothing to rebuild and
// nothing to store - a selection is something the editor is holding, not something
// the level says.
// What the arrow does: pick whatever the cursor is actually pointing at, which is
// the thing standing there if the ray hits one and the tile if it does not.
//
// That distinction is the reason this hit-tests the scene rather than reading the
// level by hex. "What is on this hex" cannot tell a click on a tree from a click
// on the grass beside it, and those are two different intentions - one of them is
// about the tree and the other is about the ground.
function pick() {
  const hit = (aimed ? pickObject() : pickByHex())
    ?? (hovered ? { kind: 'tile', q: hovered.q, r: hovered.r } : null);
  selected = hit;
  // Only a placed instance can be carried. Ground cover has nothing under the
  // cursor to move - the tufts are a consequence of the patch - and a tile is the
  // board itself.
  carried = null;
  dragged = false;
  if (hit?.kind === 'prop' || hit?.kind === 'unit' || hit?.kind === 'king') {
    carried = {
      ...hit,
      // Where the mesh sits above its own tile, so the drag can keep it sitting
      // there as the ground under it changes height.
      lift: hit.object ? hit.object.position.y - groundY(hit.q, hit.r) : 0,
    };
  }
  refreshSelection();
  say(hit ? `Selected ${describeSelection(hit)}.` : null);
  refreshPanel();
}

// The nearest thing the cursor's ray actually hits, as a selection, or null for
// bare ground. Falls back to nothing when there is no ray - which is the console
// and tools/check.py driving the editor without a pointer, and `pick` then treats
// the hex as the answer.
function pickObject() {
  if (!picker?.ray || !hovered) return null;
  const targets = [propsGO?.object3D, ...units.map(go => go.object3D)].filter(Boolean);
  if (!targets.length) return null;

  // A raycast reads `matrixWorld`, and what keeps those current is the renderer
  // doing it once a frame. A click is not a frame: an edit rebuilds the board and
  // the very next pointer event can arrive before anything has been drawn, and
  // every object in it would still be sitting at the origin as far as the ray is
  // concerned. Updating here costs a walk of the tree per click and removes the
  // dependency on when the last frame happened.
  for (const t of targets) t.updateMatrixWorld(true);

  for (const hit of picker.ray.intersectObjects(targets, true)) {
    const owner = ownerOf(hit.object);
    if (!owner) continue;
    // A scattered tuft is not a thing you can hold. What is really there is the
    // patch that grew it, so that is what a click on one selects.
    if (owner.placement?.derived) {
      const { q, r } = owner.placement;
      return detailAt(level, q, r) ? { kind: 'cover', q, r } : null;
    }
    if (owner.placement) {
      const prop = owner.placement;
      return { kind: 'prop', q: prop.q, r: prop.r, prop, object: owner.object };
    }
    if (owner.unit) {
      const u = owner.unit;
      return { kind: 'unit', q: u.q, r: u.r, unit: u, object: owner.object };
    }
    if (owner.king) {
      return { kind: 'king', q: level.king.q, r: level.king.r, object: owner.object };
    }
  }
  return null;
}

// What is on the hex, in the order the layers stack, for when there is no ray to
// ask. This is what the whole editor did before objects could be picked
// individually, and it is still exactly right when the cursor is a pair of
// coordinates rather than a position on screen.
function pickByHex() {
  if (!hovered) return null;
  const { q, r } = hovered;
  const prop = topPropAt(level, q, r);
  if (prop) return { kind: 'prop', q, r, prop, object: null };
  const here = entityAt(level, q, r);
  if (here?.kind === 'king') return { kind: 'king', q, r };
  if (here?.kind === 'unit') return { kind: 'unit', q, r, unit: here.unit };
  if (detailAt(level, q, r)) return { kind: 'cover', q, r };
  return null;
}

// From a mesh the ray hit, up to the object that knows what it belongs to. The
// tags are put on by PropLayer and by `buildTerrain`; everything between them and
// the mesh is geometry.
function ownerOf(mesh) {
  for (let o = mesh; o; o = o.parent) {
    if (o.userData?.placement) return { placement: o.userData.placement, object: o };
    if (o.userData?.unit) return { unit: o.userData.unit, object: o };
    if (o.userData?.king) return { king: true, object: o };
  }
  return null;
}

// The rest of the stroke: whatever was picked up follows the cursor. This is the
// whole of "drag and drop", and it is here rather than on a tool because what is
// held is something the editor is holding - the level has no idea anything is
// being carried. A hex it may not be put on simply does not take it, which reads
// as the thing staying where it is until the cursor comes back.
//
// **The board is not rebuilt while dragging.** The level is updated as usual - it
// is still the only state - and then the one visual consequence of that update is
// applied by hand, which is moving the mesh that is already there. Rebuilding
// would be ten milliseconds and a serialise to local storage per pointer move,
// for a picture that differs from the last one by one object having moved. The
// rebuild happens once, on release.
function carry() {
  if (!carried || !hovered || !standable(hovered)) { refreshBrush(); return; }

  const at = carried.kind === 'prop' ? offsetIn(hovered) : null;
  const moved = carried.kind === 'prop'
    ? moveProp(level, carried.prop, hovered.q, hovered.r, at)
    // A unit's position *is* its hex, so it snaps - and `moveUnit` refuses a hex
    // that is taken, which is what stops a drag stacking two bodies on one tile.
    : carried.kind === 'king'
      ? moveKing(level, hovered.q, hovered.r)
      : moveUnit(level, carried.unit, hovered.q, hovered.r);
  if (!moved) { refreshBrush(); return; }

  dragged = true;
  carried.q = hovered.q;
  carried.r = hovered.r;
  if (carried.object) {
    const { x, z } = world.grid.hexToWorld(hovered.q, hovered.r);
    carried.object.position.set(
      x + (at?.dx ?? 0), groundY(hovered.q, hovered.r) + carried.lift, z + (at?.dz ?? 0));
  }
  selected = { ...carried };
  refreshSelection();
  refreshBrush();
  refreshPanel();
}

function groundY(q, r) {
  return hexGround?.topY(q, r) ?? 0;
}

function standable(hex) {
  return isStandable(level, hex.q, hex.r) || tileAt(level, hex.q, hex.r)?.terrain === 'crag';
}

// In words, for the panel and the status line.
function describeSelection(sel) {
  if (!sel) return null;
  const where = `${sel.q}, ${sel.r}`;
  if (sel.kind === 'prop') return `${PROP_TYPES[sel.prop.type]?.name ?? sel.prop.type} at ${where}`;
  if (sel.kind === 'unit') return `${UNIT_TYPES[sel.unit.type]?.name ?? sel.unit.type} at ${where}`;
  if (sel.kind === 'king') return `the King at ${where}`;
  if (sel.kind === 'cover') {
    const patch = detailAt(level, sel.q, sel.r);
    return `ground cover at ${where}${patch ? `, ${patch.density} thick` : ''}`;
  }
  const tile = tileAt(level, sel.q, sel.r);
  return tile ? `${tile.terrain} at ${where}, height ${tile.level ?? 0}` : `nothing at ${where}`;
}

// A selection cannot outlive the thing it is on: whatever was picked may have just
// been erased, or the whole level replaced. A rebuild also throws away the mesh the
// selection was holding, so that is found again rather than kept.
function refreshSelection() {
  if (selected && !stillThere(selected)) selected = null;
  if (selected && selected.kind !== 'tile' && selected.kind !== 'cover') {
    selected.object = meshFor(selected) ?? selected.object;
  }

  // The hex for a tile or a patch of ground, the ring for one object standing on
  // it. Never both: which of the two is lit is the answer to what was clicked.
  const onTile = selected && (selected.kind === 'tile' || selected.kind === 'cover');
  selection.setHexes(selected && onTile && !session ? [selected] : []);
  if (!selected || onTile || session || !selected.object) mark.hide();
  else {
    const box = new THREE.Box3().setFromObject(selected.object);
    const size = box.getSize(new THREE.Vector3());
    mark.show(
      selected.object.position.x, groundY(selected.q, selected.r), selected.object.position.z,
      Math.max(size.x, size.z) * 0.62,
    );
  }
}

// Is what was picked still on the board? Asked of the thing itself rather than of
// its hex, because the hex having something on it is not the same question - the
// tree that was selected may be gone and a rock still be standing there.
function stillThere(sel) {
  if (sel.kind === 'prop') return (level.props ?? []).includes(sel.prop);
  if (sel.kind === 'unit') return (level.units ?? []).includes(sel.unit);
  if (sel.kind === 'king') return true;
  if (sel.kind === 'cover') return !!detailAt(level, sel.q, sel.r);
  return !!tileAt(level, sel.q, sel.r);
}

// The mesh currently standing for a selection, found by the same tag the ray used.
// The terrain is rebuilt on every edit, so a held reference is stale as soon as
// anything else happens.
function meshFor(sel) {
  if (sel.kind === 'prop') {
    return propsGO?.object3D.children.find(o => o.userData.placement === sel.prop) ?? null;
  }
  const go = units.find(u => (sel.kind === 'king'
    ? u.object3D.userData.king
    : u.object3D.userData.unit === sel.unit));
  return go?.object3D ?? null;
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
  selected = null;
  // Whatever tool was in hand belonged to the board that just went away. The
  // first thing anybody does with a level they have just opened is look at it,
  // and the first click should not paint - see `disarm`.
  disarm();
  refreshSelection();
  refreshBrush();
  refreshPanel();
}

// Back to the one tool that changes nothing. It is what the editor falls back to
// whenever it cannot be sure the next click is still meant for the thing that was
// in hand: a level has just been opened, or the window was left and come back to.
// Select is the only tool with no verb, so putting it down is the whole of being
// safe, and picking the brush back up is one key.
function disarm() {
  if (activeTool === 'select') return;
  activeTool = 'select';
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
  refreshSelection();
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

// ── What is being edited, and how ────────────────────────────────────────────
// Three independent pieces of state, which is the point of the whole
// arrangement: the tool, the category, and which assets of that category are
// ticked. None of them constrains another except where a category says a tool
// makes no sense, and then the panel draws that tool disabled rather than the
// editor silently doing something else.

let activeTool = 'brush';
let activeContent = CONTENT[0].id;

// Which assets are ticked, per category. Per category rather than one shared set
// because moving between Trees and Props and back has to come back to what was
// chosen - a palette that forgets is a palette you re-tick every time.
const chosen = {};
for (const c of CONTENT) chosen[c.id] = new Set([c.assets()[0]?.id].filter(Boolean));

// And the settings, per tool - see the note above SETTINGS in tools.js for why
// they are not shared by key.
const toolSettings = defaultSettings();

// Both kinds in one list: what this browser holds, and what ships with the game.
// System levels are fetched once and kept - they are files and cannot change
// under a running page - so the library reads a variable rather than waiting on
// anything, and the first open of a session simply has none of them in it yet.
// That is a tenth of a second on a page that has already loaded the game, and it
// is the reason nothing here had to become asynchronous.
let systemLevels = [];
loadSystemLevels().then((all) => {
  systemLevels = all;
  if (library.isOpen) library.render(levelList(), level.id);
});

function levelList() {
  let mine = [];
  try { mine = storage.list(); } catch { /* an unreadable store is an empty one */ }
  return [...mine, ...systemLevels];
}

function refreshPanel() {
  panel.update({
    level,
    hex: hovered,
    tile: hovered ? tileAt(level, hovered.q, hovered.r) : null,
    selected: describeSelection(selected),
    fog: fogWanted(),
    playing: !!session,
  });
  document.getElementById('tools').classList.toggle('is-hidden', !!session);
  const state = { assets: assets(), s: toolSettings[activeTool] };
  editbar.update({
    tools: toolsFor(content()),
    tool: tool(),
    contents: CONTENT,
    content: content(),
    assets: content().assets(),
    selected: chosen[activeContent],
    // Rendered once per asset and cached as a PNG for the life of the page, so
    // this is a map lookup on every repaint but the first - see thumbnails.js.
    thumbs: thumbnails(content().assets()),
    settings: visibleSettings(tool(), content(), state),
    values: toolSettings[activeTool],
    hint: tool().hint,
    // What Select is holding, in the block where a tool's numbers would be. It is
    // the whole of "show the properties of the selection" for now: what it is and
    // where, plus the move and the delete that already work on it.
    note: activeTool === 'select'
      ? (describeSelection(selected) ?? 'Nothing picked')
      : null,
  });
  // The library is repainted out of storage rather than told what changed, so a
  // rename, a duplicate and an import all land the same way.
  if (library.isOpen) library.render(levelList(), level.id);
  if (settings.isOpen) settings.render(level);
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

const editbar = new EditBar({
  root: document.getElementById('tools'),

  onTool: (id) => {
    if (!TOOL_BY_ID[id] || !content().tools.includes(id)) return;
    activeTool = id;
    refreshBrush();
    refreshPanel();
  },

  // Changing what is being edited does not change how. That is the whole reason
  // the two are separate - you brush terrain, then brush detail over it, then
  // brush props into it, without going back to the tool row. The one exception is
  // a category the current tool means nothing to, and then the tool moves to the
  // first one that category does support rather than sitting there disabled.
  onContent: (id) => {
    if (!CONTENT_BY_ID[id]) return;
    activeContent = id;
    if (!content().tools.includes(activeTool)) activeTool = content().tools[0];
    refreshBrush();
    refreshPanel();
  },

  // Click replaces, ctrl or shift adds - and the last tick cannot be cleared,
  // because a palette holding nothing is a tool that silently does nothing.
  onAsset: (id, additive) => {
    const known = content().assets().some(a => a.id === id);
    if (!known) return;
    const held = chosen[activeContent];
    if (!additive) {
      held.clear();
      held.add(id);
    } else if (held.has(id)) {
      if (held.size > 1) held.delete(id);
    } else {
      held.add(id);
    }
    refreshBrush();
    refreshPanel();
  },

  // A nudge, clamped by whatever the setting says about itself - so the panel
  // never has to know a setting's bounds and this never has to know its name.
  onSetting: (key, by) => {
    const spec = SETTINGS[key];
    if (!spec || !tool().settings.includes(key)) return;
    const at = toolSettings[activeTool][key] ?? spec.min;
    toolSettings[activeTool][key] = Math.min(spec.max, Math.max(spec.min, at + by));
    refreshBrush();
    refreshPanel();
  },
});

const panel = new EditorPanel({
  root: document.getElementById('panel'),
  onLevels: () => { if (!session) library.open(levelList(), level.id); },
  onSettings: () => { if (!session) settings.open(level); },
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

// The level's own settings and the deck it is tested against. Every one of these
// is an edit like any other - it changes the level and ends in `commit()` - so
// there is no Save here either, and the readout in the panel follows along.
const settings = new LevelSettings({
  root: document.getElementById('settings'),
  onName: (name) => { level.name = name; commit(); refreshSettings(); },
  onLimit: (by) => { setDeckLimit(level, deckLimit(level) + by); commit(); refreshSettings(); },
  onAdd: (key) => { if (addCard(level, key)) { commit(); refreshSettings(); } },
  onRemove: (key) => { if (removeCard(level, key)) { commit(); refreshSettings(); } },
  // Empty is a choice, and a different one from never having chosen: it means the
  // King goes in alone, and Play allows it.
  onClear: () => { level.deck = []; commit(); refreshSettings(); },
});

function refreshSettings() {
  if (settings.isOpen) settings.render(level);
}

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
  // An army nobody has chosen is not an empty army. Rather than dealing something
  // it made up - or nothing, and letting the King walk into a fight alone by
  // accident - Play opens the panel where the choice is made and says so.
  if (!Array.isArray(level.deck)) {
    settings.open(level);
    say('Choose an army to test this level with.');
    return;
  }
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
    // What the run opens with. The level's deck, played through the same hand the
    // game deals - see the note in play.js.
    deck: level.deck ?? [],
    hand: document.getElementById('hand'),
    // `window.hex` is the editor's here, and the developer keys are the game
    // page's business - R and V would fight the tools for the keyboard.
    debug: false,
    // Stay exactly where the board is being looked at. Flying to the King is
    // right when a run opens and wrong when this is the fifth time in a minute.
    focus: false,
    // A line rather than a screen. Playing here is testing a board, so the
    // useful thing to know is *that* it ended and which way - the way out is the
    // Play button, which is already where the pointer is.
    onOutcome: (kind) => say(kind === 'won'
      ? 'Every enemy on this board is down.'
      : 'The King is dead - this board is lost.', kind === 'lost'),
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

  // The only thing a system level offers, and the copy is opened rather than
  // left in the list: taking one is always the first half of working on it, and
  // a level that appears somewhere behind a modal is a level you then have to go
  // and find. It goes through `storage.duplicate` like any other copy, so the new
  // one gets its own id and is in no way still the file it came from.
  onFork: act((id) => {
    const from = systemLevels.find(e => e.id === id)?.level;
    if (!from) throw new Error('that system level did not load');
    const copy = storage.duplicate(from, storage.uniqueName(from.name));
    loadLevel(storage.load(copy.id));
    library.close();
    return `Copied "${from.name}" into this browser as "${copy.name}"`;
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
    // Stored, which is now a thing the list has to be asked: a system level is a
    // file and `storage.load` has never heard of it.
    if (entry.error || entry.system) continue;
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

// Leaving the window puts the tool down. Coming back to a tab with a brush still
// armed, at whatever hex the pointer happens to be over, is one click away from a
// change nobody meant to make - and the click that returns focus to the page is
// exactly that click. Both events, because they do not cover the same thing: a
// tab switch fires `visibilitychange` and clicking another window fires `blur`.
// It is deliberately not restored afterwards; guessing what somebody wants on the
// way back in is how you end up painting on their behalf again.
for (const [target, type] of [[window, 'blur'], [document, 'visibilitychange']]) {
  target.addEventListener(type, () => { if (!session) disarm(); });
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
  if (library.isOpen || settings.isOpen) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  // 1 to 5 are the tools, in the order the row shows them. The tool is the choice
  // that changes most often - you paint terrain, sculpt it, place a lamp on it,
  // erase what went wrong - and reaching for the panel every time is the whole of
  // the friction in an editor like this one. A tool the current content has no use
  // for is ignored, the same as its button being disabled.
  const digit = e.code.match(/^Digit([1-5])$/);
  if (digit && !session) {
    const id = TOOLS[+digit[1] - 1]?.id;
    if (id && content().tools.includes(id)) {
      activeTool = id;
      refreshBrush();
      refreshPanel();
    }
    return;
  }
  if (e.code !== 'KeyP') return;
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
  get content()  { return activeContent; },
  settings: toolSettings,
  loadLevel,
  commit,
  play: start,
  stop,
  get session() { return session; },
  storage,
  panel, editbar, library,
  // The asset palette's pictures, for the check script: how many are held, how
  // many could not be drawn, and whether a preview renderer is standing.
  thumbnailStats, forgetThumbnails,
  // The level panel, under its own name: `settings` above is the tools' own.
  levelSettings: settings,
  // The editor driven the way the mouse drives it, so a board can be built from
  // the console or the check script without a drag. The three choices are three
  // calls, in the order the panel reads: what tool, what content, which assets.
  pick: (id) => {
    if (TOOL_BY_ID[id]) activeTool = id;
    refreshBrush();
    refreshPanel();
  },
  use_content: (id) => {
    if (!CONTENT_BY_ID[id]) return;
    activeContent = id;
    if (!content().tools.includes(activeTool)) activeTool = content().tools[0];
    refreshBrush();
    refreshPanel();
  },
  use_assets: (...ids) => {
    const all = content().assets().map(a => a.id);
    const want = ids.flat().filter(id => all.includes(id));
    if (want.length) chosen[activeContent] = new Set(want);
    refreshBrush();
    refreshPanel();
  },
  // Where in the hex, for the one tool that cares. Given as a fraction of the
  // tile so a script does not have to know the hex size.
  at: (q, r, dx = 0, dz = 0) => {
    aimed = false;
    hovered = { q, r };
    const { x, z } = world.grid.hexToWorld(q, r);
    spot = { x: x + dx, z: z + dz };
    refreshBrush();
    refreshPanel();
  },
  // A press, not a continuation of one: the check script and the console place one
  // thing per call, the way a click does.
  use: () => { step = 0; apply(); },
  remove: () => { removeAt(); refreshPanel(); },
  get selected() { return selected; },
  // The content categories, so a script can ask what the editor offers.
  contents: CONTENT,
  // A drag, as the mouse makes one: press, move, release. Without a pointer there
  // is no ray, so the press picks by hex - which is what `pick` falls back to.
  drag: (fromQ, fromR, toQ, toR, dx = 0, dz = 0) => {
    aimed = false;
    hovered = { q: fromQ, r: fromR };
    spot = null;
    step = 0;
    painting = true;
    apply();
    hovered = { q: toQ, r: toR };
    const { x, z } = world.grid.hexToWorld(toQ, toR);
    spot = { x: x + dx, z: z + dz };
    step++;
    if (!tool().verb) carry();
    painting = false;
    if (dragged) { dragged = false; edited(1); }
    carried = null;
    refreshPanel();
  },
  scroll: (dir) => {
    const hexes = footprint();
    if (hexes.length && content().wheel) edited(content().wheel(ctx(), hexes, dir));
  },
  // The file format, reachable from the console and from the check script, so a
  // round trip can be asserted without a download dialog in the way.
  stringifyLevel: () => stringifyLevel(level),
  parseLevel,
  lookAt: (q, r) => { const { x, z } = geometry.hexToWorld(q, r); rig.focusOn(x, z); },
};

game.start();
