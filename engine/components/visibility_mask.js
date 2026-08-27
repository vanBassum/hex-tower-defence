import * as THREE from 'three';
import { Component } from '../gameobject.js';

// What the player cannot see, unlit - and the whole of the fog of war for now.
//
// `VisibilityMap` is the truth: a set of hexes, each unexplored, explored or
// visible. A tile the force is looking at right now renders exactly as it always
// did, and every other tile collapses to the night the island is standing in.
//
// Three things happen on top of that, in this order, and the order is the point:
// the hex decides (binary, no softness), the night is laid down, and only then is
// anything cosmetic allowed - the fade that laps the dark over the edge of the
// light, and the slow air drifting out in the dark. Neither of the two can lift a
// hex the player is not watching, which is the one property this file exists to
// keep.
//
// ── Why the hex is rebuilt in the shader ────────────────────────────────────
// The obvious way to get a hex mask to a material is a world-space texture, and
// that is what the version before this one did - but a texture has square texels
// and a hex boundary drawn out of them is a staircase unless it is blurred, and
// blurring is exactly what this pass must not do. So the lookup runs the other
// way round: the fragment takes its own world position, converts it back to
// axial coordinates and rounds - the same arithmetic `HexGrid.worldToHex` does -
// and only then reads a texture holding one texel per hex. The texture is a
// table indexed by (q, r) rather than a picture of the board, so the edge it
// produces is the mathematical hex edge and nothing else.
//
// Anything not in the table reads as visible. That is what keeps the open ocean
// past the coast, and anything else standing off the board, out of this.
export class VisibilityMask extends Component {
  constructor(grid, visibility, {
    hexes = null,          // every hex the mask covers - land and sea both
    hexSize = 1,
    color = 0x070c16,      // what a tile nobody is watching is worth
    keep  = 0.06,          // how much of its own shading survives - see below
    // How far the night reaches back *inside* the watched region, as a fraction
    // of a hex's width. Cosmetic and one-directional: it only ever takes light
    // away from a tile the player can see, so no amount of it can lift a hex the
    // player cannot. See the note over `maskFragment`.
    fade  = 0.18,
    // The weather in the dark - see `maskAirAt`. Off unless a level asks for it.
    air   = null,          // { amount, tint, scale, speed, hold }
    // And the banks standing in it - a second field entirely. See maskCloudAt.
    cloud = null,          // { amount, tint, scale, speed, band, warp, hold }
    // How the dark leaves a hex that has just been found. Presentation only: the
    // rule has already changed by the time any of this is drawn.
    reveal = null,         // { time, soft, jitter, grain }
    // Which way it drifts, and how hard. The level's one wind, handed in rather
    // than picked here: three effects with private weather look like three
    // effects.
    drift = null,          // { angle, flow }
  } = {}) {
    super();
    this._grid = grid;
    this._vis  = visibility;
    this._hexList = (hexes ? [...hexes] : [...grid.allHexes()]).map(h => ({ q: h.q, r: h.r }));

    this._patched = new Set();
    this._build();

    this._u = {
      uMaskTable:    { value: this._texture },
      uMaskOrigin:   { value: new THREE.Vector2(this._qMin, this._rMin) },
      uMaskSize:     { value: new THREE.Vector2(this._w, this._h) },
      uMaskHexSize:  { value: hexSize },
      // Centre to edge, which is what the fade below measures from.
      uMaskInradius: { value: hexSize * Math.sqrt(3) / 2 },
      // A hex's width is two circumradii. Never zero: it divides a smoothstep.
      uMaskFade:     { value: Math.max(fade * 2 * hexSize, 1e-4) },
      uMaskColor:    { value: new THREE.Color(color) },
      uMaskKeep:     { value: keep },
      uMaskStrength: { value: 1 },
      ...airUniforms(air, drift),
      ...cloudUniforms(cloud, drift),
      ...revealUniforms(reveal),
    };

    // Seconds for the dark to cross one hex, as a rate. Instant if a level asks
    // for nothing: a reveal of zero has to still be a reveal, not a divide by it.
    this._revealRate = 1 / Math.max(reveal?.time ?? 0.65, 1e-3);

    this._refresh(true);
    this._unsub = this._vis.onChange(() => this._refresh());
  }

