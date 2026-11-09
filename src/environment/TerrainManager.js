import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTINGS } from '../config/settings.js';
import { BIOMES } from '../config/biomes.js';
import { seededRandom, clamp, rand, smoothstep, segmentCircle2D } from '../utils/math.js';
import {
  getGroundTextures,
  getBiomeGroundTextures,
  getRoadTextures,
  getSandbagTextures,
  getWoodTexture,
  getMetalTexture,
  getGrassTexture,
  getScorchTexture,
  getWaterNormalTexture,
  getGlowTexture,
  getFootprintTexture,
} from '../utils/textures.js';

const COLLIDER_EPSILON = 1e-5;

function roadXAt(z) {
  return Math.sin(z * 0.0068) * 2.9 + Math.sin(z * 0.0023 + 1.4) * 2.1;
}

function applyTransform(geometry, position, rotation, scale) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0)
  );
  matrix.compose(
    new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0),
    quaternion,
    new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function colorize(geometry, colorHex) {
  const color = new THREE.Color(colorHex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function makePart(geometry, colorHex, position, rotation, scale) {
  const part = geometry.clone();
  applyTransform(part, position, rotation, scale);
  colorize(part, colorHex);
  return part;
}

function mergeParts(parts) {
  // PolyhedronGeometry (rocks/leaves) is non-indexed while BoxGeometry,
  // CylinderGeometry, etc. are indexed. Normalise everything before merging.
  const normalized = parts.map((item) => {
    if (!item.index) return item;
    const flat = item.toNonIndexed();
    item.dispose();
    return flat;
  });
  const geometry = mergeGeometries(normalized, false);
  normalized.forEach((item) => item.dispose());
  if (!geometry) {
    console.error('[Terrain] Geometry merge failed; using an empty placeholder.');
    return new THREE.BufferGeometry();
  }
  return geometry;
}

/**
 * Hand-built, deterministic level. Everything is generated in one pass so the
 * level can be explored without streaming hiccups, while still presenting a
 * classic Commando-like one-way vertical advance.
 */
export class TerrainManager {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'terrain';
    scene.add(this.root);
    this.globalRoot = this.root;
    this.chapterLayer = new THREE.Group();
    this.chapterLayer.name = 'terrain-chapters';
    this.root.add(this.chapterLayer);

    this.random = seededRandom(0xb4a7c0de);
    this.runRandom = seededRandom(0xb4a7c0de);
    this.runSeed = 0;
    this.chapters = [];
    this.chapterPlans = [];
    this.currentChapter = null;
    this.chapterStart = 0;
    this.chapterEnd = 0;
    this.chapterLength = SETTINGS.endless.chapterLength;
    this.biomeBag = [];
    this.lastBiomeId = null;
    this.chapterSerial = 0;

    this.colliders = [];
    this.coverObjects = [];
    this.coverSpots = [];
    this.destructibles = [];
    this.barrels = [];
    this.smokeSources = [];
    this.barracks = [];
    this.rivers = [];
    this.fireLights = [];
    this.flareSprites = [];
    this.biomeOverlays = [];
    this.time = 0;
    this.playableHalfWidth = SETTINGS.mission.width;

    this.materials = {
      vertex: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.87,
        metalness: 0.06,
      }),
      vertexMetal: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.52,
        metalness: 0.5,
      }),
      foliage: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.93,
        metalness: 0.0,
        flatShading: true,
      }),
      rock: new THREE.MeshStandardMaterial({
        color: 0x837d69,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      }),
      concrete: new THREE.MeshStandardMaterial({
        map: getMetalTexture(),
        color: 0x8e9082,
        roughness: 0.92,
        metalness: 0.04,
      }),
      wood: new THREE.MeshStandardMaterial({
        map: getWoodTexture(),
        color: 0xb7a17d,
        roughness: 0.9,
        metalness: 0.02,
      }),
      sandbag: null,
      grass: null,
      farJungle: new THREE.MeshStandardMaterial({
        color: 0x2b3a24,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    };

    const groundTextures = getGroundTextures();
    this.groundMaterial = new THREE.MeshStandardMaterial({
      map: groundTextures.map,
      normalMap: groundTextures.normalMap,
      roughnessMap: groundTextures.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.97,
      metalness: 0.01,
      color: 0xe9e3c8,
    });

    this.waterNormal = getWaterNormalTexture();
    this.waterNormal.repeat.set(7, 2.5);
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x4b6a5e,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.16,
      metalness: 0.32,
      transparent: true,
      opacity: 0.95,
    });
    this.iceMaterial = new THREE.MeshStandardMaterial({
      color: 0xb4d3dc,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.28,
      metalness: 0.12,
      transparent: true,
      opacity: 0.97,
    });
    this.bankMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d4934,
      roughness: 1,
      metalness: 0,
    });
    this.snowBankMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9d5d5,
      roughness: 0.85,
      metalness: 0,
    });

    this.sharedMaterials = new Set([
      ...Object.values(this.materials).filter(Boolean),
      this.groundMaterial,
      this.waterMaterial,
      this.iceMaterial,
      this.bankMaterial,
      this.snowBankMaterial,
    ]);

    this._buildFootprintPool();
    this._buildScorchPool();
  }

  startRun(seed = null) {
    for (const chapter of this.chapters) {
      this._purgeChapterData(chapter);
      this._disposeChapterVisuals(chapter);
      chapter.group.removeFromParent();
    }
    this.chapters.length = 0;
    this.chapterPlans.length = 0;
    this.biomeBag.length = 0;
    this.lastBiomeId = null;
    this.chapterSerial = 0;
    this.colliders.length = 0;
    this.coverObjects.length = 0;
    this.coverSpots.length = 0;
    this.destructibles.length = 0;
    this.barrels.length = 0;
    this.smokeSources.length = 0;
    this.barracks.length = 0;
    this.rivers.length = 0;
    this.fireLights.length = 0;
    this.flareSprites.length = 0;
    this.biomeOverlays.length = 0;

    this.runSeed = Number.isFinite(seed)
      ? seed >>> 0
      : (Math.random() * 0xffffffff) >>> 0;
    this.runRandom = seededRandom(this.runSeed || 1);
    this.random = seededRandom((this.runSeed ^ 0x9e3779b9) >>> 0);

    this.clearFootprints();
    this.clearScorch();
    this._ensureChapterPlans(0);
    this._ensureChaptersFor(0);
    return this.runSeed;
  }

  _nextBiome() {
    if (!this.biomeBag.length) {
      this.biomeBag = BIOMES.map((biome) => biome.id);
      for (let i = this.biomeBag.length - 1; i > 0; i--) {
        const j = Math.floor(this.runRandom() * (i + 1));
        [this.biomeBag[i], this.biomeBag[j]] = [this.biomeBag[j], this.biomeBag[i]];
      }
      if (this.biomeBag.length > 1 && this.biomeBag[this.biomeBag.length - 1] === this.lastBiomeId) {
        [this.biomeBag[0], this.biomeBag[this.biomeBag.length - 1]] = [
          this.biomeBag[this.biomeBag.length - 1],
          this.biomeBag[0],
        ];
      }
    }
    const id = this.biomeBag.pop();
    this.lastBiomeId = id;
    return BIOMES.find((biome) => biome.id === id) || BIOMES[0];
  }

  _makeChapterPlan(index, start, length) {
    const biome = this._nextBiome();
    const fogBanks = [];
    const foggy = ['swamp', 'snow', 'city', 'forest'].includes(biome.id);
    const count = foggy
      ? 1 + Math.floor(this.runRandom() * 2)
      : this.runRandom() < 0.48
        ? 1
        : 0;
    for (let i = 0; i < count; i++) {
      const usable = Math.max(40, length - 110);
      const bankStart = start + 32 + this.runRandom() * usable;
      const bankLength = Math.min(
        usable,
        28 + this.runRandom() * (foggy ? 78 : 52)
      );
      fogBanks.push({
        start: bankStart,
        end: bankStart + bankLength,
        peak: foggy ? 0.72 + this.runRandom() * 0.28 : 0.5 + this.runRandom() * 0.35,
      });
    }
    return {
      index,
      start,
      length,
      end: start + length,
      biome,
      fogBanks,
      seed: (this.runSeed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0,
      built: false,
    };
  }

  _ensureChapterPlans(z) {
    const endless = SETTINGS.endless;
    if (!this.chapterPlans.length) {
      const firstLength = endless.chapterLength;
      this.chapterPlans.push(
        this._makeChapterPlan(0, endless.firstChapterStart, firstLength)
      );
    }
    let last = this.chapterPlans[this.chapterPlans.length - 1];
    while (last.end < z + endless.buildAheadDistance) {
      const length =
        endless.chapterLength +
        (this.runRandom() - 0.5) * endless.chapterVariance;
      const plan = this._makeChapterPlan(
        this.chapterPlans.length,
        last.end,
        Math.max(240, Math.round(length))
      );
      this.chapterPlans.push(plan);
      last = plan;
    }
  }

  _planAt(z) {
    for (const plan of this.chapterPlans) {
      if (z >= plan.start && z < plan.end) return plan;
    }
    if (!this.chapterPlans.length) return null;
    if (z < this.chapterPlans[0].start) return this.chapterPlans[0];
    return this.chapterPlans[this.chapterPlans.length - 1];
  }

  _ensureChaptersFor(z) {
    this._ensureChapterPlans(z);
    const buildUntil = z + SETTINGS.endless.buildAheadDistance;
    for (const plan of this.chapterPlans) {
      if (!plan.built && plan.start < buildUntil) this._buildChapter(plan);
    }
    for (let i = this.chapters.length - 1; i >= 0; i--) {
      const chapter = this.chapters[i];
      if (chapter.end < z - SETTINGS.endless.keepBehindDistance) {
        this._purgeChapterData(chapter);
        this._disposeChapterVisuals(chapter);
        chapter.group.removeFromParent();
        this.chapters.splice(i, 1);
      }
    }
  }

  updateStreaming(z) {
    this._ensureChaptersFor(z);
  }

  _buildChapter(plan) {
    const group = new THREE.Group();
    group.name = `terrain-chapter-${plan.index}`;
    this.chapterLayer.add(group);

    const chapter = {
      ...plan,
      group,
      built: true,
      riverZ: null,
      riverWidth: 0,
      riverFrozen: false,
    };
    plan.built = true;

    const previousRoot = this.root;
    const previousRandom = this.random;
    this.currentChapter = chapter;
    this.chapterStart = plan.start;
    this.chapterEnd = plan.end;
    this.chapterLength = plan.length;
    this.chapterBiome = plan.biome;
    this.root = group;
    this.random = seededRandom(plan.seed);
    this.biomeOverlays = [];

    const marks = {
      colliders: this.colliders.length,
      coverObjects: this.coverObjects.length,
      coverSpots: this.coverSpots.length,
      destructibles: this.destructibles.length,
      barrels: this.barrels.length,
      smokeSources: this.smokeSources.length,
      barracks: this.barracks.length,
      rivers: this.rivers.length,
      fireLights: this.fireLights.length,
      flareSprites: this.flareSprites.length,
    };

    this._buildGround();
    this._buildGroundDetails();
    this._buildBiomeGrounds();
    this._buildRoad();
    const dressing = plan.biome.dressing || plan.biome.id;
    if (
      plan.biome.id === 'wetlands' ||
      plan.biome.id === 'snow' ||
      plan.biome.id === 'swamp'
    ) {
      this._buildRiversAndBridges();
    }
    if (
      dressing === 'jungle' ||
      dressing === 'wetlands' ||
      dressing === 'forest' ||
      dressing === 'swamp' ||
      dressing === 'grassland'
    ) {
      this._buildPalms();
      this._buildJungleAndRocks();
      this._buildGrass();
    } else {
      this._buildJungleAndRocks();
    }
    this._buildBiomeDressing();
    this._buildSandbagWalls();
    this._buildBarricadesAndCrates();
    this._buildExtraObstacles();
    this._buildBunkersAndTents();
    this._buildWatchtowersAndRuins();
    if (dressing === 'city') this._buildUrbanCombatZone();
    this._buildDestructibles();
    this._buildBarrels();
    this._buildWrecks();

    this._tagChapterData(chapter, marks);
    this.root = previousRoot;
    this.random = previousRandom;
    this.chapters.push(chapter);
  }

  _tagChapterData(chapter, marks) {
    const tag = (array, start, key) => {
      const items = array.slice(start);
      for (const item of items) item._chapter = chapter;
      chapter[key] = items;
    };
    tag(this.colliders, marks.colliders, 'colliders');
    tag(this.coverObjects, marks.coverObjects, 'coverObjects');
    tag(this.coverSpots, marks.coverSpots, 'coverSpots');
    tag(this.destructibles, marks.destructibles, 'destructibles');
    tag(this.barrels, marks.barrels, 'barrels');
    tag(this.smokeSources, marks.smokeSources, 'smokeSources');
    tag(this.barracks, marks.barracks, 'barracks');
    tag(this.rivers, marks.rivers, 'rivers');
    tag(this.fireLights, marks.fireLights, 'fireLights');
    tag(this.flareSprites, marks.flareSprites, 'flareSprites');
  }

  _purgeChapterData(chapter) {
    const purge = (array) => {
      for (let i = array.length - 1; i >= 0; i--) {
        if (array[i]._chapter === chapter) array.splice(i, 1);
      }
    };
    purge(this.colliders);
    purge(this.coverObjects);
    purge(this.coverSpots);
    purge(this.destructibles);
    purge(this.barrels);
    purge(this.smokeSources);
    purge(this.barracks);
    purge(this.rivers);
    purge(this.fireLights);
    purge(this.flareSprites);
  }

  _disposeChapterVisuals(chapter) {
    const geometries = new Set();
    const materials = new Set();
    chapter.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) materials.add(entry);
      } else if (material) {
        materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) {
      if (!this.sharedMaterials.has(material)) material.dispose?.();
    }
  }

  _nearRiver(z, padding = 0) {
    const chapter = this.currentChapter;
    if (!chapter?.riverZ) return false;
    return Math.abs(z - chapter.riverZ) < chapter.riverWidth * 0.5 + padding;
  }

  _chapterRandomZ(margin = 0) {
    return this.chapterStart + margin + this.random() * (this.chapterLength - margin * 2);
  }

  getRoadX(z) {
    return roadXAt(z);
  }

  getBiome(z) {
    this._ensureChapterPlans(z);
    const plan = this._planAt(z);
    return plan ? plan.biome : BIOMES[0];
  }

  /** 0..1 density of local fog banks, independent of the biome base fog. */
  getFogFactor(z) {
    this._ensureChapterPlans(z);
    const plan = this._planAt(z);
    if (!plan?.fogBanks?.length) return 0;
    let factor = 0;
    for (const bank of plan.fogBanks) {
      if (z < bank.start || z > bank.end) continue;
      const edge = Math.min(12, (bank.end - bank.start) * 0.34);
      const fadeIn = smoothstep(bank.start, bank.start + edge, z);
      const fadeOut = 1 - smoothstep(bank.end - edge, bank.end, z);
      factor = Math.max(factor, bank.peak * fadeIn * fadeOut);
    }
    return clamp(factor, 0, 1);
  }

  isSnow(z) {
    return this.getBiome(z).id === 'snow';
  }

  /* ------------------------------------------------------------------------
     Ground, road, water
     ------------------------------------------------------------------------ */

  _buildGround() {
    const geometry = new THREE.PlaneGeometry(180, this.chapterLength);
    const uv = geometry.attributes.uv;
    const vRepeat = Math.max(10, this.chapterLength / 7);
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * 28, uv.getY(i) * vRepeat);
    }
    uv.needsUpdate = true;
    const ground = new THREE.Mesh(geometry, this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.025, this.chapterStart + this.chapterLength / 2);
    ground.receiveShadow = true;
    this.root.add(ground);
    this.ground = ground;

    // A slightly darker earth shoulder that frames the road and play field.
    const shoulderMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d5135,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(
        new THREE.PlaneGeometry(13, this.chapterLength),
        shoulderMaterial
      );
      shoulder.rotation.x = -Math.PI / 2;
      shoulder.position.set(
        side * 26,
        -0.012,
        this.chapterStart + this.chapterLength / 2
      );
      // Keep every transparent ground layer in an explicit draw order so the
      // side strips cannot trade places with the biome overlay as the camera
      // advances.
      shoulder.renderOrder = -20;
      this.root.add(shoulder);
    }
  }

  _buildGroundDetails() {
    const texture = getScorchTexture();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      color: 0x9f8760,
      toneMapped: true,
    });
    const count = Math.max(10, Math.round(this.chapterLength * 0.09));
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    mesh.renderOrder = 20;
    mesh.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = rand(-45, 45);
      const z = rand(this.chapterStart - 6, this.chapterEnd + 6);
      const scale = rand(2.5, 11);
      dummy.position.set(x, 0.012 + this.random() * 0.01, z);
      dummy.rotation.set(-Math.PI / 2, 0, rand(0, Math.PI * 2));
      dummy.scale.set(scale, scale * rand(0.6, 1.4), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.11 + this.random() * 0.05, 0.22, 0.26 + this.random() * 0.12);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
  }

  _buildBiomeGrounds() {
    const kind = this.chapterBiome.groundKind;
    if (kind === 'jungle') return;
    const textures = getBiomeGroundTextures(kind);
    textures.map.wrapS = THREE.RepeatWrapping;
    textures.map.wrapT = THREE.RepeatWrapping;
    textures.normalMap.wrapS = THREE.RepeatWrapping;
    textures.normalMap.wrapT = THREE.RepeatWrapping;

    const material = new THREE.MeshStandardMaterial({
      map: textures.map,
      normalMap: textures.normalMap,
      normalScale: new THREE.Vector2(kind === 'snow' ? 0.45 : 0.7, kind === 'snow' ? 0.45 : 0.7),
      roughness: kind === 'snow' ? 0.74 : kind === 'city' ? 0.82 : 0.96,
      metalness: kind === 'snow' ? 0.06 : kind === 'city' ? 0.04 : 0.01,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    const baseStart = this.chapterStart;
    const baseEnd = this.chapterEnd;
    const feather = Math.min(24, this.chapterLength * 0.16);
    const start = baseStart - feather;
    const end = baseEnd + feather;
    const rows = Math.max(20, Math.ceil((end - start) / 4));
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const tile = 7.2;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const z = start + (end - start) * t;
      const alpha =
        smoothstep(start, start + feather, z) *
        (1 - smoothstep(end - feather, end, z));
      for (const x of [-90, 90]) {
        positions.push(x, 0.004, z);
        uvs.push(x / tile, z / tile);
        colors.push(1, 1, 1, alpha);
      }
      if (i > 0) {
        const base = i * 2;
        indices.push(base - 2, base, base - 1, base, base + 1, base - 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = -10 + this.currentChapter.index * 0.001;
    this.root.add(mesh);
    this.biomeOverlays.push(mesh);
  }

  _roadTintAt(z) {
    const plan = this._planAt(z) || this.chapterPlans[0];
    if (!plan) return new THREE.Color(0xffffff);
    const tint = new THREE.Color(plan.biome.roadTint);
    const next = this.chapterPlans[plan.index + 1];
    if (next) {
      const t = smoothstep(plan.end - 28, plan.end, z);
      if (t > 0) {
        tint.lerp(new THREE.Color(next.biome.roadTint), t);
      }
    }
    return tint;
  }

  _buildRoad() {
    const textures = getRoadTextures();
    textures.map.repeat.set(1, 1);
    textures.normalMap.repeat.set(1, 1);
    const material = new THREE.MeshStandardMaterial({
      map: textures.map,
      normalMap: textures.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.98,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const step = 4;
    const start = this.chapterStart - 2;
    const end = this.chapterEnd + 2;
    const count = Math.ceil((end - start) / step) + 1;
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const z = start + i * step;
      const center = roadXAt(z);
      const width = 10.2 + Math.sin(z * 0.008 + 0.7) * 1.4;
      positions.push(center - width / 2, 0.025, z);
      positions.push(center + width / 2, 0.025, z);
      uvs.push(0, z / 13, 1, z / 13);
      tint.copy(this._roadTintAt(z));
      colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      if (i > 0) {
        const base = i * 2;
        indices.push(base - 2, base, base - 1, base, base + 1, base - 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const road = new THREE.Mesh(geometry, material);
    road.receiveShadow = true;
    road.renderOrder = 10;
    this.root.add(road);
    this.road = road;
  }

  _buildRiversAndBridges() {
    const frozen = this.chapterBiome.id === 'snow';
    const width = frozen
      ? 24 + this.random() * 6
      : 18 + this.random() * 7;
    const riverZ =
      this.chapterStart + this.chapterLength * (0.38 + this.random() * 0.24);
    const chapter = this.currentChapter;
    chapter.riverZ = riverZ;
    chapter.riverWidth = width;
    chapter.riverFrozen = frozen;
    this.rivers.push({ z: riverZ, width, frozen });

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(180, width),
      frozen ? this.iceMaterial : this.waterMaterial
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.05, riverZ);
    water.receiveShadow = true;
    this.root.add(water);

    const bankMaterialForRiver = frozen ? this.snowBankMaterial : this.bankMaterial;
    for (const side of [-1, 1]) {
      const bank = new THREE.Mesh(
        new THREE.PlaneGeometry(180, frozen ? 4.5 : 3.2),
        bankMaterialForRiver
      );
      bank.rotation.x = -Math.PI / 2;
      bank.position.set(0, 0.028, riverZ + side * (width / 2 + 1.6));
      bank.receiveShadow = true;
      this.root.add(bank);
    }

    if (frozen) {
      const crackPositions = [];
      for (let i = 0; i < 10; i++) {
        const x = rand(-55, 55);
        const z = riverZ + rand(-width * 0.35, width * 0.35);
        const angle = rand(0, Math.PI);
        const length = rand(3, 10);
        crackPositions.push(
          x, 0.061, z,
          x + Math.cos(angle) * length, 0.061, z + Math.sin(angle) * length
        );
      }
      const crackGeometry = new THREE.BufferGeometry();
      crackGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(crackPositions, 3)
      );
      const cracks = new THREE.LineSegments(
        crackGeometry,
        new THREE.LineBasicMaterial({
          color: 0x789aa5,
          transparent: true,
          opacity: 0.55,
        })
      );
      this.root.add(cracks);
    }

    const reedMaterial = new THREE.MeshStandardMaterial({
      map: getGrassTexture(),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 1,
      color: frozen ? 0xbabfa8 : 0x7c8a54,
    });
    const reedGeometry = new THREE.PlaneGeometry(1.5, 1.9);
    reedGeometry.translate(0, 0.95, 0);
    const reedCount = Math.max(24, Math.round(this.chapterLength * 0.18));
    const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, reedCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < reedCount; i++) {
      const side = i % 2 ? 1 : -1;
      dummy.position.set(
        rand(-55, 55),
        0,
        riverZ + side * (width / 2 + rand(0.6, 2.9))
      );
      dummy.rotation.set(0, rand(0, Math.PI), 0);
      dummy.scale.setScalar(rand(0.6, 1.5));
      dummy.updateMatrix();
      reeds.setMatrixAt(i, dummy.matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    this.root.add(reeds);

    this._buildBridge(riverZ, width, frozen);
  }

  _buildBridge(riverZ, riverWidth, frozen = false) {
    const centerX = roadXAt(riverZ);
    const group = new THREE.Group();
    group.position.set(centerX, 0, riverZ);
    const length = riverWidth + 9;
    const width = 10.2;
    const woodMap = getWoodTexture().clone();
    woodMap.needsUpdate = true;
    woodMap.repeat.set(2.3, 7);
    const deckMaterial = new THREE.MeshStandardMaterial({
      map: woodMap,
      color: 0xb39a74,
      roughness: 0.88,
      metalness: 0.02,
    });

    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, length), deckMaterial);
    deck.position.y = 0.17;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // Cross planks read as a constructed bridge from the steep camera.
    const plankMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b5334,
      roughness: 0.92,
    });
    for (let i = 0; i < 9; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, 0.05, 0.12), plankMaterial);
      strip.position.set(0, 0.295, -length / 2 + 1.5 + (i / 8) * (length - 3));
      group.add(strip);
    }

    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d3b28,
      roughness: 0.95,
    });
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.16), postMaterial);
        post.position.set(side * (width / 2 - 0.3), 0.9, i * (length / 2 - 1.2));
        post.castShadow = true;
        group.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, length - 1), postMaterial);
      rail.position.set(side * (width / 2 - 0.3), 1.45, 0);
      rail.castShadow = true;
      group.add(rail);
      const railLow = rail.clone();
      railLow.position.y = 0.95;
      group.add(railLow);
    }

    // Piles visible through the water.
    for (const side of [-1, 1]) {
      for (const z of [-riverWidth * 0.28, riverWidth * 0.28]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.2, 7), postMaterial);
        pile.position.set(side * 3.7, -1.7, z);
        pile.castShadow = true;
        group.add(pile);
      }
    }

    if (frozen) {
      const snow = new THREE.Mesh(
        new THREE.PlaneGeometry(width - 0.7, length - 1),
        new THREE.MeshStandardMaterial({
          color: 0xd5dfe0,
          roughness: 0.82,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        })
      );
      snow.rotation.x = -Math.PI / 2;
      snow.position.y = 0.31;
      group.add(snow);
    }

    this.root.add(group);
  }

  /* ------------------------------------------------------------------------
     Vegetation
     ------------------------------------------------------------------------ */

  _makePalmGeometry() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.13, 0.23, 4.6, 6, 4);
    trunk.translate(0, 2.3, 0);
    parts.push(makePart(trunk, 0x5b452d));

    // A green crown hub anchors every frond to the trunk. Without it the
    // fronds sit almost a metre off-axis and read as floating branches.
    const crown = new THREE.SphereGeometry(0.3, 7, 5);
    parts.push(
      makePart(
        crown,
        0x354a25,
        { x: 0, y: 4.48, z: 0 },
        null,
        { x: 1, y: 0.72, z: 1 }
      )
    );

    for (let i = 0; i < 7; i++) {
      const frond = new THREE.ConeGeometry(0.48, 3.3, 4, 1);
      frond.translate(0, 1.65, 0);
      const angle = (i / 7) * Math.PI * 2 + 0.18;
      applyTransform(
        frond,
        { x: Math.cos(angle) * 0.12, y: 4.5, z: Math.sin(angle) * 0.12 },
        { x: 0, y: -angle, z: -1.1 },
        { x: 0.9, y: 1, z: 0.25 }
      );
      parts.push(colorize(frond, i % 2 ? 0x334a22 : 0x415a2a));
    }
    for (let i = 0; i < 3; i++) {
      const lower = new THREE.ConeGeometry(0.33, 2.2, 4, 1);
      lower.translate(0, 1.1, 0);
      const angle = (i / 3) * Math.PI * 2 + 0.8;
      applyTransform(
        lower,
        { x: Math.cos(angle) * 0.08, y: 4.24, z: Math.sin(angle) * 0.08 },
        { x: 0, y: -angle, z: -1.28 },
        { x: 0.8, y: 1, z: 0.2 }
      );
      parts.push(colorize(lower, 0x2e4220));
    }
    return mergeParts(parts);
  }

  _makeBroadleafGeometry() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.9, 6);
    trunk.translate(0, 1.95, 0);
    parts.push(makePart(trunk, 0x57452c));
    const blobs = [
      { x: 0, y: 4.3, z: 0, s: 1.35, color: 0x3d5229 },
      { x: -0.8, y: 3.9, z: 0.3, s: 0.9, color: 0x445b2b },
      { x: 0.9, y: 4.0, z: -0.25, s: 1.0, color: 0x344822 },
      { x: 0.2, y: 3.7, z: 1.0, s: 0.8, color: 0x4a612f },
    ];
    for (const blob of blobs) {
      const ico = new THREE.IcosahedronGeometry(1, 1);
      applyTransform(
        ico,
        { x: blob.x, y: blob.y, z: blob.z },
        { x: rand(0, 3), y: rand(0, 3), z: 0 },
        { x: blob.s, y: blob.s * 1.2, z: blob.s }
      );
      parts.push(colorize(ico, blob.color));
    }
    return mergeParts(parts);
  }

  _buildPalms() {
    const palms = [];
    const broadleaf = [];
    const dressing = this.chapterBiome.dressing || this.chapterBiome.id;
    const profile =
      dressing === 'forest'
        ? { density: 0.25, broadEvery: 2, palms: true }
        : dressing === 'jungle'
          ? { density: 0.16, broadEvery: 4, palms: true }
          : dressing === 'wetlands'
            ? { density: 0.13, broadEvery: 4, palms: true }
            : dressing === 'swamp'
              ? { density: 0.12, broadEvery: 3, palms: true }
              : dressing === 'grassland'
                ? { density: 0.045, broadEvery: 2, palms: false }
                : null;
    if (!profile) return;
    const addTree = (x, z, scale, kind = 'palm') => {
      if (Math.abs(x - roadXAt(z)) < 5.4) return;
      if (this._nearRiver(z, 2.5)) return;
      const transform = {
        x,
        z,
        rotationY: rand(0, Math.PI * 2),
        scale,
      };
      (kind === 'broad' ? broadleaf : palms).push(transform);
      if (Math.abs(x) < this.playableHalfWidth + 1.5) {
        this.addCollider({
          x,
          z,
          radius: 0.38 * scale,
          type: 'tree',
          blocksMovement: true,
          blocksBullets: true,
        });
      }
    };

    // A few loose anchors keep the opening view of each chapter composed.
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const z = this.chapterStart + 14 + i * (this.chapterLength - 28) / 3;
      const kind =
        profile.palms && i % 2
          ? 'palm'
          : i % 3 === 0 || !profile.palms
            ? 'broad'
            : 'palm';
      addTree(side * rand(11.5, 17), z, rand(1.25, 1.55), kind);
    }

    const count = Math.max(
      dressing === 'grassland' ? 6 : 18,
      Math.round(this.chapterLength * profile.density)
    );
    for (let i = 0; i < count; i++) {
      const z = this._chapterRandomZ(6);
      const side = this.random() > 0.5 ? 1 : -1;
      const edgeBias = this.random();
      let x;
      if (edgeBias < 0.55) {
        x = side * rand(22, 48);
      } else {
        x = side * rand(12.5, 23);
      }
      if (Math.abs(x - roadXAt(z)) < 8) x += side * 5;
      const kind =
        !profile.palms || i % profile.broadEvery === 0 ? 'broad' : 'palm';
      addTree(x, z, rand(0.82, 1.55), kind);
    }

    const palmMesh = new THREE.InstancedMesh(
      this._makePalmGeometry(),
      this.materials.foliage,
      palms.length
    );
    palmMesh.castShadow = true;
    palmMesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    palms.forEach((transform, index) => {
      dummy.position.set(transform.x, 0, transform.z);
      dummy.rotation.set(0, transform.rotationY, 0);
      dummy.scale.setScalar(transform.scale);
      dummy.updateMatrix();
      palmMesh.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.24 + this.random() * 0.04, 0.32, 0.68 + this.random() * 0.18);
      palmMesh.setColorAt(index, color);
    });
    palmMesh.instanceMatrix.needsUpdate = true;
    if (palmMesh.instanceColor) palmMesh.instanceColor.needsUpdate = true;
    this.root.add(palmMesh);

    const broadMesh = new THREE.InstancedMesh(
      this._makeBroadleafGeometry(),
      this.materials.foliage,
      broadleaf.length
    );
    broadMesh.castShadow = true;
    broadMesh.receiveShadow = true;
    broadleaf.forEach((transform, index) => {
      dummy.position.set(transform.x, 0, transform.z);
      dummy.rotation.set(0, transform.rotationY, 0);
      dummy.scale.setScalar(transform.scale);
      dummy.updateMatrix();
      broadMesh.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.25 + this.random() * 0.03, 0.24, 0.62 + this.random() * 0.2);
      broadMesh.setColorAt(index, color);
    });
    broadMesh.instanceMatrix.needsUpdate = true;
    if (broadMesh.instanceColor) broadMesh.instanceColor.needsUpdate = true;
    this.root.add(broadMesh);
  }

  _buildJungleAndRocks() {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const biomeId = this.chapterBiome.id;
    const dressing = this.chapterBiome.dressing || biomeId;
    const dense =
      dressing === 'jungle' ||
      dressing === 'wetlands' ||
      dressing === 'forest' ||
      dressing === 'swamp';
    const farDensity =
      dressing === 'forest'
        ? 0.34
        : dressing === 'jungle'
          ? 0.22
          : dressing === 'wetlands'
            ? 0.18
            : 0.15;
    const bushDensity =
      dressing === 'forest'
        ? 0.3
        : dressing === 'swamp'
          ? 0.24
          : 0.18;

    if (dense) {
      const farTransforms = [];
      const farCount = Math.max(24, Math.round(this.chapterLength * farDensity));
      for (let i = 0; i < farCount; i++) {
        const z = this._chapterRandomZ(2);
        const side = i % 2 ? 1 : -1;
        farTransforms.push({
          x: side * rand(34, 64),
          y: rand(0, 5) + rand(4, 13) * 0.25,
          z,
          s: rand(4, 13),
          hue: 0.25 + this.random() * 0.05,
        });
      }
      const farGeometry = new THREE.IcosahedronGeometry(1, 1);
      const farMesh = new THREE.InstancedMesh(farGeometry, this.materials.farJungle, farTransforms.length);
      farMesh.castShadow = false;
      farMesh.receiveShadow = false;
      farTransforms.forEach((t, i) => {
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(rand(0, 2), rand(0, 6), rand(0, 2));
        dummy.scale.set(t.s * rand(0.7, 1.2), t.s * rand(0.5, 0.9), t.s * rand(0.7, 1.2));
        dummy.updateMatrix();
        farMesh.setMatrixAt(i, dummy.matrix);
        color.setHSL(t.hue, 0.25, 0.2 + this.random() * 0.1);
        farMesh.setColorAt(i, color);
      });
      farMesh.instanceMatrix.needsUpdate = true;
      if (farMesh.instanceColor) farMesh.instanceColor.needsUpdate = true;
      this.root.add(farMesh);

      const bushGeometry = new THREE.IcosahedronGeometry(0.85, 0);
      const bushMaterial = new THREE.MeshStandardMaterial({
        color: 0x40512d,
        roughness: 0.96,
        metalness: 0,
        flatShading: true,
      });
      const bushTransforms = [];
      const bushCount = Math.max(16, Math.round(this.chapterLength * bushDensity));
      for (let i = 0; i < bushCount; i++) {
        const z = this._chapterRandomZ(2);
        if (this._nearRiver(z, 2)) continue;
        const side = i % 2 ? 1 : -1;
        let x = side * rand(10, 34);
        if (Math.abs(x - roadXAt(z)) < 6.5) x += side * 5;
        bushTransforms.push({ x, z });
      }
      const bushes = new THREE.InstancedMesh(bushGeometry, bushMaterial, bushTransforms.length);
      bushes.castShadow = true;
      bushes.receiveShadow = true;
      bushTransforms.forEach((t, i) => {
        dummy.position.set(t.x, rand(0.25, 0.7), t.z);
        dummy.rotation.set(rand(-0.2, 0.2), rand(0, Math.PI * 2), rand(-0.2, 0.2));
        dummy.scale.set(rand(0.7, 1.8), rand(0.55, 1.4), rand(0.8, 1.9));
        dummy.updateMatrix();
        bushes.setMatrixAt(i, dummy.matrix);
        color.setHSL(0.23 + this.random() * 0.07, 0.32, 0.25 + this.random() * 0.15);
        bushes.setColorAt(i, color);
        if (Math.abs(t.x) < this.playableHalfWidth && Math.abs(t.x - roadXAt(t.z)) > 4.5) {
          this.addCollider({
            x: t.x,
            z: t.z,
            radius: 0.6,
            type: 'bush',
            blocksMovement: true,
            blocksBullets: false,
          });
        }
      });
      bushes.instanceMatrix.needsUpdate = true;
      if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
      this.root.add(bushes);
    }

    // Weathered rocks across every biome, tinted to the local ground.
    const rockGeometry = new THREE.DodecahedronGeometry(0.7, 0);
    const rockCount = Math.max(8, Math.round(this.chapterLength * 0.07));
    const rocks = new THREE.InstancedMesh(rockGeometry, this.materials.rock, rockCount);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let i = 0; i < rockCount; i++) {
      const side = i % 2 ? 1 : -1;
      let x = side * rand(9, 33);
      const z = this._chapterRandomZ(2);
      if (Math.abs(x - roadXAt(z)) < 6) x += side * 4;
      const scale = rand(0.4, 1.7);
      dummy.position.set(x, scale * 0.15, z);
      dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      dummy.scale.set(scale, scale * rand(0.45, 0.8), scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      if (biomeId === 'snow') {
        color.setHSL(0.52, 0.08, 0.74 + this.random() * 0.12);
      } else if (biomeId === 'desert' || biomeId === 'grassland') {
        color.setHSL(0.1, 0.22, 0.48 + this.random() * 0.12);
      } else if (biomeId === 'city') {
        color.setHSL(0.55, 0.03, 0.4 + this.random() * 0.14);
      } else {
        color.setHSL(0.12, 0.08, 0.46 + this.random() * 0.16);
      }
      rocks.setColorAt(i, color);
      if (Math.abs(x) < this.playableHalfWidth && scale > 0.8) {
        this.addCollider({
          x,
          z,
          radius: scale * 0.55,
          type: 'rock',
          blocksMovement: true,
          blocksBullets: true,
        });
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.root.add(rocks);
  }

  _buildGrass() {
    const dressing = this.chapterBiome.dressing || this.chapterBiome.id;
    if (
      dressing !== 'jungle' &&
      dressing !== 'wetlands' &&
      dressing !== 'forest' &&
      dressing !== 'swamp' &&
      dressing !== 'grassland'
    ) {
      return;
    }
    const texture = getGrassTexture();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      color: 0xa5b274,
    });
    const planeA = new THREE.PlaneGeometry(1.2, 0.95);
    planeA.translate(0, 0.475, 0);
    const planeB = planeA.clone();
    planeB.rotateY(Math.PI / 2);
    const geometry = mergeGeometries([planeA, planeB], false);
    planeA.dispose();
    planeB.dispose();

    const density =
      dressing === 'grassland'
        ? 4.6
        : dressing === 'forest'
          ? 3
          : dressing === 'swamp'
            ? 2
            : 2.4;
    const targetCount = Math.max(80, Math.round(this.chapterLength * density));
    const transforms = [];
    let attempts = 0;
    // Cluster tufts for natural drifts rather than a uniform scatter.
    while (transforms.length < targetCount && attempts < targetCount * 4) {
      attempts++;
      const side = this.random() > 0.5 ? 1 : -1;
      const clusterZ = this._chapterRandomZ(4);
      if (this._nearRiver(clusterZ, 1.5)) continue;
      const clusterX = side * rand(4.6, 34);
      const clusterCount = 3 + Math.floor(this.random() * 8);
      for (let i = 0; i < clusterCount && transforms.length < targetCount; i++) {
        const z = clusterZ + rand(-4, 4);
        let x = clusterX + rand(-3.4, 3.4);
        if (Math.abs(x - roadXAt(z)) < 3.8) x += side * 3;
        transforms.push({ x, z, dressing });
      }
    }
    const grass = new THREE.InstancedMesh(geometry, material, transforms.length);
    grass.castShadow = false;
    grass.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    transforms.forEach((t, index) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.scale.set(rand(0.65, 1.55), rand(0.7, 1.7), 1);
      dummy.updateMatrix();
      grass.setMatrixAt(index, dummy.matrix);
      if (dressing === 'grassland') {
        color.setHSL(0.15 + this.random() * 0.05, 0.34, 0.52 + this.random() * 0.2);
      } else if (dressing === 'swamp') {
        color.setHSL(0.22 + this.random() * 0.06, 0.26, 0.32 + this.random() * 0.16);
      } else if (dressing === 'forest') {
        color.setHSL(0.24 + this.random() * 0.06, 0.32, 0.38 + this.random() * 0.2);
      } else {
        color.setHSL(0.2 + this.random() * 0.09, 0.3, 0.5 + this.random() * 0.25);
      }
      grass.setColorAt(index, color);
    });
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.root.add(grass);
  }

  /* ------------------------------------------------------------------------
     Biome dressing
     ------------------------------------------------------------------------ */

  _buildBiomeDressing() {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const biomeId = this.chapterBiome.id;
    const dressing = this.chapterBiome.dressing || biomeId;

    if (dressing === 'desert') {
    /* Desert: cacti, dry scrub and distant mesas. */
    const cactusParts = [];
    cactusParts.push(
      makePart(new THREE.CylinderGeometry(0.28, 0.38, 3.0, 7), 0x5f713d, { x: 0, y: 1.5, z: 0 })
    );
    cactusParts.push(
      makePart(new THREE.SphereGeometry(0.3, 7, 5), 0x718647, { x: 0, y: 3.02, z: 0 }, null, { x: 1, y: 0.6, z: 1 })
    );
    for (const side of [-1, 1]) {
      cactusParts.push(
        makePart(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6), 0x5f713d, {
          x: side * 0.55,
          y: 1.75,
          z: 0,
        }, { x: 0, y: 0, z: side * 1.1 })
      );
      cactusParts.push(
        makePart(new THREE.CylinderGeometry(0.14, 0.17, 1.1, 6), 0x637746, {
          x: side * 0.98,
          y: 2.25,
          z: 0,
        })
      );
    }
    const cactusGeometry = mergeParts(cactusParts);
    const cactusMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    const cactusTransforms = [];
    const cactusCount = Math.max(8, Math.round(this.chapterLength * 0.08));
    for (let i = 0; i < cactusCount; i++) {
      const z = this._chapterRandomZ(6);
      if (this._nearRiver(z, 3)) continue;
      const side = i % 2 ? 1 : -1;
      let x = side * rand(8, 30);
      if (Math.abs(x - roadXAt(z)) < 7) x += side * 5;
      if (Math.abs(x) > 22) continue;
      cactusTransforms.push({ x, z, scale: rand(0.65, 1.35) });
    }
    const cacti = new THREE.InstancedMesh(cactusGeometry, cactusMaterial, cactusTransforms.length);
    cacti.castShadow = true;
    cacti.receiveShadow = true;
    cactusTransforms.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      cacti.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.24, 0.2, 0.68 + this.random() * 0.12);
      cacti.setColorAt(i, color);
      this.addCollider({
        x: t.x,
        z: t.z,
        radius: 0.45 * t.scale,
        type: 'cactus',
        blocksMovement: true,
        blocksBullets: false,
      });
    });
    cacti.instanceMatrix.needsUpdate = true;
    if (cacti.instanceColor) cacti.instanceColor.needsUpdate = true;
    this.root.add(cacti);

    const scrubGeometry = new THREE.IcosahedronGeometry(0.8, 0);
    const scrubMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d7c50,
      roughness: 0.98,
      metalness: 0,
      flatShading: true,
    });
    const scrubCount = Math.max(12, Math.round(this.chapterLength * 0.16));
    const scrub = new THREE.InstancedMesh(scrubGeometry, scrubMaterial, scrubCount);
    scrub.castShadow = true;
    scrub.receiveShadow = true;
    for (let i = 0; i < scrubCount; i++) {
      const z = this._chapterRandomZ(4);
      if (this._nearRiver(z, 2)) continue;
      const side = i % 2 ? 1 : -1;
      let x = side * rand(6, 32);
      if (Math.abs(x - roadXAt(z)) < 5.5) x += side * 4;
      dummy.position.set(x, rand(0.15, 0.5), z);
      dummy.rotation.set(rand(-0.2, 0.2), rand(0, 3), rand(-0.2, 0.2));
      dummy.scale.set(rand(0.5, 1.4), rand(0.4, 0.9), rand(0.5, 1.4));
      dummy.updateMatrix();
      scrub.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.1 + this.random() * 0.06, 0.28, 0.36 + this.random() * 0.14);
      scrub.setColorAt(i, color);
    }
    scrub.instanceMatrix.needsUpdate = true;
    if (scrub.instanceColor) scrub.instanceColor.needsUpdate = true;
    this.root.add(scrub);

    const mesaGeometry = new THREE.DodecahedronGeometry(1, 0);
    const mesaMaterial = new THREE.MeshStandardMaterial({
      color: 0x9c8057,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    });
    const mesaCount = Math.max(4, Math.round(this.chapterLength * 0.025));
    const mesas = new THREE.InstancedMesh(mesaGeometry, mesaMaterial, mesaCount);
    mesas.castShadow = false;
    for (let i = 0; i < mesaCount; i++) {
      const z = this._chapterRandomZ(10);
      const side = i % 2 ? 1 : -1;
      const s = rand(8, 20);
      dummy.position.set(side * rand(38, 66), s * 0.2, z);
      dummy.rotation.set(rand(0, 2), rand(0, 4), rand(0, 2));
      dummy.scale.set(s * rand(0.8, 1.4), s * rand(0.18, 0.36), s * rand(0.7, 1.2));
      dummy.updateMatrix();
      mesas.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.09 + this.random() * 0.04, 0.24, 0.44 + this.random() * 0.09);
      mesas.setColorAt(i, color);
    }
    mesas.instanceMatrix.needsUpdate = true;
    if (mesas.instanceColor) mesas.instanceColor.needsUpdate = true;
    this.root.add(mesas);
    }

    if (dressing === 'city') {
    /* City: ruined skyline, street lamps and shattered barriers. */
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x596264,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });
    const buildingCount = Math.max(8, Math.round(this.chapterLength * 0.08));
    const buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      buildingMaterial,
      buildingCount
    );
    buildings.castShadow = false;
    buildings.receiveShadow = true;
    const buildingData = [];
    for (let i = 0; i < buildingCount; i++) {
      const z = this._chapterRandomZ(8);
      const side = i % 2 ? 1 : -1;
      const x = side * rand(31, 58);
      const w = rand(7, 15);
      const d = rand(7, 15);
      const h = rand(6, 28);
      dummy.position.set(x, h / 2, z);
      dummy.rotation.set(0, rand(-0.3, 0.3), 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      buildings.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.52 + this.random() * 0.03, 0.05, 0.26 + this.random() * 0.12);
      buildings.setColorAt(i, color);
      buildingData.push({ x, z, w, d, h });
    }
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    this.root.add(buildings);

    const roofProps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2c3437, roughness: 0.8, metalness: 0.2 }),
      buildingData.length
    );
    buildingData.forEach((b, i) => {
      dummy.position.set(
        b.x + rand(-b.w * 0.22, b.w * 0.22),
        b.h + rand(0.2, 1.0),
        b.z + rand(-b.d * 0.22, b.d * 0.22)
      );
      dummy.rotation.set(0, rand(0, 2), 0);
      dummy.scale.set(rand(0.8, Math.max(1.2, b.w * 0.3)), rand(0.5, 2.2), rand(0.8, Math.max(1.2, b.d * 0.3)));
      dummy.updateMatrix();
      roofProps.setMatrixAt(i, dummy.matrix);
    });
    roofProps.instanceMatrix.needsUpdate = true;
    this.root.add(roofProps);

    const lampParts = [];
    lampParts.push(makePart(new THREE.CylinderGeometry(0.09, 0.13, 4.4, 6), 0x252b2c, { x: 0, y: 2.2, z: 0 }));
    lampParts.push(makePart(new THREE.BoxGeometry(1.2, 0.12, 0.14), 0x252b2c, { x: 0.55, y: 4.4, z: 0 }));
    lampParts.push(makePart(new THREE.BoxGeometry(0.45, 0.2, 0.35), 0x3f494b, { x: 1.1, y: 4.28, z: 0 }));
    const lampGeometry = mergeParts(lampParts);
    const lampMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.25 });
    const lampTransforms = [];
    const lampCount = Math.max(3, Math.round(this.chapterLength * 0.018));
    for (let i = 0; i < lampCount; i++) {
      const z =
        this.chapterStart +
        18 +
        (i + 0.5) * ((this.chapterLength - 36) / lampCount) +
        rand(-4, 4);
      const side = i % 2 ? 1 : -1;
      const x = roadXAt(z) + side * rand(6, 8);
      lampTransforms.push({ x, z, side });
    }
    const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, lampTransforms.length);
    lamps.castShadow = true;
    const bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd093, toneMapped: false }),
      lampTransforms.length
    );
    lampTransforms.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x + (t.side > 0 ? 1.1 : -1.1), 4.28, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bulbs.setMatrixAt(i, dummy.matrix);
      this.addCollider({
        x: t.x,
        z: t.z,
        radius: 0.2,
        type: 'lamp',
        blocksMovement: true,
        blocksBullets: false,
      });
    });
    lamps.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    this.root.add(lamps);
    this.root.add(bulbs);

    const rubbleGeometry = new THREE.BoxGeometry(1, 1, 1);
    const rubbleMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6e69,
      roughness: 0.95,
      flatShading: true,
    });
    const rubbleCount = Math.max(10, Math.round(this.chapterLength * 0.1));
    const rubble = new THREE.InstancedMesh(rubbleGeometry, rubbleMaterial, rubbleCount);
    rubble.castShadow = true;
    for (let i = 0; i < rubbleCount; i++) {
      const z = this._chapterRandomZ(4);
      const side = i % 2 ? 1 : -1;
      let x = side * rand(6, 27);
      if (Math.abs(x - roadXAt(z)) < 5) x += side * 5;
      dummy.position.set(x, rand(0.1, 0.4), z);
      dummy.rotation.set(rand(0, 2), rand(0, 3), rand(0, 2));
      dummy.scale.set(rand(0.3, 2.2), rand(0.2, 0.8), rand(0.3, 1.6));
      dummy.updateMatrix();
      rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.instanceMatrix.needsUpdate = true;
    this.root.add(rubble);

    // Concrete cover in the urban section.
    const concreteCoverCount = Math.max(1, Math.round(this.chapterLength / 170));
    for (let i = 0; i < concreteCoverCount; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * rand(10, 15);
      const z = this._chapterRandomZ(12);
      const rotation = rand(-0.5, 0.5);
      const parts = [];
      parts.push(makePart(new THREE.BoxGeometry(3.4, 1.4, 0.7), 0x6a6e66, { x: 0, y: 0.7, z: 0 }, { x: 0, y: 0, z: 0.05 }));
      parts.push(makePart(new THREE.BoxGeometry(1.2, 1.0, 0.7), 0x4e5552, { x: -1.4, y: 0.5, z: 0.5 }, { x: 0, y: 0.4, z: 0.15 }));
      parts.push(makePart(new THREE.BoxGeometry(0.8, 0.5, 0.5), 0x787a70, { x: 1.5, y: 0.35, z: -0.4 }, { x: 0.2, y: 0.4, z: 0.5 }));
      const mesh = new THREE.Mesh(mergeParts(parts), this.materials.vertex);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.addCollider({ x, z, radius: 1.8, type: 'concrete', blocksMovement: true, blocksBullets: true });
      const cx = x + Math.sin(rotation) * 1.3;
      const cz = z + Math.cos(rotation) * 1.3;
      this.addCover(x, z, -Math.sin(rotation), -Math.cos(rotation), 3.4, rotation);
      this.coverSpots.push({ x: cx, z: cz, cover: this.coverObjects[this.coverObjects.length - 1], occupied: null });
    }
    }

    if (dressing === 'snow') {
    /* Snow: pines, drifts and snow-capped ridge silhouettes. */
    const pineParts = [];
    pineParts.push(makePart(new THREE.CylinderGeometry(0.16, 0.28, 2.8, 6), 0x5d4933, { x: 0, y: 1.4, z: 0 }));
    const tiers = [
      { y: 1.9, radius: 2.0, height: 2.8, color: 0x58725c },
      { y: 3.35, radius: 1.5, height: 2.3, color: 0x64816b },
      { y: 4.7, radius: 0.95, height: 2.0, color: 0xeaf2ef },
    ];
    for (const tier of tiers) {
      const cone = new THREE.ConeGeometry(tier.radius, tier.height, 7, 1);
      cone.translate(0, tier.y + tier.height / 2, 0);
      pineParts.push(makePart(cone, tier.color));
    }
    // Snow-laden lower branches read as pale caps from the chase camera.
    for (const side of [-1, 1]) {
      const tip = new THREE.ConeGeometry(0.6, 1.4, 6);
      tip.translate(0, 0.7, 0);
      applyTransform(
        tip,
        { x: side * 1.1, y: 2.6, z: 0 },
        { x: 0, y: 0, z: side * 1.15 },
        { x: 1, y: 0.7, z: 0.55 }
      );
      pineParts.push(colorize(tip, 0xdce9e5));
    }
    pineParts.push(makePart(new THREE.ConeGeometry(0.52, 1.1, 6), 0xf3f8f5, { x: 0, y: 6.8, z: 0 }));
    const pineGeometry = mergeParts(pineParts);
    const pineMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const pineTransforms = [];
    const pineCount = Math.max(14, Math.round(this.chapterLength * 0.12));
    for (let i = 0; i < pineCount; i++) {
      const z = this._chapterRandomZ(6);
      if (this._nearRiver(z, 4)) continue;
      const side = i % 2 ? 1 : -1;
      let x = side * rand(8, 34);
      if (Math.abs(x - roadXAt(z)) < 6.5) x += side * 5;
      pineTransforms.push({ x, z, scale: rand(1.0, 1.8) });
    }
    const pines = new THREE.InstancedMesh(pineGeometry, pineMaterial, pineTransforms.length);
    pines.castShadow = true;
    pines.receiveShadow = true;
    pineTransforms.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      pines.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.42, 0.08, 0.72 + this.random() * 0.18);
      pines.setColorAt(i, color);
      if (Math.abs(t.x) < this.playableHalfWidth + 1) {
        this.addCollider({
          x: t.x,
          z: t.z,
          radius: 0.45 * t.scale,
          type: 'pine',
          blocksMovement: true,
          blocksBullets: true,
        });
      }
    });
    pines.instanceMatrix.needsUpdate = true;
    if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
    this.root.add(pines);

    const driftCount = Math.max(12, Math.round(this.chapterLength * 0.1));
    const drifts = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 5),
      new THREE.MeshStandardMaterial({ color: 0xdbe5e4, roughness: 0.9, metalness: 0 }),
      driftCount
    );
    drifts.receiveShadow = true;
    for (let i = 0; i < driftCount; i++) {
      const z = this._chapterRandomZ(5);
      if (this._nearRiver(z, 3)) continue;
      const side = i % 2 ? 1 : -1;
      let x = side * rand(5, 34);
      if (Math.abs(x - roadXAt(z)) < 7) x += side * 5;
      dummy.position.set(x, 0.08, z);
      dummy.rotation.set(0, rand(0, 3), 0);
      dummy.scale.set(rand(1.2, 3.6), rand(0.12, 0.35), rand(0.9, 2.4));
      dummy.updateMatrix();
      drifts.setMatrixAt(i, dummy.matrix);
    }
    drifts.instanceMatrix.needsUpdate = true;
    this.root.add(drifts);

    const ridgeGeometry = new THREE.IcosahedronGeometry(1, 0);
    const ridgeMaterial = new THREE.MeshStandardMaterial({
      color: 0xcdd9da,
      roughness: 0.95,
      flatShading: true,
    });
    const ridgeCount = Math.max(4, Math.round(this.chapterLength * 0.025));
    const ridges = new THREE.InstancedMesh(ridgeGeometry, ridgeMaterial, ridgeCount);
    for (let i = 0; i < ridgeCount; i++) {
      const z = this._chapterRandomZ(12);
      const side = i % 2 ? 1 : -1;
      const s = rand(8, 22);
      dummy.position.set(side * rand(38, 66), s * 0.1, z);
      dummy.rotation.set(rand(0, 2), rand(0, 4), rand(0, 2));
      dummy.scale.set(s * rand(0.8, 1.4), s * rand(0.25, 0.5), s * rand(0.8, 1.3));
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.53, 0.07, 0.72 + this.random() * 0.12);
      ridges.setColorAt(i, color);
    }
    ridges.instanceMatrix.needsUpdate = true;
    if (ridges.instanceColor) ridges.instanceColor.needsUpdate = true;
    this.root.add(ridges);
    }

    if (dressing === 'grassland') {
      const flowerGeometry = new THREE.SphereGeometry(0.09, 5, 4);
      const flowerMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0,
      });
      const flowerCount = Math.max(18, Math.round(this.chapterLength * 0.16));
      const flowers = new THREE.InstancedMesh(
        flowerGeometry,
        flowerMaterial,
        flowerCount
      );
      flowers.castShadow = false;
      const flowerColors = [0xf1d86a, 0xf2efd9, 0xd66b4b, 0xb98ac4];
      for (let i = 0; i < flowerCount; i++) {
        const z = this._chapterRandomZ(3);
        const side = i % 2 ? 1 : -1;
        let x = side * rand(5, 28);
        if (Math.abs(x - roadXAt(z)) < 4.5) x += side * 3;
        dummy.position.set(x, 0.12, z);
        dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
        dummy.scale.setScalar(rand(0.7, 1.5));
        dummy.updateMatrix();
        flowers.setMatrixAt(i, dummy.matrix);
        color.setHex(flowerColors[Math.floor(this.random() * flowerColors.length)]);
        flowers.setColorAt(i, color);
      }
      flowers.instanceMatrix.needsUpdate = true;
      if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
      this.root.add(flowers);

      const hayGeometry = new THREE.CylinderGeometry(0.62, 0.62, 1.3, 10);
      hayGeometry.rotateZ(Math.PI / 2);
      const hayMaterial = new THREE.MeshStandardMaterial({
        color: 0xc2a354,
        roughness: 0.92,
        metalness: 0,
      });
      const hayCount = Math.max(1, Math.round(this.chapterLength / 220));
      for (let i = 0; i < hayCount; i++) {
        const z = this._chapterRandomZ(12);
        if (this._nearRiver(z, 6)) continue;
        const side = i % 2 ? 1 : -1;
        const x = side * rand(10, 18);
        const hay = new THREE.Mesh(hayGeometry, hayMaterial);
        hay.position.set(x, 0.68, z);
        hay.rotation.y = rand(0, Math.PI);
        hay.castShadow = true;
        hay.receiveShadow = true;
        this.root.add(hay);
        this.addCollider({
          x,
          z,
          radius: 1.1,
          type: 'hay',
          blocksMovement: true,
          blocksBullets: false,
        });
      }
    }

    if (dressing === 'swamp') {
      const deadCount = Math.max(3, Math.round(this.chapterLength / 85));
      for (let i = 0; i < deadCount; i++) {
        const z = this._chapterRandomZ(8);
        const side = i % 2 ? 1 : -1;
        const x = side * rand(8, 28);
        const parts = [];
        parts.push(
          makePart(
            new THREE.CylinderGeometry(0.16, 0.32, 4.2, 6),
            0x4a4030,
            { x: 0, y: 2.1, z: 0 }
          )
        );
        for (let b = 0; b < 4; b++) {
          const angle = rand(0, Math.PI * 2);
          const length = rand(1.2, 2.4);
          parts.push(
            makePart(
              new THREE.CylinderGeometry(0.055, 0.11, length, 5),
              0x524734,
              {
                x: Math.cos(angle) * length * 0.35,
                y: rand(2.5, 3.8),
                z: Math.sin(angle) * length * 0.35,
              },
              { x: Math.sin(angle) * 0.7, y: 0, z: -Math.cos(angle) * 0.7 }
            )
          );
        }
        const tree = new THREE.Mesh(mergeParts(parts), this.materials.vertex);
        tree.position.set(x, 0, z);
        tree.rotation.y = rand(0, Math.PI * 2);
        tree.castShadow = true;
        tree.receiveShadow = true;
        this.root.add(tree);
        this.addCollider({
          x,
          z,
          radius: 0.5,
          type: 'dead-tree',
          blocksMovement: true,
          blocksBullets: true,
        });
      }
    }

    if (dressing === 'forest') {
      const logCount = Math.max(2, Math.round(this.chapterLength / 110));
      const logMaterial = new THREE.MeshStandardMaterial({
        color: 0x51402a,
        roughness: 0.95,
        metalness: 0,
      });
      for (let i = 0; i < logCount; i++) {
        const z = this._chapterRandomZ(10);
        const side = i % 2 ? 1 : -1;
        const x = side * rand(9, 22);
        const log = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.34, rand(2.4, 4), 7),
          logMaterial
        );
        log.position.set(x, 0.3, z);
        log.rotation.set(Math.PI / 2, rand(0, Math.PI), rand(-0.15, 0.15));
        log.castShadow = true;
        log.receiveShadow = true;
        this.root.add(log);
        this.addCollider({
          x,
          z,
          radius: 1.1,
          type: 'log',
          blocksMovement: true,
          blocksBullets: false,
        });
      }
    }
  }

  /* ------------------------------------------------------------------------
     Footprints
     ------------------------------------------------------------------------ */

  _buildFootprintPool() {
    const capacity = 220;
    const geometry = new THREE.PlaneGeometry(0.38, 0.72);
    const material = new THREE.MeshBasicMaterial({
      map: getFootprintTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0x59686b,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      toneMapped: true,
    });
    this.footprints = new THREE.InstancedMesh(geometry, material, capacity);
    this.footprints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.footprints.renderOrder = 20;
    this.footprints.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.footprints.setMatrixAt(i, zero);
    }
    this.footprints.instanceMatrix.needsUpdate = true;
    this.footprintCursor = 0;
    this.footprintCount = capacity;
    this.root.add(this.footprints);

    this._footprintDummy = new THREE.Object3D();
    this._footprintMatrix = new THREE.Matrix4();
    this._footprintBasisX = new THREE.Vector3();
    this._footprintBasisY = new THREE.Vector3();
    this._footprintBasisZ = new THREE.Vector3(0, 1, 0);
  }

  addFootprint(x, z, yaw, side = 1) {
    if (!this.footprints) return;
    const index = this.footprintCursor;
    this.footprintCursor = (this.footprintCursor + 1) % this.footprintCount;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this._footprintDummy.position.set(
      x + rightX * 0.13 * side,
      0.041,
      z + rightZ * 0.13 * side
    );
    this._footprintBasisX.set(-Math.cos(yaw), 0, Math.sin(yaw));
    this._footprintBasisY.set(Math.sin(yaw), 0, Math.cos(yaw));
    this._footprintBasisZ.set(0, 1, 0);
    this._footprintMatrix.makeBasis(
      this._footprintBasisX,
      this._footprintBasisY,
      this._footprintBasisZ
    );
    this._footprintDummy.quaternion.setFromRotationMatrix(this._footprintMatrix);
    this._footprintDummy.scale.set(1, 1, 1);
    this._footprintDummy.updateMatrix();
    this.footprints.setMatrixAt(index, this._footprintDummy.matrix);
    this.footprints.instanceMatrix.needsUpdate = true;
  }

  clearFootprints() {
    if (!this.footprints) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.footprintCount; i++) {
      this.footprints.setMatrixAt(i, zero);
    }
    this.footprints.instanceMatrix.needsUpdate = true;
    this.footprintCursor = 0;
  }

  /* ------------------------------------------------------------------------
     Cover, barricades, props
     ------------------------------------------------------------------------ */

  addCollider(collider) {
    this.colliders.push({
      radius: 1,
      blocksMovement: true,
      blocksBullets: false,
      disabled: false,
      ...collider,
    });
    return this.colliders[this.colliders.length - 1];
  }

  addCover(x, z, normalX, normalZ, width, rotation = 0) {
    const cover = {
      x,
      z,
      nx: normalX,
      nz: normalZ,
      tx: Math.cos(rotation),
      tz: Math.sin(rotation),
      halfWidth: width * 0.5,
      radius: 3.0,
    };
    this.coverObjects.push(cover);
    return cover;
  }

  _buildSandbagWalls() {
    const sandbagTextures = getSandbagTextures();
    const bagMaterial = new THREE.MeshStandardMaterial({
      map: sandbagTextures.map,
      normalMap: sandbagTextures.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.98,
      metalness: 0.0,
      color: 0x9d8b63,
    });
    const bagGeometry = new THREE.SphereGeometry(0.5, 10, 7);
    const bagTransforms = [];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const wallCount = Math.max(2, Math.round(this.chapterLength / 75));
    for (let wallIndex = 0; wallIndex < wallCount; wallIndex++) {
      const z = this._chapterRandomZ(12);
      if (this._nearRiver(z, 10)) continue;
      const side = this.random() > 0.5 ? 1 : -1;
      const centerX = side * rand(8.5, 16.5);
      const rotation = rand(-0.3, 0.3);
      const bags = 4 + Math.floor(this.random() * 3);
      const rows = 2;
      const wallWidth = bags * 0.82 + 0.7;

      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < bags; i++) {
          const localX = (i - (bags - 1) / 2) * 0.82 + (row ? 0.33 : 0);
          const localZ = row * 0.26;
          const x = centerX + localX * Math.cos(rotation) - localZ * Math.sin(rotation);
          const zWorld = z + localX * Math.sin(rotation) + localZ * Math.cos(rotation);
          bagTransforms.push({
            x,
            y: 0.28 + row * 0.36 + rand(-0.02, 0.03),
            z: zWorld,
            rotation,
            scale: rand(0.9, 1.08),
            tint: rand(0.82, 1.08),
          });
        }
      }

      this.addCollider({
        x: centerX,
        z,
        radius: Math.max(1.2, wallWidth * 0.38),
        type: 'sandbags',
        blocksMovement: true,
        blocksBullets: false,
      });

      const normalX = -Math.sin(rotation);
      const normalZ = -Math.cos(rotation);
      const cover = this.addCover(centerX, z, normalX, normalZ, wallWidth, rotation);
      const spot = {
        x: centerX - normalX * 1.9,
        z: z - normalZ * 1.9,
        cover,
        occupied: null,
      };
      this.coverSpots.push(spot);

      // Soft, irregular ground shadow instead of a hard dark rectangle.
      const trench = new THREE.Mesh(
        new THREE.PlaneGeometry(wallWidth + 2.4, 2.6),
        new THREE.MeshBasicMaterial({
          map: getScorchTexture(),
          color: 0x1c1a13,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          toneMapped: true,
        })
      );
      trench.rotation.x = -Math.PI / 2;
      trench.rotation.z = rotation;
      trench.position.set(centerX, 0.035, z + Math.cos(rotation) * 1.05);
      trench.renderOrder = 19;
      this.root.add(trench);

    }

    const mesh = new THREE.InstancedMesh(bagGeometry, bagMaterial, bagTransforms.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bagTransforms.forEach((transform, index) => {
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(0, transform.rotation + rand(-0.08, 0.08), rand(-0.12, 0.12));
      dummy.scale.set(1.28 * transform.scale, 0.42 * transform.scale, 0.66 * transform.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.setScalar(transform.tint);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
  }

  _buildBarricadesAndCrates() {
    // Wooden tank traps / cheval de frise.
    const barricadeParts = [
      makePart(new THREE.BoxGeometry(0.16, 0.16, 3.3), 0x6f5836, { x: -0.75, y: 0.9, z: 0 }, { x: 0, y: 0, z: 0.7 }),
      makePart(new THREE.BoxGeometry(0.16, 0.16, 3.3), 0x6f5836, { x: 0.75, y: 0.9, z: 0 }, { x: 0, y: 0, z: -0.7 }),
      makePart(new THREE.BoxGeometry(0.12, 0.12, 3.6), 0x4e3e25, { x: 0, y: 1.35, z: 0 }, { x: 0.35, y: 0, z: 0 }),
      makePart(new THREE.BoxGeometry(0.22, 1.5, 0.22), 0x5c482d, { x: -1.1, y: 0.75, z: -1.1 }),
      makePart(new THREE.BoxGeometry(0.22, 1.5, 0.22), 0x5c482d, { x: 1.1, y: 0.75, z: 1.1 }),
    ];
    const barricadeGeometry = mergeParts(barricadeParts);
    const barricadeMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.02,
    });
    const barricadePositions = [];
    const barricadeCount = Math.max(1, Math.round(this.chapterLength / 140));
    for (let i = 0; i < barricadeCount; i++) {
      const z = this._chapterRandomZ(14);
      if (this._nearRiver(z, 8)) continue;
      const side = i % 2 ? 1 : -1;
      barricadePositions.push([side * rand(8, 14), z, rand(-0.7, 0.8)]);
    }
    const barricades = new THREE.InstancedMesh(
      barricadeGeometry,
      barricadeMaterial,
      barricadePositions.length
    );
    barricades.castShadow = true;
    const dummy = new THREE.Object3D();
    barricadePositions.forEach(([x, z, rotation], index) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      barricades.setMatrixAt(index, dummy.matrix);
      this.addCollider({
        x,
        z,
        radius: 1.5,
        type: 'barricade',
        blocksMovement: true,
        blocksBullets: false,
      });
    });
    barricades.instanceMatrix.needsUpdate = true;
    this.root.add(barricades);

    // Supply crates near camps.
    const crateGeometry = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const crateCount = Math.max(4, Math.round(this.chapterLength * 0.028));
    const crates = new THREE.InstancedMesh(crateGeometry, this.materials.wood, crateCount);
    crates.castShadow = true;
    crates.receiveShadow = true;
    const color = new THREE.Color();
    for (let i = 0; i < crateCount; i++) {
      const side = i % 2 ? 1 : -1;
      let x = side * rand(7, 18);
      let z = this._chapterRandomZ(8);
      if (this._nearRiver(z, 5)) z += 8;
      if (Math.abs(x - roadXAt(z)) < 6) x += side * 3;
      const stack = this.random() > 0.7 ? 2 : 1;
      dummy.position.set(x, 0.55, z);
      dummy.rotation.set(0, rand(0, Math.PI), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      crates.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.09, 0.18, 0.62 + this.random() * 0.12);
      crates.setColorAt(i, color);
      if (stack === 2) {
        const stacked = new THREE.Mesh(crateGeometry, this.materials.wood);
        stacked.position.set(x + rand(-0.08, 0.08), 1.65, z + rand(-0.08, 0.08));
        stacked.rotation.y = rand(0, Math.PI);
        stacked.castShadow = true;
        this.root.add(stacked);
      }
      this.addCollider({
        x,
        z,
        radius: 0.8,
        type: 'crate',
        blocksMovement: true,
        blocksBullets: false,
      });
    }
    crates.instanceMatrix.needsUpdate = true;
    if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
    this.root.add(crates);
  }

  _buildExtraObstacles() {
    const count = Math.max(3, Math.round(this.chapterLength / 44));
    for (let i = 0; i < count; i++) {
      const z = this._chapterRandomZ(8);
      if (this._nearRiver(z, 5)) continue;
      const side = i % 2 ? 1 : -1;
      let x = roadXAt(z) + side * rand(5.5, 16);
      if (Math.abs(x - roadXAt(z)) < 4.8) x += side * 3;
      if (Math.abs(x) > this.playableHalfWidth + 1) continue;
      const roll = this.random();

      if (roll < 0.24) {
        // Boulder / rock outcrop.
        const s = rand(0.7, 1.9);
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(s, 0),
          this.materials.rock
        );
        rock.position.set(x, rand(0.1, 0.35) * s, z);
        rock.rotation.set(rand(0, 2), rand(0, 3), rand(0, 2));
        rock.scale.set(rand(0.8, 1.35), rand(0.55, 0.95), rand(0.8, 1.3));
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.root.add(rock);
        this.addCollider({
          x,
          z,
          radius: s * rand(0.65, 0.95),
          type: 'boulder',
          blocksMovement: true,
          blocksBullets: true,
        });
      } else if (roll < 0.43) {
        // Fallen log with a low, shoot-over profile.
        const length = rand(3.2, 5.8);
        const radius = rand(0.22, 0.38);
        const log = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius * 0.86, length, 7),
          this.materials.wood
        );
        log.position.set(x, radius * 0.9, z);
        log.rotation.set(Math.PI / 2, rand(-0.4, 0.4), rand(-0.3, 0.3));
        log.castShadow = true;
        log.receiveShadow = true;
        this.root.add(log);
        const rotation = rand(-0.5, 0.5);
        this.addCollider({
          x,
          z,
          radius: Math.max(0.5, length * 0.28),
          type: 'log',
          blocksMovement: true,
          blocksBullets: false,
        });
        this.addCover(
          x,
          z,
          -Math.sin(rotation),
          -Math.cos(rotation),
          length * 0.8,
          rotation
        );
      } else if (roll < 0.64) {
        // Jersey / concrete barrier, a classic urban corner obstacle.
        const rotation = rand(-0.6, 0.6);
        const parts = [];
        parts.push(makePart(new THREE.BoxGeometry(3.6, 0.65, 0.56), 0x84847a, { x: 0, y: 0.33, z: 0 }));
        parts.push(makePart(new THREE.BoxGeometry(3.3, 0.55, 0.44), 0x6e7068, { x: 0, y: 0.87, z: 0 }));
        parts.push(makePart(new THREE.BoxGeometry(0.3, 0.26, 0.2), 0xb9b39a, { x: 1.45, y: 1.06, z: 0 }));
        const barrier = new THREE.Mesh(mergeParts(parts), this.materials.vertex);
        barrier.position.set(x, 0, z);
        barrier.rotation.y = rotation;
        barrier.castShadow = true;
        barrier.receiveShadow = true;
        this.root.add(barrier);
        this.addCollider({
          x,
          z,
          radius: 1.8,
          type: 'jersey',
          blocksMovement: true,
          blocksBullets: true,
        });
        this.addCover(
          x,
          z,
          -Math.sin(rotation),
          -Math.cos(rotation),
          3.2,
          rotation
        );
      } else if (roll < 0.82) {
        // Stacked pipes / drums: a tall silhouette that stops bullets.
        const parts = [];
        for (let k = 0; k < 3; k++) {
          parts.push(
            makePart(
              new THREE.CylinderGeometry(0.32, 0.32, rand(2.2, 3.4), 9),
              0x5a5e55,
              {
                x: rand(-0.5, 0.5),
                y: 0.34,
                z: rand(-0.5, 0.5),
              },
              { x: Math.PI / 2, y: rand(0, 3), z: 0 }
            )
          );
        }
        const pipes = new THREE.Mesh(mergeParts(parts), this.materials.vertexMetal);
        pipes.position.set(x, 0, z);
        pipes.rotation.y = rand(0, Math.PI);
        pipes.castShadow = true;
        this.root.add(pipes);
        this.addCollider({
          x,
          z,
          radius: 1.15,
          type: 'pipes',
          blocksMovement: true,
          blocksBullets: true,
        });
      } else {
        // Shallow crater lip that does not block movement but provides cover.
        const crater = new THREE.Mesh(
          new THREE.RingGeometry(0.8, rand(1.4, 2.3), 16),
          new THREE.MeshStandardMaterial({
            color: 0x4a4034,
            roughness: 1,
            metalness: 0,
          })
        );
        crater.rotation.x = -Math.PI / 2;
        crater.position.set(x, 0.045, z);
        crater.receiveShadow = true;
        this.root.add(crater);
        this.addCover(x, z, 0, 1, 2.4, 0);
        this.addCover(x, z, 0, -1, 2.4, 0);
      }
    }
  }

  _buildBunkersAndTents() {
    const concreteMaterial = this.materials.vertex;
    const bunkers = [];
    const bunkerCount = Math.max(0, Math.round(this.chapterLength / 330));
    for (let i = 0; i < bunkerCount; i++) {
      const z = this._chapterRandomZ(18);
      if (this._nearRiver(z, 12)) continue;
      const side = i % 2 ? 1 : -1;
      bunkers.push([side * rand(15, 18), z, rand(-0.25, 0.2)]);
    }
    for (const [x, z, rotation] of bunkers) {
      const parts = [];
      parts.push(makePart(new THREE.BoxGeometry(5.6, 1.55, 3.8), 0x737468, { x: 0, y: 0.78, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(6.0, 0.28, 4.2), 0x555a50, { x: 0, y: 1.62, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(3.4, 0.32, 0.08), 0x141712, { x: 0, y: 1.12, z: -1.92 }));
      parts.push(makePart(new THREE.BoxGeometry(0.4, 0.8, 0.6), 0x8a8a7a, { x: -2.2, y: 1.9, z: -1.5 }));
      parts.push(makePart(new THREE.BoxGeometry(0.4, 0.8, 0.6), 0x8a8a7a, { x: 2.2, y: 1.9, z: -1.5 }));
      for (let i = -3; i <= 3; i++) {
        const bag = makePart(
          new THREE.SphereGeometry(0.5, 8, 6),
          0x8a7d58,
          { x: i * 0.78, y: 0.3, z: -2.4 },
          { x: 0, y: rand(-0.15, 0.15), z: 0 },
          { x: 1.25, y: 0.42, z: 0.68 }
        );
        parts.push(bag);
      }
      const geometry = mergeParts(parts);
      const mesh = new THREE.Mesh(geometry, concreteMaterial);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.addCollider({
        x,
        z,
        radius: 3.0,
        type: 'bunker',
        blocksMovement: true,
        blocksBullets: true,
      });
      this.barracks.push({ x, z: z + 3.5, rotation });
    }

    const tentMaterial = this.materials.vertex;
    const tents = [];
    const tentCount = Math.max(1, Math.round(this.chapterLength / 280));
    for (let i = 0; i < tentCount; i++) {
      const z = this._chapterRandomZ(16);
      if (this._nearRiver(z, 10)) continue;
      const side = i % 2 ? 1 : -1;
      tents.push([side * rand(14, 17), z, rand(-0.45, 0.45)]);
    }
    for (const [x, z, rotation] of tents) {
      const parts = [];
      parts.push(makePart(new THREE.BoxGeometry(4.4, 1.35, 4.8), 0x5f6041, { x: 0, y: 0.68, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(4.8, 0.12, 2.7), 0x3d4a2e, { x: 0, y: 1.68, z: -1.05 }, { x: 0.55, y: 0, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(4.8, 0.12, 2.7), 0x344127, { x: 0, y: 1.68, z: 1.05 }, { x: -0.55, y: 0, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(0.12, 1.25, 0.12), 0x6b5a3b, { x: -2.1, y: 0.65, z: 2.45 }));
      parts.push(makePart(new THREE.BoxGeometry(0.12, 1.25, 0.12), 0x6b5a3b, { x: 2.1, y: 0.65, z: 2.45 }));
      parts.push(makePart(new THREE.BoxGeometry(1.1, 1.15, 0.08), 0x1d2219, { x: 0, y: 0.58, z: -2.41 }));
      const geometry = mergeParts(parts);
      const mesh = new THREE.Mesh(geometry, tentMaterial);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.addCollider({
        x,
        z,
        radius: 2.5,
        type: 'tent',
        blocksMovement: true,
        blocksBullets: false,
      });
      this.barracks.push({ x, z: z + 4, rotation });
    }
  }

  _buildWatchtowersAndRuins() {
    const towerMaterial = this.materials.vertex;
    const towerPositions = [];
    if (this.random() > 0.35) {
      const z = this._chapterRandomZ(18);
      if (!this._nearRiver(z, 12)) {
        const side = this.random() > 0.5 ? 1 : -1;
        towerPositions.push([side * rand(16, 20), z, rand(-0.2, 0.1)]);
      }
    }
    for (const [x, z, rotation] of towerPositions) {
      const parts = [];
      for (const sx of [-1.2, 1.2]) {
        for (const sz of [-1.2, 1.2]) {
          parts.push(makePart(new THREE.CylinderGeometry(0.16, 0.22, 6.4, 6), 0x59452c, { x: sx, y: 3.2, z: sz }));
        }
      }
      parts.push(makePart(new THREE.BoxGeometry(3.6, 0.24, 3.6), 0x6f5a3a, { x: 0, y: 5.2, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(3.9, 0.18, 3.9), 0x3f4a2f, { x: 0, y: 7.2, z: 0 }));
      for (const sx of [-1.7, 1.7]) {
        for (const sz of [-1.7, 1.7]) {
          parts.push(makePart(new THREE.BoxGeometry(0.14, 2.1, 0.14), 0x4a3b26, { x: sx, y: 6.2, z: sz }));
        }
      }
      parts.push(makePart(new THREE.BoxGeometry(3.5, 0.9, 0.12), 0x5b4a30, { x: 0, y: 5.7, z: 1.75 }));
      parts.push(makePart(new THREE.BoxGeometry(3.5, 0.9, 0.12), 0x5b4a30, { x: 0, y: 5.7, z: -1.75 }));
      const geometry = mergeParts(parts);
      const mesh = new THREE.Mesh(geometry, towerMaterial);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.addCollider({
        x,
        z,
        radius: 1.7,
        type: 'tower',
        blocksMovement: true,
        blocksBullets: true,
      });
    }

    const ruinMaterial = this.materials.vertex;
    const ruins = [];
    if (
      this.chapterBiome.id === 'city' ||
      this.chapterBiome.id === 'desert' ||
      this.chapterBiome.id === 'snow'
    ) {
      const ruinCount = Math.max(1, Math.round(this.chapterLength / 260));
      for (let i = 0; i < ruinCount; i++) {
        const z = this._chapterRandomZ(14);
        if (this._nearRiver(z, 8)) continue;
        const side = i % 2 ? 1 : -1;
        ruins.push({
          x: side * rand(12, 16),
          z,
          rotation: rand(-0.6, 0.5),
          scale: rand(0.8, 1.15),
        });
      }
    }
    for (const ruin of ruins) {
      const parts = [];
      parts.push(makePart(new THREE.BoxGeometry(3.8, 1.8, 0.55), 0x74746a, { x: 0, y: 0.9, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(1.2, 2.3, 0.55), 0x5d5e55, { x: -1.1, y: 1.15, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(1.0, 0.5, 0.5), 0x4a4d44, { x: 1.2, y: 0.25, z: 1.2 }, { x: 0.2, y: 0.5, z: 0.8 }));
      parts.push(makePart(new THREE.BoxGeometry(0.8, 0.25, 0.65), 0x76776b, { x: -1.8, y: 0.12, z: 1.7 }, { x: 0.1, y: 0.6, z: 0.2 }));
      const geometry = mergeParts(parts);
      const mesh = new THREE.Mesh(geometry, ruinMaterial);
      mesh.position.set(ruin.x, 0, ruin.z);
      mesh.rotation.y = ruin.rotation;
      mesh.scale.setScalar(ruin.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.addCollider({
        x: ruin.x,
        z: ruin.z,
        radius: 2.2 * ruin.scale,
        type: 'ruin',
        blocksMovement: true,
        blocksBullets: true,
      });
    }
  }

  _createDestructible({
    x,
    z,
    w = 3,
    d = 1,
    h = 2,
    rotation = 0,
    color = 0x74766c,
    accent = 0x555a52,
    type = 'structure',
    label = 'STRUCTURE',
    health = 140,
    debrisScale = 1.3,
    debrisColor = 0x8a8578,
    cover = false,
    blocksBullets = true,
  }) {
    const parts = [];
    parts.push(makePart(new THREE.BoxGeometry(w, h, d), color, { x: 0, y: h * 0.5, z: 0 }));
    // Broken crown and facade detail so the block reads as ruin rather than a
    // pristine cube. These are merged into the destructible geometry.
    parts.push(
      makePart(
        new THREE.BoxGeometry(w * rand(0.22, 0.44), h * rand(0.16, 0.34), d * 1.04),
        accent,
        { x: rand(-w * 0.24, w * 0.24), y: h + h * 0.08, z: 0 },
        { x: 0, y: 0, z: rand(-0.08, 0.08) }
      )
    );
    if (type === 'building' || type === 'block') {
      for (const side of [-1, 1]) {
        for (let row = 0; row < 2; row++) {
          parts.push(
            makePart(
              new THREE.BoxGeometry(w * 0.18, h * 0.14, 0.08),
              0x222a2c,
              {
                x: side * w * 0.22,
                y: h * (0.34 + row * 0.26),
                z: d * 0.5 + 0.04,
              }
            )
          );
        }
      }
    } else if (type === 'wall') {
      parts.push(
        makePart(
          new THREE.BoxGeometry(w * 1.02, 0.16, d * 1.2),
          accent,
          { x: 0, y: h * 0.55, z: 0 }
        )
      );
    } else if (type === 'vehicle' || type === 'dumpster') {
      parts.push(
        makePart(
          new THREE.BoxGeometry(w * 0.9, h * 0.24, d * 0.9),
          accent,
          { x: 0, y: h * 0.94, z: 0 }
        )
      );
      for (const side of [-1, 1]) {
        parts.push(
          makePart(
            new THREE.CylinderGeometry(h * 0.18, h * 0.18, 0.18, 8),
            0x1d1e19,
            { x: side * w * 0.38, y: h * 0.22, z: d * 0.46 },
            { x: Math.PI / 2, y: 0, z: 0 }
          )
        );
      }
    }
    const geometry = mergeParts(parts);
    const mesh = new THREE.Mesh(geometry, this.materials.vertex);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);

    const rubbleParts = [];
    const chunks = 3 + Math.floor(this.random() * 4);
    for (let i = 0; i < chunks; i++) {
      rubbleParts.push(
        makePart(
          new THREE.BoxGeometry(
            w * rand(0.2, 0.58),
            rand(0.12, 0.42),
            d * rand(1.2, 2.8)
          ),
          i % 2 ? debrisColor : accent,
          {
            x: rand(-w * 0.46, w * 0.46),
            y: rand(0.08, 0.32),
            z: rand(-d * 0.8, d * 0.8),
          },
          { x: rand(-0.2, 0.2), y: rand(0, Math.PI), z: rand(-0.2, 0.2) }
        )
      );
    }
    const rubble = new THREE.Mesh(mergeParts(rubbleParts), this.materials.vertex);
    rubble.position.set(x, 0, z);
    rubble.rotation.y = rotation;
    rubble.castShadow = true;
    rubble.visible = false;
    this.root.add(rubble);

    const colliderRadius =
      type === 'wall'
        ? Math.max(w, d) * 0.47
        : Math.hypot(w, d) * 0.37;
    const collider = this.addCollider({
      x,
      z,
      radius: colliderRadius,
      type: 'destructible',
      blocksMovement: true,
      blocksBullets,
    });
    const destructible = {
      x,
      z,
      w,
      d,
      h,
      rotation,
      type,
      label,
      health,
      maxHealth: health,
      mesh,
      rubble,
      collider,
      radius: colliderRadius,
      debrisScale,
      debrisColor,
      destroyed: false,
      hitFlash: 0,
    };
    collider.destructible = destructible;
    if (cover) {
      const normalX = -Math.sin(rotation);
      const normalZ = -Math.cos(rotation);
      destructible.cover = this.addCover(
        x,
        z,
        normalX,
        normalZ,
        Math.max(1.8, w * 0.8),
        rotation
      );
    }
    this.destructibles.push(destructible);
    return destructible;
  }

  _buildDestructibles() {
    const dressing = this.chapterBiome.dressing || this.chapterBiome.id;
    const wallCount = Math.max(2, Math.round(this.chapterLength / 62));
    for (let i = 0; i < wallCount; i++) {
      const z = this._chapterRandomZ(10);
      if (this._nearRiver(z, 6)) continue;
      const side = i % 2 ? 1 : -1;
      let x = roadXAt(z) + side * rand(7.5, 15.5);
      if (Math.abs(x - roadXAt(z)) < 6) x += side * 4;
      if (Math.abs(x) > this.playableHalfWidth + 2) x = Math.sign(x) * (this.playableHalfWidth - 1);
      if (!this.isFree(x, z, 1.1)) continue;
      const city = dressing === 'city';
      this._createDestructible({
        x,
        z,
        w: rand(2.6, 4.6),
        d: rand(0.6, 0.95),
        h: rand(1.3, 2.4),
        rotation: rand(-0.5, 0.5),
        color: city ? 0x737771 : 0x8a7d62,
        accent: city ? 0x4e534f : 0x655b45,
        type: 'wall',
        label: city ? 'CONCRETE WALL' : 'BARRICADE',
        health: city ? 130 : 90,
        debrisScale: 1.1,
        debrisColor: city ? 0x8c908a : 0x8a7a5c,
        cover: true,
      });
    }

    const propCount = Math.max(2, Math.round(this.chapterLength / 88));
    for (let i = 0; i < propCount; i++) {
      const z = this._chapterRandomZ(6);
      if (this._nearRiver(z, 4)) continue;
      const side = i % 2 ? 1 : -1;
      let x = roadXAt(z) + side * rand(6.5, 14);
      if (Math.abs(x - roadXAt(z)) < 5) x += side * 3;
      if (!this.isFree(x, z, 0.8)) continue;
      const roll = this.random();
      if (roll < 0.42) {
        this._createDestructible({
          x,
          z,
          w: rand(1.3, 2.2),
          d: rand(0.8, 1.3),
          h: rand(0.9, 1.4),
          rotation: rand(0, Math.PI),
          color: 0x6b5837,
          accent: 0x3e3322,
          type: 'crate',
          label: 'SUPPLY CRATE',
          health: 48,
          debrisScale: 0.8,
          debrisColor: 0x8a6b3d,
        });
      } else if (roll < 0.72) {
        this._createDestructible({
          x,
          z,
          w: rand(2.1, 3.2),
          d: rand(1.1, 1.6),
          h: rand(1.0, 1.6),
          rotation: rand(-0.4, 0.4),
          color: 0x39463b,
          accent: 0x202a23,
          type: 'dumpster',
          label: 'DUMPSTER',
          health: 75,
          debrisScale: 1.1,
          debrisColor: 0x5c6758,
        });
      } else {
        this._createDestructible({
          x,
          z,
          w: rand(2.4, 3.6),
          d: rand(1.1, 1.7),
          h: rand(1.1, 1.6),
          rotation: rand(-0.5, 0.5),
          color: 0x4b4534,
          accent: 0x2c291f,
          type: 'vehicle',
          label: 'WRECKED CAR',
          health: 110,
          debrisScale: 1.25,
          debrisColor: 0x6b6250,
          cover: true,
        });
      }
    }
  }

  _buildUrbanCombatZone() {
    // Dense blocks, offset cross-walls and street clutter create blind corners:
    // buildings block bullets, so both sides must reposition to get a shot.
    const step = 24;
    let index = 0;
    for (let z = this.chapterStart + 18; z < this.chapterEnd - 16; z += step) {
      const rx = roadXAt(z);
      const side = index % 2 ? 1 : -1;
      this._createDestructible({
        x: rx + side * rand(10.5, 15.5),
        z: z + rand(-3, 3),
        w: rand(5.2, 8.2),
        d: rand(6.5, 11.5),
        h: rand(6, 15),
        rotation: rand(-0.18, 0.18),
        color: this.random() > 0.5 ? 0x5d6462 : 0x676b64,
        accent: 0x3c4341,
        type: 'building',
        label: 'CITY BLOCK',
        health: 250,
        debrisScale: 2.3,
        debrisColor: 0x8a8d84,
      });
      this._createDestructible({
        x: rx - side * rand(12.5, 16.5),
        z: z + rand(-2, 4),
        w: rand(4, 6.5),
        d: rand(4.5, 8),
        h: rand(3.5, 8),
        rotation: rand(-0.3, 0.3),
        color: 0x555c59,
        accent: 0x343b39,
        type: 'building',
        label: 'RUINED BLOCK',
        health: 185,
        debrisScale: 1.8,
        debrisColor: 0x8a8d84,
      });

      // Alternating cross-walls extend from one side toward the middle and
      // leave a lane on the other side. The player has to round each corner.
      const wallSide = index % 4 < 2 ? -1 : 1;
      this._createDestructible({
        x: rx + wallSide * rand(3.4, 6.4),
        z: z + rand(8, 12),
        w: rand(6.5, 9.5),
        d: rand(0.7, 1.0),
        h: rand(2.2, 3.6),
        rotation: rand(-0.15, 0.15),
        color: 0x6b6f68,
        accent: 0x464b47,
        type: 'wall',
        label: 'CORNER WALL',
        health: 160,
        debrisScale: 1.2,
        debrisColor: 0x8a8d84,
        cover: true,
      });

      if (this.random() > 0.45) {
        this._createDestructible({
          x: rx + (this.random() > 0.5 ? 1 : -1) * rand(1.8, 3.6),
          z: z + rand(-9, 9),
          w: rand(2.4, 3.6),
          d: rand(1.5, 2.4),
          h: rand(1.1, 1.8),
          rotation: rand(0, Math.PI),
          color: 0x474d49,
          accent: 0x2b302d,
          type: 'vehicle',
          label: 'STREET WRECK',
          health: 100,
          debrisScale: 1.1,
          debrisColor: 0x6b6250,
          cover: true,
        });
      }
      index++;
    }
  }

  _buildBarrels() {
    const parts = [
      makePart(new THREE.CylinderGeometry(0.36, 0.36, 0.92, 12), 0x8a2f1d, { x: 0, y: 0.46, z: 0 }),
      makePart(new THREE.CylinderGeometry(0.39, 0.39, 0.08, 12), 0x2f2c24, { x: 0, y: 0.14, z: 0 }),
      makePart(new THREE.CylinderGeometry(0.39, 0.39, 0.08, 12), 0x2f2c24, { x: 0, y: 0.78, z: 0 }),
      makePart(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), 0x4b2014, { x: 0, y: 0.93, z: 0 }),
      makePart(new THREE.CylinderGeometry(0.365, 0.365, 0.19, 12), 0xd1a245, { x: 0, y: 0.52, z: 0 }),
      makePart(new THREE.TorusGeometry(0.36, 0.035, 5, 12), 0x2f2c24, { x: 0, y: 0.68, z: 0 }, { x: Math.PI / 2, y: 0, z: 0 }),
    ];
    const geometry = mergeParts(parts);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.63,
      metalness: 0.36,
    });
    const barrelCount = Math.max(2, Math.round(this.chapterLength / 80));
    for (let i = 0; i < barrelCount; i++) {
      const z = this._chapterRandomZ(8);
      if (this._nearRiver(z, 3)) continue;
      const side = i % 2 ? 1 : -1;
      let x = side * rand(6, 15);
      if (Math.abs(x - roadXAt(z)) < 5) x += side * 3;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rand(0, Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const collider = this.addCollider({
        x,
        z,
        radius: 0.48,
        type: 'barrel',
        blocksMovement: true,
        blocksBullets: false,
      });
      this.barrels.push({
        x,
        z,
        radius: 0.52,
        health: 28,
        alive: true,
        mesh,
        collider,
        respawn: { x, z },
      });
    }
  }

  _buildWrecks() {
    const wreckMaterial = this.materials.vertexMetal;
    const wrecks = [];
    if (this.random() > 0.4) {
      const z = this._chapterRandomZ(16);
      if (!this._nearRiver(z, 10)) {
        const side = this.random() > 0.5 ? 1 : -1;
        wrecks.push({
          x: side * rand(8, 14),
          z,
          rotation: rand(-0.9, 0.8),
        });
      }
    }
    for (const wreck of wrecks) {
      const parts = [];
      parts.push(makePart(new THREE.BoxGeometry(2.4, 0.75, 4.2), 0x3f3d30, { x: 0, y: 0.62, z: 0 }));
      parts.push(makePart(new THREE.BoxGeometry(2.0, 0.55, 1.8), 0x34362b, { x: 0, y: 1.25, z: -0.4 }));
      parts.push(makePart(new THREE.BoxGeometry(2.1, 0.12, 1.3), 0x5a4d34, { x: 0, y: 1.57, z: 0.7 }, { x: 0.08, y: 0, z: 0.03 }));
      for (const sx of [-1.08, 1.08]) {
        for (const sz of [-1.25, 1.25]) {
          parts.push(makePart(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 10), 0x1d1e19, { x: sx, y: 0.34, z: sz }, { x: 0, y: 0, z: Math.PI / 2 }));
        }
      }
      const geometry = mergeParts(parts);
      const mesh = new THREE.Mesh(geometry, wreckMaterial);
      mesh.position.set(wreck.x, 0, wreck.z);
      mesh.rotation.y = wreck.rotation;
      mesh.rotation.x = 0.04;
      mesh.castShadow = true;
      this.root.add(mesh);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0xff8a32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.85,
          toneMapped: false,
        })
      );
      glow.position.set(wreck.x + rand(-0.5, 0.5), 0.55, wreck.z + rand(-0.5, 0.5));
      glow.scale.set(3.6, 2.4, 1);
      this.root.add(glow);
      const light = new THREE.PointLight(0xff7b30, 14, 11, 2);
      light.position.copy(glow.position);
      light.position.y = 1.3;
      this.root.add(light);
      this.fireLights.push({ light, base: 14, phase: rand(0, 10) });
      this.flareSprites.push({ sprite: glow, baseScale: 3.6, phase: rand(0, 10), flicker: true });

      this.addCollider({
        x: wreck.x,
        z: wreck.z,
        radius: 2.0,
        type: 'wreck',
        blocksMovement: true,
        blocksBullets: true,
      });
      this.smokeSources.push({ x: wreck.x, z: wreck.z, large: true, rate: 0.13, timer: rand(0, 0.13) });
    }
  }

  _buildScorchPool() {
    const texture = getScorchTexture();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      color: 0xded4be,
      toneMapped: true,
    });
    this.scorchMeshes = [];
    this.scorchCursor = 0;
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, -20, 0);
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.root.add(mesh);
      this.scorchMeshes.push(mesh);
    }
  }

  addScorch(position, scale = 5) {
    const mesh = this.scorchMeshes[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % this.scorchMeshes.length;
    mesh.visible = true;
    mesh.position.set(position.x, 0.065, position.z);
    mesh.rotation.z = rand(0, Math.PI * 2);
    mesh.scale.setScalar(scale);
  }

  clearScorch() {
    for (const mesh of this.scorchMeshes) mesh.visible = false;
  }

  /* ------------------------------------------------------------------------
     Physics queries + AI helpers
     ------------------------------------------------------------------------ */

  resolveCircle(position, radius) {
    for (let pass = 0; pass < 2; pass++) {
      for (const collider of this.colliders) {
        if (!collider.blocksMovement || collider.disabled) continue;
        const dx = position.x - collider.x;
        const dz = position.z - collider.z;
        const minDist = collider.radius + radius;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist) continue;
        let dist = Math.sqrt(distSq);
        if (dist < COLLIDER_EPSILON) {
          dist = COLLIDER_EPSILON;
        }
        const push = minDist - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
      }
    }
    return position;
  }

  isFree(x, z, radius = 1) {
    for (const collider of this.colliders) {
      if (!collider.blocksMovement || collider.disabled) continue;
      const dx = x - collider.x;
      const dz = z - collider.z;
      const r = collider.radius + radius;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  hasLineOfSight(from, to) {
    for (const collider of this.colliders) {
      if (!collider.blocksBullets || collider.disabled) continue;
      const t = segmentCircle2D(from.x, from.z, to.x, to.z, collider.x, collider.z, collider.radius);
      if (t !== null && t > 0.03 && t < 0.97) return false;
    }
    return true;
  }

  /** Return the first obstacle hit by a bullet segment, if any. */
  firstObstacleHit(from, to, extraRadius = 0) {
    let earliest = null;
    for (const collider of this.colliders) {
      if (!collider.blocksBullets || collider.disabled) continue;
      const t = segmentCircle2D(
        from.x, from.z, to.x, to.z,
        collider.x, collider.z, collider.radius + extraRadius
      );
      if (t !== null && t > 0.015 && (earliest === null || t < earliest.t)) {
        earliest = { t, collider };
      }
    }
    return earliest;
  }

  isInCover(entityPosition, shooterPosition) {
    for (const cover of this.coverObjects) {
      const edx = entityPosition.x - cover.x;
      const edz = entityPosition.z - cover.z;
      const sdx = shooterPosition.x - cover.x;
      const sdz = shooterPosition.z - cover.z;
      const entitySide = edx * cover.nx + edz * cover.nz;
      const shooterSide = sdx * cover.nx + sdz * cover.nz;
      if (entitySide > -0.15 || shooterSide < 0.4) continue;
      const alongEntity = Math.abs(edx * cover.tx + edz * cover.tz);
      if (alongEntity > cover.halfWidth + 1.3) continue;
      const distSq = edx * edx + edz * edz;
      if (distSq < (cover.halfWidth + 3.2) * (cover.halfWidth + 3.2)) return true;
    }
    return false;
  }

  findCoverSpotNear(x, z, maxDistance = 9, exclude = null) {
    let best = null;
    let bestDist = maxDistance * maxDistance;
    for (const spot of this.coverSpots) {
      if (spot.occupied && spot.occupied !== exclude) continue;
      const dx = spot.x - x;
      const dz = spot.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        best = spot;
        bestDist = d;
      }
    }
    return best;
  }

  claimCoverSpot(spot, owner) {
    if (!spot) return null;
    if (spot.occupied && spot.occupied !== owner) return null;
    spot.occupied = owner;
    return spot;
  }

  releaseCoverSpot(spot, owner) {
    if (spot && spot.occupied === owner) spot.occupied = null;
  }

  findSpawnPoint(minZ, maxZ, { preferCover = false, radius = 0.9, exclude = null } = {}) {
    if (preferCover) {
      const candidates = this.coverSpots.filter(
        (spot) =>
          !spot.occupied &&
          spot.z >= minZ &&
          spot.z <= maxZ &&
          this.isFree(spot.x, spot.z, radius)
      );
      if (candidates.length) {
        const spot = candidates[Math.floor(Math.random() * candidates.length)];
        return { x: spot.x, z: spot.z, spot };
      }
    }
    for (let attempt = 0; attempt < 24; attempt++) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const x = side * rand(this.playableHalfWidth * 0.55, this.playableHalfWidth - 1.2);
      const z = rand(minZ, maxZ);
      if (this.isFree(x, z, radius)) {
        return { x, z, spot: null };
      }
    }
    return { x: rand(-8, 8), z: clamp(rand(minZ, maxZ), minZ, maxZ), spot: null };
  }

  findSpawnNear(x, z, radius) {
    for (let attempt = 0; attempt < 18; attempt++) {
      const px = x + rand(-6, 6);
      const pz = z + rand(-6, 6);
      if (Math.abs(px) < this.playableHalfWidth && this.isFree(px, pz, radius)) {
        return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  getBarrelAt(x, z, radius = 0.5) {
    for (const barrel of this.barrels) {
      if (!barrel.alive) continue;
      const dx = barrel.x - x;
      const dz = barrel.z - z;
      const r = barrel.radius + radius;
      if (dx * dx + dz * dz < r * r) return barrel;
    }
    return null;
  }

  destroyBarrel(barrel) {
    if (!barrel || !barrel.alive) return false;
    barrel.alive = false;
    barrel.mesh.visible = false;
    if (barrel.collider) barrel.collider.disabled = true;
    return true;
  }

  destroyDestructible(destructible) {
    if (!destructible || destructible.destroyed) return false;
    destructible.destroyed = true;
    destructible.mesh.visible = false;
    if (destructible.rubble) destructible.rubble.visible = true;
    if (destructible.collider) destructible.collider.disabled = true;
    return true;
  }

  /* ------------------------------------------------------------------------
     Frame update + reset
     ------------------------------------------------------------------------ */

  update(dt) {
    this.time += dt;
    if (this.waterMaterial) {
      this.waterNormal.offset.x = (this.waterNormal.offset.x + dt * 0.009) % 1;
      this.waterNormal.offset.y = (this.waterNormal.offset.y + dt * 0.004) % 1;
    }
    for (const item of this.fireLights) {
      const flicker =
        1 +
        Math.sin(this.time * 9.7 + item.phase) * 0.18 +
        Math.sin(this.time * 23.1 + item.phase * 2) * 0.08;
      item.light.intensity = item.base * flicker;
    }
    for (const item of this.flareSprites) {
      const flicker =
        1 +
        Math.sin(this.time * (item.flicker ? 7.3 : 4.1) + item.phase) * 0.12 +
        Math.sin(this.time * 17.7 + item.phase) * 0.05;
      item.sprite.scale.set(item.baseScale * flicker, item.baseScale * 0.72 * flicker, 1);
    }
    if (this.flareLight) {
      this.flareLight.intensity =
        5.5 + Math.sin(this.time * 5.7) * 1.2 + Math.sin(this.time * 13.1) * 0.4;
    }
  }

  reset() {
    this.clearScorch();
    this.clearFootprints();
    for (const barrel of this.barrels) {
      barrel.alive = true;
      barrel.health = 28;
      barrel.mesh.visible = true;
      if (barrel.collider) barrel.collider.disabled = false;
    }
    for (const spot of this.coverSpots) spot.occupied = null;
    for (const destructible of this.destructibles) {
      destructible.destroyed = false;
      destructible.health = destructible.maxHealth;
      destructible.hitFlash = 0;
      destructible.mesh.visible = true;
      if (destructible.rubble) destructible.rubble.visible = false;
      if (destructible.collider) destructible.collider.disabled = false;
    }
  }

  getSmokeSources() {
    return this.smokeSources;
  }
}
