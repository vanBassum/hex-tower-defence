import { PROP_TYPES, propTypesIn } from './props.js';
import { hashHex, patchNoise } from '../engine/hex/hex_noise.js';

// Terrain detail: the ground cover, and the one layer of decoration that is
// *derived* rather than placed.
//
// A placed thing is stored as itself - a tree is a line in the level saying where
// that tree is. A scattered tuft of grass is not worth a line. Ground that reads
// as ground wants thousands of them, nobody is ever going to select one, and a
// file with four thousand tufts in it is a file that cannot be read, cannot be
// diffed and cannot be edited by hand.
//
// So a painted hex stores a *patch* - which kinds of thing grow there, how thick,
// and the seed to draw it with - and the tufts are regenerated from that,
// identically, every time the level is opened. One line per hex instead of one
// line per tuft, and the level still comes back down to which way each blade is
// facing.
//
// The rule that makes this safe: nothing may ever be stored about an individual
// *scattered* tuft, because there is nowhere to put it. Anything the author needs
// to control is a number on the patch. A tuft placed deliberately - one press for
// one tuft - is not this: that is an instance in `props` like any other, and the
// two sit on the same tile without knowing about each other.
//
// ── Why it does not look like a grid ─────────────────────────────────────────
// A count that is the same on every hex reads as a lawn, and a count drawn from
// each hex's own hash reads as noise - both of them read as a texture applied to
// a grid rather than as ground. What makes a scattering read as ground is that it
// varies over a distance *larger* than one hex: thick here, thin two tiles along,
// bare in the hollow. That is `patchNoise`, which is smooth across tiles, and it
// is the whole reason this file exists rather than a loop in the editor.
//
// The per-hex hash is still in there, at half the weight, so two neighbours
// inside one thick patch are not both exactly full.
//
// ── A patch holds a list, not a name ────────────────────────────────────────
// `kinds` is the detail types this patch draws from, and it is a list because a
// mixture is what ground looks like: grass with stones through it and the odd
// flower. It used to be the name of a predefined set - grass, stones, stony grass
// - and that third entry is what gave the game away: the combination existed
// because the data could not hold one, not because anybody wanted a thing called
// stony grass. Now the palette is the types themselves, whatever was ticked is
// what the patch stores, and there is no such thing as a mixture somebody has to
// have thought of first.

// The one thing still keyed by set name: reading a file written when a patch held
// one. Nothing else may use this - it is a migration table, not a palette.
export const LEGACY_SETS = {
  grass: ['grass', 'grass_tall', 'grass_broad', 'grass_low', 'grass_fine'],
  stones: ['pebble', 'pebble_flat'],
  scrubby: ['grass', 'grass_low', 'grass_fine', 'pebble', 'pebble_flat'],
};

// Every type that can be ground cover: the palette the editor shows, and the only
// thing a patch's `kinds` may name.
export function detailKinds() {
  return propTypesIn('detail').map(t => t.key);
}

export function isDetailKind(key) {
  return PROP_TYPES[key]?.category === 'detail';
}

// What a patch says when it says nothing, and how far each number may go. The
// editor's steppers read these, so the tool and the file cannot disagree about
// what a legal patch is.
export const DETAIL_DEFAULTS = { density: 3, seed: 0, size: 2, spin: 2 };
export const DETAIL_RANGE = {
  // A ceiling, not a count - see `patchCount` - so the top of this range is not
  // what a tile gets, it is what a tile in the thickest part of a patch gets.
  // Ten, because six read as a mown verge: a hex is twelve metres of ground and
  // three tufts on it is a lawn that needs cutting rather than open country. The
  // cost of ground cover is draw calls and this is where they are spent, so it is
  // as high as it is useful and no higher.
  density: [0, 10],
  seed: [0, 9],
  size: [0, 3],
  spin: [0, 2],
};

// How far across its tile a scattered tuft may wander. Nearly the whole hex:
// ground cover that hugs the middle of each tile draws the grid.
export const DETAIL_SPREAD = 0.9;

// How much bigger and smaller than standard one instance may come out. Step 0 is
// a kind drawn at exactly its own size, which is worth having: uniform ground
// cover is what a mown field or a stone floor looks like.
const SIZE_VARIATION = [0, 0.14, 0.28, 0.44];

// How far off a shared heading one instance may be turned. The last step is
// `null`, meaning "whatever its hash says" - a free spin is the default and it
// costs nothing to store, because the hash was already going to decide.
const SPIN_SPREAD = [0, 0.4, null];

