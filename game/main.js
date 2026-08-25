import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { WaterPlane } from '../engine/components/water_plane.js';
import { HexWater } from '../engine/components/hex_water.js';
import { AmbientMotes } from '../engine/components/ambient_motes.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexOverlay } from '../engine/components/hex_overlay.js';
import { LEVEL_1, buildLevel } from './level.js';
import { MOOD, WIND } from './mood.js';
import { GameState } from './game_state.js';
import { WaveSpawner } from './components/wave_spawner.js';
import { LevelDirector } from './components/level_director.js';
import { TowerPlacer } from './components/tower_placer.js';
import { PropLayer } from './components/prop_layer.js';
import { Hud } from './components/hud.js';

const ELEVATION_STEP = 0.22;   // world height of one elevation level

const game  = new Game();
const level = buildLevel(LEVEL_1);
game.level   = level;
game.hexGrid = level.grid;
game.enemies = [];
game.pathY   = (LEVEL_1.pathLevel ?? 0) * ELEVATION_STEP;   // enemies walk on the path surface

const state = new GameState({ currency: 160, lives: 30 });
game.state = state;

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig({ dist: 30 }));
game.add(camera);

// The hour: blue-hour sky, blue haze in the distance, and skylight doing most of
// the lighting. Every colour below comes from mood.js, which is where the look
// is decided - see the note there about why they cannot be tuned separately.
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

// The last of the direct light, low in the sky so shadows run long across the
// board. Dim on purpose: it shapes the terrain, and the lanterns light it.
const sun = new GameObject('Sun');
sun.position.set(...MOOD.sun.position);
sun.addComponent(new DirectionalLight({
  color: MOOD.sun.color,
  intensity: MOOD.sun.intensity,
  shadowExtent: MOOD.sun.shadowExtent,
}));
game.add(sun);

// Grass tones in patches, crags as bare rock, and elevation as actual landform -
// a cliff face on every drop, with the board rim carried down so it reads as one
// solid mass.
//
// The route is deliberately not drawn, and neither are its ends. It still exists
// - enemies walk it and it is still off-limits for building - but a paved road
// with a red tile at one end and a blue tile at the other states that the level
// is a track to be defended, and that is not the direction. It is an island now,
// and an island is all grass.
const groundGO = new GameObject('HexGround');
const hexGround = groundGO.addComponent(new HexGround(level.grid, {
  rockKeys: level.blockedKeys,
  levels: level.levels,
  step: ELEVATION_STEP,
  ...MOOD.ground,
}));
game.add(groundGO);

// The sea: hex tiles on the same grid as the land, shaded by their distance from
// the coast, with a flat ocean just below them so the water has no edge. Built
// after the ground because sea level is stated relative to the land's own
// elevation units - a step below the lowest tile, so the coast is a real drop.
//
// Dark water with bright crests, and the swell is the world's one wind rather
// than a direction picked for the sea alone - so a gust crosses the water and
// the trees on the far shore answer the same gust.
const seaY = level.waterLevel * ELEVATION_STEP;
const sea = new GameObject('Sea');
sea.addComponent(new HexWater(level.grid, level.water, {
  y: seaY,
  depthColors: MOOD.water.depthColors,
  crestColor: MOOD.water.crestColor,
  swell: [
    // Amplitudes carry the shared wind strength too, so a calmer day is calmer
    // on the water and in the trees at the same time.
    { amplitude: 0.045 * WIND.strength, length: WIND.length * 0.75, angle: WIND.angle,       period: WIND.period * 1.35 },
    { amplitude: 0.028 * WIND.strength, length: WIND.length * 0.40, angle: WIND.angle - 1.7, period: WIND.period * 0.85 },
  ],
}));
// Far enough under the tiles that a trough never dips below it, which would show
// the flat ocean punching up through a moving wave.
sea.addComponent(new WaterPlane({ size: 400, y: seaY - 0.16, color: MOOD.water.oceanColor }));
game.add(sea);

// Props and scattered detail, sitting on whatever tile surface they are on, and
// leaning in the wind.
const propsGO = new GameObject('Props');
const propLayer = propsGO.addComponent(new PropLayer({
  grid: level.grid, ground: hexGround, props: [...level.props, ...level.scatter],
  colors: MOOD.props, wind: WIND,
  tuning: {
    lanternLight: MOOD.lanternLight,
    flicker: { lantern: MOOD.lanternFlickerAmount },
  },
}));
game.add(propsGO);

// Darker than the grass, so the grid reads as seams in the ground rather than
// as white lines drawn over it.
const gridGO = new GameObject('HexGrid');
gridGO.addComponent(new HexGridRenderer(level.grid, { color: MOOD.gridColor, opacity: 0.45 }));
game.add(gridGO);

// The build cursor's overlay is added first so TowerPlacer.start() can find it.
const build = new GameObject('Build');
build.addComponent(new HexOverlay(level.grid, [], { color: 0x55dd66, opacity: 0.45, y: 0.05 }));
const placer = build.addComponent(new TowerPlacer({ level, state, ground: hexGround, towerType: 'gun' }));
game.add(build);

// Fireflies over the island and glints on the water. Same component twice - what
// differs is where they live, how far they wander, and whether they light
// anything.
const motes = new GameObject('Motes');
motes.addComponent(new AmbientMotes(level.grid, [...level.grid.allHexes()], {
  // Ten, not forty, and each one carries a real light. Kept low over the grass:
  // a firefly's pool only reaches a couple of units, so one hovering at head
  // height lights nothing and is just a speck again.
  count: 8, yRange: [0.25, 1.15],
  drift: { x: 1.7, y: 0.45, z: 1.3 },
  // Slow drift and rare flares. `periods` is how long a mote takes to cross its
  // own wander, `twinkle` how long between flares, and `sharpness` how much of
  // that cycle it spends dark - so raising all three at once is what turns a
  // field of blinking dots into something you notice every few seconds.
  periods: { x: 17.0, y: 11.5, z: 21.0 },
  twinkle: [5.5, 9.5], sharpness: 3,
  size: 0.075, color: MOOD.motes.firefly,
  light: MOOD.motes.fireflyLight,
  salt: 0,
}));
motes.addComponent(new AmbientMotes(level.grid, level.water, {
  // Sitting just clear of the tallest crest, drifting almost not at all, and
  // flicking on and off faster than the pollen does: sun off moving water.
  count: 14, yRange: [seaY + 0.10, seaY + 0.13],
  drift: { x: 0.35, y: 0.02, z: 0.35 },
  twinkle: [1.6, 3.4], sharpness: 5,
  size: 0.05, color: MOOD.motes.sparkle, salt: 900,
}));
game.add(motes);

const levelGO = new GameObject('Level');
const spawner = levelGO.addComponent(new WaveSpawner({
  waves: level.waves,
  worldPath: level.worldPath,
  onLeak: (enemy) => state.registerLeak(enemy),
  onKill: (enemy) => state.registerKill(enemy),
  onBonus: (amount) => state.earn(amount),
}));
levelGO.addComponent(new LevelDirector({ state, spawner }));
levelGO.addComponent(new Hud({ state, spawner, placer }));
game.add(levelGO);

game.start();
