import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Loads glTF models once and hands out clones.
//
// The clone shares geometry and materials with the original, so a hundred
// instances of a tree cost a hundred transforms rather than a hundred copies of
// the mesh. That is the whole reason this exists as a cache rather than a
// loader call per prop.
//
// Loading is async and the scene cannot be built until it finishes, which is why
// the caller awaits `load()` before assembling anything.
export class AssetCache {
  constructor({ basePath = '' } = {}) {
    this._basePath = basePath;
    this._loader = new GLTFLoader();
    this._models = new Map();   // name -> THREE.Object3D (the loaded scene)
    this.failed = [];
  }

  has(name) { return this._models.has(name); }
  get size() { return this._models.size; }

  // `manifest` maps a short name to a file. Everything loads in parallel; a file
  // that fails is recorded rather than thrown, so one missing model degrades the
  // scene instead of blanking it.
  async load(manifest) {
    const entries = Object.entries(manifest);
    await Promise.all(entries.map(async ([name, file]) => {
      try {
        const gltf = await this._loader.loadAsync(this._basePath + file);
        this._models.set(name, gltf.scene);
      } catch (err) {
        this.failed.push({ name, file, error: String(err) });
      }
    }));
    if (this.failed.length) {
      console.warn(`AssetCache: ${this.failed.length} model(s) failed to load`, this.failed);
    }
    return this;
  }

  // A fresh instance, or null if the model is missing. Shadows are enabled here
  // because every caller wants them and forgetting is invisible until you look
  // at the ground.
  create(name) {
    const src = this._models.get(name);
    if (!src) return null;
    const obj = src.clone(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return obj;
  }

  // Disposes the shared geometry and materials. Clones handed out earlier become
  // unusable, so only call this when tearing the whole scene down.
  dispose() {
    const seenGeo = new Set(), seenMat = new Set();
    for (const src of this._models.values()) {
      src.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry && !seenGeo.has(o.geometry)) { seenGeo.add(o.geometry); o.geometry.dispose(); }
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (m && !seenMat.has(m)) { seenMat.add(m); m.dispose(); }
        }
      });
    }
    this._models.clear();
  }
}
