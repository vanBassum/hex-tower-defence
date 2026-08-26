import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { HEX_VISIBILITY } from '../hex/visibility.js';
import { hashHex, patchNoise } from '../hex/hex_noise.js';

// Flat-top axial neighbours. The fog covers sea as well as land, and the grid's
// own `neighbors` yields only what is playable, so this walks its own.
const NEIGHBORS = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1]];

// Fog of war as *weather on a surface*, not as a heap of objects.
//
// Everything the player sees here comes out of one continuous sheet draped a
// hand's breadth over the board, shaded by a procedural cloud field. There is no
// per-hex geometry in the layer at all - no lids, no lenses, no blobs.
//
// The version this replaced built the mist out of a thousand overlapping
// translucent lenses, and no amount of tuning was ever going to fix it: a field
// of soft-edged ellipsoids has *silhouettes*, and silhouettes are what the eye
// counts. Making them broader, softer, flatter or more numerous only changed the
// size of the bubbles. Mist has no silhouette, and the only way to have none is
// for the shape you see to be painted rather than built.
//
// ── The three parts ─────────────────────────────────────────────────────────
//
//   1. **The sheet.** A regular triangle lattice spanning the whole fogged
//      region, its height sampled from the terrain underneath and then smoothed,
//      so it lies over the island like a cloth rather than sitting flat above it.
//      Draping matters for one reason: the sheet is the only thing hiding the
//      board, and a flat plane at crag height would float a full step over the
//      low ground, showing the coast from any camera below the top of the dive.
//
//   2. **The mask**, which is not this component's. `VisibilityField` owns it -
//      what the player has discovered, rasterised into a world-space texture and
//      blurred - and the mist is only one of its readers. Every material in the
//      world reads the same texture and paints itself out on undiscovered ground,
//      which is what actually hides the board.
//
//      Of its four channels the mist uses two: R discovered (softly, so the
//      reveal is organic) and B inside-the-region (so the bank knows where to
//      stop). Outside the region R is 1, which is what feathers the blanket's
//      outer rim into the ocean haze rather than ending it at a straight line.
//
//   3. **The shader.** Three noise fields at three scales drifting at three
//      speeds along the level's one wind, over a slow domain warp that keeps them
//      from reading as scrolling wallpaper. The mask decides how much of that
//      survives; a fourth field nudges the mask's own threshold up and down, so
//      the line between known and unknown is a ragged coast rather than a contour
//      of the blur.
//
// ── Why the deep field is nearly flat ───────────────────────────────────────
// Far from anything discovered the mist has to hide the board completely, and
// "hide" is not negotiable - a board you can dimly make out is a board you did
// not have to explore. So depth into the unknown does not add detail, it
// *removes* it: both the alpha variation and the colour variation are scaled by a
// factor that falls to almost nothing well inside the unknown, leaving a
// near-opaque sheet with a slow swell in it. All the visible structure - the
// tearing, the holes, the wisping - is spent at the boundary, which is the only
// place it says anything.
//
// ── This hides nothing ──────────────────────────────────────────────────────
// It used to, and that was the mistake. A horizontal sheet occludes nothing when
// you look along it, so dropping the camera below the bank put the whole
// unexplored half of the island in plain view - and no thickness, skirt or extra
// geometry fixes that, because the problem is that a blanket is not a wall.
//
// Hiding now belongs to the objects. `VisibilityField.patch` makes terrain,
// props, units and grid seams paint themselves out on undiscovered ground, which
// is correct from every camera angle for free. What is left here is weather: if
// this component were deleted the board would still be unreadable where it should
// be, it would just stop being atmospheric about it.
//
// The sheet does still write depth and discard where it is clear, which is worth
// keeping - over the unknown it swallows the motes and water sparkles that would
// otherwise draw on top of it, and over known ground it leaves no trace at all,
// so the path overlay and the cursor read through where it passes above them.
export class FogOfWar extends Component {
  constructor(grid, visibility, {
    field,                    // the shared VisibilityField - see visibility_field.js
    hexes    = null,          // every hex that can be fogged - land and sea both
    surfaceY = () => 0,       // top of the tile at (q, r)
    hexSize  = 1,

    // ── The sheet ──────────────────────────────────────────────────────────
    height     = 0.30,        // how far it floats over the ground it drapes
    minCover   = 0.10,        // and the least it may ever clear a tile's own top
    roll       = 0.06,        // a broad noise field lifting and dropping the drape
    patchScale = 5.0,         // how wide that field's features are
    resolution = 0.42,        // lattice spacing, in hex circumradii
    // Rings of neighbourhood *maximum* taken before the drape is smoothed. This
    // is what makes a crag mound over rather than terrace: smoothing alone drags
    // a summit's own height down toward its neighbours', and the sheet then has
    // to be clamped back up to clear the rock - which puts the hexagonal step
    // straight back, one tile further out.
    drapeRings    = 2,
    drapeSmooth   = 2,        // passes of neighbour averaging after that
    latticeSmooth = 2,        // and passes over the lattice, killing the last of the hex

    // ── The boundary ───────────────────────────────────────────────────────
    edge      = [0.34, 0.78], // the mask values the fog fades out between
    edgeWarp  = 0.20,         // how far noise pushes that threshold about
    edgeScale = 0.17,         // and how fine the wobble it puts in it is
    // Where the *outer* rim of the bank goes. The fogged region ends somewhere
    // out at sea, and where it ends is not a fact about the world - it is where
    // the level's hex list stops, so it is drawn as the bank simply running out
    // into the ocean haze. The field hands that boundary over already grown
    // seaward and widely blurred; these two only decide how it is painted.
    rimFade   = [0.14, 0.58],
    rimTear   = 0.30,         // the most the noise may push that fade *inward*

    // ── The cloud field ────────────────────────────────────────────────────
    warp    = { scale: 0.030, amount: 4.2 },
    scales  = [0.045, 0.105, 0.240],   // 1/world-unit: banks, clumps, texture
    speeds  = [0.075, 0.130, 0.220],   // world units per second
    weights = [0.34, 0.20, 0.11],
    flow    = 1,              // one multiplier over all three speeds

    // The level's one breeze, shared with the swell and the trees - three effects
    // with private weather look like three effects.
    drift = { angle: 0.55, amount: 0.05, period: 34 },

    // ── Colour ─────────────────────────────────────────────────────────────
    color       = 0x27303f,   // the body of it
    colorLight  = 0x46536a,   // where it piles up thick
    rimColor    = 0x76889f,   // the lit edge, where it thins away to nothing
    rimStrength = 0.45,
    opacity     = 1.0,
    detail = [0.95, 0.13],    // alpha contrast at the boundary / deep in the unknown
    shade  = [1.00, 0.50],    // colour contrast, likewise

    // ── Wisps ──────────────────────────────────────────────────────────────
    // Decoration, and nothing rests on them: they hide nothing, they carry no
    // information, and `wisps: 0` costs the layer nothing but parallax. A
    // handful, near the boundary, drifting - the sheet is a painted thing with no
    // parallax of its own, so a few real objects crossing in front of it are what
    // keep it from reading as a texture stuck to the ground when the camera turns.
    //
    // The first pass at these was three times this size and twice this opacity,
    // and it put the bubbles straight back: a pale disc seen from a camera that
    // is mostly looking *down* is a disc, however soft its edge, and a dozen of
    // them scattered over the bank was the exact artefact the sheet exists to be
    // rid of. Small, dim, and thin enough to be edge-on is the whole of what
    // keeps them readable as air.
    wisps         = 14,
    wispColor     = 0x4a5468,
    wispEmissive  = 0x394252,
    wispOpacity   = 0.14,
    wispRimFade   = 0.95,
    wispSize      = [0.5, 1.05],  // in hex circumradii
    wispRate      = 2.2,          // how fast one fades when it moves to a new post
  } = {}) {
    super();
    if (!field) throw new Error('FogOfWar draws a VisibilityField, it does not own one - pass `field`');
    this._grid = grid;
    this._vis  = visibility;
    this._field = field;
    this._hexes = hexes ? [...hexes] : [...grid.allHexes()];
    this._surfaceY = surfaceY;
    this._hexSize = hexSize;

    this._height = height;
    this._minCover = minCover;
    this._roll = roll;
    this._patchScale = patchScale;
    this._resolution = resolution;
    this._drapeRings = drapeRings;
    this._drapeSmooth = drapeSmooth;
    this._latticeSmooth = latticeSmooth;

    this._rimFade = rimFade;
    this._rimTear = rimTear;

    this._edge = edge;
    this._edgeWarp = edgeWarp;
    this._edgeScale = edgeScale;
    this._warp = warp;
    this._scales = scales;
    this._speeds = speeds;
    this._weights = weights;
    this._flow = flow;
    this._drift = drift;

    this._color = color;
    this._colorLight = colorLight;
    this._rimColor = rimColor;
    this._rimStrength = rimStrength;
    this._opacity = opacity;
    this._detail = detail;
    this._shade = shade;

    this._wispCount = wisps;
    this._wispColor = wispColor;
    this._wispEmissive = wispEmissive;
    this._wispOpacity = wispOpacity;
    this._wispRimFade = wispRimFade;
    this._wispSize = wispSize;
    this._wispRate = wispRate;

    this._shown = true;
    this._time  = 0;
    this._cells = new Map();     // "q,r" -> where the sheet stands over that hex
    this._wispData = [];
  }

