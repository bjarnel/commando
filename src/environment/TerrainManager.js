import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTINGS } from '../config/settings.js';
import { BIOMES, getBiomeAt } from '../config/biomes.js';
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

const LEVEL_EXTRA = 320;
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

    this.random = seededRandom(0xb4a7c0de);
    this.colliders = [];
    this.coverObjects = [];
    this.coverSpots = [];
    this.barrels = [];
    this.smokeSources = [];
    this.barracks = [];
    this.rivers = [];
    this.fireLights = [];
    this.flareSprites = [];
    this.time = 0;
    this.levelLength = SETTINGS.mission.length;
    this.extractionZ = SETTINGS.mission.extractionZ;
    this.extractionX = roadXAt(this.extractionZ);
    this.extraction = { x: this.extractionX, z: this.extractionZ };
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

    this._buildGround();
    this._buildGroundDetails();
    this._buildBiomeGrounds();
    this._buildRoad();
    this._buildRiversAndBridges();
    this._buildPalms();
    this._buildJungleAndRocks();
    this._buildGrass();
    this._buildSandbagWalls();
    this._buildBarricadesAndCrates();
    this._buildBunkersAndTents();
    this._buildWatchtowersAndRuins();
    this._buildBiomeDressing();
    this._buildBarrels();
    this._buildWrecks();
    this._buildExtraction();
    this._buildScorchPool();
    this._buildFootprintPool();
  }

  getRoadX(z) {
    return roadXAt(z);
  }

  getBiome(z) {
    return getBiomeAt(z);
  }

  isSnow(z) {
    return getBiomeAt(z).id === 'snow';
  }

  /* ------------------------------------------------------------------------
     Ground, road, water
     ------------------------------------------------------------------------ */

  _buildGround() {
    const groundTextures = getGroundTextures();
    groundTextures.map.repeat.set(28, 300);
    groundTextures.normalMap.repeat.set(28, 300);
    groundTextures.roughnessMap.repeat.set(28, 300);
    const material = new THREE.MeshStandardMaterial({
      map: groundTextures.map,
      normalMap: groundTextures.normalMap,
      roughnessMap: groundTextures.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.97,
      metalness: 0.01,
      color: 0xe9e3c8,
    });
    const geometry = new THREE.PlaneGeometry(180, this.levelLength + LEVEL_EXTRA * 2);
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.025, this.levelLength / 2 - 60);
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
        new THREE.PlaneGeometry(13, this.levelLength + 200),
        shoulderMaterial
      );
      shoulder.rotation.x = -Math.PI / 2;
      shoulder.position.set(side * 26, -0.012, this.levelLength / 2);
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
    const count = 150;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    mesh.renderOrder = 2;
    mesh.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = rand(-45, 45);
      const z = rand(-80, this.levelLength + 120);
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
    const overlays = [
      { kind: 'desert', start: 645, end: 972 },
      { kind: 'city', start: 932, end: 1203 },
      { kind: 'snow', start: 1158, end: 1540 },
    ];
    this.biomeOverlays = [];
    for (const overlay of overlays) {
      const textures = getBiomeGroundTextures(overlay.kind);
      textures.map.wrapS = THREE.RepeatWrapping;
      textures.map.wrapT = THREE.RepeatWrapping;
      textures.normalMap.wrapS = THREE.RepeatWrapping;
      textures.normalMap.wrapT = THREE.RepeatWrapping;
      textures.map.repeat.set(1, 1);
      textures.normalMap.repeat.set(1, 1);

      const material = new THREE.MeshStandardMaterial({
        map: textures.map,
        normalMap: textures.normalMap,
        normalScale: new THREE.Vector2(overlay.kind === 'snow' ? 0.45 : 0.7, overlay.kind === 'snow' ? 0.45 : 0.7),
        roughness: overlay.kind === 'snow' ? 0.74 : overlay.kind === 'city' ? 0.82 : 0.96,
        metalness: overlay.kind === 'snow' ? 0.06 : overlay.kind === 'city' ? 0.04 : 0.01,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });

      const rows = Math.max(28, Math.ceil((overlay.end - overlay.start) / 4));
      const positions = [];
      const uvs = [];
      const colors = [];
      const indices = [];
      const feather = 28;
      const tile = 7.2;
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const z = overlay.start + (overlay.end - overlay.start) * t;
        const alpha =
          smoothstep(overlay.start, overlay.start + feather, z) *
          (1 - smoothstep(overlay.end - feather, overlay.end, z));
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
      mesh.renderOrder = 0;
      this.root.add(mesh);
      this.biomeOverlays.push(mesh);
    }
  }

  _roadTintAt(z) {
    for (let i = 0; i < BIOMES.length - 1; i++) {
      const boundary = BIOMES[i].end;
      if (z > boundary - 35 && z < boundary + 35) {
        const t = smoothstep(boundary - 35, boundary + 35, z);
        return new THREE.Color(BIOMES[i].roadTint).lerp(
          new THREE.Color(BIOMES[i + 1].roadTint),
          t
        );
      }
    }
    return new THREE.Color(getBiomeAt(z).roadTint);
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
    const start = -100;
    const end = this.levelLength + 100;
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
    road.renderOrder = 1;
    this.root.add(road);
    this.road = road;
  }

  _buildRiversAndBridges() {
    const waterNormal = getWaterNormalTexture();
    waterNormal.repeat.set(7, 2.5);
    this.waterNormal = waterNormal;
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x4b6a5e,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.16,
      metalness: 0.32,
      transparent: true,
      opacity: 0.95,
    });
    this.waterMaterial = waterMaterial;
    const iceMaterial = new THREE.MeshStandardMaterial({
      color: 0xb4d3dc,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.28,
      metalness: 0.12,
      transparent: true,
      opacity: 0.97,
    });
    this.iceMaterial = iceMaterial;

    const bankMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d4934,
      roughness: 1,
      metalness: 0,
    });
    const snowBankMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9d5d5,
      roughness: 0.85,
      metalness: 0,
    });

    const rivers = [
      { z: 545, width: 22, frozen: false },
      { z: 1180, width: 28, frozen: true },
    ];

    for (const river of rivers) {
      this.rivers.push({ z: river.z, width: river.width, frozen: river.frozen });
      const material = river.frozen ? iceMaterial : waterMaterial;
      const water = new THREE.Mesh(new THREE.PlaneGeometry(180, river.width), material);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, 0.05, river.z);
      water.receiveShadow = true;
      this.root.add(water);

      // Muddy banks become snow-packed shores at the frozen crossing.
      const bankMaterialForRiver = river.frozen ? snowBankMaterial : bankMaterial;
      for (const side of [-1, 1]) {
        const bank = new THREE.Mesh(new THREE.PlaneGeometry(180, river.frozen ? 4.5 : 3.2), bankMaterialForRiver);
        bank.rotation.x = -Math.PI / 2;
        bank.position.set(0, 0.028, river.z + side * (river.width / 2 + 1.6));
        bank.receiveShadow = true;
        this.root.add(bank);
      }

      if (river.frozen) {
        // A few sharp cracks across the ice sheet.
        const crackPositions = [];
        for (let i = 0; i < 12; i++) {
          const x = rand(-55, 55);
          const z = river.z + rand(-river.width * 0.35, river.width * 0.35);
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

      // Reeds and river rocks.
      const reedMaterial = new THREE.MeshStandardMaterial({
        map: getGrassTexture(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 1,
        color: river.frozen ? 0xbabfa8 : 0x7c8a54,
      });
      const reedGeometry = new THREE.PlaneGeometry(1.5, 1.9);
      reedGeometry.translate(0, 0.95, 0);
      const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, 90);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 90; i++) {
        const side = i % 2 ? 1 : -1;
        dummy.position.set(
          rand(-55, 55),
          0,
          river.z + side * (river.width / 2 + rand(0.6, 2.9))
        );
        dummy.rotation.set(0, rand(0, Math.PI), 0);
        dummy.scale.setScalar(rand(0.6, 1.5));
        dummy.updateMatrix();
        reeds.setMatrixAt(i, dummy.matrix);
      }
      reeds.instanceMatrix.needsUpdate = true;
      this.root.add(reeds);

      this._buildBridge(river.z, river.width, river.frozen);
    }
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
    const coin = new THREE.SphereGeometry(0.18, 6, 5);
    parts.push(makePart(coin, 0x6c542f, { x: 0, y: 4.5, z: 0 }));

    for (let i = 0; i < 7; i++) {
      const frond = new THREE.ConeGeometry(0.48, 3.3, 4, 1);
      frond.translate(0, 1.65, 0);
      const angle = (i / 7) * Math.PI * 2 + 0.18;
      applyTransform(
        frond,
        { x: Math.cos(angle) * 0.9, y: 4.65, z: Math.sin(angle) * 0.9 },
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
        { x: Math.cos(angle) * 0.55, y: 4.2, z: Math.sin(angle) * 0.55 },
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
    const addTree = (x, z, scale, kind = 'palm') => {
      if (Math.abs(x - roadXAt(z)) < 5.4) return;
      const biome = getBiomeAt(z).id;
      if (biome !== 'jungle' && biome !== 'wetlands') return;
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

    // Hand-placed anchors give the opening view and landmarks a composed feel.
    const anchors = [
      [-12.5, 13, 1.5, 'palm'],
      [13.4, 21, 1.35, 'broad'],
      [-16.2, 35, 1.6, 'palm'],
      [15.8, 47, 1.25, 'palm'],
      [-13.1, 72, 1.45, 'broad'],
      [12.9, 94, 1.5, 'palm'],
      [-17.4, 122, 1.35, 'palm'],
      [16.5, 158, 1.45, 'broad'],
      [-12.4, 205, 1.3, 'palm'],
      [14.8, 258, 1.5, 'palm'],
      [-15.2, 330, 1.35, 'broad'],
      [17.1, 412, 1.55, 'palm'],
      [-11.9, 501, 1.4, 'palm'],
      [12.1, 630, 1.25, 'broad'],
      [-16.7, 733, 1.5, 'palm'],
      [13.9, 860, 1.4, 'palm'],
      [-14.1, 1010, 1.5, 'broad'],
      [16.3, 1150, 1.45, 'palm'],
      [-12.8, 1270, 1.35, 'palm'],
      [14.4, 1360, 1.55, 'palm'],
    ];
    for (const [x, z, scale, kind] of anchors) addTree(x, z, scale, kind);

    for (let i = 0; i < 148; i++) {
      const z = rand(-40, this.levelLength + 150);
      const side = this.random() > 0.5 ? 1 : -1;
      const edgeBias = this.random();
      let x;
      if (edgeBias < 0.55) {
        x = side * rand(22, 48);
      } else {
        x = side * rand(12.5, 23);
      }
      if (Math.abs(x - roadXAt(z)) < 8) x += side * 5;
      addTree(x, z, rand(0.82, 1.55), i % 4 === 0 ? 'broad' : 'palm');
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
    // Dense, fogged wall of jungle beyond the playable corridor, ending at the
    // desert line where the dedicated biome dressing takes over.
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const farTransforms = [];
    for (let i = 0; i < 260; i++) {
      const z = rand(-80, 820);
      if (getBiomeAt(z).id !== 'jungle' && getBiomeAt(z).id !== 'wetlands') continue;
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

    // Close jungle bushes / shrubs.
    const bushGeometry = new THREE.IcosahedronGeometry(0.85, 0);
    const bushMaterial = new THREE.MeshStandardMaterial({
      color: 0x40512d,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    });
    const bushTransforms = [];
    for (let i = 0; i < 230; i++) {
      const z = rand(-30, 780);
      if (getBiomeAt(z).id !== 'jungle' && getBiomeAt(z).id !== 'wetlands') continue;
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

    // Weathered rocks across every biome, tinted to the local ground.
    const rockGeometry = new THREE.DodecahedronGeometry(0.7, 0);
    const rockCount = 100;
    const rocks = new THREE.InstancedMesh(rockGeometry, this.materials.rock, rockCount);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let i = 0; i < rockCount; i++) {
      const side = i % 2 ? 1 : -1;
      let x = side * rand(9, 33);
      const z = rand(-20, this.levelLength + 80);
      if (Math.abs(x - roadXAt(z)) < 6) x += side * 4;
      const scale = rand(0.4, 1.7);
      const biomeId = getBiomeAt(z).id;
      dummy.position.set(x, scale * 0.15, z);
      dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      dummy.scale.set(scale, scale * rand(0.45, 0.8), scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      if (biomeId === 'snow') {
        color.setHSL(0.52, 0.08, 0.74 + this.random() * 0.12);
      } else if (biomeId === 'desert') {
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

    const targetCount = 3600;
    const transforms = [];
    let attempts = 0;
    // Cluster tufts for natural drifts rather than a uniform scatter. City and
    // snow sections have no grass; desert tufts are dry and sparse.
    while (transforms.length < targetCount && attempts < 12000) {
      attempts++;
      const side = this.random() > 0.5 ? 1 : -1;
      const clusterZ = rand(-60, this.levelLength + 140);
      const biomeId = getBiomeAt(clusterZ).id;
      // Grass belongs to jungle, wetlands and damp jungle fringes only.
      if (biomeId !== 'jungle' && biomeId !== 'wetlands') continue;
      const clusterX = side * rand(4.6, 34);
      const clusterCount = 3 + Math.floor(this.random() * 8);
      for (let i = 0; i < clusterCount && transforms.length < targetCount; i++) {
        const z = clusterZ + rand(-4, 4);
        let x = clusterX + rand(-3.4, 3.4);
        if (Math.abs(x - roadXAt(z)) < 3.8) x += side * 3;
        transforms.push({ x, z, biomeId });
      }
    }
    const grass = new THREE.InstancedMesh(geometry, material, transforms.length);
    grass.castShadow = false;
    grass.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    transforms.forEach((t, index) => {
      const dryScale = t.biomeId === 'desert' ? 0.7 : 1;
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.scale.set(rand(0.65, 1.55) * dryScale, rand(0.7, 1.7) * dryScale, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(index, dummy.matrix);
      if (t.biomeId === 'desert') {
        color.setHSL(0.12 + this.random() * 0.04, 0.22, 0.55 + this.random() * 0.16);
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
    for (let i = 0; i < 64; i++) {
      const z = rand(680, 945);
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
    const scrubCount = 120;
    const scrub = new THREE.InstancedMesh(scrubGeometry, scrubMaterial, scrubCount);
    scrub.castShadow = true;
    scrub.receiveShadow = true;
    for (let i = 0; i < scrubCount; i++) {
      const z = rand(680, 955);
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
    const mesaCount = 26;
    const mesas = new THREE.InstancedMesh(mesaGeometry, mesaMaterial, mesaCount);
    mesas.castShadow = false;
    for (let i = 0; i < mesaCount; i++) {
      const z = rand(660, 980);
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

    /* City: ruined skyline, street lamps and shattered barriers. */
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x596264,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });
    const buildingCount = 34;
    const buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      buildingMaterial,
      buildingCount
    );
    buildings.castShadow = false;
    buildings.receiveShadow = true;
    const buildingData = [];
    for (let i = 0; i < buildingCount; i++) {
      const z = rand(945, 1210);
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
    for (let i = 0; i < 12; i++) {
      const z = 965 + i * 18 + rand(-3, 3);
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
    const rubble = new THREE.InstancedMesh(rubbleGeometry, rubbleMaterial, 70);
    rubble.castShadow = true;
    for (let i = 0; i < 70; i++) {
      const z = rand(940, 1210);
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
    for (const [x, z, rotation] of [
      [-11, 1005, 0.15],
      [12, 1060, -0.3],
      [-14, 1120, 0.2],
    ]) {
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
    for (let i = 0; i < 82; i++) {
      const z = rand(1160, 1500);
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

    const drifts = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 5),
      new THREE.MeshStandardMaterial({ color: 0xdbe5e4, roughness: 0.9, metalness: 0 }),
      70
    );
    drifts.receiveShadow = true;
    for (let i = 0; i < 70; i++) {
      const z = rand(1155, 1510);
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
    const ridgeCount = 26;
    const ridges = new THREE.InstancedMesh(ridgeGeometry, ridgeMaterial, ridgeCount);
    for (let i = 0; i < ridgeCount; i++) {
      const z = rand(1140, 1550);
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
    this.footprints.renderOrder = 2;
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

    const wallZ = [18, 42, 80, 118, 155, 202, 235, 320, 405, 475, 640, 705, 790, 880, 960, 1045, 1130, 1290, 1360, 1418];
    for (const z of wallZ) {
      if (Math.abs(z - 545) < 15 || Math.abs(z - 1180) < 18) continue;
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

      // Trench shadow and earth lip behind the wall.
      const trench = new THREE.Mesh(
        new THREE.PlaneGeometry(wallWidth + 1.8, 2.1),
        new THREE.MeshStandardMaterial({
          color: 0x2f2d20,
          roughness: 1,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        })
      );
      trench.rotation.x = -Math.PI / 2;
      trench.rotation.z = rotation;
      trench.position.set(centerX, 0.035, z + Math.cos(rotation) * 1.05);
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
    const barricadePositions = [
      [ -9.5, 12, 0.45 ],
      [ 8.5, 58, -0.2 ],
      [ -11, 300, 0.4 ],
      [ 13, 520, -0.2 ],
      [ -14, 760, 0.8 ],
      [ 13, 940, 0.1 ],
      [ -10, 1110, 0.5 ],
      [ 11, 1330, -0.6 ],
    ];
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
    const crateCount = 36;
    const crates = new THREE.InstancedMesh(crateGeometry, this.materials.wood, crateCount);
    crates.castShadow = true;
    crates.receiveShadow = true;
    const color = new THREE.Color();
    const crateAnchors = [
      [-7.6, 9.5], [-6.6, 10.6], [12.9, 16.2], [13.8, 15.4],
      [-14.4, 64], [15.2, 74.5], [-11.5, 162], [12.4, 244],
    ];
    const anchorCount = Math.min(crateCount, crateAnchors.length);
    for (let i = 0; i < crateCount; i++) {
      let x;
      let z;
      if (i < anchorCount) {
        [x, z] = crateAnchors[i];
      } else {
        const side = i % 2 ? 1 : -1;
        x = side * rand(12, 22);
        z = rand(70, this.levelLength - 60);
        if (Math.abs(x - roadXAt(z)) < 6) x += side * 3;
      }
      const stack = i < anchorCount ? (i % 3 === 0 ? 2 : 1) : (this.random() > 0.7 ? 2 : 1);
      dummy.position.set(x, 0.55, z);
      dummy.rotation.set(0, rand(0, Math.PI), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      crates.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.09, 0.18, 0.62 + this.random() * 0.12);
      crates.setColorAt(i, color);
      if (stack === 2) {
        // The stack is represented by one extra small visual object per stack.
        const stacked = new THREE.Mesh(crateGeometry, this.materials.wood);
        stacked.position.set(x + rand(-0.08, 0.08), 1.65, z + rand(-0.08, 0.08));
        stacked.rotation.y = rand(0, Math.PI);
        stacked.castShadow = true;
        this.root.add(stacked);
      }
      if (i < 16) {
        this.addCollider({
          x,
          z,
          radius: 0.8,
          type: 'crate',
          blocksMovement: true,
          blocksBullets: false,
        });
      }
    }
    crates.instanceMatrix.needsUpdate = true;
    if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
    this.root.add(crates);
  }

  _buildBunkersAndTents() {
    const concreteMaterial = this.materials.vertex;
    const bunkers = [
      [15.5, 96, -0.12],
      [-17, 250, 0.12],
      [17, 675, -0.2],
      [-18, 1035, 0.16],
      [16, 1355, 0.15],
    ];
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
    const tents = [
      [14.2, 46, -0.3],
      [-15.5, 78, 0.4],
      [16, 170, -0.2],
      [-16, 455, 0.4],
      [17, 805, 0.2],
      [-16, 1110, -0.35],
    ];
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
    const towerPositions = [
      [-16.5, 54, 0.1],
      [18.5, 208, -0.2],
      [20, 380, 0.1],
      [-20, 985, -0.2],
    ];
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
    const ruins = [
      { x: -13, z: 350, rotation: 0.4, scale: 1 },
      { x: 14, z: 870, rotation: -0.6, scale: 0.8 },
      { x: -15, z: 1300, rotation: 0.2, scale: 1.1 },
    ];
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
    const positions = [
      [-6.8, 11], [8.6, 24], [9.4, 63], [-9, 110], [7, 210], [-14, 360],
      [9, 440], [-8, 510], [14, 690], [-11, 820], [8, 900], [-15, 1080],
      [11, 1210], [-7, 1300], [13, 1390],
    ];
    for (const [x, z] of positions) {
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
    const wrecks = [
      { x: 9.2, z: 36, rotation: 0.55 },
      { x: -14, z: 520, rotation: 0.4 },
      { x: 12.5, z: 970, rotation: -0.8 },
    ];
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

  _buildExtraction() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    ctx.translate(256, 256);
    ctx.strokeStyle = 'rgba(191, 228, 122, 0.9)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(0, 0, 206, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 182, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(199, 235, 133, 0.9)';
    ctx.font = 'bold 250px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 0, -12);
    ctx.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
    ctx.letterSpacing = '14px';
    ctx.fillText('LZ DELTA', 0, 138);
    ctx.letterSpacing = '0px';
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const padMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.8,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      depthWrite: false,
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), padMaterial);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = -0.25;
    pad.position.set(this.extractionX, 0.055, this.extractionZ);
    pad.receiveShadow = true;
    pad.renderOrder = 2;
    this.root.add(pad);
    this.extractionPad = pad;

    // Corner marker lights and a pair of green smoke flares.
    for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x262b20, roughness: 0.7 })
      );
      post.position.set(this.extractionX + dx, 0.4, this.extractionZ + dz);
      this.root.add(post);
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xa8ff77, toneMapped: false })
      );
      light.position.set(this.extractionX + dx, 0.85, this.extractionZ + dz);
      this.root.add(light);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0x9aff6b,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.7,
          toneMapped: false,
        })
      );
      glow.position.set(this.extractionX + dx, 0.85, this.extractionZ + dz);
      glow.scale.set(1.5, 1.5, 1);
      this.root.add(glow);
      this.flareSprites.push({ sprite: glow, baseScale: 1.5, phase: rand(0, 6), flicker: true });
    }

    for (const side of [-1, 1]) {
      const srcX = this.extractionX + side * 6.7;
      const srcZ = this.extractionZ + 3.7;
      const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: 0x39412c, roughness: 0.8 })
      );
      flare.position.set(srcX, 0.35, srcZ);
      flare.rotation.z = side * 0.55;
      this.root.add(flare);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0x8cff5d,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.85,
          toneMapped: false,
        })
      );
      glow.position.set(srcX, 0.85, srcZ);
      glow.scale.set(3.6, 2.6, 1);
      this.root.add(glow);
      this.flareSprites.push({ sprite: glow, baseScale: 3.6, phase: rand(0, 6), flicker: true });
      this.smokeSources.push({ x: srcX, z: srcZ, large: false, rate: 0.16, timer: rand(0, 0.16), green: true });
    }

    // A few crates and sandbags immediately around the LZ.
    const crateGeometry = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    for (const [dx, dz, rotation] of [[-10, -4, 0.2], [-9.3, -2.7, 0.7], [10, 4, -0.4]]) {
      const crate = new THREE.Mesh(crateGeometry, this.materials.wood);
      crate.position.set(this.extractionX + dx, 0.58, this.extractionZ + dz);
      crate.rotation.y = rotation;
      crate.castShadow = true;
      this.root.add(crate);
    }
    const sandbagMaterial = new THREE.MeshStandardMaterial({
      map: getSandbagTextures().map,
      normalMap: getSandbagTextures().normalMap,
      roughness: 1,
      color: 0xc2b189,
    });
    for (let i = 0; i < 10; i++) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), sandbagMaterial);
      bag.scale.set(1.3, 0.42, 0.7);
      bag.position.set(this.extractionX - 8 + (i % 5) * 0.85, 0.24 + Math.floor(i / 5) * 0.34, this.extractionZ - 8.4);
      bag.rotation.y = 0.1;
      bag.castShadow = true;
      this.root.add(bag);
    }
    this.addCollider({
      x: this.extractionX - 6.3,
      z: this.extractionZ - 8.4,
      radius: 1.6,
      type: 'sandbags',
      blocksMovement: true,
      blocksBullets: false,
    });

    this.flareLight = new THREE.PointLight(0x9aff68, 5.5, 14, 2);
    this.flareLight.position.set(this.extractionX, 2, this.extractionZ + 2);
    this.root.add(this.flareLight);
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
      mesh.renderOrder = 3;
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
    return { x: rand(-8, 8), z: clamp(rand(minZ, maxZ), 0, this.levelLength - 10), spot: null };
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
  }

  getSmokeSources() {
    return this.smokeSources;
  }
}
