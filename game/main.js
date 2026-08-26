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
import { HexPicker } from '../engine/components/hex_picker.js';
import { FogOfWar } from '../engine/components/fog_of_war.js';
import { VisibilityField } from '../engine/components/visibility_field.js';
import { VisibilityMap } from '../engine/hex/visibility.js';
import { MAP_1, buildMap } from './maps.js';
import { MOOD, WIND } from './mood.js';
import { PropLayer } from './components/prop_layer.js';
import { Unit } from './components/unit.js';
import { UnitControl } from './components/unit_control.js';
import { Pickup } from './components/pickup.js';
import { Deployment } from './components/deployment.js';
import { HexRegionOutline } from '../engine/components/hex_region_outline.js';
import { CardBar } from './ui/card_bar.js';
import { DEBUG, installDebug } from './debug.js';

// The world, and the first thing that plays on it: a scout, and a map it has to
// walk to see.
//
// The tower defence layer that used to live here is gone - towers, waves, an
// economy, lives, a route across the island. What is on top of the world now is
// exploration and nothing else, because the question this milestone exists to
// answer is whether walking an unknown island is already worth doing before any
// enemy, card or turn is added to it.

const ELEVATION_STEP = 0.22;   // world height of one elevation level

const game = new Game();
const map  = buildMap(MAP_1);
game.map     = map;
game.hexGrid = map.grid;

// What is known about the board. Land and sea both: the shape of a coastline is
// worth discovering, and a sea that starts visible has already drawn the island
// for you. It is state, not drawing - FogOfWar below reads it and never writes.
const visibility = new VisibilityMap(map.grid, [...map.grid.allHexes(), ...map.water]);
game.visibility = visibility;

// The same fact, in a form a shader can read: a blurred world-space texture of
// what has been found. It goes in early because almost everything below reads it.
//
// Two very different things do. The mist reads it to know where to lie, and every
// material in the world reads it to know whether it is allowed to be seen - and
// the second of those is what actually hides the board. The mist used to do that
// job and could not: a horizontal sheet occludes nothing when the camera drops to
// its own level, so the whole unexplored half of the island was visible from a
// low angle. Fog is the mood; hex visibility is the rule.
const fieldGO = new GameObject('Visibility');
const field = fieldGO.addComponent(new VisibilityField(map.grid, visibility, {
  hexes: [...map.grid.allHexes(), ...map.water],
  hexSize: map.grid.size,
  ...MOOD.visibility,
}));
game.visibilityField = field;
game.add(fieldGO);

const camera = new GameObject('Camera');
// Closer than the old sightseeing distance: at the start almost nothing is
// revealed, so a wide shot is a wide shot of fog.
const rig = camera.addComponent(new CameraRig({ dist: 21 }));
game.add(camera);