  start() {
    for (const { q, r } of this._hexes) this._addCell(q, r);
    this._drapeSurfaces();

    this._buildSheet();
    this._buildWisps();

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();

    this._retarget();
    this._unsub = this._vis.onChange(() => this._retarget());
  }

  // Debug: hide the layer without touching what has actually been explored, so
  // turning it back on shows the same map rather than a fresh one.
  setShown(shown) {
    this._shown = shown;
    if (this._sheet) this._sheet.visible = shown;
    if (this._wispMesh) this._wispMesh.visible = shown;
  }
  get shown() { return this._shown; }

  // Unscaled time, like the water and the wind: the board may stop, but a sky
  // that stops dead reads as a crash.
  update(_dt, rawDt) {
    if (!this._shown) return;
    this._time += rawDt;
    this._uniforms.uTime.value = this._time;
    this._writeWisps(rawDt);
  }

  // ── Cells and the drape ───────────────────────────────────────────────────

  _addCell(q, r) {
    const { x, z } = this._grid.hexToWorld(q, r);
    const n = (patchNoise(x / this._patchScale + 8.4, z / this._patchScale - 3.1) - 0.5) * 2;
    const top = this._surfaceY(q, r);
    this._cells.set(`${q},${r}`, {
      q, r, x, z, key: `${q},${r}`,
      // Two heights, and they do different jobs. `surf` is what the sheet drapes
      // at and gets averaged with its neighbours below; `cover` is the tile's own
      // true top and never moves, so a crag standing three levels over its
      // neighbours is never left poking out of the mist.
      surf: top + n * this._roll,
      cover: top,
      known: false,
      edge: false,
    });
  }

