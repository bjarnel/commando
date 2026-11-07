import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/**
 * Optional external asset support. All gameplay assets are procedural, so this
 * loader is deliberately tolerant: failures never block boot. Add entries to
 * the manifest in config/assets.js to bring in GLTF/OBJ meshes or textures.
 */
export class AssetLoader {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.objLoader = new OBJLoader(this.manager);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.cache = new Map();
    this.failures = [];
  }

  async preload(manifest, onProgress = () => {}) {
    const modelJobs = (manifest.models || []).map((entry) => this._loadModel(entry));
    const textureJobs = (manifest.textures || []).map((entry) => this._loadTexture(entry));
    const total = modelJobs.length + textureJobs.length;

    if (total === 0) {
      onProgress(1, 'PROCEDURAL ASSETS READY');
      return this;
    }

    let done = 0;
    const progress = () => {
      done++;
      onProgress(done / total, `${done} / ${total} ASSETS`);
    };

    await Promise.allSettled([...modelJobs, ...textureJobs]).then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') this.failures.push(result.reason);
        progress();
      });
    });

    if (this.failures.length) {
      console.warn('[AssetLoader] Some optional assets failed; procedural fallbacks remain active.', this.failures);
    }
    onProgress(1, 'PROCEDURAL ASSETS READY');
    return this;
  }

  async _loadModel(entry) {
    if (!entry?.url || !entry?.name) return;
    try {
      let object;
      if (entry.type === 'obj' || entry.url.toLowerCase().endsWith('.obj')) {
        object = await this.objLoader.loadAsync(entry.url);
      } else {
        const gltf = await this.gltfLoader.loadAsync(entry.url);
        object = gltf.scene || gltf.scenes?.[0];
      }
      if (!object) throw new Error(`Model ${entry.url} contained no scene`);
      object.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material?.map) child.material.map.colorSpace = THREE.SRGBColorSpace;
        }
      });
      this.cache.set(entry.name, object);
      return object;
    } catch (error) {
      this.failures.push(error);
      throw error;
    }
  }

  async _loadTexture(entry) {
    if (!entry?.url || !entry?.name) return;
    try {
      const texture = await this.textureLoader.loadAsync(entry.url);
      texture.colorSpace = entry.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (entry.repeat) texture.repeat.set(entry.repeat[0], entry.repeat[1]);
      texture.anisotropy = 8;
      this.cache.set(entry.name, texture);
      return texture;
    } catch (error) {
      this.failures.push(error);
      throw error;
    }
  }

  get(name) {
    return this.cache.get(name) || null;
  }

  getModel(name) {
    const model = this.cache.get(name);
    return model ? model.clone(true) : null;
  }
}