// The hour: blue-hour sky, blue haze in the distance, and skylight doing most of
// the lighting. Every colour comes from mood.js, which is where the look is
// decided - see the note there about why they cannot be tuned separately.
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
// a cliff face on every drop, with the board rim carried down so the island reads
// as one solid mass rather than a sheet of tiles.
const groundGO = new GameObject('HexGround');
const hexGround = groundGO.addComponent(new HexGround(map.grid, {
  rockKeys: map.blockedKeys,
  levels: map.levels,
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
const seaY = map.waterLevel * ELEVATION_STEP;
const sea = new GameObject('Sea');
sea.addComponent(new HexWater(map.grid, map.water, {
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
propsGO.addComponent(new PropLayer({
  grid: map.grid, ground: hexGround, props: [...map.props, ...map.scatter],
  colors: MOOD.props, wind: WIND,
  // Lamps are lit when their tile is found rather than burning from the first
  // frame - the board answering the player, and the reason an undiscovered
  // lantern no longer lights the inside of the cloud standing over it.
  visibility,
  tuning: {
    lanternLight: MOOD.lanternLight,
    flicker: { lantern: MOOD.lanternFlickerAmount },
  },
}));
game.add(propsGO);

// Darker than the grass, so the grid reads as seams in the ground rather than as
// white lines drawn over it.
const gridGO = new GameObject('HexGrid');
gridGO.addComponent(new HexGridRenderer(map.grid, { color: MOOD.gridColor, opacity: 0.45 }));
game.add(gridGO);

// The unknown, lying over the board as one continuous bank of mist. It goes on
// after the terrain because it drapes itself over the tile heights the terrain
// settled, and it is a layer over that terrain rather than a change to it - the
// ground mesh is built once and never rebuilt however much of it gets found.
//
// It reads the VisibilityMap and never writes to it. Gameplay still knows
// exactly which hexes are unexplored, explored and visible; the mist is only how
// that is drawn, and the two meet at one blurred texture.
//
// Water is fogged along with the land. Working out where the coast runs is part
// of learning the island, and a sea drawn in full has already told you.
const fogGO = new GameObject('Fog');
const fog = fogGO.addComponent(new FogOfWar(map.grid, visibility, {
  field,
  hexes: [...map.grid.allHexes(), ...map.water],
  // Sea level is nudged up past the tallest crest the swell can raise, because
  // the surface an explored water tile is capped at is a surface that moves - and
  // a cap sitting exactly at rest height spends half of every wave underwater.
  surfaceY: (q, r) => (map.grid.inBounds(q, r) ? hexGround.topY(q, r) : seaY + 0.09),
  hexSize: map.grid.size,
  // The bank drifts on the level's one breeze, for the reason the swell and the
  // sway share theirs: three effects with private weather look like three
  // effects, and one direction reads as a day with a wind on it. It sets which
  // way the cloud field flows as well as which way the wisps lean.
  drift: { angle: WIND.angle, amount: 0.05 * WIND.strength, period: WIND.period * 3.5 },
  flow: WIND.strength,
  ...MOOD.fogOfWar,
}));
game.add(fogGO);

// The Scout. One unit, one stat, and the whole of this milestone: move, and see
// further than you did from the last hex.
const scoutGO = new GameObject('Scout');
const scout = scoutGO.addComponent(new Unit({
  grid: map.grid,
  ground: hexGround,
  type: 'scout',
  q: DEBUG.scoutStart.q, r: DEBUG.scoutStart.r,
  viewDistance: DEBUG.scoutViewDistance,
  colors: MOOD.units,
  tuning: { lamp: MOOD.scoutLamp },
}));
game.add(scoutGO);

// The camp: the ground a card may be played onto, and the only place on the
// board that belongs to the player before they have walked anywhere.
//
// It is drawn twice, because it answers two questions that are not asked at the
// same time. The rim is always there and says *where home is*; it is a line on
// the ground, which is exactly the kind of thing this board refuses to use as a
// highlight - but a boundary is what a line is *for*, and it is dim enough to
// read as a mark on the grass rather than as a shape laid over it. The three
// stakes standing outside it in the prop list are the other half of that: a rim
// vanishes when the camera drops to look along it, and something with height
// does not.
const campGO = new GameObject('Camp');
campGO.addComponent(new HexRegionOutline(map.grid, map.deployment, {
  color: MOOD.camp.rimColor,
  opacity: MOOD.camp.rimOpacity,
  y: 0.02,
  heightAt: (q, r) => hexGround.topY(q, r),
}));
game.add(campGO);

// What is out there to be found. One cache of somebody's colours on the small
// hill east of the start, and the first thing on this board that is neither
// terrain nor the player: walk onto it and the Footmen it belonged to join the
// force.
//
// It gets its own GameObject each rather than a layer, which is the opposite of
// what the props do and for the opposite reason - there are four hundred props
// and none of them is ever asked a question, while a pickup is a thing the game
// reasons about.
const pickupGOs = [];
const pickups = [];
for (const p of map.pickups) {
  const go = new GameObject(`Pickup:${p.type}`);
  pickups.push(go.addComponent(new Pickup({
    grid: map.grid,
    ground: hexGround,
    // Found before lit, the same as a lantern - and for the harder of the two
    // reasons: an undiscovered light burns the inside of the cloud above it.
    visibility,
    type: p.type, q: p.q, r: p.r,
    colors: MOOD.pickups,
    tuning: { light: MOOD.pickupLight },
    // The banner streams downwind, on the level's one breeze.
    wind: WIND,
  })));
  game.add(go);
  pickupGOs.push(go);
}

// How a card becomes a unit standing on the board. It is one function because
// there are two callers that must not drift apart: the pickup that grants a
// unit, and the debug console that spawns one to check a claim with. Whatever
// deployment eventually looks like - a screen, a hand of cards, a starting
// roster - it ends in this call.
function deploy(type, q, r) {
  const go = new GameObject(type);
  const unit = go.addComponent(new Unit({
    grid: map.grid, ground: hexGround, type, q, r,
    colors: MOOD.units, tuning: { lamp: MOOD.scoutLamp },
    // Scaled up rather than switched on: this one was not here a moment ago.
    emerge: true,
  }));
  game.add(go);
  // Built after the sweep at the bottom of this file, so it patches itself in.
  field.patch(go.object3D);
  return unit;
}

// Who the player owns, what is picked up, and what the force can see - one
// component, because vision is the union over that same roster and splitting the
// two would leave two lists to keep in step.
//
// One overlay, and it is a *brightening* rather than a wash: additive blending
// at low strength, so a hex on the previewed route reads as catching a little
// more light instead of having a pale hexagon painted on it.
//
// The wash over everywhere-you-could-walk is gone entirely. Filling tiles with
// flat translucent white is the cheapest possible way to say something about a
// hex and it looked exactly that cheap - a sticker on the board, fighting the
// crisp tile edges that are the best thing about the terrain. The board is meant
// to stay sharp and the fog is meant to be the soft thing; a hex-shaped smear of
// white had it the wrong way round. Whatever replaces it for reachability should
// come from the *tile* - its own brightness, a rim, a lift - or from the unit,
// not from a decal laid over the top.
const forceGO = new GameObject('Force');
const pathOverlay = forceGO.addComponent(new HexOverlay(map.grid, [], {
  color: 0x9fd8ee, opacity: 0.13, y: 0.03, additive: true,
  heightAt: (q, r) => hexGround.topY(q, r),
}));
const control = forceGO.addComponent(new UnitControl({
  grid: map.grid,
  ground: hexGround,
  visibility,
  units: [scout],
  // Collecting is the join between the roster and the board, and this is the one
  // component that holds both halves of it.
  pickups,
  pathOverlay,
}));

// Where a card may be played, lit up only while one is armed. It is the route
// preview's treatment at a slightly higher strength - additive, so a tile catches
// more light rather than having a hexagon painted on it - and it is off the rest
// of the time, because "where may this go" is not a question anybody is asking
// until they are holding something.
const placeOverlay = forceGO.addComponent(new HexOverlay(map.grid, [], {
  color: MOOD.camp.placeColor, opacity: MOOD.camp.placeOpacity, y: 0.04, additive: true,
  heightAt: (q, r) => hexGround.topY(q, r),
}));

// The hand along the bottom of the screen. The only piece of the game that is
// not the world, and it holds no state: it is handed the deployment and paints
// what it finds, so there is one account of what the player has.
const cardBar = new CardBar({
  root: document.getElementById('hand'),
  onArm: (entry) => deployment.arm(entry),
});

// The hand, and the ground it can be played onto. It goes on the same GameObject
// as the force because it *is* the force - the part of it not standing on the
// board yet.
const deployment = forceGO.addComponent(new Deployment({
  grid: map.grid,
  visibility,
  control,
  deploy,
  zone: map.deployment,
  overlay: placeOverlay,
  onChange: () => cardBar.update(deployment),
}));

// The two wires between the force and the camp, tied here rather than inside
// either of them: what a pickup grants becomes a card, and picking a unit off
// the board puts an armed card back down. Neither component has to know the
// other exists in order to say so, which is the only reason the pickup does not
// have to be taught what a card is.
control.onGrant = (grants) => { if (grants.card) deployment.addCard(grants.card); };
control.onSelect = () => deployment.cancel();

game.add(forceGO);


// A cursor on the hex under the mouse, and now three things asking what the mouse
// means. The picker still knows nothing about any of them: it reports a hex and
// the force decides whether that is a unit, a destination, or a change of mind.
// The overlay goes on first so HexPicker.start() can find it.
const cursor = new GameObject('Cursor');
// The cursor gets the same treatment: a lift, not a fill.
cursor.addComponent(new HexOverlay(map.grid, [], {
  color: 0x8fd8e8, opacity: 0.16, y: 0.05, additive: true,
}));
// The camp gets first refusal on every click and the force gets what is left.
// That order is the mode: while a card is armed the left button is placing it
// and nothing else, and the moment it is not armed the picker's callbacks reach
// the force unchanged. The picker itself still knows about none of this - it
// reports a hex, and what a hex means is decided here.
cursor.addComponent(new HexPicker({
  grid: map.grid,
  ground: hexGround,
  onHover: (hex) => { deployment.handleHover(hex); control.handleHover(hex); },
  onPick:  (hex) => { if (!deployment.handlePick(hex)) control.handlePick(hex); },
  onOrder: (hex) => { if (!deployment.handleOrder(hex)) control.handleOrder(hex); },
}));
game.add(cursor);

// Open looking at the Scout rather than at the middle of a board that is almost
// entirely hidden.
{
  const { x, z } = map.grid.hexToWorld(scout.q, scout.r);
  rig.focusOn(x, z);
}

// Fireflies over the island and glints on the water. Same component twice - what
// differs is where they live, how far they wander, and whether they light
// anything.
const motes = new GameObject('Motes');
motes.addComponent(new AmbientMotes(map.grid, [...map.grid.allHexes()], {
  // Eight, not forty, and each one carries a real light. Kept low over the grass:
  // a firefly's pool only reaches a couple of units, so one hovering at head
  // height lights nothing and is a speck again.
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
motes.addComponent(new AmbientMotes(map.grid, map.water, {
  // Sitting just clear of the tallest crest, drifting almost not at all, and
  // flicking on and off faster than the fireflies do: sun off moving water.
  count: 14, yRange: [seaY + 0.10, seaY + 0.13],
  drift: { x: 0.35, y: 0.02, z: 0.35 },
  twinkle: [1.6, 3.4], sharpness: 5,
  size: 0.05, color: MOOD.motes.sparkle, salt: 900,
}));
game.add(motes);

// And now the part that does the hiding. Every material in these layers learns to
// paint itself out on ground nobody has found and to dim itself on ground nobody
// is watching, straight off the field's texture.
//
// One call per layer rather than a `visibility` argument threaded through eight
// constructors, because whether a thing obeys fog of war is a fact about the
// *scene*, not about the thing. A tree, a wave crest, a grid seam and a unit all
// want identical behaviour, and the next component to be added should get it
// without having to remember to ask.
//
// The fog is deliberately not in this list: it is the one thing in the scene that
// is *about* the unknown rather than subject to it.
for (const go of [groundGO, sea, propsGO, gridGO, campGO, scoutGO, motes, ...pickupGOs]) field.patch(go.object3D);

// Developer knobs: F hides the fog, V rings what the force is lighting up, R
// reveals the board, and `window.hex` has the rest. Not game UI on purpose - how
// far a scout sees is a number that has to be tried, not a feature.
installDebug({
  game, grid: map.grid, ground: hexGround, rig, fog, field, control, visibility,
  pickups, deployment,
  // How a unit gets built, handed over rather than rebuilt in the debug module -
  // it is the same call a collected pickup goes through.
  spawn: deploy,
});

game.start();
