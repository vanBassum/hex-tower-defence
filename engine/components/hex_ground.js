import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { hashHex, patchNoise } from '../hex/hex_noise.js';

// The board as a single merged, vertex-coloured mesh: a top face per hex at its
// elevation, plus a cliff face on every edge where the neighbour sits lower.
// Off-board edges drop to a base depth, so the whole board reads as one solid
// landmass rather than a sheet of tiles.
//
// One cliff material covers every height change - path steps, hill sides and the
// board rim alike - which is what keeps varied elevation looking like the same
// piece of land.
//
// Surface colour variation is two-scale on purpose. Per-hex jitter on its own
// looks like static; a smooth large-scale component makes it form patches, which
// is what reads as ground. All amounts are lightness swings in *sRGB* space, so
// the numbers match what you see - offsetting in the linear space three stores
// by default is far subtler than it looks.

export class HexGround extends Component {
  constructor(grid, {
    pathKeys    = null,   // Set of "q,r" painted as path
    rockKeys    = null,   // Set of "q,r" painted as bare rock (crags)
    levels      = null,   // Map of "q,r" -> integer elevation level
    step        = 0.22,   // world height of one level
    baseDepth   = 0.95,   // how far the board rim drops below its lowest tile
    // Discrete grass tones, picked in broad patches rather than per tile. Index
    // 1 is the base: value noise clusters around its midpoint, so the middle
    // entry dominates and the outer two appear as occasional patches.
    grassColors = [0x55743a, 0x6a8b3e, 0x82994b],
    variantScale = 6.0,   // patch size for the variant choice - wider than the shading patches
    // Worn earth, as a whole-tile tone rather than a blob drawn on top. A decal
    // reads as a sticker on grass; a tile that simply *is* dirtier reads as
    // ground. Kept rare so it stays an accent, not a terrain type.
    dirtColor   = 0x8d7d4c,
    dirtChance  = 0.07,
    pathColor   = 0xc4aa72,
    // Bare stone, close enough in hue to the cliff faces that a crag reads as
    // the same rock pushed up through the grass rather than a different object.
    rockColor   = 0x9c968c,
    cliffColor  = 0x8a6a45,
    cliffShade  = 0.5,    // how much the foot of a cliff darkens
    patchScale  = 3.2,    // world units per noise cell - larger means broader patches
    patchAmount = 0.012,  // lightness swing from the smooth component
    tileAmount  = 0.010,  // lightness swing from per-hex jitter
    hueAmount   = 0.004,  // hue swing, keeps the colour from looking printed
  } = {}) {
    super();
    this._grid       = grid;
    this._pathKeys   = pathKeys;
    this._rockKeys   = rockKeys;
    this._levels     = levels;
    this.step        = step;
    this._baseDepth  = baseDepth;
    this._grassColors = grassColors;
    this._variantScale = variantScale;
    this._dirtColor = dirtColor;
    this._dirtChance = dirtChance;
    this._pathColor  = pathColor;
    this._rockColor  = rockColor;
    this._cliffColor = cliffColor;
    this._cliffShade = cliffShade;
    this._patchScale  = patchScale;
    this._patchAmount = patchAmount;
    this._tileAmount  = tileAmount;
    this._hueAmount   = hueAmount;
  }

  _isPath(q, r) { return !!this._pathKeys?.has(`${q},${r}`); }
  _isRock(q, r) { return !!this._rockKeys?.has(`${q},${r}`); }

  levelAt(q, r) { return this._levels?.get(`${q},${r}`) ?? 0; }

  // Surface height of a tile. Anything standing on the board needs this.
  topY(q, r) { return this.levelAt(q, r) * this.step; }

  get baseY() {
    let min = 0;
    if (this._levels) for (const v of this._levels.values()) min = Math.min(min, v);
    return min * this.step - this._baseDepth;
  }

