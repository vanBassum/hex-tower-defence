import { HexOverlay } from '../engine/components/hex_overlay.js';
import { GameObject } from '../engine/gameobject.js';

// Developer controls for the exploration pass. Deliberately not game UI: this is
// a system that has to be *tuned* - how far a scout sees decides how much of a
// walk the island is - and a knob you have to reload the page to change is a knob
// you turn twice and then stop turning.
//
// Everything here is either a keypress or a call on `window.hex` from the
// console. None of it is reachable from the game itself, so none of it needs to
// survive into a build.
export const DEBUG = {
  // Where the run begins, and it is one hex rather than a roster. The King is
  // the only thing the game puts on the board itself, because every card is
  // played onto a tile beside him and something has to be there first.
  kingStart: { q: -3, r: 4 },

  // What the run is dealt on top of the King, and it is nothing: every card the
  // player holds is one they walked onto. Putting `'scout'` or `'swordsmen'` back
  // here is how you play the second half of a run without playing the first.
  startingHand: [],

  showVision: false,   // ring the hexes the selected unit is lighting up
};

const VISION_COLOR = 0xffc07a;

export function installDebug({ game, grid, ground, rig, mask, control, visibility,
                               spawn = null, pickups = [], deployment = null, enemies = null,
                               loop = null, garrison = null,
                               add = null }) {
  // Its own GameObject, because the picker's cursor and the move highlight each
  // already own the one overlay on theirs.
  const go = new GameObject('DebugVision');
  const overlay = go.addComponent(new HexOverlay(grid, [], {
    color: VISION_COLOR, opacity: 0.30, y: 0.035,
    heightAt: (q, r) => (grid.inBounds(q, r) ? ground.topY(q, r) : 0),
  }));
  (add ?? ((x) => game.add(x)))(go);

  const refreshVision = () => {
    if (!DEBUG.showVision) { overlay.setHexes([]); return; }
    const seen = new Set();
    const out = [];
    for (const u of control.units) {
      for (const h of grid.hexesInRange(u.q, u.r, u.viewDistance, { playableOnly: true })) {
        const k = `${h.q},${h.r}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(h);
      }
    }
    overlay.setHexes(out);
  };

  visibility.onChange(refreshVision);

  const api = {
    DEBUG,
    game, grid, ground, mask, control, visibility,
    // What is on the board to be found, so a reward can be taken without walking
    // to it: `hex.pickups[0].collect()`. It grants exactly what standing on it
    // would, because the pickup calls the same hook either way.
    pickups,
    deployment,
    // The other side, so a fight can be started without walking into one:
    // `hex.enemies.units[0].damage(5)`, or `hex.teleport(0, 2)` and wait.
    enemies,
    // The action loop, while there is one - `hex.loop.state` is why the board is
    // not taking orders, and `hex.loop.TACTICS` is where the numbers are. It is
    // the experiment's knobs rather than the game's, so it is null when the
    // experiment is off.
    loop,
    // Troops the level is holding back until somebody sees them.
    // `hex.garrison.dormant` is who has not been found yet.
    garrison,

    // A card in hand without finding the thing that carries it. The one knob
    // this milestone actually needs tried: whether a card is worth walking back
    // to camp for depends entirely on how far camp is, and answering that by
    // walking to the cache every time is answering it twice a minute.
    card(key = 'swordsmen') { return deployment?.addCard(key) ?? null; },

    toggleVision(on = !DEBUG.showVision) {
      DEBUG.showVision = on;
      refreshVision();
      return on;
    },

    // Retune a unit's sight without a reload. Defaults to the whole force, which
    // is the version you want while deciding what the number should be.
    setViewDistance(n, unit = null) {
      for (const u of unit ? [unit] : control.units) u.viewDistance = n;
      control.refreshVision();
      refreshVision();
      return n;
    },

    // Drop a unit somewhere without walking it there - for looking at a corner of
    // the island without discovering the road to it.
    teleport(q, r, unit = control.units[0]) {
      unit?.placeAt(q, r);
      return unit?.hex;
    },

    revealAll() { return visibility.revealAll(); },

    // Where the air in the dark actually lands. `hex.airDebug(1)` paints it cyan
    // at full strength, `hex.airDebug(2)` paints every night fragment magenta -
    // which is a picture of what geometry is under the dark at all - and
    // `hex.airDebug(0)` puts it back.
    airDebug(v = 1) { mask?.setAirDebug(v); return v; },

    // Puts a unit on the board without finding it first. The force can be
    // recruited properly now - walk onto the cache - so this is for the two
    // things that are still worth checking by hand: that fog is the union over
    // the force, and what a unit type looks like without walking to the tile it
    // is granted on. `hex.spawn(q, r, 'swordsmen')`.
    spawn(q, r, type = 'scout') {
      if (!spawn) return null;
      const u = spawn(type, q, r);
      control.add(u);
      control.refreshVision();
      refreshVision();
      return u;
    },

    lookAt(q, r) {
      const { x, z } = grid.hexToWorld(q, r);
      rig?.focusOn(x, z);
    },
  };

  // Speed slider, bottom right. Purely for watching a fight at 10% or skipping a
  // walk at 100% - on the keyboard already, and here so the one knob anybody
  // actually reaches for is visible rather than remembered.
  let wrap;
  {
    wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;gap:8px;'
      + 'align-items:center;padding:8px 11px;border-radius:7px;background:rgba(9,16,30,0.55);'
      + 'border:1px solid rgba(143,216,232,0.14);color:#b9cfe0;font:12px system-ui;user-select:none';
    const out = document.createElement('span');
    out.style.cssText = 'min-width:34px;text-align:right';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0; slider.max = 100; slider.value = 100;
    slider.style.cssText = 'width:120px;accent-color:#8fd8e8';
    const apply = () => {
      game.timeScale = slider.value / 100;
      out.textContent = `${slider.value}%`;
    };
    slider.addEventListener('input', apply);
    apply();
    wrap.append(document.createTextNode('Speed'), slider, out);
    document.body.append(wrap);
  }

  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyV') api.toggleVision();
    if (e.code === 'KeyR') api.revealAll();
  };
  window.addEventListener('keydown', onKey);

  window.hex = api;

  // And how to take all of it back off again. It matters now that a page can
  // play a second level without being reloaded: everything above is per session -
  // the overlay knows one roster, the slider one clock, `window.hex` one board -
  // so a session that left its slider behind would stack another one under it
  // every time somebody picked a level.
  return () => {
    game.remove(go);
    wrap.remove();
    window.removeEventListener('keydown', onKey);
    if (window.hex === api) delete window.hex;
  };
  return api;
}
