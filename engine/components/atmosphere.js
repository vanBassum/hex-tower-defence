import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Sky, fog and the light that has no direction - the three things that decide
// what hour it is. Grouped into one component because they cannot be set
// independently: fog has to match the sky it fades into, and skylight has to
// match the sky it is supposed to be coming from. Splitting them into three
// places is how a scene ends up with a blue sky and warm shadows.
//
// The directional light stays separate: it is the one light with a position, so
// it belongs to an object in the world rather than to the air.
export class Atmosphere extends Component {
  constructor({
    sky = 0x87ceeb,
    // A fog colour lighter than the sky reads as haze; the same colour as the
    // sky reads as an infinitely deep background, which is also useful - it
    // makes the edge of the ocean plane disappear.
    fog = { color: 0x9fbcd0, near: 60, far: 110 },
    // Skylight: a gradient from above, which is what makes upward faces read as
    // lit by the sky and downward faces as lit by the ground.
    hemisphere = { sky: 0xffffff, ground: 0x444444, intensity: 0.6 },
    // A flat floor under everything, so a face pointing away from every light
    // is dim rather than black.
    ambient = { color: 0xffffff, intensity: 0.3 },
    environmentIntensity = 1,
    // Tone mapping exposure. It belongs here rather than with the renderer
    // because it is not a device setting - it is the same decision as how bright
    // the sky is, and changing one without the other undoes it.
    exposure = null,
  } = {}) {
    super();
    this._sky = sky;
    this._fog = fog;
    this._hemisphere = hemisphere;
    this._ambient = ambient;
    this._environmentIntensity = environmentIntensity;
    this._exposure = exposure;
  }

  start() {
    const { scene, renderer } = this.gameObject.game;
    if (this._exposure != null) renderer.toneMappingExposure = this._exposure;

    scene.background = new THREE.Color(this._sky);
    scene.fog = this._fog
      ? new THREE.Fog(this._fog.color, this._fog.near, this._fog.far)
      : null;
    scene.environmentIntensity = this._environmentIntensity;

    const h = this._hemisphere;
    if (h?.intensity) {
      this._hemi = new THREE.HemisphereLight(h.sky, h.ground, h.intensity);
      scene.add(this._hemi);
    }

    const a = this._ambient;
    if (a?.intensity) {
      this._amb = new THREE.AmbientLight(a.color, a.intensity);
      scene.add(this._amb);
    }
  }

  destroy() {
    const { scene } = this.gameObject.game;
    if (this._hemi) { scene.remove(this._hemi); this._hemi.dispose(); }
    if (this._amb)  { scene.remove(this._amb);  this._amb.dispose(); }
  }
}
