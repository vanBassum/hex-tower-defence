import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { GroundPlane } from '../engine/components/ground_plane.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexRegionOutline } from '../engine/components/hex_region_outline.js';
import { HexOverlay } from '../engine/components/hex_overlay.js';
import { LEVEL_1, buildLevel } from './level.js';
import { GameState } from './game_state.js';
import { WaveSpawner } from './components/wave_spawner.js';
import { LevelDirector } from './components/level_director.js';
import { TowerPlacer } from './components/tower_placer.js';
import { PropLayer } from './components/prop_layer.js';
import { AssetCache } from '../engine/assets.js';
import { requiredModels, propTypesUsedBy } from './props.js';
import { Hud } from './components/hud.js';

const ELEVATION_STEP = 0.22;   // world height of one elevation level

// Models load before the scene is assembled - top-level await, so nothing gets
// built half-populated. A model that fails to load is reported by the cache and
// simply goes missing, rather than taking the whole scene down with it.
const level = buildLevel(LEVEL_1);
const assets = new AssetCache({ basePath: 'assets/nature/' });
await assets.load(requiredModels(propTypesUsedBy(level)));

const game  = new Game();
game.level   = level;
game.hexGrid = level.grid;
game.enemies = [];
game.pathY   = (LEVEL_1.pathLevel ?? 0) * ELEVATION_STEP;   // enemies walk on the path surface

const state = new GameState({ currency: 160, lives: 30 });
game.state = state;

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig({ dist: 30 }));
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(18, 26, 12);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4, shadowExtent: 32 }));
game.add(sun);

// Sits at the foot of the rim cliffs, dark and desaturated, so the board reads
// as a landmass standing on a plain rather than a sheet floating over grass.
const ground = new GameObject('Ground');
ground.addComponent(new GroundPlane({ size: 200, color: 0x39482c }));
game.add(ground);

// Grass tones in patches, the path as real ground a step above it, and elevation
// as actual landform - a cliff face on every drop, with the board rim carried
// down so it reads as one solid mass.
const groundGO = new GameObject('HexGround');
const hexGround = groundGO.addComponent(new HexGround(level.grid, {
  pathKeys: level.pathKeys,
  levels: level.levels,
  step: ELEVATION_STEP,
}));
game.add(groundGO);
ground.position.y = hexGround.baseY - 0.02;

// Decoration: hand-placed props plus sparse scattered ground cover, all sitting
// on whatever tile surface they are on. The path is excluded from scatter.
const propsGO = new GameObject('Props');
const propLayer = propsGO.addComponent(new PropLayer({
  grid: level.grid,
  assets,
  ground: hexGround,
  props: level.props,
  scatter: level.scatter,
  includes: (q, r) => !level.pathKeys.has(`${q},${r}`),
}));
game.add(propsGO);

// A border where the path meets the grass, sitting on the step's top edge.
const outlineGO = new GameObject('PathOutline');
const pathOutline = outlineGO.addComponent(new HexRegionOutline(level.grid, level.path, {
  color: 0x6b5836, opacity: 0.9, y: game.pathY + 0.012,
}));
game.add(outlineGO);

// Darker than the grass, so the grid reads as seams in the ground rather than
// as white lines drawn over it.
const gridGO = new GameObject('HexGrid');
gridGO.addComponent(new HexGridRenderer(level.grid, { color: 0x3f5626, opacity: 0.45 }));
game.add(gridGO);

// Spawn and base markers sit on the raised path surface. Separate layers so the
// coplanar fills do not z-fight.
const markers = new GameObject('Markers');
markers.addComponent(new HexOverlay(level.grid, [level.spawn], { color: 0xdd4444, opacity: 0.8, y: game.pathY + 0.02 }));
markers.addComponent(new HexOverlay(level.grid, [level.goal],  { color: 0x3388dd, opacity: 0.8, y: game.pathY + 0.03 }));
game.add(markers);

// The build cursor's overlay is added first so TowerPlacer.start() can find it.
const build = new GameObject('Build');
build.addComponent(new HexOverlay(level.grid, [], { color: 0x55dd66, opacity: 0.45, y: 0.05 }));
const placer = build.addComponent(new TowerPlacer({ level, state, ground: hexGround, towerType: 'gun' }));
game.add(build);

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
