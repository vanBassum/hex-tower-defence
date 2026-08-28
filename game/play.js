import * as THREE from 'three';
import { GameObject } from '../engine/gameobject.js';
import { WaterPlane } from '../engine/components/water_plane.js';
import { HexWater } from '../engine/components/hex_water.js';
import { AmbientMotes } from '../engine/components/ambient_motes.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { HexGround } from '../engine/components/hex_ground.js';
import { HexCorners } from '../engine/components/hex_corners.js';
import { HexRoute } from '../engine/components/hex_route.js';
import { HexPicker } from '../engine/components/hex_picker.js';
import { VisibilityMask } from '../engine/components/visibility_mask.js';
import { VisibilityMap } from '../engine/hex/visibility.js';
import { MOOD, WIND } from './mood.js';
import { PropLayer } from './components/prop_layer.js';
import { Unit } from './components/unit.js';
import { UNIT_TYPES } from './units.js';
import { UnitControl } from './components/unit_control.js';
import { Pickup } from './components/pickup.js';
import { Deployment } from './components/deployment.js';
import { EnemyForce } from './components/enemy_force.js';
import { Battle } from './components/battle.js';
import { ActionLoop, makeStatus } from './components/action_loop.js';
import { CARD_TYPES } from './cards.js';
import { CardBar } from './ui/card_bar.js';
import { DEBUG, installDebug } from './debug.js';

// The game, as something that can be started.
//
// Everything that plays on a board is in here: the ground, the sea, the props,
// the fog, both sides, the hand of cards, the fight between them, and the mouse
// that gives orders. What is *not* in here is the world it plays inside - the
// renderer, the camera, the hour - because those outlive any one level. The
// caller owns them and hands them over.
//
// It exists as a function rather than a module that runs on import for one
// reason: the editor plays a level in the same page it edits it in. That needs
// the game to be startable twice and stoppable in between, which a top-level
// script cannot be. The alternative was a second, simpler simulation living in
// the editor - which is the thing this file exists to make unnecessary. There is
// one game, and both pages call it.
//
// Every GameObject it adds is remembered, so `teardown()` can take the whole of
// it back out and leave the page as it found it: the board goes, the units go,
// the fog goes, the hand empties. Nothing here writes to storage, which is why a
// playtest cannot touch the level it came from.
//
// ── What the caller passes ──────────────────────────────────────────────────
//   game      the running Game - already started, or about to be
//   map       a built map, out of buildMap
//   rig       the camera to look through
//   fog       false to play with the whole board visible - see the note below
//   deck      the cards the run opens with, as card keys - a list rather than a
//             table of counts, because two Footmen cards are two bodies
//   hand      the element the card bar draws into
//   debug     whether to install `window.hex` and the developer keys
//   focus     whether to point the camera at the King on the way in
//   onReady   called once the first real frame has been drawn
//   tactical  one action at a time instead of real time - see action_loop.js.
//             False gives back the real-time game exactly as it was, which is
//             the seam the experiment is meant to be removable along.
//
// ── The tower defence layer that used to live here ──────────────────────────
// Towers, waves, an economy, lives, a route across the island: all gone. What is
// on top of the world now is exploration and a fight, because the question this
// milestone exists to answer is whether walking an unknown island is already
// worth doing before any of that is added back.

const ELEVATION_STEP = 0.22;   // world height of one elevation level

