// The editor's preferences, of which there is one.
//
// It is in localStorage rather than in memory because it is answered once and
// then meant for an hour, and because it is not a fact about any level - the
// board does not get an opinion about whether you look at it through a hood.
const FOG = 'hex-tower-defence#fog';

export function fogWanted() {
  try { return localStorage.getItem(FOG) !== '0'; } catch { return true; }
}

export function setFogWanted(on) {
  try { localStorage.setItem(FOG, on ? '1' : '0'); } catch { /* nothing to do */ }
}