  // Debug: stop the world hiding itself, without touching what has been explored.
  setStrength(v) { this._u.uMaskStrength.value = v; }

  // Where the air actually lands, and on what. 1 paints the raw haze noise in
  // cyan at full strength with its band and hold bypassed; 2 paints every
  // fragment whose own hex is night flat magenta, which is a map of what geometry
  // is under the dark at all; 3 paints the cloud field, banded and held back
  // exactly as it really is, so its coverage can be read off. All go through
  // untouched - tone curve, distance haze - so what reaches the screen is what
  // the real term would have had done to it.
  setAirDebug(v) { this._u.uMaskAirDebug.value = v; }

  // The weather runs on unscaled time, like the swell and the sway - the debug
  // speed slider is for watching a fight at a tenth, not for changing the
  // weather while you do it. The reveal runs on scaled time; see `_advance`.
  update(dt, rawDt) {
    this._u.uMaskTime.value += rawDt;
    if (this._settling) this._advance(dt);
  }

  // ── The table ─────────────────────────────────────────────────────────────

  _build() {
    let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const { q, r } of this._hexList) {
      if (q < qMin) qMin = q;
      if (q > qMax) qMax = q;
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    this._qMin = qMin; this._rMin = rMin;
    this._w = qMax - qMin + 1;
    this._h = rMax - rMin + 1;

    // One texel per hex, nearest-sampled, and every texel outside the level's
    // own hexes left at "visible" - a hole in a shaped board is open sea, not
    // undiscovered ground.
    //
    // Two channels, and keeping them apart is the whole of how the reveal stays
    // honest. **R is the rule**: watched or not, binary, changed the instant the
    // VisibilityMap says so, and the only thing culling reads. **G is the
    // picture**: how far through its reveal the hex is, which eases from one to
    // the other over `reveal.time` and is what every cosmetic term reads. A hex
    // is therefore *fully* a gameplay fact before it has finished looking like
    // one, and never the other way round.
    this._data = new Uint8Array(this._w * this._h * 4).fill(255);
    // Where each hex is going, and where it has got to. Indexed like the texture.
    this._goal = new Float32Array(this._w * this._h).fill(1);
    this._cur  = new Float32Array(this._w * this._h).fill(1);
    this._texture = new THREE.DataTexture(this._data, this._w, this._h, THREE.RGBAFormat);
    this._texture.minFilter = this._texture.magFilter = THREE.NearestFilter;
    this._texture.wrapS = this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.generateMipmaps = false;
    this._texture.needsUpdate = true;
  }

  // The only place the two systems touch, and it is one-way: hexes in, a table
  // out. Cheap enough to redo whole on every change - it is two bytes per hex.
  //
  // The rule lands immediately. The picture is only given a new destination here;
  // `_advance` walks it there. `instant` is construction: whatever is already
  // known at the start of a run has always been known, and should not sweep in.
  _refresh(instant = false) {
    let settling = false;
    for (const { q, r } of this._hexList) {
      const t = (r - this._rMin) * this._w + (q - this._qMin);
      const lit = this._vis.isVisible(q, r) ? 1 : 0;
      this._data[t * 4] = lit ? 255 : 0;
      this._goal[t] = lit;
      if (instant) {
        this._cur[t] = lit;
        this._data[t * 4 + 1] = lit ? 255 : 0;
      } else if (this._cur[t] !== lit) {
        settling = true;
      }
    }
    if (settling) this._settling = true;
    this._texture.needsUpdate = true;
  }

