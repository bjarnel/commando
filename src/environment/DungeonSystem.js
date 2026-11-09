import * as THREE from 'three';
import { DUNGEON_THEMES, DUNGEON_MODIFIERS, makeDungeonBiome } from '../config/dungeons.js';
import { SETTINGS } from '../config/settings.js';
import { clamp, rand, chance } from '../utils/math.js';
import { getGlowTexture, getSmokeTexture, getWoodTexture, getMetalTexture } from '../utils/textures.js';

const ORIGIN_BASE = 60000;
const DOOR_WIDTH = 3.8;

const THEME_BY_ID = new Map(DUNGEON_THEMES.map((theme) => [theme.id, theme]));

/**
 * Surface entrances + randomized underground zones.
 *
 * The dungeon lives far outside the normal endless corridor. While active we
 * swap TerrainManager's query arrays for the dungeon's own walls, hide the
 * surface chapter layer, and restore everything on exit. That keeps the
 * existing movement, bullet, enemy and pickup systems unchanged.
 */
export class DungeonSystem {
  constructor(scene, terrain, particles, audio) {
    this.scene = scene;
    this.terrain = terrain;
    this.particles = particles;
    this.audio = audio;

    this.surfaceRoot = new THREE.Group();
    this.surfaceRoot.name = 'dungeon-entrances';
    scene.add(this.surfaceRoot);

    this.root = new THREE.Group();
    this.root.name = 'dungeon-active';
    this.root.visible = false;
    scene.add(this.root);

    this.entrances = [];
    this.active = null;
    this.instanceCounter = 0;
    this.time = 0;
    this.materials = new Set();
    this.geometries = new Set();
  }

  /* ------------------------------------------------------------------------
     Surface entrances
     ------------------------------------------------------------------------ */

