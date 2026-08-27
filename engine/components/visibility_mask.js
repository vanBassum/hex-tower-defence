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
    };

    this._refresh();
    this._unsub = this._vis.onChange(() => this._refresh());
  }

  // Debug: stop the world hiding itself, without touching what has been explored.
  setStrength(v) { this._u.uMaskStrength.value = v; }

  // Where the air actually lands, and on what. 1 paints the raw noise in cyan at
  // full strength with the band and the boundary hold both bypassed; 2 paints
  // every fragment whose own hex is night flat magenta, which is a map of what
  // geometry exists under the dark at all. Both go through the rest of the frame
  // untouched - tone curve, distance haze - so what reaches the screen is what
  // the real term would have had done to it.
  setAirDebug(v) { this._u.uMaskAirDebug.value = v; }

  // Unscaled, like the swell and the sway: the debug speed slider is for watching
  // a fight at a tenth, not for changing the weather while you do it.
  update(_dt, rawDt) { this._u.uMaskTime.value += rawDt; }

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
    this._data = new Uint8Array(this._w * this._h * 4).fill(255);
    this._texture = new THREE.DataTexture(this._data, this._w, this._h, THREE.RGBAFormat);
    this._texture.minFilter = this._texture.magFilter = THREE.NearestFilter;
    this._texture.wrapS = this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.generateMipmaps = false;
    this._texture.needsUpdate = true;
  }

  // The only place the two systems touch, and it is one-way: hexes in, a table
  // out. Cheap enough to redo whole on every change - it is one byte per hex.
  _refresh() {
    for (const { q, r } of this._hexList) {
      const i = ((r - this._rMin) * this._w + (q - this._qMin)) * 4;
      this._data[i] = this._vis.isVisible(q, r) ? 255 : 0;
    }
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
vec3 maskNight( vec3 rgb, float air ) {
  if ( uMaskAirDebug > 1.5 ) return vec3( 1.0, 0.0, 1.0 );
  if ( uMaskAirDebug > 0.5 ) return vec3( 0.0, air, air );
  float lum = dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  return uMaskColor
    + uMaskKeep * ( 1.0 - exp( -10.0 * lum ) )
    + uMaskAirAmount * air * uMaskAirTint;
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

// Is this hex watched? Anything off the table counts as watched - the open ocean
// past the coast is not a secret.
float maskWatched( vec2 ax ) {
  vec2 idx = ax - uMaskOrigin;
  if ( any( lessThan( idx, vec2( 0.0 ) ) ) || any( greaterThanEqual( idx, uMaskSize ) ) ) return 1.0;
  return texture2D( uMaskTable, ( idx + 0.5 ) / uMaskSize ).r;
}

vec2 maskCenter( vec2 ax ) {
  return uMaskHexSize * vec2( 1.5 * ax.x, 1.73205081 * ( ax.y + 0.5 * ax.x ) );
}

// How far inside the edge shared with this neighbour the fragment sits - but only
// when the neighbour is on the far side of the boundary being measured - 'want' is
// what that side is worth - and out of reach otherwise. A neighbour on our own
// side never enters the minimum below, which is what makes the distance follow
// the perimeter of the whole region rather than the outline of each hex in it.
float maskEdgeDepth( vec2 ax, vec2 off, vec2 nb, vec2 dir, float want ) {
  if ( abs( maskWatched( ax + nb ) - want ) > 0.5 ) return 1000.0;
  return uMaskInradius - dot( off, dir );
}

// How far this fragment is from the nearest boundary with the other side. Both
// directions are the same question asked twice: 'want' 0.0 measures a watched
// fragment's distance in from the night, and 1.0 measures a night fragment's
// distance in from the light.
float maskBoundaryDepth( vec2 ax, vec2 xz, float want ) {
  vec2 off = xz - maskCenter( ax );
  float d =        maskEdgeDepth( ax, off, vec2(  1.0,  0.0 ), vec2(  0.8660254,  0.5 ), want );
  d = min( d, maskEdgeDepth( ax, off, vec2(  1.0, -1.0 ), vec2(  0.8660254, -0.5 ), want ) );
  d = min( d, maskEdgeDepth( ax, off, vec2(  0.0, -1.0 ), vec2(  0.0,       -1.0 ), want ) );
  d = min( d, maskEdgeDepth( ax, off, vec2( -1.0,  0.0 ), vec2( -0.8660254, -0.5 ), want ) );
  d = min( d, maskEdgeDepth( ax, off, vec2( -1.0,  1.0 ), vec2( -0.8660254,  0.5 ), want ) );
  d = min( d, maskEdgeDepth( ax, off, vec2(  0.0,  1.0 ), vec2(  0.0,        1.0 ), want ) );
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
  float maskHide = 1.0 - maskWatched( maskAx );
${cull ? `
  // Not dimmed - gone. This is the information rule, not a look: on an unwatched
  // hex there is to be nothing on screen to read, not even a shape against the
  // ground behind it. It tests the fragment's own hex rather than the faded
  // value, so a prop or a man standing in the band on a watched tile darkens
  // with the ground he is standing on instead of blinking out of existence.
  if ( maskHide > 0.5 ) discard;
` : ''}
  float maskAir = 0.0;
  if ( maskHide > 0.5 ) {
    // Weather, held out of the boundary. The air builds up over 'uMaskAirHold'
    // as the night gets further from the light, so the edge of the lit region is
    // plain dark on both sides of itself - the fade on one side and nothing on
    // the other - and no drifting shape can put a lip on it.
    float maskRaw = maskAirAt( vMaskWorld.xz );
    maskAir = smoothstep( uMaskAirBand.x, uMaskAirBand.y, maskRaw )
      * smoothstep( 0.0, uMaskAirHold, maskBoundaryDepth( maskAx, vMaskWorld.xz, 1.0 ) );
    if ( uMaskAirDebug > 0.5 ) maskAir = maskRaw;
  } else {
    maskHide = 1.0 - smoothstep( 0.0, uMaskFade, maskBoundaryDepth( maskAx, vMaskWorld.xz, 0.0 ) );
  }
  maskHide *= uMaskStrength;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, maskNight( gl_FragColor.rgb, maskAir ), maskHide );
  // Anything that draws by *adding* light - a firefly, a lantern's halo, a grid
  // seam - has to go out rather than go dark, because a dark colour added to the
  // night is still a mark on it. Opaque materials do not blend, so this costs
  // them nothing.
  gl_FragColor.a *= 1.0 - maskHide;
}
#include <tonemapping_fragment>
`;
}