  // The dark arriving and leaving, one step a frame. Scaled time rather than raw:
  // this is tied to a unit walking, and the debug speed slider is for watching
  // exactly this kind of thing happen slowly.
  _advance(dt) {
    const step = this._revealRate * dt;
    let settling = false;
    for (const { q, r } of this._hexList) {
      const t = (r - this._rMin) * this._w + (q - this._qMin);
      const goal = this._goal[t];
      let cur = this._cur[t];
      if (cur === goal) continue;
      cur = goal > cur ? Math.min(goal, cur + step) : Math.max(goal, cur - step);
      this._cur[t] = cur;
      this._data[t * 4 + 1] = cur * 255;
      if (cur !== goal) settling = true;
    }
    this._settling = settling;
    this._texture.needsUpdate = true;
  }

  // ── Making the world answer for it ────────────────────────────────────────

  // One call in main.js per layer, and the layer never hears about it: whether a
  // thing obeys fog of war is a fact about the scene, not about the thing.
  //
  // `cull` is the difference between the two kinds of thing in the scene, and it
  // is the rule rather than a look. Terrain is *land*, and land nobody is
  // watching still has to read as land continuing into the dark, so it is dimmed
  // to almost nothing and left there. Everything standing on it - a unit, an
  // enemy, a prop, a pickup - is gameplay information, and information is not
  // dimmed, it is thrown away: the fragment is discarded outright on a hex the
  // force is not watching, so there is nothing on screen to read, not even a
  // silhouette against the ground behind it.
  patch(root, opts) {
    root.traverse?.((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const one of m) this.patchMaterial(one, opts);
      else this.patchMaterial(m, opts);
    });
    return root;
  }

  patchMaterial(material, { cull = false } = {}) {
    if (!material || this._patched.has(material)) return material;
    this._patched.add(material);

    const prev = material.onBeforeCompile;
    // three keys its program cache on the source text of onBeforeCompile, and the
    // closure below reads identically for every material it is put on - so
    // anything that distinguishes them has to go into the key by hand.
    const key = `${prev ? prev.toString() : ''}|mask${cull ? 'c' : ''}`;
    material.customProgramCacheKey = () => key;

    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      // The same uniform *objects*, not copies, so one mask drives the whole
      // scene and a change to it needs no bookkeeping anywhere.
      Object.assign(shader.uniforms, this._u);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMaskWorld;')
        .replace('#include <project_vertex>', MASK_VERTEX);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', MASK_FRAG_PARS)
        .replace('#include <tonemapping_fragment>', maskFragment(cull));
    };
    material.needsUpdate = true;
    return material;
  }

  destroy() {
    this._unsub?.();
    this._texture?.dispose();
  }
}

// Two fields at different scales drifting on the same wind at different speeds -
// the second one turned well off the first, because two shapes crossing is what
// stops the pair reading as one texture being pulled across the board.
function airUniforms(air, drift) {
  const a = { amount: 0, tint: 0x4d80ff, scale: 16, speed: 0.16, band: [0.4, 0.95], hold: 1.0,
              ...(air || {}) };
  const angle = drift?.angle ?? 0;
  const flow  = drift?.flow ?? 1;
  return {
    uMaskTime:      { value: 0 },
    uMaskAirAmount: { value: a.amount },
    uMaskAirTint:   { value: new THREE.Color(a.tint) },
    uMaskAirScale:  { value: a.scale },
    uMaskAirBand:   { value: new THREE.Vector2(a.band[0], a.band[1]) },
    // 0 off, 1 the air itself in cyan at full strength, 2 every night fragment
    // flat magenta. See setAirDebug.
    uMaskAirDebug:  { value: 0 },
    uMaskAirSpeed:  { value: a.speed * flow },
    // Never zero: it divides a smoothstep.
    uMaskAirHold:   { value: Math.max(a.hold, 1e-4) },
    uMaskAirDriftA: { value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)) },
    uMaskAirDriftB: { value: new THREE.Vector2(Math.cos(angle + 2.2), Math.sin(angle + 2.2)) },
  };
}

