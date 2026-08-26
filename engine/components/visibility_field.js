import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { HEX_VISIBILITY } from '../hex/visibility.js';

// What the player has discovered, as something a shader can read - and the one
// place in the engine that turns hexes into pixels.
//
// `VisibilityMap` is the truth: a set of hexes, each unexplored, explored or
// visible, and nothing in it knows what any of that looks like. This takes that
// map, rasterises it into a world-space texture and blurs it, and hands the
// result to anything that has to answer for it. Gameplay stays exactly as
// discrete as it was; by the time a fragment shader sees it, the hexagons are
// gone.
//
// ── Who reads it, and why it is one field and not two ───────────────────────
// Two entirely different things read this texture:
//
//   - **FogOfWar**, which draws the mist. That is *mood* - a soft blanket over
//     the part of the board nobody has walked.
//   - **every other material in the world**, through `patch()` below. That is
//     *rules* - terrain, props, units and grid lines on an undiscovered hex are
//     painted out to the mist's own colour, and ground the player has walked but
//     is not watching is dimmed.
//
// The split matters, and it was learned the hard way. For a while the mist was
// the only thing hiding anything, which works right up until the camera drops
// below it: a horizontal sheet occludes nothing when you look along it, and the
// whole unexplored half of the island was in plain view from a low angle. A
// blanket cannot be a wall. So the sheet went back to being decoration and the
// objects took over hiding themselves - which is correct from every angle for
// free, because an object that paints itself out has no silhouette to peer past.
//
// Both read the *same* texture, so the mist and the hidden ground always agree
// about where the edge is.
//
// ── The four channels ───────────────────────────────────────────────────────
//   R  discovered, softly    - the mist's own boundary, blurred over a hex or so
//                              so the reveal is organic rather than hexagonal
//   G  in view right now     - drives the dimming of remembered ground
//   B  inside the fogged region at all - so nothing dims the open sea
//   A  discovered, sharply   - the same fact as R, blurred only just enough to
//                              take the corners off
//
// R and A are the same fact at two different softnesses and both are needed.
// R has to be soft, because a hard reveal edge on the mist is a hexagon. A has to
// be tight, because it decides whether the player may *see* a thing, and a blur
// wide enough to look good on mist would dim the middle of a tile the player is
// standing on. Softness is a matter of taste on one and a bug on the other.
//
// Outside the region every channel reads "discovered": that is what feathers the
// mist's outer rim away into the open sea, and it is why the ocean beyond the
// board is not painted out by everything below.
export class VisibilityField extends Component {
  constructor(grid, visibility, {
    hexes    = null,     // every hex that can be fogged - land and sea both
    hexSize  = 1,

    margin   = 8.0,      // how far past those hexes the field reaches, in hexes
    texel    = 0.30,     // texel size, in hex circumradii
    passes   = 2,        // blur passes, for every channel

    softness   = 1.15,   // the mist's reveal blur, in hex circumradii
    sharpness  = 0.34,   // and the one the world's own hiding uses
    // The region channel is *grown* before it is blurred, so it still reads 1
    // over every hex the level actually fogs and its fade lives entirely out at
    // sea. See the note on the clamp in fog_of_war.js: the mist's outer edge is
    // pushed about by noise, and it must not be able to swing back inland.
    rimReach    = 4.0,
    rimSoftness = 1.8,

    revealRate = 1.6,    // how fast the field eases toward what is known

    // How the world paints itself out. `hide` is the pair of A-channel values the
    // painting fades between; `dim` is how dark remembered ground goes and `cool`
    // how far it drifts toward the mist's colour on the way.
    hide   = [0.30, 0.62],
    dim    = 0.50,
    cool   = 0.32,
    hiddenColor = 0x333d4d,
  } = {}) {
    super();
    this._grid = grid;
    this._vis  = visibility;
    this._hexList = (hexes ? [...hexes] : [...grid.allHexes()]).map(h => ({ q: h.q, r: h.r }));
    this._hexSize = hexSize;
    this._texel = texel;
    this._passes = passes;
    this._softness = softness;
    this._sharpness = sharpness;
    this._rimReach = rimReach;
    this._rimSoftness = rimSoftness;
    this._revealRate = revealRate;

    this._patched = new Set();
    this._settling = false;

    this._build(margin);

    this._u = {
      uVisMask:     { value: this._texture },
      uVisMin:      { value: this._min },
      uVisSpan:     { value: this._span },
      uVisHidden:   { value: new THREE.Color(hiddenColor) },
      uVisTune:     { value: new THREE.Vector4(hide[0], hide[1], dim, cool) },
      uVisStrength: { value: 1 },
    };

    this._retarget(true);
    this._unsub = this._vis.onChange(() => this._retarget());
  }

