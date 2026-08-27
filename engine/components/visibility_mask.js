import * as THREE from 'three';
import { Component } from '../gameobject.js';

// What the player cannot see, unlit - and the whole of the fog of war for now.
//
// `VisibilityMap` is the truth: a set of hexes, each unexplored, explored or
// visible. This is the first and simplest thing built on top of it - a tile the
// force is looking at right now renders exactly as it always did, and every
// other tile collapses to the night the island is standing in. No mist, no blur,
// no reveal animation: the hexagon survives all the way into the fragment shader
// on purpose, so what is on screen is precisely what the rules say.
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
      uMaskColor:    { value: new THREE.Color(color) },
      uMaskKeep:     { value: keep },
      uMaskStrength: { value: 1 },
    };

    this._refresh();
    this._unsub = this._vis.onChange(() => this._refresh());
  }

  // Debug: stop the world hiding itself, without touching what has been explored.
  setStrength(v) { this._u.uMaskStrength.value = v; }

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
  patch(root) {
    root.traverse?.((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const one of m) this.patchMaterial(one);
      else this.patchMaterial(m);
    });
    return root;
  }

  patchMaterial(material) {
    if (!material || this._patched.has(material)) return material;
    this._patched.add(material);

    const prev = material.onBeforeCompile;
    // three keys its program cache on the source text of onBeforeCompile, and the
    // closure below reads identically for every material it is put on - so
    // anything that distinguishes them has to go into the key by hand.
    const key = `${prev ? prev.toString() : ''}|mask`;
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
        .replace('#include <tonemapping_fragment>', MASK_FRAGMENT);
    };
    material.needsUpdate = true;
    return material;
  }

  destroy() {
    this._unsub?.();
    this._texture?.dispose();
  }
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
uniform vec3  uMaskColor;
uniform float uMaskKeep;
uniform float uMaskStrength;
varying vec3  vMaskWorld;

// What a fragment on an unwatched hex is worth. The night, plus a trace of the
// surface's own *brightness* and nothing of its colour: out there the player is
// meant to be able to make out that the land keeps going, not to read what is
// standing on it. Monochrome and compressive is what makes that true of every
// material at once - a lantern bulb on an undiscovered tile is worth about what
// the grass beside it is worth, where keeping a flat fraction of the colour left
// bright things showing as bright pinpricks in the dark.
vec3 maskNight( vec3 rgb ) {
  float lum = dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  return uMaskColor + uMaskKeep * ( 1.0 - exp( -10.0 * lum ) );
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
const MASK_FRAGMENT = /* glsl */`
{
  vec2 maskIdx = maskHexAt( vMaskWorld.xz ) - uMaskOrigin;
  float maskHide = 0.0;
  if ( all( greaterThanEqual( maskIdx, vec2( 0.0 ) ) ) && all( lessThan( maskIdx, uMaskSize ) ) ) {
    maskHide = 1.0 - texture2D( uMaskTable, ( maskIdx + 0.5 ) / uMaskSize ).r;
  }
  maskHide *= uMaskStrength;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, maskNight( gl_FragColor.rgb ), maskHide );
  // Anything that draws by *adding* light - a firefly, a lantern's halo, a grid
  // seam - has to go out rather than go dark, because a dark colour added to the
  // night is still a mark on it. Opaque materials do not blend, so this costs
  // them nothing.
  gl_FragColor.a *= 1.0 - maskHide;
}
#include <tonemapping_fragment>
`;