// The banks. Everything here is their own - scale, drift, seeds - because two
// layers sharing any of it move together, and two things moving together are one
// thing. The direction is off the same wind by a fixed angle rather than picked
// freely: a bank crossing the board *against* the haze it sits in would be two
// weathers, where a bank crossing it at a slant is one sky with height in it.
function cloudUniforms(cloud, drift) {
  const c = { amount: 0, tint: 0x93aecc, scale: 13, speed: 0.06, band: [0.64, 0.92],
              warp: 0.55, hold: 2.5, ...(cloud || {}) };
  const angle = (drift?.angle ?? 0) + 1.1;
  const flow  = drift?.flow ?? 1;
  return {
    uMaskCloudAmount: { value: c.amount },
    uMaskCloudTint:   { value: new THREE.Color(c.tint) },
    uMaskCloudScale:  { value: c.scale },
    uMaskCloudSpeed:  { value: c.speed * flow },
    uMaskCloudBand:   { value: new THREE.Vector2(c.band[0], c.band[1]) },
    uMaskCloudWarp:   { value: c.warp },
    // Never zero: it divides a smoothstep.
    uMaskCloudHold:   { value: Math.max(c.hold, 1e-4) },
    uMaskCloudDrift:  { value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)) },
  };
}

// How the front that crosses a revealing hex is shaped. `soft` is its width as a
// fraction of the hex, and it must never be zero: it divides.
function revealUniforms(reveal) {
  const r = { soft: 0.45, jitter: 0.30, grain: 2.6, ...(reveal || {}) };
  return {
    uMaskRevealSoft:   { value: Math.max(r.soft, 1e-3) },
    uMaskRevealJitter: { value: r.jitter },
    uMaskRevealGrain:  { value: Math.max(r.grain, 1e-3) },
  };
}

// World position, taken the same way three takes it, instancing included - the
// hex is worked out from it, so every reader has to agree where it is.
const MASK_VERTEX = /* glsl */`
#include <project_vertex>
vec4 maskWorldPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  maskWorldPos = instanceMatrix * maskWorldPos;
#endif
vMaskWorld = ( modelMatrix * maskWorldPos ).xyz;
`;

