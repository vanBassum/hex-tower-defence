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
  // The Scout, before the game starts. Both are read once, at setup.
  scoutStart: { q: -3, r: 4 },
  scoutViewDistance: 2,

  fog: true,           // draw the fog layer at all
  showVision: false,   // ring the hexes the selected unit is lighting up
};

const VISION_COLOR = 0xffc07a;

export function installDebug({ game, grid, ground, rig, fog, field, control, visibility, spawn = null }) {
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
    game, grid, fog, field, control, visibility,

    // Both halves at once. The mist is only the visible half now - the world
    // hides itself off the same field - so a switch that lifted the sheet and
    // left the terrain painted out would be a debug key that shows you nothing.
    toggleFog(on = !DEBUG.fog) {
      DEBUG.fog = on;
      fog.setShown(on);
      field?.setMasking(on);
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

    // Puts a second unit on the board. Only a debug hook - there is no way to
    // recruit anything yet - but it is the one claim this milestone makes that is
    // worth being able to check: fog is the union over the force, so a second
    // scout should widen what is known and stepping one of them away should not
    // close the other one's window.
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

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyF') api.toggleFog();
    if (e.code === 'KeyV') api.toggleVision();
    if (e.code === 'KeyR') api.revealAll();
  });

  window.hex = api;
  return api;
}