  // Neighbourhood maximum first, then averaging. See `drapeRings` above for why
  // that order and not the other.
  _drapeSurfaces() {
    for (let ring = 0; ring < this._drapeRings; ring++) {
      const next = new Map();
      for (const cell of this._cells.values()) {
        let hi = cell.surf;
        for (const [dq, dr] of NEIGHBORS) {
          const c = this._cells.get(`${cell.q + dq},${cell.r + dr}`);
          if (c && c.surf > hi) hi = c.surf;
        }
        next.set(cell, hi);
      }
      for (const [cell, v] of next) cell.surf = v;
    }
    for (let pass = 0; pass < this._drapeSmooth; pass++) {
      const next = new Map();
      for (const cell of this._cells.values()) {
        let sum = cell.surf, n = 1;
        for (const [dq, dr] of NEIGHBORS) {
          const c = this._cells.get(`${cell.q + dq},${cell.r + dr}`);
          if (!c) continue;
          sum += c.surf; n++;
        }
        next.set(cell, sum / n);
      }
      for (const [cell, v] of next) cell.surf = v;
    }
    for (const cell of this._cells.values()) {
      if (cell.surf < cell.cover) cell.surf = cell.cover;
    }
  }

  // Where the reveal boundary currently runs, which since the mask moved out to
  // VisibilityField is the only thing this component still asks the map. A hex is
  // on the line if it is still unknown and something known touches it - and the
  // line is only ever used to decide where the wisps hang about.
  _retarget() {
    for (const cell of this._cells.values()) {
      cell.known = this._vis.stateAt(cell.q, cell.r) !== HEX_VISIBILITY.UNEXPLORED;
    }
    for (const cell of this._cells.values()) {
      let edge = false;
      if (!cell.known) {
        for (const [dq, dr] of NEIGHBORS) {
          const c = this._cells.get(`${cell.q + dq},${cell.r + dr}`);
          if (c?.known) { edge = true; break; }
        }
      }
      cell.edge = edge;
    }
    this._placeWisps();
  }