  get texture() { return this._texture; }
  get min()     { return this._min; }
  get span()    { return this._span; }

  // Debug: stop the world painting itself out, without touching what has actually
  // been explored. Deliberately not `Component.enabled` - switching that off would
  // stop the field easing and freeze the mask mid-reveal, which is a different
  // thing entirely.
  setMasking(on) { this._u.uVisStrength.value = on ? 1 : 0; }
  get masking()  { return this._u.uVisStrength.value > 0.5; }

  // Unscaled, like the water and the wind.
  update(_dt, rawDt) {
    if (this._settling) this._advance(rawDt);
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build(margin) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const h of this._hexList) {
      const { x, z } = this._grid.hexToWorld(h.q, h.r);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const pad = (margin + 1) * this._hexSize;
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

    const t = this._texel * this._hexSize;
    this._w = Math.max(8, Math.ceil((maxX - minX) / t));
    this._h = Math.max(8, Math.ceil((maxZ - minZ) / t));
    // The box grows out to a whole number of texels rather than the texels being
    // stretched, so a texel stays square and every blur below is isotropic.
    this._min  = new THREE.Vector2(minX, minZ);
    this._span = new THREE.Vector2(this._w * t, this._h * t);

    const n = this._w * this._h;
    this._goalRev   = new Float32Array(n);
    this._goalVis   = new Float32Array(n);
    this._goalSharp = new Float32Array(n);
    this._curRev    = new Float32Array(n);
    this._curVis    = new Float32Array(n);
    this._curSharp  = new Float32Array(n);
    this._region    = new Float32Array(n);   // static
    this._tmp       = new Float32Array(n);

    // Which hex each texel sits in, resolved once. The same question is asked of
    // every texel on every change, and hex rounding plus a string key is not
    // free - so it becomes an index into a short per-hex array instead.
    this._texelHex = new Int32Array(n).fill(-1);
    const index = new Map();
    this._hexList.forEach((h, i) => index.set(`${h.q},${h.r}`, i));
    for (let j = 0; j < this._h; j++) {
      for (let i = 0; i < this._w; i++) {
        const x = minX + ((i + 0.5) / this._w) * this._span.x;
        const z = minZ + ((j + 0.5) / this._h) * this._span.y;
        const { q, r } = this._grid.worldToHex(x, z);
        const k = index.get(`${q},${r}`);
        const idx = j * this._w + i;
        if (k !== undefined) { this._texelHex[idx] = k; this._region[idx] = 1; }
      }
    }
    this._dilate(this._region, this._rimReach);
    this._blur(this._region, this._rimSoftness);

    this._hexRev = new Float32Array(this._hexList.length);
    this._hexVis = new Float32Array(this._hexList.length);

    this._data = new Uint8Array(n * 4);
    this._texture = new THREE.DataTexture(this._data, this._w, this._h, THREE.RGBAFormat);
    this._texture.minFilter = this._texture.magFilter = THREE.LinearFilter;
    this._texture.wrapS = this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.needsUpdate = true;
  }

