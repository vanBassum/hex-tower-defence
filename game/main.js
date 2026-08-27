import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { MAP_1, buildMap } from './maps.js';
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
const map  = buildMap(MAP_1);
window.__boot.map = performance.now();

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

startPlay({
  game, map, rig,
  hand: document.getElementById('hand'),
  // The loading message goes with the last of the waiting, which is the throwaway
  // frame play.js draws to compile its shaders - a message that leaves before the
  // freeze it exists to cover is worse than no message at all.
  onReady: () => document.getElementById('loading')?.classList.add('is-done'),
});

window.__boot.wired = performance.now();
game.start();
