import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { Atmosphere } from '../engine/components/atmosphere.js';
import { catalogue } from './levels.js';
import { Menu } from './ui/menu.js';
import { MOOD } from './mood.js';
import { startPlay } from './play.js';

// The game as a page: a renderer, an hour, a camera, and a menu that starts one
// level at a time inside them.
//
// Everything that used to be here is in play.js now, called rather than run on
// import - see the note at the top of that file. What is left is the part that is
// true of the page and not of the level: which camera distance, the loading
// message that covers the first frame, and which board is on.
//
// ── One page, many boards ───────────────────────────────────────────────────
// The world outlives every level in it. The renderer, the hour and the camera are
// built once here and handed to `startPlay`, which returns a `teardown` that puts
// the board back - so picking a second level is a teardown and another call, not a
// reload. That is exactly what the editor's Play button has always done, and it
// is the reason this page needed no new machinery to grow a menu: there was
// already a way to stop a level.
//
// `?level=<id>` skips the menu and starts that board, which is how a board is
// linked to and how the check script drives one.

window.__boot = { t0: performance.now() };
const game = new Game();



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

// ── The board that is on ────────────────────────────────────────────────────
const loading = document.getElementById('loading');
const now = document.getElementById('now');
const menu = new Menu({ root: document.getElementById('menu'), onPick: play });

let session = null;

// A handle on the page, and it exists before any board does. `startPlay` installs
// the session's own `window.hex` - the roster, the fog, the loop - and takes it
// away again on teardown, so without this the console and the check script would
// have nothing to talk to while the menu is up. The page's own controls are
// merged on top of whatever the session left, which is why the object is the
// board when there is one and the page when there is not.
function publish() {
  window.hex = Object.assign(window.hex ?? {}, { game, rig, menu, play, stop, levels });
}

async function play(entry) {
  stop();
  menu.hide();
  // The message goes back up for the frame play.js throws away compiling its
  // shaders. It covered the first board when there was only ever one; there are
  // several now and every one of them costs that frame.
  loading.classList.remove('is-done');
  const map = await entry.load();
  session = startPlay({
    game, map, rig,
    // What the run opens with. A level says - the same field the editor's Play
    // reads - and the island says nothing, which is the empty hand it has always
    // been dealt.
    deck: map.def.deck ?? undefined,
    hand: document.getElementById('hand'),
    // A message that leaves before the freeze it exists to cover is worse than no
    // message at all, so it goes when play.js says the slow frame is done.
    onReady: () => loading.classList.add('is-done'),
  });
  now.innerHTML = `<span>${entry.name}</span><span class="back">Levels</span>`;
  now.hidden = false;
  publish();
}

function stop() {
  session?.teardown();
  session = null;
  now.hidden = true;
  publish();
}

// The name of the board is also the way out of it - see menu.css. Escape is not
// offered for it on purpose: Deployment already spends Escape on putting an armed
// card down, and one key that sometimes leaves the level is worse than no key.
now.onclick = () => {
  stop();
  menu.show(levels);
};

const levels = await catalogue();
window.__boot.map = performance.now();
publish();

// A board named in the address starts straight away; anything else opens on the
// list. A name nothing answers to falls back to the list rather than to a blank
// page, since the only way to mistype it is by hand.
const wanted = new URLSearchParams(location.search).get('level');
const asked = wanted ? levels.find(l => l.id === wanted && !l.error) : null;
if (wanted && !asked) {
  console.warn(`No level called "${wanted}". Try one of: ` +
               levels.map(l => l.id).join(', '));
}

window.__boot.wired = performance.now();
game.start();

if (asked) {
  play(asked);
} else {
  menu.show(levels);
  // Nothing is being built yet, so the word that covers the building goes now.
  loading.classList.add('is-done');
}