  // ── The sheet ─────────────────────────────────────────────────────────────

  _buildSheet() {
    // The same box the mask is laid out in, because the two are read together:
    // a sheet that stopped short of the field would end while the mist it is
    // painted with was still saying "fogged".
    const min = this._field.min, span = this._field.span;
    const b = { minX: min.x, maxX: min.x + span.x, minZ: min.y, maxZ: min.y + span.y };
    const step = this._resolution * this._hexSize;
    const nx = Math.max(2, Math.ceil((b.maxX - b.minX) / step) + 1);
    const nz = Math.max(2, Math.ceil((b.maxZ - b.minZ) / step) + 1);
    const dx = (b.maxX - b.minX) / (nx - 1);
    const dz = (b.maxZ - b.minZ) / (nz - 1);

    // Sample the drape, then smooth the lattice itself. Cell heights are constant
    // across a hex, so without this pass the sheet is a plate of hexagons however
    // well the cells were averaged - and a hexagon is the one shape this layer
    // exists not to show.
    const y = new Float32Array(nx * nz);
    const cover = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = b.minX + i * dx, z = b.minZ + j * dz;
        const { q, r } = this._grid.worldToHex(x, z);
        const cell = this._cells.get(`${q},${r}`);
        const h = cell ? cell.surf : this._surfaceY(q, r);
        y[j * nx + i] = h;
        cover[j * nx + i] = cell ? cell.cover : h;
      }
    }
    const tmp = new Float32Array(nx * nz);
    for (let pass = 0; pass < this._latticeSmooth; pass++) {
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          let s = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj; if (jj < 0 || jj >= nz) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di; if (ii < 0 || ii >= nx) continue;
              s += y[jj * nx + ii]; n++;
            }
          }
          tmp[j * nx + i] = s / n;
        }
      }
      y.set(tmp);
    }

    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        // Insurance, and after two rings of neighbourhood maximum it almost never
        // binds: whatever the smoothing did, the sheet still clears the tile.
        const h = Math.max(y[k], cover[k] + this._minCover) + this._height;
        pos[k * 3]     = b.minX + i * dx;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = b.minZ + j * dz;
      }
    }

    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let t = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, c = a + 1, d = a + nx, e = d + 1;
        idx[t++] = a; idx[t++] = d; idx[t++] = c;
        idx[t++] = c; idx[t++] = d; idx[t++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const wind = new THREE.Vector2(Math.cos(this._drift.angle), Math.sin(this._drift.angle));
    this._uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMask:       { value: null },
        uMaskMin:    { value: new THREE.Vector2() },
        uMaskSpan:   { value: new THREE.Vector2() },
        uTime:       { value: 0 },
        uWind:       { value: new THREE.Vector2() },
        uWarp:       { value: new THREE.Vector2() },
        uScales:     { value: new THREE.Vector3() },
        uSpeeds:     { value: new THREE.Vector3() },
        uWeights:    { value: new THREE.Vector3() },
        uEdge:       { value: new THREE.Vector2() },
        uEdgeNoise:  { value: new THREE.Vector2() },
        uRimFade:    { value: new THREE.Vector2() },
        uRimTear:    { value: 0 },
        uDetail:     { value: new THREE.Vector2() },
        uShade:      { value: new THREE.Vector2() },
        uColor:      { value: new THREE.Color() },
        uColorLight: { value: new THREE.Color() },
        uRim:        { value: new THREE.Color() },
        uRimStrength:{ value: 0 },
        uOpacity:    { value: 1 },
      },
    ]);
    const u = this._uniforms;
    u.uMask.value = this._field.texture;
    u.uMaskMin.value.copy(this._field.min);
    u.uMaskSpan.value.copy(this._field.span);
    u.uWind.value.copy(wind);
    u.uWarp.value.set(this._warp.scale, this._warp.amount);
    u.uScales.value.set(...this._scales);
    u.uSpeeds.value.set(...this._speeds).multiplyScalar(this._flow);
    u.uWeights.value.set(...this._weights);
    u.uEdge.value.set(...this._edge);
    u.uEdgeNoise.value.set(this._edgeScale, this._edgeWarp);
    u.uRimFade.value.set(...this._rimFade);
    u.uRimTear.value = this._rimTear;
    u.uDetail.value.set(...this._detail);
    u.uShade.value.set(...this._shade);
    u.uColor.value.setHex(this._color);
    u.uColorLight.value.setHex(this._colorLight);
    u.uRim.value.setHex(this._rimColor);
    u.uRimStrength.value = this._rimStrength;
    u.uOpacity.value = this._opacity;

    this._mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      // It writes depth *and* discards where it is clear - see the note on depth
      // at the top of the file. Over the unknown that hides the motes and
      // sparkles behind it; over known ground nothing is written, so the overlays
      // underneath survive.
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
    });

    this._sheet = new THREE.Mesh(geo, this._mat);
    this._sheet.frustumCulled = false;   // it is the size of the board
    this._sheet.renderOrder = 1;
    this._sheet.castShadow = this._sheet.receiveShadow = false;
    this.gameObject.object3D.add(this._sheet);
  }

  // ── Wisps ─────────────────────────────────────────────────────────────────

  _buildWisps() {
    if (this._wispCount <= 0) return;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this._wispMat = new THREE.MeshLambertMaterial({
      color: this._wispColor, emissive: this._wispEmissive,
      transparent: true, opacity: this._wispOpacity, depthWrite: false,
    });
    // Each one dissolves toward its own outline, so what drifts past is a
    // thickening of the air rather than a pebble. Four lines into a stock Lambert
    // rather than a shader of our own, which is what keeps them lit by the same
    // sky as everything else.
    this._wispMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         float wispRim = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
         diffuseColor.a *= pow( wispRim, ${this._wispRimFade.toFixed(2)} );`,
      );
    };
    this._wispMesh = new THREE.InstancedMesh(geo, this._wispMat, this._wispCount);
    this._wispMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._wispMesh.castShadow = this._wispMesh.receiveShadow = false;
    this._wispMesh.frustumCulled = false;
    this._wispMesh.renderOrder = 2;   // after the sheet, so they read as in front of it
    this._wispMesh.count = 0;
    this.gameObject.object3D.add(this._wispMesh);

    const [sMin, sMax] = this._wispSize;
    for (let i = 0; i < this._wispCount; i++) {
      this._wispData.push({
        cell: null, next: null, pending: false, ease: 0,
        dx: (hashHex(i, 3, 11) - 0.5) * 2.0 * this._hexSize,
        dz: (hashHex(i, 5, 13) - 0.5) * 2.0 * this._hexSize,
        rise: (hashHex(i, 6, 15) - 0.4) * 0.35,
        size: this._hexSize * (sMin + (sMax - sMin) * hashHex(i, 7, 17)),
        aspect: 0.7 + hashHex(i, 9, 19) * 0.7,
        thick: 0.07 + hashHex(i, 11, 23) * 0.07,
        // Barely off level. At this aspect a free rotation stands a lens on its
        // edge, and a field of flat plates at random angles is not mist.
        rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (hashHex(i, 13, 29) - 0.5) * 0.18,
          hashHex(i, 15, 31) * 6.283,
          (hashHex(i, 17, 37) - 0.5) * 0.18,
        )),
        bobPhase: hashHex(i, 19, 41) * 6.283,
        bobRate: (Math.PI * 2) / (11 + hashHex(i, 21, 43) * 9),
        brPhase: hashHex(i, 23, 47) * 6.283,
        brRate: (Math.PI * 2) / (13 + hashHex(i, 25, 53) * 15),
        driftPhase: hashHex(i, 27, 59) * 6.283,
      });
    }
  }

  // Hand every wisp a post on the boundary, keeping the ones whose post is still
  // on it. A wisp that has to move does not fly there - it thins out and comes
  // back somewhere else, because a wisp crossing the board would be the one thing
  // in this layer that announced itself.
  _placeWisps() {
    if (!this._wispData.length) return;
    const posts = [];
    for (const cell of this._cells.values()) if (cell.edge) posts.push(cell);

    if (!posts.length) {
      for (const w of this._wispData) { w.next = null; w.pending = w.cell !== null; }
      return;
    }

    const taken = new Set();
    const need = [];
    for (const w of this._wispData) {
      if (w.cell?.edge && !taken.has(w.cell.key)) { taken.add(w.cell.key); w.pending = false; }
      else need.push(w);
    }
    let seed = 0;
    for (const w of need) {
      let pick = null;
      // Step through the posts on a stride rather than in order, so a run of
      // wisps does not pile onto one stretch of the line.
      for (let k = 0; k < posts.length; k++) {
        const c = posts[(seed * 7 + k * 3) % posts.length];
        if (taken.has(c.key)) continue;
        pick = c; break;
      }
      seed++;
      if (!pick) pick = posts[(seed * 7) % posts.length];   // more wisps than line
      taken.add(pick.key);
      w.next = pick;
      w.pending = w.next !== w.cell;
    }
  }

  _writeWisps(dt) {
    if (!this._wispMesh) return;
    const k = 1 - Math.exp(-this._wispRate * dt);
    const t = this._time;
    const dirX = Math.cos(this._drift.angle), dirZ = Math.sin(this._drift.angle);
    const dw = (Math.PI * 2) / this._drift.period;
    let n = 0;

    for (const w of this._wispData) {
      if (w.pending) {
        if (w.cell === null || w.ease < 0.04) {
          w.cell = w.next; w.pending = false; w.ease = 0;
        } else {
          w.ease += (0 - w.ease) * k;
        }
      } else if (w.cell) {
        w.ease += (1 - w.ease) * k;
      }
      if (!w.cell || w.ease < 0.03) continue;

      const bob   = Math.sin(t * w.bobRate + w.bobPhase);
      const br    = Math.sin(t * w.brRate + w.brPhase);
      const slide = Math.sin(t * dw + w.driftPhase) * this._drift.amount * 6;
      const grow  = w.ease * (1 + br * 0.07);
      const wide  = w.size * grow;

      this._p.set(
        w.cell.x + w.dx + dirX * slide,
        w.cell.surf + this._height * 0.75 + w.rise + bob * 0.05,
        w.cell.z + w.dz + dirZ * slide,
      );
      this._s.set(wide * w.aspect, w.size * w.thick * grow, wide / w.aspect);
      this._m.compose(this._p, w.rot, this._s);
      this._wispMesh.setMatrixAt(n, this._m);
      n++;
    }

    this._wispMesh.count = n;
    this._wispMesh.instanceMatrix.needsUpdate = true;
  }

  destroy() {
    this._unsub?.();
    this._sheet?.geometry.dispose();
    this._mat?.dispose();
    this._wispMesh?.geometry.dispose();
    this._wispMesh?.dispose();
    this._wispMat?.dispose();
  }
}

const SHEET_VERT = /* glsl */`
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SHEET_FRAG = /* glsl */`
uniform sampler2D uMask;
uniform vec2  uMaskMin;
uniform vec2  uMaskSpan;
uniform float uTime;
uniform vec2  uWind;
uniform vec2  uWarp;        // x scale, y amount
uniform vec3  uScales;
uniform vec3  uSpeeds;
uniform vec3  uWeights;
uniform vec2  uEdge;        // the mask values the fog fades between
uniform vec2  uEdgeNoise;   // x scale, y amount
uniform vec2  uRimFade;     // where the region channel turns the bank off
uniform float uRimTear;     // and the most the noise may push that inward
uniform vec2  uDetail;      // alpha contrast at the boundary / deep
uniform vec2  uShade;       // colour contrast, likewise
uniform vec3  uColor;
uniform vec3  uColorLight;
uniform vec3  uRim;
uniform float uRimStrength;
uniform float uOpacity;

varying vec3 vWorld;

// Tone mapping and colour space are declared for us: three prepends both pars
// chunks to every ShaderMaterial. Including them again is a redefinition error.
#include <common>
#include <fog_pars_fragment>

// Ashima's 2D simplex noise, unchanged. Roughly [-1, 1].
vec3 permute289( vec3 x ) { return mod( ( ( x * 34.0 ) + 1.0 ) * x, 289.0 ); }
float snoise( vec2 v ) {
  const vec4 C = vec4( 0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439 );
  vec2 i  = floor( v + dot( v, C.yy ) );
  vec2 x0 = v - i + dot( i, C.xx );
  vec2 i1 = ( x0.x > x0.y ) ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 );
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod( i, 289.0 );
  vec3 p = permute289( permute289( i.y + vec3( 0.0, i1.y, 1.0 ) )
                                 + i.x + vec3( 0.0, i1.x, 1.0 ) );
  vec3 m = max( 0.5 - vec3( dot( x0, x0 ), dot( x12.xy, x12.xy ),
                            dot( x12.zw, x12.zw ) ), 0.0 );
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract( p * C.www ) - 1.0;
  vec3 h = abs( x ) - 0.5;
  vec3 ox = floor( x + 0.5 );
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0 * a0 + h * h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot( m, g );
}

vec2 turn( vec2 v, float a ) {
  float c = cos( a ), s = sin( a );
  return vec2( c * v.x - s * v.y, s * v.x + c * v.y );
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;

  // A slow swirl applied to every layer below. Without it, three scrolling noise
  // fields read as three scrolling noise fields; with it they knead each other
  // and the mist turns over instead of sliding past.
  vec2 warp = vec2(
    snoise( ( p + uWind * t * 0.06 ) * uWarp.x ),
    snoise( ( p - uWind * t * 0.05 ) * uWarp.x + 41.7 )
  ) * uWarp.y;

  // Three scales, three speeds, three directions leaning off the one wind.
  float n1 = snoise( ( p + warp        + turn( uWind,  0.00 ) * t * uSpeeds.x ) * uScales.x );
  float n2 = snoise( ( p + warp * 0.6  + turn( uWind,  0.55 ) * t * uSpeeds.y ) * uScales.y );
  float n3 = snoise( ( p + warp * 0.25 + turn( uWind, -0.75 ) * t * uSpeeds.z ) * uScales.z );
  float density = clamp( 0.5 + uWeights.x * n1 + uWeights.y * n2 + uWeights.z * n3, 0.0, 1.0 );

  vec2 muv = ( p - uMaskMin ) / uMaskSpan;
  vec3 mask = texture2D( uMask, muv ).rgb;   // r discovered, g in view, b fogged at all

  // The reveal boundary, pushed about by its own noise so it is not a contour of
  // the blur. It only bites near the boundary - anywhere the mask is well clear
  // of the threshold the smoothstep has already saturated, which is what keeps
  // the deep field from being perforated.
  float wobble = snoise( ( p + warp * 0.5 + uWind * t * 0.05 ) * uEdgeNoise.x );
  float rv = mask.r + wobble * uEdgeNoise.y;
  float cover = 1.0 - smoothstep( uEdge.x, uEdge.y, rv );   // 1 = fogged

  // Where the fogged region itself runs out. Torn by the same wobble, so the
  // bank frays into the open sea instead of ending on a contour.
  // Where the fogged region itself runs out, torn on two scales. The fine wobble
  // is the same one the reveal uses and does the same job; the coarse term is
  // there because the region is a *hexagon* - the level's hex list ends on the
  // envelope's six straight sides, and a blurred hexagon is still a hexagon.
  // Bowing its sides over ten-odd units is what turns it into a coastline. The
  // fine term is kept small on purpose: pushed harder the threshold starts to
  // expose the hex structure still faintly present in the blurred channel, and
  // the bank's edge grows a staircase.
  //
  // The push is clamped one way only, and that clamp is load-bearing rather than
  // cosmetic. The region channel is grown out to sea before it is blurred, so it
  // still reads 1 over every hex the level actually fogs; bounding how far the
  // noise may pull it *back* is what guarantees a bulge of mist can wander
  // further out but never inward far enough to thin the bank over a tile nobody
  // has been to. Reaching further out to sea costs nothing at all.
  float rimBow = snoise( ( p + warp ) * uEdgeNoise.x * 0.32 );
  float push = ( wobble * 0.45 + rimBow * 1.6 ) * uEdgeNoise.y * 1.4;
  float region = smoothstep( uRimFade.x, uRimFade.y, mask.b + max( push, -uRimTear ) );

  // Deep in the unknown the noise all but switches off - the sheet has to hide
  // the board out there, and detail is what would let it be read.
  float detail = mix( uDetail.x, uDetail.y, cover );
  float shade  = mix( uShade.x,  uShade.y,  cover );

  // Variation only ever thins the mist, never thickens it past opaque.
  float aFog = uOpacity * cover * region
             * ( 1.0 - detail * clamp( 0.65 - density, 0.0, 1.0 ) * 1.6 );
  aFog = clamp( aFog, 0.0, 1.0 );

  // Ground that has been walked and is not being watched used to get a dim veil
  // painted here. It is gone: dimming is a statement about *visibility*, and it
  // belongs on the objects themselves rather than on a sheet floating above them
  // - which is also the only way it reaches a tree, a lamp or a unit standing on
  // the tile rather than just the tile.
  float a = aFog;
  if ( a < 0.02 ) discard;

  vec3 body = mix( uColor, uColorLight,
                   clamp( 0.5 + ( density - 0.5 ) * shade * 1.5, 0.0, 1.0 ) );
  // Where the mist is thinning out it catches a little more light, which is what
  // gives the receding edge a lip instead of it just running out of alpha.
  //
  // Gated on being well inside the region, and that gate is not cosmetic. The
  // bank also thins where the *level* runs out, and without this the lip painted
  // a bright line right round the fogged area - an outline on the one boundary
  // that is an artefact of the hex list rather than anything the player did.
  float lip = cover * ( 1.0 - cover ) * 4.0 * smoothstep( 0.80, 0.97, mask.b );
  body = mix( body, uRim, lip * uRimStrength );

  gl_FragColor = vec4( body, a );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