  // Separable box blur, in place. Edges clamp, which is exactly what is wanted:
  // outside the box the world is open ocean and the border value already says so.
  _blur(field, softness) {
    const w = this._w, h = this._h, tmp = this._tmp;
    const r = Math.max(1, Math.round(softness / this._texel));
    const inv = 1 / (2 * r + 1);
    for (let pass = 0; pass < this._passes; pass++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let k = -r; k <= r; k++) {
            const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
            s += field[row + xx];
          }
          tmp[row + x] = s * inv;
        }
      }
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          let s = 0;
          for (let k = -r; k <= r; k++) {
            const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
            s += tmp[yy * w + x];
          }
          field[y * w + x] = s * inv;
        }
      }
    }
  }

  // Separable maximum filter - the region channel's head start out to sea.
  _dilate(field, reach) {
    const w = this._w, h = this._h, tmp = this._tmp;
    const r = Math.max(1, Math.round(reach / this._texel));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          if (field[row + xx] > m) m = field[row + xx];
        }
        tmp[row + x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          const v = tmp[yy * w + x];
          if (v > m) m = v;
        }
        field[y * w + x] = m;
      }
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────

  // Re-read the VisibilityMap. This is the only place the two systems touch, and
  // it is one-way: hexes in, a texture out.
  _retarget(instant = false) {
    for (let i = 0; i < this._hexList.length; i++) {
      const { q, r } = this._hexList[i];
      const state = this._vis.stateAt(q, r);
      this._hexRev[i] = state !== HEX_VISIBILITY.UNEXPLORED ? 1 : 0;
      this._hexVis[i] = state === HEX_VISIBILITY.VISIBLE ? 1 : 0;
    }
    const n = this._w * this._h;
    for (let i = 0; i < n; i++) {
      const k = this._texelHex[i];
      // Outside the region counts as discovered, so nothing out there is hidden
      // and the mist's own rim has something to feather into.
      const rev = k < 0 ? 1 : this._hexRev[k];
      this._goalRev[i]   = rev;
      this._goalSharp[i] = rev;
      this._goalVis[i]   = k < 0 ? 1 : this._hexVis[k];
    }
    this._blur(this._goalRev,   this._softness);
    this._blur(this._goalVis,   this._softness);
    this._blur(this._goalSharp, this._sharpness);

    if (instant) {
      this._curRev.set(this._goalRev);
      this._curVis.set(this._goalVis);
      this._curSharp.set(this._goalSharp);
      this._settling = false;
      this._upload();
    } else {
      this._settling = true;
    }
  }

  // The mist receding, and the world coming up under it. Easing the *blurred*
  // fields rather than the hex ones keeps them blurred - the whole operation is
  // linear - and costs one pass a frame instead of three.
  _advance(dt) {
    const k = 1 - Math.exp(-this._revealRate * dt);
    const n = this._w * this._h;
    let settling = false;
    for (let i = 0; i < n; i++) {
      const a = this._goalRev[i] - this._curRev[i];
      if (Math.abs(a) > 0.002) { this._curRev[i] += a * k; settling = true; }
      else this._curRev[i] = this._goalRev[i];
      const b = this._goalVis[i] - this._curVis[i];
      if (Math.abs(b) > 0.002) { this._curVis[i] += b * k; settling = true; }
      else this._curVis[i] = this._goalVis[i];
      const c = this._goalSharp[i] - this._curSharp[i];
      if (Math.abs(c) > 0.002) { this._curSharp[i] += c * k; settling = true; }
      else this._curSharp[i] = this._goalSharp[i];
    }
    this._settling = settling;
    this._upload();
  }

  _upload() {
    const n = this._w * this._h;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      this._data[o]     = this._curRev[i] * 255;
      this._data[o + 1] = this._curVis[i] * 255;
      this._data[o + 2] = this._region[i] * 255;
      this._data[o + 3] = this._curSharp[i] * 255;
    }
    this._texture.needsUpdate = true;
  }

  // ── Making the world answer for it ────────────────────────────────────────

  // Patch every material under `root` so it hides itself on undiscovered ground
  // and dims itself on ground nobody is watching.
  //
  // A traversal rather than a constructor argument on each component, and that is
  // deliberate: whether a thing obeys fog of war is a fact about the *scene*, not
  // about the thing. Trees, rocks, lamps, units, the water, the grid seams and
  // whatever gets added next all want identical behaviour, and threading a field
  // through eight constructors to get it would mean every new component had to
  // remember. One call in main.js per layer, and the layer never hears about it.
  patch(root, opts) {
    root.traverse?.((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const one of m) this.patchMaterial(one, opts);
      else this.patchMaterial(m, opts);
    });
    return root;
  }

  // `hide` paints the fragment out to the mist's colour on undiscovered ground -
  // and drops its alpha too, so a transparent thing (a grid seam, a mote)
  // vanishes rather than turning into a fog-coloured mark.
  // `dim` is the memory of a place: darker, and drifting a little toward the
  // mist. Nothing is *hidden* by it - the player has been told what is on that
  // tile and taking it back would be a lie.
  patchMaterial(material, { hide = true, dim = true } = {}) {
    if (!material || this._patched.has(material)) return material;
    this._patched.add(material);

    const prev = material.onBeforeCompile;
    // three keys its program cache on the source text of onBeforeCompile, and the
    // closure below has the same text for every material it is put on - so the
    // flags have to go into the key by hand or the first material compiled wins
    // and the rest quietly share its shader.
    const key = `${prev ? prev.toString() : ''}|vis${hide ? 1 : 0}${dim ? 1 : 0}`;
    material.customProgramCacheKey = () => key;

    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      // The same uniform *objects*, not copies, so one field drives the whole
      // scene and a change to it needs no bookkeeping anywhere.
      Object.assign(shader.uniforms, this._u);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVisWorld;')
        .replace('#include <project_vertex>', VIS_VERTEX);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', VIS_FRAG_PARS)
        .replace('#include <tonemapping_fragment>', visFragment(hide, dim));
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
// mask is a world-space texture and every reader has to agree where it is.
const VIS_VERTEX = /* glsl */`
#include <project_vertex>
vec4 visWorldPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  visWorldPos = instanceMatrix * visWorldPos;
#endif
vVisWorld = ( modelMatrix * visWorldPos ).xyz;
`;

const VIS_FRAG_PARS = /* glsl */`
#include <common>
uniform sampler2D uVisMask;
uniform vec2  uVisMin;
uniform vec2  uVisSpan;
uniform vec3  uVisHidden;
uniform vec4  uVisTune;      // hide lo, hide hi, dim, cool
uniform float uVisStrength;
varying vec3  vVisWorld;
`;

// Injected where the fragment's colour is settled but before tone mapping, so a
// painted-out surface goes through the same tone curve and the same distance
// haze as everything else - which is what lets it sit against the mist above it
// without a seam.
function visFragment(hide, dim) {
  return /* glsl */`
{
  vec4 visMask = texture2D( uVisMask, ( vVisWorld.xz - uVisMin ) / uVisSpan );
  float visHide = ( 1.0 - smoothstep( uVisTune.x, uVisTune.y, visMask.a ) ) * uVisStrength;
${dim ? `
  // Remembered, not watched. Gated on the region so the open sea stays lit, and
  // on not being hidden so the two never fight over the same fragment.
  float visMemory = ( 1.0 - visMask.g ) * visMask.b * ( 1.0 - visHide ) * uVisStrength;
  gl_FragColor.rgb = mix(
    gl_FragColor.rgb,
    mix( gl_FragColor.rgb * uVisTune.z, uVisHidden, uVisTune.w ),
    visMemory );
` : ''}${hide ? `
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uVisHidden, visHide );
  gl_FragColor.a *= 1.0 - visHide;
` : ''}}
#include <tonemapping_fragment>
`;
}
