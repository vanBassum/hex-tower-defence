import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { MAP_1, buildMap } from './maps.js';
import { SYSTEM_LEVEL_BY_ID, loadSystemLevel } from './levels.js';
import { MOOD } from './mood.js';
import { startPlay } from './play.js';

// The game as a page: a renderer, an hour, a camera, and one level started
// inside them.
//
// Everything that used to be here is in play.js now, called rather than run on
// import - see the note at the top of that file. What is left is the part that is
// true of the page and not of the level: which map, which camera distance, and
// the loading message that covers the first frame. The editor is the other caller
// of the same function, which is what makes a playtest the real game rather than
// a second simulation.

window.__boot = { t0: performance.now() };
const game = new Game();

// Which board. `?level=skirmish` plays one of the levels that ship in `levels/`
// - see game/levels.js - and nothing in the query string plays the hand-authored
// island, which is still what the game opens on.
//
// A query string rather than a menu, because a menu is a screen and this page has
// never had one. The editor's library is where levels are browsed; this is the
// address of one. A name nothing answers to falls back to the island with a line
// in the console rather than a blank page, since the only way to mistype it is by
// hand.
const wanted = new URLSearchParams(location.search).get('level');
const map = buildMap(await pickLevel(wanted));
window.__boot.map = performance.now();

async function pickLevel(id) {
  if (!id) return MAP_1;
  if (!SYSTEM_LEVEL_BY_ID[id]) {
    console.warn(`No level called "${id}" - playing the island. Try one of: ` +
                 Object.keys(SYSTEM_LEVEL_BY_ID).join(', '));
    return MAP_1;
  }
  try {
    return await loadSystemLevel(id);
  } catch (e) {
    console.warn(`Could not load level "${id}": ${e.message} - playing the island.`);
    return MAP_1;
  }
}

const camera = new GameObject('Camera');
// Closer again than the last time this was pulled in. A run opens on nothing but
// the camp - a couple of dozen hexes of known ground in a board of mist - and a
// wide shot of that is a wide shot of fog with a coin in the middle of it. The
// wheel is right there for anyone who wants the sightseeing distance back.
const rig = camera.addComponent(new CameraRig({ dist: 14 }));
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

startPlay({
  game, map, rig,
  // What the run opens with. A shipped level says - the same field the editor's
  // Play reads - and the island says nothing, which is the empty hand it has
  // always been dealt.
  deck: map.def.deck ?? undefined,
  hand: document.getElementById('hand'),
  // The loading message goes with the last of the waiting, which is the throwaway
  // frame play.js draws to compile its shaders - a message that leaves before the
  // freeze it exists to cover is worse than no message at all.
  onReady: () => document.getElementById('loading')?.classList.add('is-done'),
});

window.__boot.wired = performance.now();
game.start();