export function startPlay({
  game,
  map,
  rig,
  fog = true,
  deck = DEBUG.startingHand,
  hand = null,
  debug = true,
  focus = true,
  onReady = null,
  tactical = true,
} = {}) {
  // Everything that went into the scene, in the order it went in, so it can all
  // come back out. `add` is the only way anything gets added below.
  const added = [];
  const add = (go) => { added.push(go); return game.add(go); };
  // Boot timings when the page is keeping them, and a scratch object when it is
  // not - the editor starts this a dozen times a session and has no interest.
  const boot = window.__boot ?? {};
  // Where the run begins. The level says, or the debug knob does for the
  // hand-authored map, which has never had to.
  const start = map.king ?? DEBUG.kingStart;

  game.map     = map;
  game.hexGrid = map.grid;

  // What is known about the board. Land and sea both: the shape of a coastline is
  // worth discovering, and a sea that starts visible has already drawn the island
  // for you. It is state, not drawing - VisibilityMask below reads it and never
  // writes.
  const visibility = new VisibilityMap(map.grid, [...map.grid.allHexes(), ...map.water]);
  game.visibility = visibility;

  // And the drawing of it, such as it is: a tile the force is looking at renders
  // normally and every other tile goes out. It goes in early because the sweep at
  // the bottom of this file hands it every layer in the scene.
  //
  // Deliberately the plainest thing that can be built on the visibility state -
  // hard hex edges, one colour, no reveal - so that whatever the unknown ends up
  // looking like is a decision taken against something honest rather than against
  // a bank of mist that was already hiding the answer.
  const maskGO = new GameObject('Visibility');
  const mask = fog ? maskGO.addComponent(new VisibilityMask(map.grid, visibility, {
    hexes: [...map.grid.allHexes(), ...map.water],
    hexSize: map.grid.size,
    // The air in the dark drifts on the level's one breeze, for the reason the
    // swell and the sway share theirs: three effects with private weather look
    // like three effects, and one direction reads as a night with a wind on it.
    drift: { angle: WIND.angle, flow: WIND.strength },
    ...MOOD.hidden,
  })) : null;
  game.visibilityMask = mask;
  add(maskGO);

  // What the layers below are told about discovery. Null is how a lantern, a
  // pickup and a prop each say "always lit", so with the fog off they simply are.
  const found = fog ? visibility : null;

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
  add(groundGO);

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
  add(sea);

  // Props and scattered detail, sitting on whatever tile surface they are on, and
  // leaning in the wind.
  const propsGO = new GameObject('Props');
  propsGO.addComponent(new PropLayer({
    grid: map.grid, ground: hexGround, props: [...map.props, ...map.scatter],
    colors: MOOD.props, wind: WIND,
    // Lamps are lit when their tile is found rather than burning from the first
    // frame - the board answering the player, and the reason an undiscovered
    // lantern no longer lights the inside of the cloud standing over it.
    visibility: found,
    tuning: {
      lanternLight: MOOD.lanternLight,
      flicker: { lantern: MOOD.lanternFlickerAmount },
    },
  }));
  add(propsGO);

  // Darker than the grass, so the grid reads as seams in the ground rather than as
  // white lines drawn over it - but only just. At 0.45 it stopped reading as seams
  // and started reading as cracks between the tiles, which is a hole in a landmass
  // that is meant to be one piece. It is also drawn at one height for the whole
  // board, so it only ever shows on the lowest tiles anyway; faint is the honest
  // version of that. Zero here removes it entirely and nothing else notices.
  const gridGO = new GameObject('HexGrid');
  gridGO.addComponent(new HexGridRenderer(map.grid, { color: MOOD.gridColor, opacity: 0.14 }));
  add(gridGO);

  // What a unit carries a light for is a fact about its type; how bright it burns
  // is a fact about the hour. The two halves meet here, which is the only place
  // that already knows both.
  const LAMPS = { scout: MOOD.scoutLamp, king: MOOD.kingFire };

  // And the lamps themselves, alight from before the first frame is drawn. This is
  // the single worst piece of three.js behaviour the game has met: the number of
  // point lights in the scene is part of the *identity* of every shader program it
  // compiles, so the moment a Scout is deployed and its lamp joins the scene, every
  // material on the board is recompiled - which was a two second freeze on the
  // frame a card was played, and it looked like the deployment was broken.
  //
  // So the lights exist up front and are only ever *reparented* - onto the unit
  // that borrows one, back to here when it dies. Which parent a light has costs
  // nothing; how many there are is what three cares about. Running the pool dry
  // only means the old behaviour comes back for that one unit, so it is sized well
  // past any hand the game deals.
  const lampsGO = new GameObject('Lamps');
  const lampPool = [];
  for (let i = 0; i < 10; i++) {
    const light = new THREE.PointLight(0xffffff, 0);
    lampsGO.object3D.add(light);
    lampPool.push(light);
  }
  add(lampsGO);

  // The King, and the only thing the game puts on the board itself. Everything
  // else is a card played onto a tile beside him - including the Scout the run is
  // dealt - so something has to be standing there before the first card can be.
  const kingGO = new GameObject('King');
  const king = kingGO.addComponent(new Unit({
    grid: map.grid,
    ground: hexGround,
    type: 'king',
    q: start.q, r: start.r,
    colors: MOOD.units,
    tuning: { lamp: LAMPS.king },
  }));
  add(kingGO);

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
      visibility: found,
      type: p.type, q: p.q, r: p.r,
      colors: MOOD.pickups,
      tuning: { light: MOOD.pickupLight },
      // The banner streams downwind, on the level's one breeze.
      wind: WIND,
    })));
    add(go);
    pickupGOs.push(go);
  }

  // How a card becomes a unit standing on the board. It is one function because
  // there are two callers that must not drift apart: the pickup that grants a
  // unit, and the debug console that spawns one to check a claim with. Whatever
  // deployment eventually looks like - a screen, a hand of cards, a starting
  // roster - it ends in this call.
  function deploy(type, q, r, { emerge = true } = {}) {
    const go = new GameObject(type);
    // A lamp is borrowed rather than made - see the pool above. Handed over here
    // rather than looked up in units.js, because which lights are already in the
    // scene is a fact about the scene.
    const lampLight = UNIT_TYPES[type]?.lamp ? lampPool.pop() ?? null : null;
    const unit = go.addComponent(new Unit({
      grid: map.grid, ground: hexGround, type, q, r,
      viewDistance: type === 'scout' ? DEBUG.scoutViewDistance : null,
      colors: MOOD.units, tuning: { lamp: LAMPS[type], lampLight },
      // Scaled up rather than switched on, for anything that was not here a moment
      // ago. What the level stands on the board at setup was always there.
      emerge,
    }));
    add(go);
    // Handed back before the unit is torn down, so the scene keeps the same number
    // of lights it has had since the first frame.
    if (lampLight) {
      unit.onDied(() => {
        lampLight.intensity = 0;
        lampsGO.object3D.add(lampLight);
        lampPool.push(lampLight);
      });
    }
    // Built after the sweep at the bottom of this file, so it patches itself in -
    // culled rather than dimmed, because a unit is the one thing on the board that
    // is nothing but information.
    mask?.patch(go.object3D, { cull: true });
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
  // And - only while one action at a time is the game - where the group that is
  // picked up may get to on this one. Corner brackets rather than lit tiles: it
  // is up to two dozen hexes at once, and twenty filled hexagons is a region
  // painted over the board where what is meant is twenty separate tiles you
  // could stand on. It goes on before the route so the line reads as the bright
  // thread through the field.
  const reachOverlay = tactical ? forceGO.addComponent(new HexCorners(map.grid, [], {
    color: MOOD.interact.color, opacity: MOOD.interact.field, y: 0.02,
    heightAt: (q, r) => hexGround.topY(q, r),
  })) : null;
  const pathOverlay = forceGO.addComponent(new HexRoute(map.grid, [], {
    color: MOOD.interact.color, opacity: MOOD.interact.route, y: 0.03,
    heightAt: (q, r) => hexGround.topY(q, r),
  }));
  const control = forceGO.addComponent(new UnitControl({
    grid: map.grid,
    ground: hexGround,
    visibility,
    units: [king],
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
  //
  // It is the *only* drawing of the deployment zone now. There was a rim around a
  // fixed camp as well, always on, saying where home was; a zone that follows the
  // Scout has no home to point at, and a ring drawn permanently around a unit that
  // already has a lamp and a selection ring is the third thing competing to
  // describe the same tile.
  const placeOverlay = forceGO.addComponent(new HexCorners(map.grid, [], {
    color: MOOD.interact.color, opacity: MOOD.interact.zone, y: 0.04,
    heightAt: (q, r) => hexGround.topY(q, r),
  }));

  // The hand along the bottom of the screen. The only piece of the game that is
  // not the world, and it holds no state: it is handed the deployment and paints
  // what it finds, so there is one account of what the player has.
  const cardBar = new CardBar({
    root: hand,
    onArm: (entry) => deployment.arm(entry),
  });

  // The hand, and the ground it can be played onto. It goes on the same GameObject
  // as the force because it *is* the force - the part of it not standing on the
  // board yet - and it reads the roster to know where the board will accept it.
  const deployment = forceGO.addComponent(new Deployment({
    grid: map.grid,
    visibility,
    control,
    deploy,
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

  add(forceGO);

  // The King's own card, spent before the run starts, because he is standing there
  // before it starts. It is the only card in the bar that was never in a hand: it
  // exists so the one unit that cannot be replaced has the same readout as every
  // unit that can.
  deployment.addPlacedCard('king', king);

  // And whatever else the run opens with. On the game page that is nothing -
  // every card the player gets is one they find - and from the editor it is the
  // deck the level is being tested against. When a run can be lost this is where
  // a collection is spent instead, and it is still this call.
  for (const card of deck) deployment.addCard(card);


  // The other side. It goes on after the force because it watches it, and its
  // units are built through the same call the player's are - a unit is a unit, and
  // what makes one an enemy is a field on its type rather than a different way of
  // getting onto the board.
  const enemyGO = new GameObject('Enemies');
  const enemies = enemyGO.addComponent(new EnemyForce({ grid: map.grid, control }));
  add(enemyGO);

  // Everybody the level puts on the board, sorted by the only thing that says which
  // side they are on: `hostile` on their type. A level that stands friendly units
  // on the board - which is every level out of the editor, and none of the authored
  // ones - hands them to the roster the same way a played card does, and they get a
  // card apiece so the bar reads the whole force rather than only the King.
  for (const u of map.units) {
    const unit = deploy(u.type, u.q, u.r, { emerge: false });
    if (UNIT_TYPES[u.type]?.hostile) enemies.add(unit);
    else {
      control.add(unit);
      if (CARD_TYPES[u.type]) deployment.addPlacedCard(u.type, unit);
    }
  }

  // And what happens when the two of them end up next to each other. It is handed
  // both rosters and neither of them is told: a side is anything with a `units`
  // array, so the day there is a third one it is one more entry here.
  const battleGO = new GameObject('Battle');
  // Blows land only while the board is resolving an action. With no loop that is
  // always, which is the real-time game.
  battleGO.addComponent(new Battle({
    grid: map.grid, sides: [control, enemies],
    active: () => loop == null || busy(),
  }));
  add(battleGO);

  // And - the experiment - the thing that decides when either side may act at
  // all. It goes on last of the three because it drives the other two: it takes
  // EnemyForce off automatic and hands it one decision per player action, and it
  // waits on Battle rather than replacing it, so a fight still looks like a
  // fight. See action_loop.js; `tactical: false` removes the whole of it.
  const loopGO = new GameObject('Actions');
  const loop = tactical ? loopGO.addComponent(new ActionLoop({
    grid: map.grid, control, enemies, visibility,
    overlay: reachOverlay, status: makeStatus(),
  })) : null;
  if (tactical) add(loopGO);

  // The one question every input path asks. Not a flag kept here: while the
  // board is finishing what was asked of it there is exactly one authority on
  // whether it will take another order, and it is the loop.
  const busy = () => loop != null && !loop.canCommand();

  // A cursor on the hex under the mouse, and now three things asking what the mouse
  // means. The picker still knows nothing about any of them: it reports a hex and
  // the force decides whether that is a unit, a destination, or a change of mind.
  // The overlay goes on first so HexPicker.start() can find it.
  const cursor = new GameObject('Cursor');
  // The tile under the pointer, and the brightest of the four: it is one hex and
  // it is the one the click will land on. HexPicker finds it by instanceof and
  // never learns it is drawn as a bracket rather than a fill.
  cursor.addComponent(new HexCorners(map.grid, [], {
    color: MOOD.interact.color, opacity: MOOD.interact.cursor, y: 0.05,
    // Heavier than the field's, because it has to be found among two dozen of
    // them. The same six ticks, drawn as though pressed harder.
    arm: 0.28, width: 0.075,
  }));
  // The camp gets first refusal on every click and the force gets what is left.
  // That order is the mode: while a card is armed the left button is placing it
  // and nothing else, and the moment it is not armed the picker's callbacks reach
  // the force unchanged. The picker itself still knows about none of this - it
  // reports a hex, and what a hex means is decided here.
  cursor.addComponent(new HexPicker({
    grid: map.grid,
    ground: hexGround,
    color: MOOD.interact.color,
    // The route preview is only drawn while an order could actually be given.
    // The selection survives a move, so without this the group would go on
    // offering routes it is in no position to walk.
    onHover: (hex) => { deployment.handleHover(hex); if (!busy()) control.handleHover(hex); },
    // A hex the selection can reach is a destination, and everything else the
    // left button always meant - pick a group up, or put it down. The order
    // matters: the card gets first refusal, then the move, then selection, so
    // clicking the tile you are already going to does not also deselect.
    onPick:  (hex) => {
      if (busy()) return;
      if (deployment.handlePick(hex)) return;
      if (loop?.handlePick(hex)) return;
      control.handlePick(hex);
    },
    // A right *drag* is the camera's rotate and a right *press* is the order, and
    // the rig is the one that knows which just happened - so an order that arrives
    // at the end of a drag is thrown away here rather than in either component.
    onOrder: (hex) => {
      if (rig.consumedRightPress) return;
      if (busy()) return;
      if (deployment.handleOrder(hex)) return;
      // Through the loop when there is one, so the right button commits an
      // action rather than going round the back of it.
      if (loop) loop.handleOrder(hex);
      else control.handleOrder(hex);
    },
  }));
  add(cursor);

  // Open looking at the King rather than at the middle of a board that is almost
  // entirely hidden. He is where the run starts from in every sense that matters.
  if (focus) {
    const { x, z } = map.grid.hexToWorld(king.q, king.r);
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
  add(motes);

  // And now the part that does the hiding. Every material in these layers learns
  // to go out on a hex nobody is watching, straight off the mask's table.
  //
  // One call per layer rather than a `visibility` argument threaded through eight
  // constructors, because whether a thing obeys fog of war is a fact about the
  // *scene*, not about the thing. A tree, a wave crest, a grid seam and a unit all
  // want identical behaviour, and the next component to be added should get it
  // without having to remember to ask.
  //
  // The two lists are the two kinds of thing on the board, and which list a layer
  // is in is a rule rather than a look. The land is dimmed to almost nothing and
  // left there, so the island still reads as continuing into the dark. Everything
  // standing on it is *information* - a unit, an enemy, a prop, a pickup - and
  // information is not dimmed, it is discarded: on an unwatched hex there is
  // nothing on screen to read at all.
  for (const go of [groundGO, sea]) mask?.patch(go.object3D);
  for (const go of [propsGO, gridGO, kingGO, motes, ...pickupGOs]) mask?.patch(go.object3D, { cull: true });

  // Developer knobs: V rings what the force is lighting up, R
  // reveals the board, and `window.hex` has the rest. Not game UI on purpose - how
  // far a scout sees is a number that has to be tried, not a feature.
  if (debug) installDebug({
    game, grid: map.grid, ground: hexGround, rig, mask, control, visibility,
    pickups, deployment, enemies, loop,
    // How a unit gets built, handed over rather than rebuilt in the debug module -
    // it is the same call a collected pickup goes through.
    spawn: deploy,
  });


  // ── Shader warm-up ──────────────────────────────────────────────────────────
  // A material's shader program is built - and, worse, compiled by the driver the
  // first time it actually shades a pixel - and a unit arriving mid-run brings
  // seven of them with it. That landed on the exact frame the card was played:
  // about a second on a software renderer, two on a real one, and it was the
  // loudest thing in the game.
  //
  // So one of every type that could be put on the board is built here on the first
  // frame, patched exactly as a real one is, and *drawn* once. After that a card
  // lands in a couple of milliseconds.
  //
  // The draw is the part that matters, and it took three wrong turns to learn it.
  // three's `compile()` looks like the tool for this and is not: it silently skips
  // anything invisible, and a program it does build still stalls the frame that
  // first uses it. Drawing the scrap off the side of the world does not work
  // either - the draw call is issued, every vertex clips, no pixel is shaded and
  // the driver has done none of the work. It has to be drawn where it can be seen.
  //
  // Which is why the frame is thrown away instead: the scrap is put in front of the
  // camera, one render is taken and dropped, and the scrap comes straight back out
  // again - all inside a single tick, so the browser only ever composites the clean
  // frame that follows. `type.build` makes meshes and touches nothing else - no
  // grid, no occupancy, no roster - which is what makes that safe to do behind the
  // game's back.
  //
  // The overlays are the other half of the same bug: they start with no hexes in
  // them, so nothing draws them until the frame a card is armed. A hex apiece for
  // the same throwaway frame does for them what the scrap units do for themselves.
  function warmShaders() {
    const at = map.grid.hexToWorld(start.q, start.r);
    const scrap = Object.values(UNIT_TYPES).map((type) => {
      const mesh = type.build(MOOD.units, { lamp: LAMPS[type.key], hexSize: map.grid.size });
      mask?.patch(mesh, { cull: true });
      // Where the camera is already looking, and clear of the ground, so its
      // fragments are really shaded rather than sorted away behind the terrain.
      mesh.position.set(at.x, hexGround.topY(start.q, start.r) + 1.2, at.z);
      game.scene.add(mesh);
      return mesh;
    });
    const overlays = [pathOverlay, placeOverlay, reachOverlay].filter(Boolean);
    // Two hexes rather than one, because a route of a single tile has no run in
    // it and would draw nothing - which is exactly the material this frame
    // exists to compile. The neighbour is taken off the grid so it is a tile
    // that really exists and `topY` has an answer for it.
    const next = [...map.grid.neighbors(start.q, start.r)][0] ?? start;
    for (const o of overlays) o.setHexes([{ q: start.q, r: start.r }, next]);

    boot.beforeWarm = performance.now();
    game.renderer.render(game.scene, game.camera);
    boot.afterWarm = performance.now();

    // The scrap geometry goes; the *materials* stay, because three counts a
    // program's users by material and disposing them would release every program
    // this exists to build.
    for (const mesh of scrap) {
      game.scene.remove(mesh);
      mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    for (const o of overlays) o.setHexes([]);

    // And the loading message goes with the last of the waiting. It is taken away
    // here rather than when the module finishes, because the frame above is the
    // slow one - a message that leaves before the freeze it exists to cover is
    // worse than no message at all. The clean frame paints immediately after this
    // returns, which is what the fade is timed against.
    onReady?.();
  }

  // On the first tick rather than from here: the camera is wired by
  // CameraRig.start(), which runs inside that tick, and there is nothing to draw
  // with until there is one. One shot - it takes the hook back off itself.
  game.onTick = () => {
    game.onTick = null;
    boot.firstTick = performance.now();
    warmShaders();
    requestAnimationFrame(() => { boot.firstClean = performance.now(); });
  };

  // Taking it all out again, in the one call the editor needs to get its board
  // back. Removing a GameObject destroys its components, which is what releases
  // the grid's occupancy, the geometry, and every listener the picker put on the
  // page - so there is nothing here that has to be remembered separately.
  function teardown() {
    game.onTick = null;
    for (const go of added) game.remove(go);
    added.length = 0;
    game.map = null;
    game.hexGrid = null;
    game.visibility = null;
    game.visibilityMask = null;
    if (hand) {
      hand.innerHTML = '';
      hand.classList.add('is-empty');
    }
  }

  return {
    teardown,
    map, control, enemies, deployment, visibility, mask, deploy, loop,
    ground: hexGround,
    king,
  };
}