const MASK_FRAG_PARS = /* glsl */`
#include <common>
uniform sampler2D uMaskTable;
uniform vec2  uMaskOrigin;
uniform vec2  uMaskSize;
uniform float uMaskHexSize;
uniform float uMaskInradius;
uniform float uMaskFade;
uniform vec3  uMaskColor;
uniform float uMaskKeep;
uniform float uMaskStrength;
uniform float uMaskTime;
uniform float uMaskAirAmount;
uniform vec3  uMaskAirTint;
uniform float uMaskAirScale;
uniform vec2  uMaskAirBand;
uniform float uMaskAirDebug;
uniform float uMaskCloudAmount;
uniform vec3  uMaskCloudTint;
uniform float uMaskCloudScale;
uniform float uMaskCloudSpeed;
uniform vec2  uMaskCloudBand;
uniform float uMaskCloudWarp;
uniform float uMaskCloudHold;
uniform vec2  uMaskCloudDrift;
uniform float uMaskRevealSoft;
uniform float uMaskRevealJitter;
uniform float uMaskRevealGrain;
uniform float uMaskAirSpeed;
uniform float uMaskAirHold;
uniform vec2  uMaskAirDriftA;
uniform vec2  uMaskAirDriftB;
varying vec3  vMaskWorld;

// What a fragment on an unwatched hex is worth. The night, a trace of the
// surface's own *brightness* and nothing of its colour, and whatever the air out
// there is doing. Out there the player is meant to be able to make out that the
// land keeps going, not to read what is standing on it - monochrome and
// compressive is what makes that true of every material at once, where keeping a
// flat fraction of the colour left bright things showing as bright pinpricks.
vec3 maskNight( vec3 rgb, float air, float cloud ) {
  if ( uMaskAirDebug > 2.5 ) return vec3( cloud, cloud * 0.15, cloud );
  if ( uMaskAirDebug > 1.5 ) return vec3( 1.0, 0.0, 1.0 );
  if ( uMaskAirDebug > 0.5 ) return vec3( 0.0, air, air );
  float lum = dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  return uMaskColor
    + uMaskKeep * ( 1.0 - exp( -10.0 * lum ) )
    + uMaskAirAmount * air * uMaskAirTint
    + uMaskCloudAmount * cloud * uMaskCloudTint;
}

// No sine in here, and the lattice is offset off the integers, because both of
// those put a hole in the field. sin(0) is 0, so the old hash returned exactly
// zero at the lattice point on the world origin - which is the middle of the
// board, where the run starts - and every fract-of-a-product hash degenerates
// the same way on an exact zero. A non-integer offset means no sample ever lands
// on it, and it doubles as the per-octave seed.
float maskHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 19.19 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float maskNoise( vec2 p, vec2 seed ) {
  vec2 i = floor( p ) + seed, f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( maskHash( i ),                  maskHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( maskHash( i + vec2( 0.0, 1.0 ) ), maskHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}

// The weather in the dark. Two fields crossing each other slowly: one field
// drifting on its own reads as a texture being pulled across the board, and two
// at different scales and angles never repeat their arrangement, which is what
// turns a moving pattern into air. Sampled in *world* space, so it stays put when
// the camera turns.
//
// The primary carries the shapes and the second is coarser and slower - regional
// weather, a few features across the whole island, deciding where the primary's
// shapes are thick and where they thin out. It was the other way round once, a
// *finer* second field, which only added detail nothing was asking for.
//
// The board is about fifty world units across, so a scale of six gives eight or
// nine features over it - the coarse version of this had three, which is why the
// whole thing turned on the luck of a handful of lattice values.
//
// uMaskAirBand is what decides whether this is patches or haze: it is the slice
// of the noise that becomes air at all. Its low end is where the dark still goes
// black between shapes, and its high end is where a shape tops out - so widening
// it lifts the whole region and narrowing it leaves only the peaks.
float maskAirAt( vec2 xz ) {
  vec2 a = ( xz + uMaskAirDriftA * ( uMaskTime * uMaskAirSpeed        ) ) / uMaskAirScale;
  vec2 b = ( xz + uMaskAirDriftB * ( uMaskTime * uMaskAirSpeed * 0.55 ) ) / ( uMaskAirScale * 2.2 );
  // Averaging two fields pulls the result to the middle - the sum of two randoms
  // is always narrower than either of them - so the contrast is put back after
  // the average rather than the average being avoided. What comes out spans 0..1
  // with a mean near a half whatever the scales are, which is the property that
  // lets the band below keep meaning the same thing when the scale is retuned.
  float n = 0.7 * maskNoise( a, vec2( 37.2, 91.7 ) )
          + 0.3 * maskNoise( b, vec2( 11.3, 57.9 ) );
  return clamp( 0.5 + ( n - 0.5 ) * 1.7, 0.0, 1.0 );
}

// HexGrid.worldToHex, in GLSL: flat-top axial, then cube rounding. Kept in step
// with the JS by hand - if one of them changes the mask stops agreeing with the
// rules, which shows up as an edge half a tile out of place.
vec2 maskHexAt( vec2 p ) {
  float q = ( 2.0 / 3.0 ) * p.x / uMaskHexSize;
  float r = ( -p.x / 3.0 + 0.57735026919 * p.y ) / uMaskHexSize;
  float y = -q - r;
  float rq = floor( q + 0.5 ), ry = floor( y + 0.5 ), rr = floor( r + 0.5 );
  float dq = abs( rq - q ), dy = abs( ry - y ), dr = abs( rr - r );
  if ( dq > dy && dq > dr ) rq = -ry - rr;
  else if ( dy > dr )       ry = -rq - rr;
  else                      rr = -rq - ry;
  return vec2( rq, rr );
}

// The two readings of a hex, and which one a thing is allowed to ask matters.
// Anything off the table counts as watched and finished - the open ocean past the
// coast is not a secret.
//
// 'maskRule' is the gameplay fact, and only the culling below may read it: an
// object on an unwatched hex is not drawn at all, and it starts being drawn the
// instant the rule changes rather than when the picture catches up.
//
// 'maskShown' is how far through its reveal a hex is - 0 night, 1 open - and
// every cosmetic term reads this one instead. 'maskWatched' is the same thing
// asked as a yes or no, for the geometry that needs a side rather than a degree:
// which edges the fade band and the weather's hold-back are measured from.
float maskRule( vec2 ax ) {
  vec2 idx = ax - uMaskOrigin;
  if ( any( lessThan( idx, vec2( 0.0 ) ) ) || any( greaterThanEqual( idx, uMaskSize ) ) ) return 1.0;
  return texture2D( uMaskTable, ( idx + 0.5 ) / uMaskSize ).r;
}

float maskShown( vec2 ax ) {
  vec2 idx = ax - uMaskOrigin;
  if ( any( lessThan( idx, vec2( 0.0 ) ) ) || any( greaterThanEqual( idx, uMaskSize ) ) ) return 1.0;
  return texture2D( uMaskTable, ( idx + 0.5 ) / uMaskSize ).g;
}

// Which of the two sides a neighbour is on, for whichever side is being measured
// from - and the two questions are deliberately asked of different things.
//
// The band that laps the dark over the edge of the lit region asks the **rule**:
// is the far side genuinely unwatched? Anything softer outlines every hex in the
// region while it is revealing, which is what a black seam down the middle of the
// explored ground was. A neighbour halfway through its own reveal is not half
// night for this purpose - it is ground the player already owns, and the two have
// to merge into one region with nothing drawn between them.
//
// The distance to the light, which the reveal front comes in from and the weather
// is held off by, asks the **picture**: a neighbour halfway through its reveal is
// halfway a source of light, and that one has to be continuous or the hold-back
// steps as the reveal crosses it.
float maskSide( vec2 ax, float want ) {
  return want > 0.5 ? maskShown( ax ) : 1.0 - maskRule( ax );
}

vec2 maskCenter( vec2 ax ) {
  return uMaskHexSize * vec2( 1.5 * ax.x, 1.73205081 * ( ax.y + 0.5 * ax.x ) );
}

// The banks standing in that air, and a field of their own end to end. Three
// things make them banks rather than more haze:
//
//   - a *threshold* rather than a level, so most of the dark has no cloud in it
//     at all and what there is has an edge - soft, but findable;
//   - a **domain warp**, which is the whole reason they are not blobs. The sample
//     point is pushed about by a slower field before the noise is read, so the
//     shapes come off the lattice they are built on. Without it a sparse
//     threshold cuts evenly spaced lumps and the eye finds the grid in a second;
//   - a second octave at twice the frequency, which is what makes an edge ragged
//     instead of a smooth contour line.
float maskCloudAt( vec2 xz ) {
  vec2 p = ( xz + uMaskCloudDrift * ( uMaskTime * uMaskCloudSpeed ) ) / uMaskCloudScale;
  vec2 w = vec2( maskNoise( p * 0.5 + vec2( 5.2, 1.3 ), vec2( 63.4, 12.8 ) ),
                 maskNoise( p * 0.5 + vec2( 9.1, 7.7 ), vec2( 24.6, 88.1 ) ) ) - 0.5;
  p += w * uMaskCloudWarp;
  float n = 0.65 * maskNoise( p,       vec2( 71.9, 19.4 ) )
          + 0.35 * maskNoise( p * 2.1, vec2( 44.2, 66.5 ) );
  n = clamp( 0.5 + ( n - 0.5 ) * 1.7, 0.0, 1.0 );
  return smoothstep( uMaskCloudBand.x, uMaskCloudBand.y, n );
}

// How far inside the edge shared with this neighbour the fragment sits, and out
// of reach when the neighbour is not on the far side at all - so a neighbour on
// our own side never enters the minimum below, which is what makes the distance
// follow the perimeter of the whole region rather than the outline of each hex in
// it.
//
// The neighbour's share of that side *weights* the distance instead of gating it,
// and that is not a nicety. Thresholding it left a black line standing along the
// edge of a hex that had already opened: the hex counted as night to its
// neighbour for the first half of its reveal, so the neighbour painted a full
// fade band there, while the hex's own front had already cleared the same edge -
// bright, dark line, bright. Dividing by the weight fades the band out as the
// neighbour lightens, and leaves the settled ends exactly where they were, since
// a weight of one changes nothing and a weight of zero is out of reach.
float maskEdgeDepth( vec2 ax, vec2 off, vec2 dir, float weight ) {
  if ( weight < 0.004 ) return 1000.0;
  return ( uMaskInradius - dot( off, dir ) ) / weight;
}

// How far this fragment is from the nearest boundary with the other side. Both
// directions are the same question asked twice: 'want' 0.0 measures a watched
// fragment's distance in from the night, and 1.0 measures a night fragment's
// distance in from the light.
float maskBoundaryDepth( vec2 ax, vec2 xz, float want ) {
  vec2 off = xz - maskCenter( ax );
  float d =        maskEdgeDepth( ax, off, vec2(  0.8660254,  0.5 ), maskSide( ax + vec2(  1.0,  0.0 ), want ) );
  d = min( d, maskEdgeDepth( ax, off, vec2(  0.8660254, -0.5 ), maskSide( ax + vec2(  1.0, -1.0 ), want ) ) );
  d = min( d, maskEdgeDepth( ax, off, vec2(  0.0,       -1.0 ), maskSide( ax + vec2(  0.0, -1.0 ), want ) ) );
  d = min( d, maskEdgeDepth( ax, off, vec2( -0.8660254, -0.5 ), maskSide( ax + vec2( -1.0,  0.0 ), want ) ) );
  d = min( d, maskEdgeDepth( ax, off, vec2( -0.8660254,  0.5 ), maskSide( ax + vec2( -1.0,  1.0 ), want ) ) );
  d = min( d, maskEdgeDepth( ax, off, vec2(  0.0,        1.0 ), maskSide( ax + vec2(  0.0,  1.0 ), want ) ) );
  return d;
}
`;

