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
  scoutViewDistance: 2,

  // Everything else is dealt. The Scout is a card like any other - the player
  // places it - and adding `'footman'` here is how you play the second run
  // without playing the first.
  startingHand: ['scout'],

  fog: true,           // draw the fog layer at all
  showVision: false,   // ring the hexes the selected unit is lighting up
};

const VISION_COLOR = 0xffc07a;

export function installDebug({ game, grid, ground, rig, fog, field, control, visibility,
                               spawn = null, pickups = [], deployment = null, enemies = null }) {
  // Its own GameObject, because the picker's cursor and the move highlight each
  // already own the one overlay on theirs.
  const go = new GameObject('DebugVision');
  const overlay = go.addComponent(new HexOverlay(grid, [], {
    color: VISION_COLOR, opacity: 0.30, y: 0.035,
    heightAt: (q, r) => (grid.inBounds(q, r) ? ground.topY(q, r) : 0),
  }));
  game.add(go);

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

  fog.setShown(DEBUG.fog);
  field?.setMasking(DEBUG.fog);
  visibility.onChange(refreshVision);

  const api = {
    DEBUG,
    game, grid, ground, fog, field, control, visibility,
    // What is on the board to be found, so a reward can be taken without walking
    // to it: `hex.pickups[0].collect()`. It grants exactly what standing on it
    // would, because the pickup calls the same hook either way.
    pickups,
    deployment,
    // The other side, so a fight can be started without walking into one:
    // `hex.enemies.units[0].damage(5)`, or `hex.teleport(0, 2)` and wait.
    enemies,

    // A card in hand without finding the thing that carries it. The one knob
    // this milestone actually needs tried: whether a card is worth walking back
    // to camp for depends entirely on how far camp is, and answering that by
    // walking to the cache every time is answering it twice a minute.
    card(key = 'footman') { return deployment?.addCard(key) ?? null; },

    // Both halves at once. The mist is only the visible half now - the world
    // hides itself off the same field - so a switch that lifted the sheet and
    // left the terrain painted out would be a debug key that shows you nothing.
    toggleFog(on = !DEBUG.fog) {
      DEBUG.fog = on;
      fog.setShown(on);
      field?.setMasking(on);
      api.onFogChanged?.();
      return on;
    },

    toggleVision(on = !DEBUG.showVision) {
      DEBUG.showVision = on;
      refreshVision();
      return on;
    },

    // Retune a unit's sight without a reload. Defaults to the whole force, which
    // is the version you want while deciding what the number should be.
    setViewDistance(n, unit = null) {
      for (const u of unit ? [unit] : control.units) u.viewDistance = n;
      DEBUG.scoutViewDistance = n;
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

    // Puts a unit on the board without finding it first. The force can be
    // recruited properly now - walk onto the cache - so this is for the two
    // things that are still worth checking by hand: that fog is the union over
    // the force, and what a unit type looks like without walking to the tile it
    // is granted on. `hex.spawn(q, r, 'footman')`.
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

  // Speed slider and a fog switch, bottom right. Purely for watching a fight at
  // 10% or skipping a walk at 100%, and for looking at the island without it.
  // Both are on F and the slider already, so this is only so the two knobs
  // anybody actually reaches for are visible rather than remembered.
  {
    const wrap = document.createElement('div');
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
    const fog = document.createElement('button');
    fog.style.cssText = 'padding:4px 9px;border-radius:5px;cursor:pointer;font:12px system-ui;'
      + 'background:rgba(143,216,232,0.10);border:1px solid rgba(143,216,232,0.28);color:#b9cfe0';
    const label = () => { fog.textContent = DEBUG.fog ? 'Fog on' : 'Fog off'; };
    fog.addEventListener('click', () => { api.toggleFog(); label(); });
    label();

    wrap.append(document.createTextNode('Speed'), slider, out, fog);
    document.body.append(wrap);
    // F still works, and the button has to agree with it or it lies the first
    // time somebody uses both.
    api.onFogChanged = label;
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyF') api.toggleFog();
    if (e.code === 'KeyV') api.toggleVision();
    if (e.code === 'KeyR') api.revealAll();
  });

  window.hex = api;
  return api;
}