  createEntrance({ x, z, themeId = null, modifierId = null }) {
    const theme =
      THEME_BY_ID.get(themeId) ||
      DUNGEON_THEMES[Math.floor(Math.random() * DUNGEON_THEMES.length)];
    const modifier =
      DUNGEON_MODIFIERS.find((entry) => entry.id === modifierId) ||
      DUNGEON_MODIFIERS[Math.floor(Math.random() * DUNGEON_MODIFIERS.length)];
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.name = `dungeon-entrance-${theme.id}`;

    const accent = new THREE.MeshBasicMaterial({
      color: theme.accent,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: theme.wall,
      roughness: 0.78,
      metalness: 0.28,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: theme.trim,
      roughness: 0.44,
      metalness: 0.65,
    });

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.07, 8, 32),
      accent
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);
    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.035, 6, 24),
      accent
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.14;
    group.add(innerRing);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: theme.accent,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    glow.position.y = 0.55;
    glow.scale.set(4.2, 4.2, 1);
    group.add(glow);

    // A theme-specific frame makes entrances read as hatches, cave mouths,
    // sewer grates or armoured vault doors from a distance.
    if (theme.kind === 'hatch') {
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 1.6), metal);
      lid.position.set(0, 0.06, -0.35);
      lid.rotation.y = 0.12;
      group.add(lid);
      for (const side of [-1, 1]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.6), dark);
        handle.position.set(side * 0.72, 0.16, 0.2);
        group.add(handle);
      }
    } else if (theme.kind === 'grate') {
      for (let i = -3; i <= 3; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.8), metal);
        bar.position.set(i * 0.27, 0.1, 0);
        group.add(bar);
      }
      const rim = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.22, 2.1), dark);
      rim.position.y = 0.02;
      group.add(rim);
    } else if (theme.kind === 'vault') {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 0.3), metal);
      door.position.set(0, 1.25, -0.5);
      group.add(door);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 8, 24), accent);
      wheel.position.set(0, 1.25, -0.33);
      group.add(wheel);
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.45), dark);
        jamb.position.set(side * 1.2, 1.3, -0.5);
        group.add(jamb);
      }
    } else if (theme.kind === 'door') {
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.6, 0.5), dark);
        jamb.position.set(side * 1.2, 1.3, -0.35);
        group.add(jamb);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.28, 0.5), metal);
      lintel.position.set(0, 2.55, -0.35);
      group.add(lintel);
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.3, 0.16), dark);
      door.position.set(0, 1.15, -0.5);
      door.rotation.y = 0.18;
      group.add(door);
    } else {
      // Rough cave mouth: a ring of stones around the glow.
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(rand(0.26, 0.5), 0),
          dark
        );
        rock.position.set(Math.cos(angle) * 1.4, rand(0.08, 0.35), Math.sin(angle) * 1.1 - 0.1);
        rock.rotation.set(rand(0, 1), rand(0, Math.PI), rand(0, 1));
        rock.scale.y = rand(0.5, 1.1);
        group.add(rock);
      }
    }

    const chevron = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.75, 4),
      accent
    );
    chevron.rotation.x = Math.PI;
    chevron.position.y = 2.8;
    group.add(chevron);

    const light = new THREE.PointLight(theme.accent, 5.2, 9, 2);
    light.position.set(0, 1.1, 0);
    group.add(light);

    this.surfaceRoot.add(group);
    const entrance = {
      group,
      theme,
      modifier,
      x,
      z,
      ring,
      innerRing,
      glow,
      chevron,
      light,
      age: rand(0, 10),
      used: false,
      materials: [accent, dark, metal],
      geometries: [
        ring.geometry,
        innerRing.geometry,
        chevron.geometry,
      ],
    };
    this.entrances.push(entrance);
    return entrance;
  }

  removeEntrance(entrance) {
    const index = this.entrances.indexOf(entrance);
    if (index >= 0) this.entrances.splice(index, 1);
    const geometries = new Set(entrance.geometries);
    const materials = new Set(entrance.materials);
    entrance.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((entry) => materials.add(entry));
        } else {
          materials.add(object.material);
        }
      }
    });
    entrance.group.removeFromParent();
    geometries.forEach((geometry) => geometry.dispose?.());
    materials.forEach((material) => material.dispose?.());
  }

  clearEntrances() {
    for (const entrance of [...this.entrances]) this.removeEntrance(entrance);
  }

  nearestEntrance(position, range = 3.1) {
    let best = null;
    let bestDistance = range;
    for (const entrance of this.entrances) {
      const distance = Math.hypot(position.x - entrance.x, position.z - entrance.z);
      if (distance < bestDistance) {
        best = entrance;
        bestDistance = distance;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------------
     Build / enter / leave
     ------------------------------------------------------------------------ */

  enter(entrance) {
    if (this.active) this.end();
    if (entrance.used) return null;
    const theme = entrance.theme;
    const modifier = entrance.modifier;
    const biome = makeDungeonBiome(theme, modifier);
    const originZ = ORIGIN_BASE + this.instanceCounter++ * 900;
    const instance = {
      entrance,
      theme,
      modifier,
      biome,
      originZ,
      group: new THREE.Group(),
      colliders: [],
      coverObjects: [],
      coverSpots: [],
      destructibles: [],
      barrels: [],
      smokeSources: [],
      barracks: [],
      rivers: [],
      fireLights: [],
      flareSprites: [],
      rooms: [],
      braziers: [],
      lights: [],
      materials: new Set(),
      geometries: new Set(),
      time: 0,
      smokeTimer: 0,
    };
    instance.group.name = `dungeon-${theme.id}-${this.instanceCounter}`;
    this.root.add(instance.group);
    this.root.visible = true;
    this.surfaceRoot.visible = false;

    this._saveTerrainState();
    this._buildLayout(instance);
    this.terrain.dungeonMode = true;
    this.terrain.dungeonBiome = biome;
    this.terrain.dungeonFogFactor = biome.dungeonFogFactor;
    this._installTerrainState(instance);
    this.terrain.root.visible = false;

    this.active = instance;
    return {
      originZ,
      entryZ: originZ + 2.2,
      exitZ: instance.exit.z,
      rooms: instance.rooms,
      theme,
      modifier,
      biome,
    };
  }

  _saveTerrainState() {
    const terrain = this.terrain;
    this.savedTerrain = {
      colliders: terrain.colliders,
      coverObjects: terrain.coverObjects,
      coverSpots: terrain.coverSpots,
      destructibles: terrain.destructibles,
      barrels: terrain.barrels,
      smokeSources: terrain.smokeSources,
      barracks: terrain.barracks,
      rivers: terrain.rivers,
      fireLights: terrain.fireLights,
      flareSprites: terrain.flareSprites,
      rootVisible: terrain.root.visible,
      dungeonMode: terrain.dungeonMode,
      dungeonBiome: terrain.dungeonBiome,
      dungeonFogFactor: terrain.dungeonFogFactor,
    };
  }

  _installTerrainState(instance) {
    const terrain = this.terrain;
    terrain.colliders = instance.colliders;
    terrain.coverObjects = instance.coverObjects;
    terrain.coverSpots = instance.coverSpots;
    terrain.destructibles = instance.destructibles;
    terrain.barrels = instance.barrels;
    terrain.smokeSources = instance.smokeSources;
    terrain.barracks = instance.barracks;
    terrain.rivers = instance.rivers;
    terrain.fireLights = instance.fireLights;
    terrain.flareSprites = instance.flareSprites;
  }

  _restoreTerrainState() {
    const terrain = this.terrain;
    const saved = this.savedTerrain;
    if (!saved) return;
    terrain.colliders = saved.colliders;
    terrain.coverObjects = saved.coverObjects;
    terrain.coverSpots = saved.coverSpots;
    terrain.destructibles = saved.destructibles;
    terrain.barrels = saved.barrels;
    terrain.smokeSources = saved.smokeSources;
    terrain.barracks = saved.barracks;
    terrain.rivers = saved.rivers;
    terrain.fireLights = saved.fireLights;
    terrain.flareSprites = saved.flareSprites;
    terrain.root.visible = saved.rootVisible;
    terrain.dungeonMode = saved.dungeonMode;
    terrain.dungeonBiome = saved.dungeonBiome;
    terrain.dungeonFogFactor = saved.dungeonFogFactor;
    this.savedTerrain = null;
  }

  end() {
    if (!this.active) return;
    const active = this.active;
    this.active = null;
    this.root.visible = false;
    this.surfaceRoot.visible = true;
    this._restoreTerrainState();
    const geometries = new Set(active.geometries);
    const materials = new Set(active.materials);
    active.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((entry) => materials.add(entry));
        } else {
          materials.add(object.material);
        }
      }
    });
    active.group.removeFromParent();
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    active.geometries.clear();
    active.materials.clear();
  }

  abort() {
    this.end();
  }

  _material(instance, color, options = {}) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.86,
      metalness: options.metalness ?? 0.06,
      ...options,
    });
    instance.materials.add(material);
    return material;
  }

  _geometry(instance, geometry) {
    instance.geometries.add(geometry);
    return geometry;
  }

  _addCollider(instance, x, z, radius, blocksBullets = true) {
    instance.colliders.push({
      x,
      z,
      radius,
      blocksMovement: true,
      blocksBullets,
      disabled: false,
    });
  }

  _addWallBox(instance, x, z, width, depth, height, material, block = true) {
    const mesh = new THREE.Mesh(
      this._geometry(instance, new THREE.BoxGeometry(width, height, depth)),
      material
    );
    mesh.position.set(x, height * 0.5, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    instance.group.add(mesh);

    if (!block) return mesh;
    const alongX = width > depth;
    const length = alongX ? width : depth;
    const spacing = 1.35;
    const count = Math.max(1, Math.ceil(length / spacing));
    const start = length * 0.5 - length / count * 0.5;
    for (let i = 0; i < count; i++) {
      const offset = -start + i * (length / count);
      this._addCollider(
        instance,
        x + (alongX ? offset : 0),
        z + (alongX ? 0 : offset),
        Math.min(width, depth) * 0.55 + 0.36
      );
    }
    return mesh;
  }

  _buildLayout(instance) {
    const { theme, modifier } = instance;
    const originZ = instance.originZ;
    const floorMaterial = this._material(instance, theme.floor, {
      roughness: 0.94,
      metalness: 0.04,
    });
    const wallMaterial = this._material(instance, theme.wall, {
      roughness: 0.88,
      metalness: 0.1,
    });
    const trimMaterial = this._material(instance, theme.trim, {
      roughness: 0.52,
      metalness: theme.id === 'vault' ? 0.64 : 0.24,
    });
    const accentMaterial = this._material(instance, theme.accent, {
      roughness: 0.35,
      metalness: 0.36,
      emissive: theme.accent,
      emissiveIntensity: 0.35,
    });
    const wood = this._material(instance, 0x71553a, {
      roughness: 0.92,
      metalness: 0.02,
      map: getWoodTexture(),
    });
    const metal = this._material(instance, theme.trim, {
      roughness: 0.4,
      metalness: 0.7,
      map: getMetalTexture(),
    });
    instance.materialKit = { floorMaterial, wallMaterial, trimMaterial, accentMaterial, wood, metal };

    const count =
      Math.floor(rand(theme.roomRange[0], theme.roomRange[1] + 1)) +
      (modifier.id === 'cursed' || modifier.id === 'elite' ? 1 : 0);
    let cursor = originZ;
    instance.rooms = [];

    for (let i = 0; i < count; i++) {
      const isEntrance = i === 0;
      const isExit = i === count - 1 && count > 1;
      const length = isEntrance ? 10 : isExit ? 12 : rand(10, 16);
      const halfWidth = isEntrance ? 6.4 : clamp(rand(6.2, 8.8), 6, 8.8);
      const room = {
        index: i,
        start: cursor,
        end: cursor + length,
        centerZ: cursor + length * 0.5,
        halfWidth,
        length,
        type: isEntrance ? 'entrance' : isExit ? 'exit' : this._pickRoomType(),
        spawned: false,
        cleared: false,
        lootSpawned: false,
        spawnPoints: [],
        chest: null,
      };
      instance.rooms.push(room);
      this._buildRoom(instance, room, {
        floorMaterial,
        wallMaterial,
        trimMaterial,
        accentMaterial,
        wood,
        metal,
        isEntrance,
        isExit,
      });
      cursor = room.end;
      if (!isExit) {
        const corridorLength = rand(5.5, 9.5);
        this._buildCorridor(instance, cursor, cursor + corridorLength, {
          floorMaterial,
          wallMaterial,
          trimMaterial,
        });
        cursor += corridorLength;
      }
    }

    // Entry and exit points.
    instance.entry = { x: 0, z: originZ + 2.2 };
    const final = instance.rooms[instance.rooms.length - 1];
    instance.exit = {
      x: 0,
      z: final.end - 3.2,
      mesh: this._buildPortal(instance, 0, final.end - 3.2, accentMaterial, theme.accent),
    };
    this._buildPortal(instance, 0, originZ + 1.1, accentMaterial, theme.accent, 0.7);
    instance.rooms.forEach((room) => {
      if (room.type === 'treasure') this._buildChest(instance, room, wood, trimMaterial);
    });
  }

  _pickRoomType() {
    const roll = Math.random();
    if (roll < 0.22) return 'treasure';
    if (roll < 0.34) return 'shrine';
    if (roll < 0.54) return 'ambush';
    return 'combat';
  }

  _buildRoom(instance, room, kit) {
    const { isEntrance, isExit } = kit;
    const center = room.centerZ;
    const half = room.halfWidth;
    const floor = new THREE.Mesh(
      this._geometry(instance, new THREE.BoxGeometry(half * 2, 0.18, room.length)),
      kit.floorMaterial
    );
    floor.position.set(0, -0.07, center);
    floor.receiveShadow = true;
    instance.group.add(floor);

    // Tile seams and occasional standing water give the floor more read at
    // the steep camera angle without relying on expensive extra meshes.
    const seamPositions = [];
    for (let z = room.start + 2; z < room.end; z += 2.6) {
      seamPositions.push(-half + 0.5, 0.035, z, half - 0.5, 0.035, z);
    }
    for (let x = -half + 2; x < half; x += 2.6) {
      seamPositions.push(x, 0.035, room.start + 0.5, x, 0.035, room.end - 0.5);
    }
    if (seamPositions.length) {
      const seamGeometry = this._geometry(
        instance,
        new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(seamPositions, 3)
        )
      );
      const seamMaterial = new THREE.LineBasicMaterial({
        color: instance.theme.trim,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        toneMapped: false,
      });
      instance.materials.add(seamMaterial);
      instance.group.add(new THREE.LineSegments(seamGeometry, seamMaterial));
    }
    if (chance(0.55)) {
      const puddleColor =
        instance.theme.id === 'sewer'
          ? 0x6fa84f
          : instance.theme.id === 'foundry'
            ? 0xb56b3d
            : instance.theme.accent;
      for (let i = 0; i < 2; i++) {
        const puddle = new THREE.Mesh(
          this._geometry(instance, new THREE.CircleGeometry(rand(0.8, 2.1), 20)),
          new THREE.MeshBasicMaterial({
            color: puddleColor,
            transparent: true,
            opacity: 0.09,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          })
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(
          rand(-half + 2, half - 2),
          0.04,
          rand(room.start + 2, room.end - 2)
        );
        instance.group.add(puddle);
      }
    }

    // Side walls.
    this._addWallBox(instance, -half, center, 0.7, room.length, 4.4, kit.wallMaterial);
    this._addWallBox(instance, half, center, 0.7, room.length, 4.4, kit.wallMaterial);
    this._addWallBox(instance, -half, center, 0.82, room.length, 0.32, kit.trimMaterial, false).position.y = 0.35;
    this._addWallBox(instance, half, center, 0.82, room.length, 0.32, kit.trimMaterial, false).position.y = 0.35;

    // Cross walls with a central door gap. Entrance keeps a solid rear wall.
    const addCrossWall = (z, solid = false) => {
      if (solid) {
        this._addWallBox(instance, 0, z, half * 2, 0.7, 4.4, kit.wallMaterial);
        return;
      }
      const sideWidth = half - DOOR_WIDTH * 0.5;
      for (const side of [-1, 1]) {
        this._addWallBox(
          instance,
          side * (DOOR_WIDTH * 0.5 + sideWidth * 0.5),
          z,
          sideWidth,
          0.7,
          4.4,
          kit.wallMaterial
        );
      }
      // Door pillars and lintel add silhouette without blocking the opening.
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(
          this._geometry(instance, new THREE.BoxGeometry(0.46, 4.1, 0.8)),
          kit.trimMaterial
        );
        pillar.position.set(side * (DOOR_WIDTH * 0.5 + 0.28), 2.05, z);
        instance.group.add(pillar);
      }
      const lintel = new THREE.Mesh(
        this._geometry(instance, new THREE.BoxGeometry(DOOR_WIDTH + 1.1, 0.36, 0.8)),
        kit.trimMaterial
      );
      lintel.position.set(0, 3.9, z);
      instance.group.add(lintel);
    };
    addCrossWall(room.start, isEntrance);
    addCrossWall(room.end, isExit);

    // Ceiling beams.
    for (let z = room.start + 3; z < room.end - 1; z += 4.5) {
      const beam = new THREE.Mesh(
        this._geometry(instance, new THREE.BoxGeometry(half * 2 + 0.2, 0.22, 0.24)),
        kit.trimMaterial
      );
      beam.position.set(0, 4.18, z);
      instance.group.add(beam);
    }

    // Pillars in the wider rooms.
    if (half > 7.2) {
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(
          this._geometry(instance, new THREE.CylinderGeometry(0.4, 0.48, 4.1, 8)),
          kit.wallMaterial
        );
        pillar.position.set(side * (half - 1.6), 2.05, center + rand(-1.8, 1.8));
        instance.group.add(pillar);
        this._addCollider(instance, pillar.position.x, pillar.position.z, 0.72, true);
      }
    }

    // Rubble, puddles/cracks and crates.
    for (let i = 0; i < 5; i++) {
      const side = chance(0.5) ? -1 : 1;
      const x = side * rand(1.4, half - 1.3);
      const z = rand(room.start + 1.3, room.end - 1.3);
      if (Math.random() < 0.5) {
        const crate = new THREE.Mesh(
          this._geometry(instance, new THREE.BoxGeometry(rand(0.6, 1.1), rand(0.5, 1), rand(0.6, 1.1))),
          kit.wood
        );
        crate.position.set(x, 0.3, z);
        crate.rotation.y = rand(0, Math.PI);
        instance.group.add(crate);
        this._addCollider(instance, x, z, 0.6, true);
      } else {
        const rubble = new THREE.Mesh(
          this._geometry(instance, new THREE.DodecahedronGeometry(rand(0.14, 0.42), 0)),
          kit.wallMaterial
        );
        rubble.position.set(x, 0.18, z);
        rubble.scale.y = rand(0.35, 0.9);
        instance.group.add(rubble);
      }
    }

    for (const side of [-1, 1]) {
      this._addBrazier(instance, side * (half - 0.85), room.start + 2.2, kit.accentMaterial);
      if (room.length > 11) {
        this._addBrazier(instance, side * (half - 0.85), room.end - 2.2, kit.accentMaterial);
      }
    }

    // Spawn points for the room's guard detail.
    const count = room.type === 'entrance' ? 0 : 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      room.spawnPoints.push({
        x: rand(-half + 1.6, half - 1.6),
        z: rand(room.start + 2.4, room.end - 2.4),
      });
    }
  }

  _buildCorridor(instance, startZ, endZ, kit) {
    const length = endZ - startZ;
    const center = (startZ + endZ) * 0.5;
    const floor = new THREE.Mesh(
      this._geometry(instance, new THREE.BoxGeometry(DOOR_WIDTH, 0.16, length)),
      kit.floorMaterial
    );
    floor.position.set(0, -0.06, center);
    instance.group.add(floor);
    this._addWallBox(instance, -DOOR_WIDTH * 0.5, center, 0.62, length, 4.2, kit.wallMaterial);
    this._addWallBox(instance, DOOR_WIDTH * 0.5, center, 0.62, length, 4.2, kit.wallMaterial);
    for (const side of [-1, 1]) {
      const conduit = new THREE.Mesh(
        this._geometry(instance, new THREE.CylinderGeometry(0.05, 0.05, length, 6)),
        kit.trimMaterial
      );
      conduit.rotation.x = Math.PI / 2;
      conduit.position.set(side * (DOOR_WIDTH * 0.5 - 0.24), 3.2, center);
      instance.group.add(conduit);
    }
  }

  _addBrazier(instance, x, z, material) {
    const bowl = new THREE.Mesh(
      this._geometry(instance, new THREE.CylinderGeometry(0.28, 0.4, 0.3, 8)),
      material
    );
    bowl.position.set(x, 1.1, z);
    instance.group.add(bowl);
    const stem = new THREE.Mesh(
      this._geometry(instance, new THREE.CylinderGeometry(0.08, 0.12, 1.1, 6)),
      instance.materialKit?.metal || material
    );
    stem.position.set(x, 0.55, z);
    instance.group.add(stem);
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: instance.biome.roadTint ? instance.theme.accent : 0xffa04d,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    flame.position.set(x, 1.5, z);
    flame.scale.set(1.35, 1.35, 1);
    instance.group.add(flame);
    const light = new THREE.PointLight(instance.theme.light, 7.5, 15, 2);
    light.position.set(x, 2.1, z);
    instance.group.add(light);
    instance.braziers.push({ x, z, flame, light, phase: rand(0, 10), base: 7.5 });
    instance.lights.push(light);
  }

  _buildChest(instance, room, wood, trim) {
    const side = chance(0.5) ? -1 : 1;
    const x = side * Math.max(2.2, room.halfWidth - 2.2);
    const z = room.centerZ;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const base = new THREE.Mesh(
      this._geometry(instance, new THREE.BoxGeometry(1.15, 0.68, 0.8)),
      wood
    );
    base.position.y = 0.34;
    group.add(base);
    const lid = new THREE.Mesh(
      this._geometry(instance, new THREE.BoxGeometry(1.2, 0.2, 0.86)),
      trim
    );
    lid.position.y = 0.76;
    group.add(lid);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: instance.theme.accent,
        transparent: true,
        opacity: 0.44,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    glow.position.y = 1.0;
    glow.scale.set(2.2, 2.2, 1);
    group.add(glow);
    instance.group.add(group);
    room.chest = { group, x, z, glow };
    this._addCollider(instance, x, z, 0.62, true);
  }

  _buildPortal(instance, x, z, material, color, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const ring = new THREE.Mesh(
      this._geometry(instance, new THREE.TorusGeometry(1.4 * scale, 0.09, 8, 32)),
      material
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(ring);
    const inner = new THREE.Mesh(
      this._geometry(instance, new THREE.CircleGeometry(1.25 * scale, 32)),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.13;
    group.add(inner);
    const beam = new THREE.Mesh(
      this._geometry(instance, new THREE.CylinderGeometry(0.9 * scale, 1.35 * scale, 4.2, 16, 1, true)),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    beam.position.y = 2.1;
    group.add(beam);
    const light = new THREE.PointLight(color, 6, 10, 2);
    light.position.y = 1.6;
    group.add(light);
    instance.group.add(group);
    return { group, ring, inner, beam, light };
  }

  /* ------------------------------------------------------------------------
     Frame update
     ------------------------------------------------------------------------ */

  update(dt) {
    this.time += dt;
    for (const entrance of this.entrances) {
      entrance.age += dt;
      const pulse = 0.5 + Math.sin(entrance.age * 2.1) * 0.5;
      entrance.ring.rotation.z += dt * 0.4;
      entrance.innerRing.rotation.z -= dt * 0.65;
      entrance.chevron.position.y = 2.65 + Math.sin(entrance.age * 2.6) * 0.15;
      entrance.glow.material.opacity = 0.28 + pulse * 0.22;
      entrance.light.intensity = 4.4 + pulse * 1.4;
    }

    const active = this.active;
    if (!active) return;
    active.time += dt;
    for (const brazier of active.braziers) {
      const flicker =
        1 +
        Math.sin(active.time * 11.7 + brazier.phase) * 0.16 +
        Math.sin(active.time * 23.1 + brazier.phase * 2) * 0.08;
      brazier.light.intensity = brazier.base * flicker;
      brazier.flame.material.opacity = 0.58 + 0.22 * flicker;
      const scale = 1.18 + 0.18 * flicker;
      brazier.flame.scale.set(scale, scale, 1);
    }
    if (active.exit?.mesh) {
      active.exit.mesh.ring.rotation.z += dt * 0.7;
      active.exit.mesh.inner.material.opacity = 0.14 + Math.sin(active.time * 2.8) * 0.06;
      active.exit.mesh.light.intensity = 5 + Math.sin(active.time * 3.1) * 1.2;
    }
    for (const room of active.rooms) {
      if (!room.chest) continue;
      room.chest.glow.material.opacity = 0.32 + Math.sin(active.time * 2.3 + room.index) * 0.14;
    }

    active.smokeTimer -= dt;
    if (active.smokeTimer <= 0) {
      active.smokeTimer = rand(0.3, 0.75);
      const brazier = active.braziers[Math.floor(Math.random() * active.braziers.length)];
      if (brazier) {
        this.particles.spawnSmokeColumn(
          new THREE.Vector3(brazier.x, 1.5, brazier.z),
          false,
          false
        );
      }
      const room = active.rooms[Math.floor(Math.random() * active.rooms.length)];
      if (room && Math.random() < 0.7) {
        this.particles.spawnMote(
          new THREE.Vector3(
            rand(-room.halfWidth + 1, room.halfWidth - 1),
            rand(0.4, 3.4),
            rand(room.start + 1, room.end - 1)
          )
        );
      }
    }
  }
}
