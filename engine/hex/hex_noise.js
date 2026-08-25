// Deterministic pseudo-randomness keyed to hex coordinates, so a board looks
// identical on every load and editing one hex never reshuffles its neighbours.

// Value in [0,1) for a hex. Vary `salt` to get independent draws for the same
// hex - one for colour, one for rotation, and so on.
export function hashHex(q, r, salt = 0) {
  let h = (q * 374761393 + r * 668265263 + salt * 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function lattice(ix, iz) {
  let h = (ix * 1597334677 + iz * 3812015801) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Smooth 2D value noise in world space. Used for variation that should form
// patches across several hexes rather than change per tile.
export function patchNoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = smooth(x - x0), tz = smooth(z - z0);
  const a = lattice(x0, z0),     b = lattice(x0 + 1, z0);
  const c = lattice(x0, z0 + 1), d = lattice(x0 + 1, z0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
