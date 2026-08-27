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
import { UNIT_TYPES } from '../game/units.js';
import { defaultLevel, buildLevel, tileAt } from './level.js';
import { EditorPanel } from './ui/panel.js';

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
// This pass does one thing: it draws a small default level and lets a hex be
// selected. Everything that comes next - painting terrain, placing units, saving
// - is a change to the `level` object below and a redraw, which is why that
// object is plain JSON and nothing in the scene owns a copy of it.

const ELEVATION_STEP = 0.22;   // world height of one elevation level, as in the game

// The level being edited, and the pieces the scene reads out of it. One is data
// and the other is derived: nothing below writes to `level` yet, and when
// editing arrives it writes there and rebuilds `world`, never the other way
// round.
const level = defaultLevel();
const world = buildLevel(level);

const game = new Game();
game.hexGrid = world.grid;

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

const groundGO = new GameObject('HexGround');
const hexGround = groundGO.addComponent(new HexGround(world.grid, {
  rockKeys: world.blockedKeys,
  levels: world.levels,
  step: ELEVATION_STEP,
  ...MOOD.ground,
}));
game.add(groundGO);

const gridGO = new GameObject('HexGrid');
gridGO.addComponent(new HexGridRenderer(world.grid, { color: MOOD.gridColor, opacity: 0.14 }));
game.add(gridGO);

// What the level says is standing on the board. One loop rather than a King
// spelled out, because the next thing this file is asked to do is place a second
// one - and a unit the editor drew a special way would be a unit that looked
// wrong the moment it was placed rather than authored.
for (const u of level.units) {
  const go = new GameObject(`Unit:${u.type}`);
  go.addComponent(new Unit({
    grid: world.grid,
    ground: hexGround,
    type: u.type,
    q: u.q, r: u.r,
    colors: MOOD.units,
    // The King's torch, and the reason a lamp is named here rather than in
    // units.js: what a unit carries a light for is a fact about its type, how
    // bright it burns is a fact about the hour, and this is a place that knows
    // both. The game says the same thing in the same way.
    tuning: { lamp: u.type === 'king' ? MOOD.kingFire : MOOD.scoutLamp },
    emerge: false,
  }));
  game.add(go);
}

// The cursor under the mouse. Straight out of the game, including the two-pass
// plane solve that makes a click on a hillside land on the tile you were aiming
// at.
const cursor = new GameObject('Cursor');
cursor.addComponent(new HexOverlay(world.grid, [], {
  color: 0x8fd8e8, opacity: 0.16, y: 0.05, additive: true,
}));

// And what is selected. A separate overlay from the cursor rather than a
// recolour of it, because the two are true at the same time - the thing being
// worked on and the thing about to be clicked - and one hexagon cannot say both.
//
// Stronger than anything the game draws on a tile, and it has earned that: in
// the game a highlight is a hint about a move, and here it is the answer to
// "which tile am I editing", which has to be unmistakable from across the board.
// Still additive, so the tile keeps its own grass and simply catches much more
// light - a flat pale hexagon stuck on the ground is the thing MOOD's overlays
// exist to avoid.
const selectionGO = new GameObject('Selection');
const selectionOverlay = selectionGO.addComponent(new HexOverlay(world.grid, [], {
  color: 0xbfe8ff, opacity: 0.5, y: 0.045, additive: true,
  heightAt: (q, r) => hexGround.topY(q, r),
}));
game.add(selectionGO);

const panel = new EditorPanel({ root: document.getElementById('panel') });

// The whole of the editor's state, for now. It is one hex, and it is here rather
// than inside a component because selection is what the *editor* is doing, not
// what anything in the scene is doing - the overlay and the panel are both told.
let selected = null;

function select(hex) {
  selected = hex ? { q: hex.q, r: hex.r } : null;
  selectionOverlay.setHexes(selected ? [selected] : []);
  panel.update(level, selected, selected ? tileAt(level, selected.q, selected.r) : null);
}

cursor.addComponent(new HexPicker({
  grid: world.grid,
  ground: hexGround,
  onPick: (hex) => select(hex),
}));
game.add(cursor);

select(null);

// Open looking at the middle of the board.
{
  const { x, z } = world.grid.hexToWorld(0, 0);
  rig.focusOn(x, z);
}

// The same hook the game exposes, and for the same reason: tools/check.py drives
// the page through it, and a screenshot of a hex has to be able to ask where
// that hex is on screen. Not editor UI - the editor's UI is the panel.
window.hex = {
  game, level, world,
  grid: world.grid,
  ground: hexGround,
  rig,
  types: UNIT_TYPES,
  get selected() { return selected; },
  select,
  lookAt: (q, r) => { const { x, z } = world.grid.hexToWorld(q, r); rig.focusOn(x, z); },
};

game.start();