// Injected where the fragment's colour is settled but before tone mapping, so an
// unlit tile goes through the same tone curve and the same distance haze as
// everything else - which is what lets the hidden ground and the horizon behind
// it read as one night rather than as two darks with a seam between them.
//
// `uMaskKeep` is why the ground out there is not a flat cutout: a trace of the
// surface's own brightness is left in - see `maskNight` - so a cliff face and a
// tile top are still *just* separable and the island reads as continuing into
// the dark rather than ending at the edge of the light.
//
// ── The band, and why it can only ever hide more ────────────────────────────
// Gameplay visibility is binary and stays binary: a hex is watched or it is
// night, and the fragment's own hex decides which with no softness anywhere in
// it. The softening runs entirely in the other direction - a fragment on a
// *watched* hex within `uMaskFade` of an edge it shares with the night is faded
// toward that night, so the darkness laps a little way over the lit ground
// instead of stopping dead along a hex edge.
//
// That asymmetry is the whole safety argument. The band takes light away from
// tiles the player can already see; there is no term anywhere that can give any
// to a tile they cannot. An unwatched hex is worth exactly `maskNight` of itself
// whatever its neighbours are doing, and anything standing on one is discarded
// before the fade is even computed.
function maskFragment(cull) {
  return /* glsl */`
{
  vec2 maskAx = maskHexAt( vMaskWorld.xz );
${cull ? `
  // Not dimmed - gone, and off the *rule* rather than off the picture. This is
  // the information rule: on an unwatched hex there is to be nothing on screen
  // to read, not even a shape against the ground behind it. Reading the rule is
  // what keeps that true through a reveal - a hex is a gameplay fact before it
  // has finished looking like one, so an object waits for the fact and then
  // emerges with the dark, painted toward the night by the same term the ground
  // is until the front has passed it.
  if ( maskRule( maskAx ) < 0.5 ) discard;
` : ''}
  // How far through its own reveal this hex is, eased so the dark neither starts
  // nor stops abruptly. 0 and 1 are left exactly alone, which is what makes the
  // two ends of the animation identical to the two static looks.
  float maskP = maskShown( maskAx );
  maskP = maskP * maskP * ( 3.0 - 2.0 * maskP );

  float maskLocal = 1.0;
  float maskAir = 0.0;
  float maskCloud = 0.0;

  if ( maskP < 1.0 ) {
    float maskToLight = maskBoundaryDepth( maskAx, vMaskWorld.xz, 1.0 );

    // The front crosses the hex from the edge the light is already on rather than
    // the whole tile fading at once - which is the difference between the dark
    // *retreating* and the dark being turned down. A hex with no lit neighbour to
    // come in from - the first hex of a run, a unit put down out of nowhere - has
    // no direction to offer, and fades evenly instead.
    float maskU = maskToLight > 999.0
      ? 0.0
      : clamp( maskToLight / ( 2.0 * uMaskInradius ), 0.0, 1.0 );
    // And a wobble on it, so the edge is a tide line rather than a wipe. Static
    // and in world space: the raggedness belongs to the ground it crosses, not to
    // the clock. Clamped back into the tile because the front must still be
    // nowhere at zero and everywhere at one.
    maskU = clamp( maskU + ( maskNoise( vMaskWorld.xz / uMaskRevealGrain, vec2( 13.7, 82.1 ) ) - 0.5 )
                          * uMaskRevealJitter, 0.0, 1.0 );
    float maskFront = maskP * ( 1.0 + uMaskRevealSoft );
    maskLocal = clamp( ( maskFront - maskU ) / uMaskRevealSoft, 0.0, 1.0 );

    if ( maskLocal < 1.0 ) {
      // Still night here, and the night has weather in it. Both are held off the
      // light by the same edge distance the front is measured from, so the two
      // agree about where the boundary is - and both leave with the dark rather
      // than switching off, because everything below is scaled by what is left of
      // it.
      float maskRaw = maskAirAt( vMaskWorld.xz );
      maskAir = smoothstep( uMaskAirBand.x, uMaskAirBand.y, maskRaw )
        * smoothstep( 0.0, uMaskAirHold, maskToLight );
      // The banks are held off the reveal edge harder than the haze is: a dense
      // shape landing on the boundary is what would read as a wall standing
      // around the ground the player can see.
      maskCloud = maskCloudAt( vMaskWorld.xz )
        * smoothstep( 0.0, uMaskCloudHold, maskToLight );
      if ( uMaskAirDebug > 0.5 && uMaskAirDebug < 1.5 ) maskAir = maskRaw;
    }
  }

  float maskHide = 1.0;
  if ( maskLocal > 0.0 ) {
    // What this fragment is worth once the front has passed: the static visible
    // look, band and all. Mixed by the front, so a fragment is the hidden look
    // exactly until the front reaches it and the visible look exactly after.
    float maskOpen = 1.0 - smoothstep( 0.0, uMaskFade,
      maskBoundaryDepth( maskAx, vMaskWorld.xz, 0.0 ) );
    maskHide = mix( 1.0, maskOpen, maskLocal );
  }
  maskHide *= uMaskStrength;

  gl_FragColor.rgb = mix( gl_FragColor.rgb, maskNight( gl_FragColor.rgb, maskAir, maskCloud ), maskHide );
  // Anything that draws by *adding* light - a firefly, a lantern's halo, a grid
  // seam - has to go out rather than go dark, because a dark colour added to the
  // night is still a mark on it. Opaque materials do not blend, so this costs
  // them nothing.
  gl_FragColor.a *= 1.0 - maskHide;
}
#include <tonemapping_fragment>
`;
}