  start() {
    const pos = [];
    const col = [];
    const top = new THREE.Color();
    const foot = new THREE.Color();
    const baseY = this.baseY;

    for (const { q, r } of this._grid.allHexes()) {
      const { x, z } = this._grid.hexToWorld(q, r);
      const path = this._isPath(q, r);
      const y = this.topY(q, r);
      const corners = this._grid.hexCorners(q, r);

      // The path carries less variation so the route stays readable at a glance,
      // and so does rock - variation on stone reads as dirt on it.
      const surface = path ? this._pathColor
                   : this._isRock(q, r) ? this._rockColor
                   : this._groundAt(q, r, x, z);
      this._shade(top, q, r, x, z, surface, path ? 0.55 : this._isRock(q, r) ? 0.7 : 1);
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        // Wound (centre, b, a) so the normal points +Y. The other order faces
        // down and is culled when seen from above.
        pos.push(x, y, z, b.x, y, b.z, a.x, y, a.z);
        for (let k = 0; k < 3; k++) col.push(top.r, top.g, top.b);
      }

      // Cliffs, only where there is a drop to fill.
      this._shade(top, q, r, x, z, this._cliffColor, 0.6);
      foot.copy(top).multiplyScalar(1 - this._cliffShade);
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        const n = this._across(x, z, a, b);
        const nY = this._grid.inBounds(n.q, n.r) ? this.topY(n.q, n.r) : baseY;
        if (nY >= y - 1e-6) continue;

        // Wound so the normal faces away from the tile centre.
        pos.push(a.x, y, a.z, b.x, nY, b.z, a.x, nY, a.z);
        col.push(top.r, top.g, top.b, foot.r, foot.g, foot.b, foot.r, foot.g, foot.b);
        pos.push(a.x, y, a.z, b.x, y, b.z, b.x, nY, b.z);
        col.push(top.r, top.g, top.b, top.r, top.g, top.b, foot.r, foot.g, foot.b);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();

    this._mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this._mesh = new THREE.Mesh(geo, this._mat);
    this._mesh.receiveShadow = true;
    this.gameObject.object3D.add(this._mesh);
  }

  // Tile tone for a non-path hex: usually grass, occasionally worn earth.
  _groundAt(q, r, x, z) {
    if (hashHex(q, r, 71) < this._dirtChance) return this._dirtColor;
    return this._grassAt(x, z);
  }

  // Grass tone for a position. Sampled from its own noise field, offset from the
  // shading field so tone patches and lightness patches do not coincide - that
  // overlap is what would make the variation read as one repeating texture.
  //
  // The tones are ~0.053 apart in lightness while the jitter above swings at
  // most ~0.022, deliberately: if jitter matches the tone step it erases the
  // patches, and the ground goes back to reading as noise.
  _grassAt(x, z) {
    const n = this._grassColors.length;
    const v = patchNoise(x / this._variantScale + 31.7, z / this._variantScale - 17.3);
    return this._grassColors[Math.min(n - 1, Math.floor(v * n))];
  }

  // The hex across edge (a,b), found by reflecting the centre through the edge
  // midpoint. Avoids needing a corner-to-neighbour lookup table, which is the
  // part that is easy to get subtly wrong on a hex grid.
  _across(x, z, a, b) {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    return this._grid.worldToHex(x + (mx - x) * 2, z + (mz - z) * 2);
  }

  _shade(c, q, r, x, z, hex, scale) {
    const patch = patchNoise(x / this._patchScale, z / this._patchScale) - 0.5;
    const tile  = hashHex(q, r, 5) - 0.5;
    const hue   = hashHex(q, r, 9) - 0.5;
    // Offsets applied to the raw sRGB numbers, then converted, so a given amount
    // means the same visible step whatever the base colour.
    c.setHex(hex, THREE.LinearSRGBColorSpace);
    c.offsetHSL(
      hue * 2 * this._hueAmount * scale,
      0,
      (patch * 2 * this._patchAmount + tile * 2 * this._tileAmount) * scale,
    );
    c.convertSRGBToLinear();
  }

  destroy() {
    this._mesh?.geometry.dispose();
    this._mat?.dispose();
  }
}