// The two of them as the editor and this file both want them: a size and a
// heading for one instance, from a variation step and a salt. They are here
// rather than in the editor because the placed categories have to vary the same
// way the derived one does - a scattered rock whose size varied by some other
// rule would read as a different system standing on the same ground.
export function variedScale(step, q, r, salt) {
  const vary = SIZE_VARIATION[clamp(step ?? 0, 0, SIZE_VARIATION.length - 1)];
  return vary ? 1 + (hashHex(q, r, 307 + salt) - 0.5) * 2 * vary : 1;
}

// An angle, or null for "leave it to the hash" - which is a free spin, and is
// what a scattering wants nine times out of ten.
export function variedYaw(step, q, r, salt) {
  const spread = SPIN_SPREAD[clamp(step ?? 0, 0, SPIN_SPREAD.length - 1)];
  return spread === null ? null : (hashHex(q, r, 311 + salt) - 0.5) * spread;
}

// The clump field: smooth across tiles, so what it decides varies over two or
// three hexes rather than per tile. Exported because the props scatter draws from
// the same one - rocks that thinned out where the grass thickened would read as
// two unrelated systems laid over each other, and the whole trick of a scattering
// looking natural is that everything on the ground agrees about where the ground
// is thick.
//
// The seed slides the sample point rather than reseeding the noise: `patchNoise`
// has no seed, and from the author's side sliding is the same thing - a different
// part of the field is a different draw.
export function clumpAt(q, r, seed = 0) {
  return patchNoise(q * 0.47 + seed * 13.13, (r + q * 0.5) * 0.54 + seed * 7.77);
}

// How thick this tile is, in [0, ~1.3]: mostly the neighbourhood, with the hex's
// own hash at half weight so two tiles inside one thick patch are not both
// exactly full.
export function coverAt(q, r, seed = 0) {
  return clumpAt(q, r, seed) * 0.8 + hashHex(q, r, 101 + seed * 13) * 0.5;
}

// How many instances a patch puts on its hex. Never more than its density, often
// fewer, sometimes none - and which of those depends mostly on the *neighbourhood*
// rather than on this tile, which is what makes the result patchy instead of
// speckled.
function patchCount(patch) {
  const { q, r } = patch;
  const density = clamp(patch.density ?? DETAIL_DEFAULTS.density, ...DETAIL_RANGE.density);
  if (!density) return 0;
  return clamp(Math.round(density * coverAt(q, r, patch.seed ?? 0)), 0, density);
}

// Patches to prop placements - the same shape everything else on the board is
// built from, so `PropLayer` never learns that this layer was not placed by hand.
//
// A patch naming nothing that exists draws nothing rather than throwing. This runs
// while a level is being edited and on every playtest, and a level that refuses to
// open because it names a kind some later version removed is worse than a hex that
// comes up bare.
export function detailPlacements(patches = []) {
  const out = [];
  // How many places on each hex have been handed out already. Slots are what keep
  // two instances off the same spot - see `buildProp` - and they carry on across
  // the patches sharing a hex, so two patches on one tile interleave instead of
  // standing their instances in the same six places. The count is per hex rather
  // than per patch for that one reason.
  const used = new Map();
  for (const patch of patches) {
    const kinds = (patch.kinds ?? []).filter(isDetailKind);
    if (!kinds.length) continue;
    const { q, r } = patch;
    const seed = patch.seed ?? 0;
    const n = patchCount(patch);
    const key = `${q},${r}`;
    // Earlier patches keep the slots they had, so adding a second patch to a tile
    // never moves what is already growing there.
    const base = used.get(key) ?? 0;
    used.set(key, base + n);

    for (let i = 0; i < n; i++) {
      // Every draw below is keyed to this number, and it is keyed to the seed, so
      // nudging the seed redraws the tile completely rather than adding to it.
      // The multipliers are chosen so no two (seed, i) pairs in range collide -
      // two instances sharing a salt would be two tufts in exactly one place.
      const salt = 1 + seed * 37 + i * 11;
      const kind = kinds[Math.floor(hashHex(q, r, 211 + seed * 7 + i * 19) * kinds.length)];

      const placement = { type: kind, q, r, salt, slot: base + i, spread: DETAIL_SPREAD };
      const scale = variedScale(patch.size ?? DETAIL_DEFAULTS.size, q, r, salt);
      const yaw = variedYaw(patch.spin ?? DETAIL_DEFAULTS.spin, q, r, salt);
      if (scale !== 1) placement.scale = scale;
      if (yaw !== null) placement.yaw = yaw;
      out.push(placement);
    }
  }
  return out;
}

// What a patch will actually put down, for a readout that has to say how thick
// the ground cover is without building it.
export function detailInstances(patches = []) {
  return patches.reduce(
    (sum, p) => sum + ((p.kinds ?? []).some(isDetailKind) ? patchCount(p) : 0), 0);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
