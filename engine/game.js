import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Game {
  constructor({ container = document.body } = {}) {
    this.gameObjects = [];
    this._lastTime   = 0;
    this.elapsed     = 0;  // cumulative game time in seconds
    this.timeScale   = 1;  // 0 = paused, 1 = normal, 2 = 2x, ...
    this.camera      = null;
    this._container  = container;
    // GameObjects added/removed during the update loop are queued so the
    // iteration over this.gameObjects never mutates mid-frame.
    this._pendingAdd    = [];
    this._pendingRemove = [];
    this._inUpdate      = false;

    this._initRenderer();
    this._initScene();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const w = this._container.clientWidth  || window.innerWidth;
    const h = this._container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this._container.appendChild(this.renderer.domElement);

    const ro = new ResizeObserver(() => {
      const w = this._container.clientWidth;
      const h = this._container.clientHeight;
      if (!w || !h) return;
      if (this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.renderer.setSize(w, h);
    });
    ro.observe(this._container);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 60, 110);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Environment map so PBR materials (especially metallic ones) aren't pitch-black
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  add(gameObject) {
    gameObject.game = this;
    if (this._inUpdate) { this._pendingAdd.push(gameObject); return gameObject; }
    this.gameObjects.push(gameObject);
    this.scene.add(gameObject.object3D);
    gameObject.start();
    return gameObject;
  }

  remove(gameObject) {
    if (gameObject._removed) return;
    gameObject._removed = true;
    if (this._inUpdate) { this._pendingRemove.push(gameObject); return; }
    this._removeNow(gameObject);
  }

  _removeNow(gameObject) {
    const i = this.gameObjects.indexOf(gameObject);
    if (i >= 0) this.gameObjects.splice(i, 1);
    this.scene.remove(gameObject.object3D);
    gameObject.destroy();
  }

  _flushPending() {
    for (const go of this._pendingRemove) this._removeNow(go);
    this._pendingRemove.length = 0;
    for (const go of this._pendingAdd) {
      this.gameObjects.push(go);
      this.scene.add(go.object3D);
      go.start();
    }
    this._pendingAdd.length = 0;
  }

  start() {
    this.renderer.setAnimationLoop((time) => this._tick(time));
  }

  _tick(time) {
    const rawDt = Math.min((time - this._lastTime) / 1000, 0.1);
    this._lastTime = time;
    const dt = rawDt * this.timeScale;
    this.elapsed += dt;

    this._inUpdate = true;
    for (const go of this.gameObjects) {
      if (!go._removed) go.update(dt, rawDt);
    }
    this._inUpdate = false;
    this._flushPending();

    this.onTick?.(dt, rawDt);

    if (this.camera) this.renderer.render(this.scene, this.camera);
  }
}
