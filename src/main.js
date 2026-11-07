import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { InputManager } from './core/InputManager.js';
import { AudioManager } from './core/AudioManager.js';
import { AssetLoader } from './core/AssetLoader.js';
import { Player } from './entities/Player.js';
import {
  Officer,
  OfficerTruck,
  MortarTeam,
  Rifleman,
  HeavyGunner,
  Sapper,
  Fanatic,
  Sniper,
  Hunter,
} from './entities/Enemy.js';
import { BulletSystem } from './entities/Bullet.js';
import { GrenadeSystem } from './entities/Grenade.js';
import { Civilian } from './entities/Civilian.js';
import { TerrainManager } from './environment/TerrainManager.js';
import { DynamicLighting } from './environment/DynamicLighting.js';
import { ParticleSystem } from './fx/ParticleSystem.js';
import { ScreenEffects } from './fx/ScreenEffects.js';
import { WeatherSystem } from './fx/WeatherSystem.js';
import { UIManager } from './ui/UIManager.js';
import { SETTINGS, GAME_STATE } from './config/settings.js';
import { ASSET_MANIFEST, LOADING_COPY } from './config/assets.js';
import {
  WEAPONS,
  WEAPON_BY_ID,
  WEAPON_CATEGORIES,
  STARTING_LOADOUT,
} from './config/weapons.js';
import { getWeaponVisual } from './entities/WeaponModels.js';
import { clamp, clamp01, damp, lerp, rand, chance } from './utils/math.js';
import { getGlowTexture, getWeaponPickupLabelTexture } from './utils/textures.js';

const RUN_ANNOUNCEMENTS = [
  { z: 190, kicker: 'CONTACT', text: 'ENEMY MORTARS IN THE TREELINE', tone: 'danger' },
];

const WEAPON_PICKUP_STYLES = {
  light: { color: 0xffe96e },
  assault: { color: 0x74e0e0 },
  heavy: { color: 0xc47bff },
};

function safeStorageGet(key, fallback = null) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
}

class Game {
  constructor({ engine, input, audio, assets, ui, terrain, lighting, particles, effects, weather }) {
    this.engine = engine;
    this.scene = engine.scene;
    this.input = input;
    this.audio = audio;
    this.assets = assets;
    this.ui = ui;
    this.terrain = terrain;
    this.lighting = lighting;
    this.particles = particles;
    this.effects = effects;
    this.weather = weather;

    this.state = GAME_STATE.MENU;
    this.visualTime = 0;
    this.scroll = 0;
    this.combatBounds = { bottom: -1.9, top: 25.5, despawnBottom: -3.3 };
    this.battleTempo = SETTINGS.difficulty.idleTempo;
    this.playerMoveRatio = 0;
    this.runSpeedMultiplier = 1;
    this._threatTimer = 0;
    this._coverTimer = 0;
    this.aimWorld = new THREE.Vector3(0, 0, 12);
    this.aimAssistTarget = null;
    this._screenPoint = { x: 0, y: 0 };
    this._projectionPoint = new THREE.Vector3();
    this.enemies = [];
    this.civilians = [];
    this.pickups = [];
    this.boss = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.lives = SETTINGS.player.lives;
    this.best = Number(safeStorageGet(SETTINGS.storageKeys.best, '0')) || 0;
    this.bestDistance =
      Number(safeStorageGet(SETTINGS.storageKeys.bestDistance, '0')) || 0;
    this.crtEnabled = safeStorageGet(SETTINGS.storageKeys.crt, '1') !== '0';
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.warAmbienceTimer = rand(5, 12);
    this.menuParticleTimer = 0;
    this.moteTimer = 0;
    this.lastGamepadState = false;
    this.stats = this._createStats();
    this.pickupSchedule = [];
    this.nextScheduledPickup = 0;
    this.threatTier = 1;
    this.announced = new Set();
    this.currentBiomeId = null;
    this.fogColorTarget = new THREE.Color();
    this.backgroundTarget = new THREE.Color();

    this._init(this);
  }

  _init(game) {
    this.player = new Player(game);
    this.bullets = new BulletSystem(this.scene, {
      terrain: this.terrain,
      particles: this.particles,
      audio: this.audio,
    });
    this.weaponPickupTimer = 0;
    this.grenades = new GrenadeSystem(this.scene, {
      particles: this.particles,
      audio: this.audio,
    });

    this._initPickupAssets();
    this._initReticle();
    this._bindEvents();
    this._bindMenuAudio();
    this._updateParticlesViewport();
    this.resetRun();
    this.player.rig.root.visible = true;
    this.state = GAME_STATE.MENU;
    this.engine.setCrtEnabled(this.crtEnabled);
    this.ui.setCrtEnabled(this.crtEnabled);

    this.engine.onResize = () => this._updateParticlesViewport();
  }

  _createStats() {
    return {
      score: 0,
      kills: 0,
      deaths: 0,
      civilianKills: 0,
      shots: 0,
      hits: 0,
      grenadesThrown: 0,
      damageTaken: 0,
      maxCombo: 0,
      time: 0,
      distance: 0,
      accuracy: 0,
      best: 0,
      bestDistance: 0,
    };
  }

  _bindEvents() {
    this.input.callbacks.onGamepadChange = (active, id) => {
      this.lastGamepadState = active;
      this.ui.setPadStatus(active, id);
    };
    this.input.callbacks.onGamepadChange(
      this.input.getGamepadActive(),
      this.input.pad.id
    );

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === GAME_STATE.PLAYING) this.pauseGame();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
  }

  _initPickupAssets() {
    const box = new THREE.BoxGeometry(0.62, 0.34, 0.46);
    const band = new THREE.BoxGeometry(0.64, 0.08, 0.48);
    const crossA = new THREE.BoxGeometry(0.34, 0.09, 0.1);
    const crossB = new THREE.BoxGeometry(0.1, 0.09, 0.34);
    const grenadeGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const beamGeometry = new THREE.CylinderGeometry(0.07, 0.3, 2.4, 8, 1, true);
    this.pickupAssets = {
      box,
      band,
      crossA,
      crossB,
      grenadeGeo,
      beamGeometry,
      beamHealthMaterial: new THREE.MeshBasicMaterial({
        color: 0x9dff7b,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      beamGrenadeMaterial: new THREE.MeshBasicMaterial({
        color: 0xffd17d,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      iconGeometry: new THREE.OctahedronGeometry(0.2, 0),
      iconHealthMaterial: new THREE.MeshBasicMaterial({
        color: 0xb9ff9f,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      iconGrenadeMaterial: new THREE.MeshBasicMaterial({
        color: 0xffda91,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      crateMaterial: new THREE.MeshStandardMaterial({
        color: 0x4b4b2f,
        roughness: 0.72,
        metalness: 0.18,
      }),
      bandMaterial: new THREE.MeshStandardMaterial({
        color: 0x262a20,
        roughness: 0.8,
        metalness: 0.1,
      }),
      healthMaterial: new THREE.MeshStandardMaterial({
        color: 0xd7f6bb,
        emissive: 0x2f6a2b,
        emissiveIntensity: 0.5,
        roughness: 0.5,
      }),
      grenadeMaterial: new THREE.MeshStandardMaterial({
        color: 0xd9b063,
        emissive: 0x5f3c0c,
        emissiveIntensity: 0.35,
        roughness: 0.5,
        metalness: 0.4,
      }),
      healthGlow: new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xa8ff8c,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      grenadeGlow: new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xffd17d,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      healthRing: new THREE.MeshBasicMaterial({
        color: 0x9dff7b,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      grenadeRing: new THREE.MeshBasicMaterial({
        color: 0xffbe6b,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      weaponBeamMaterial: new THREE.MeshBasicMaterial({
        color: 0x9fe4ff,
        transparent: true,
        opacity: 0.23,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      weaponGlow: new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xb6ecff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      weaponRing: new THREE.MeshBasicMaterial({
        color: 0x9fe4ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      armorBeamMaterial: new THREE.MeshBasicMaterial({
        color: 0x9fb8ff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      armorGlow: new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xc4d4ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      armorRing: new THREE.MeshBasicMaterial({
        color: 0x9fb8ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      armorIconMaterial: new THREE.MeshBasicMaterial({
        color: 0xcfe0ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      calibrationBeamMaterial: new THREE.MeshBasicMaterial({
        color: 0xffb066,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      calibrationGlow: new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xffc47b,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      calibrationRing: new THREE.MeshBasicMaterial({
        color: 0xffb066,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      calibrationIconMaterial: new THREE.MeshBasicMaterial({
        color: 0xffd6a1,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      ringGeometry: new THREE.RingGeometry(0.42, 0.5, 24),
    };

    this.pickupAssets.weaponStyles = {};
    for (const [category, style] of Object.entries(WEAPON_PICKUP_STYLES)) {
      this.pickupAssets.weaponStyles[category] = {
        color: style.color,
        beam: new THREE.MeshBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
        ring: new THREE.MeshBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
        glow: new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: style.color,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          fog: false,
        }),
        band: new THREE.MeshBasicMaterial({
          color: style.color,
          toneMapped: false,
        }),
      };
    }
    this.weaponLabelMaterials = new Map();
  }

  _getWeaponLabelMaterial(weapon) {
    if (this.weaponLabelMaterials.has(weapon.id)) {
      return this.weaponLabelMaterials.get(weapon.id);
    }
    const material = new THREE.SpriteMaterial({
      map: getWeaponPickupLabelTexture(weapon),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false,
    });
    this.weaponLabelMaterials.set(weapon.id, material);
    return material;
  }

  _initReticle() {
    this.reticle = new THREE.Group();
    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe96e,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.reticleInnerMaterial = this.reticleMaterial.clone();
    this.reticleInnerMaterial.color.setHex(0x74e0e0);
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.675, 36), this.reticleMaterial);
    outer.rotation.x = -Math.PI / 2;
    this.reticle.add(outer);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.23, 24), this.reticleInnerMaterial);
    inner.rotation.x = -Math.PI / 2;
    this.reticle.add(inner);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), this.reticleInnerMaterial);
    dot.rotation.x = -Math.PI / 2;
    this.reticle.add(dot);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.28), this.reticleMaterial);
      tick.rotation.x = -Math.PI / 2;
      const angle = (i / 4) * Math.PI * 2;
      tick.position.set(Math.sin(angle) * 0.86, 0.002, Math.cos(angle) * 0.86);
      tick.rotation.z = -angle;
      this.reticle.add(tick);
    }
    this.reticle.position.y = 0.075;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.reticleTime = 0;
  }

  _updateParticlesViewport() {
    const height = this.engine.renderer.domElement.height || window.innerHeight;
    this.particles.setViewportHeight(height);
  }

  resetRun() {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    for (const civilian of this.civilians) civilian.dispose();
    this.civilians.length = 0;
    this.nextCivilianZ = rand(80, 150);
    this.civilianWarningShown = false;
    this.bullets.clear();
    this.grenades.clear();
    this._clearPickups();
    this.particles.clear();
    this.terrain.startRun();
    this.effects.reset();
    this.player.reset(SETTINGS.mission.startZ, 0);
    this.player.resetLoadout();
    this.player.rig.root.visible = true;

    this.scroll = 0;
    this.engine.scroll = 0;
    this.combatBounds.bottom = this.scroll - 1.9;
    this.combatBounds.top = this.scroll + 25.5;
    this.combatBounds.despawnBottom = this.scroll - 3.3;
    this.battleTempo = SETTINGS.difficulty.idleTempo;
    this.playerMoveRatio = 0;
    this.runSpeedMultiplier = 1;
    this._threatTimer = 0;
    this._coverTimer = 0;
    this.aimWorld.set(0, 0, 12);
    this.aimAssistTarget = null;
    this.currentBiomeId = null;
    this.weather?.reset();
    this.lives = SETTINGS.player.lives;
    this.combo = 0;
    this.comboTimer = 0;
    this.stats = this._createStats();
    this.stats.best = this.best;
    this.stats.bestDistance = this.bestDistance;
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.boss = null;
    this.threatTier = this._threatTier();
    this.lastThreatTier = this.threatTier;
    this.announced = new Set();
    this.director = {
      regular: 1.4,
      mortar: 9,
      officer: 18,
      nextTruck: SETTINGS.difficulty.truckFirstDistance,
    };
    this.warAmbienceTimer = rand(7, 14);
    this._lastTruckDeployToast = -999;
    this.moteTimer = 0;
    this.reticleTime = 0;
    this.reticle.visible = false;
    this.input.clear();

    this.ui.setScore(0);
    this.ui.setKills(0);
    this.ui.setLives(this.lives);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setBestScore(this.best);
    this.ui.setBestDistance(this.bestDistance);
    this.ui.setRunStatus(
      this.player.position.z,
      this.bestDistance,
      this.threatTier,
      0,
      this.terrain.getBiome(this.player.position.z).phase
    );
    this.ui.setObjective('RUN AS DEEP AS YOU CAN');
    this.ui.hideBoss();
    this.ui.hideCombo();
    this.ui.hideBanner();
    this.ui.setLowHealth(false);
    this.ui.clearCombatIndicators();
    this.effects.setLowHealth(false);
    this.refreshWeaponUI();
    this._scheduleRunPickups();
    this._ensureScheduledPickups();
    this._refreshProgressionUI();
    this._updateEnvironment(0.016, true);
  }

  _threatTier() {
    const distance = Math.max(0, this.player.position.z);
    const grace = SETTINGS.endless.threatGraceDistance;
    const tierDistance = SETTINGS.endless.threatTierDistance;
    return Math.min(
      SETTINGS.endless.maxThreatTier,
      1 + Math.floor(Math.max(0, distance - grace) / tierDistance)
    );
  }

  _threatTierProgress() {
    const distance = Math.max(0, this.player.position.z);
    const grace = SETTINGS.endless.threatGraceDistance;
    const tierDistance = SETTINGS.endless.threatTierDistance;
    if (distance <= grace) return 0;
    return clamp01(((distance - grace) % tierDistance) / tierDistance);
  }

  _runSpeedMultiplier() {
    const distance = Math.max(0, this.player.position.z);
    return (
      1 +
      Math.min(
        SETTINGS.endless.speedRampMax,
        distance * SETTINGS.endless.speedRampPerMeter
      )
    );
  }

  _scheduleRunPickups() {
    const progression = SETTINGS.progression;
    this.pickupSchedule = [];
    const weaponIds = WEAPONS.filter(
      (weapon) => !Object.values(STARTING_LOADOUT).includes(weapon.id)
    ).map((weapon) => weapon.id);
    for (let i = weaponIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weaponIds[i], weaponIds[j]] = [weaponIds[j], weaponIds[i]];
    }
    weaponIds.forEach((weaponId, index) => {
      this.pickupSchedule.push({
        type: 'weapon',
        z:
          progression.weaponCacheStart +
          index * progression.weaponCacheStep +
          rand(-28, 28),
        side: index % 2 ? 1 : -1,
        extra: { weaponId, persistent: true },
      });
    });
    progression.armorSchedule.forEach((z, index) => {
      this.pickupSchedule.push({
        type: 'armor',
        z: z + rand(-30, 30),
        side: index % 2 ? 1 : -1,
        extra: { persistent: true },
      });
    });
    progression.calibrationSchedule.forEach((z, index) => {
      this.pickupSchedule.push({
        type: 'calibration',
        z: z + rand(-30, 30),
        side: index % 2 ? -1 : 1,
        extra: { persistent: true },
      });
    });
    this.pickupSchedule.sort((a, b) => a.z - b.z);
    this.nextScheduledPickup = 0;
    this.pickupScheduleEnd =
      this.pickupSchedule[this.pickupSchedule.length - 1]?.z || 0;
    this.pickupPatternIndex = 0;
    this._extendPickupSchedule(3200);
  }

  _extendPickupSchedule(untilZ) {
    let z = Math.max(this.pickupScheduleEnd + 360, 1800);
    while (z < untilZ) {
      const armor = this.pickupPatternIndex % 2 === 0;
      this.pickupSchedule.push({
        type: armor ? 'armor' : 'calibration',
        z,
        side: this.pickupPatternIndex % 2 ? 1 : -1,
        extra: { persistent: true },
      });
      this.pickupPatternIndex++;
      z += 420;
    }
    this.pickupScheduleEnd = Math.max(
      this.pickupScheduleEnd,
      this.pickupSchedule[this.pickupSchedule.length - 1]?.z || 0
    );
  }

  _ensureScheduledPickups() {
    const playerZ = this.player.position.z;
    const ahead = playerZ + 240;
    if (this.pickupScheduleEnd < ahead + 1200) {
      this._extendPickupSchedule(ahead + 2200);
    }
    while (this.nextScheduledPickup < this.pickupSchedule.length) {
      const entry = this.pickupSchedule[this.nextScheduledPickup];
      if (entry.z > ahead) break;
      this.nextScheduledPickup++;
      if (entry.z < playerZ - 26) continue;
      const offset = entry.type === 'weapon' ? 5.4 : 4.2;
      const point = this.terrain.findSpawnNear(
        this.terrain.getRoadX(entry.z) + entry.side * offset,
        entry.z,
        1.1
      );
      this._spawnPickup(entry.type, point.x, point.z, entry.extra);
    }
  }

  _ensureCivilians() {
    const playerZ = this.player.position.z;
    if (playerZ + 170 < this.nextCivilianZ) return;
    const groupZ = Math.max(this.scroll + 20, this.nextCivilianZ + rand(-16, 16));
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const point = this.terrain.findSpawnNear(
        this.terrain.getRoadX(groupZ) + side * rand(5, 14),
        groupZ + rand(-7, 7),
        0.6
      );
      const roll = Math.random();
      const variant = roll < 0.42 ? 'woman' : roll < 0.8 ? 'child' : 'man';
      this.civilians.push(
        new Civilian(this, { x: point.x, z: point.z, variant })
      );
    }
    this.nextCivilianZ += rand(150, 280);
    if (!this.civilianWarningShown) {
      this.civilianWarningShown = true;
      this.ui.toast('CIVILIANS IN THE AREA — WATCH YOUR FIRE', 'danger');
    }
  }

  _updateCivilians(dt) {
    for (const civilian of this.civilians) {
      if (!civilian.removeFlag) civilian.update(dt);
    }
    for (let i = this.civilians.length - 1; i >= 0; i--) {
      if (this.civilians[i].removeFlag) {
        this.civilians[i].dispose();
        this.civilians.splice(i, 1);
      }
    }
  }

  _onCivilianHit(civilian, hitPosition) {
    const direction = hitPosition
      ? new THREE.Vector3(
          hitPosition.x - this.player.position.x,
          0,
          hitPosition.z - this.player.position.z
        )
      : new THREE.Vector3(0, 0, 1);
    if (direction.lengthSq() > 0.001) direction.normalize();
    if (this._killCivilian(civilian, hitPosition, direction)) {
      this._civilianPenalty(1);
    }
  }

  _killCivilian(civilian, hitPosition = null, direction = null) {
    if (!civilian.kill()) return false;
    const position =
      hitPosition ||
      new THREE.Vector3(civilian.position.x, 1.05, civilian.position.z);
    this.particles.spawnBlood(
      position,
      direction || new THREE.Vector3(0, 0, 1),
      1.3
    );
    return true;
  }

  _civilianPenalty(count = 1) {
    if (count <= 0) return;
    this.stats.civilianKills += count;
    const lost = Math.min(this.lives, count);
    this.lives = Math.max(0, this.lives - count);
    this.stats.score = Math.max(0, this.stats.score - 400 * count);
    this.ui.setLives(this.lives);
    this.ui.setScore(this.stats.score);
    this.ui.setBestScore(Math.max(this.best, this.stats.score));
    this.combo = 0;
    this.comboTimer = 0;
    this.ui.hideCombo();
    this.effects.flashDamage(0.55);
    this.audio.playCivilianPenalty(count);
    if (lost > 0) {
      this.ui.announce(
        'CIVILIAN CASUALTY',
        count > 1
          ? `${count} CIVILIANS DOWN — ${lost} REINFORCEMENT${lost === 1 ? '' : 'S'} LOST`
          : 'REINFORCEMENT REVOKED — ONE LIFE LOST',
        3.2,
        'danger'
      );
      this.ui.toast(
        count > 1
          ? `${count} CIVILIANS DOWN — ${lost} LIVES LOST`
          : 'CIVILIAN DOWN — 1 LIFE LOST',
        'danger'
      );
    } else {
      this.ui.announce(
        'CIVILIAN CASUALTY',
        'NO REINFORCEMENTS LEFT — DISHONOR RECORDED',
        3.2,
        'danger'
      );
      this.ui.toast('CIVILIAN DOWN — NO REINFORCEMENTS LEFT', 'danger');
    }
  }

  _damageCiviliansInBlast(position, radius, damage, playerCaused = false) {
    if (!playerCaused) return 0;
    let killed = 0;
    for (const civilian of this.civilians) {
      if (!civilian.alive) continue;
      const dx = civilian.position.x - position.x;
      const dz = civilian.position.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const direction = new THREE.Vector3(dx, 0, dz);
      if (direction.lengthSq() > 0.001) direction.normalize();
      if (this._killCivilian(civilian, null, direction)) killed++;
    }
    if (killed > 0) this._civilianPenalty(killed);
    return killed;
  }

  refreshWeaponUI() {
    this.ui.setWeapons(this.player.inventory, this.player.weaponSlot);
  }

  _refreshProgressionUI() {
    this.ui.setArmor(this.player.armorDamageReduction);
    this.ui.setCalibration(this.player.weaponDamageMultiplier);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
  }

  showMenu() {
    this.state = GAME_STATE.MENU;
    this.input.clear();
    this.audio.setDucked(false);
    this.audio.setIntensity(0.36);
    this._startMenuMusic();
    this.aimWorld.set(0, 0, 12);
    this.reticle.visible = false;
    this.ui.showStartScreen(this.best);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setLives(this.lives);
    this.ui.setScore(0);
    this.player.rig.root.visible = true;
  }

  _startMenuMusic() {
    if (!this.audio.ready || this.audio.muted) return;
    this.audio.startMusic('menu');
    this.audio.setDucked(false);
    this.audio.setIntensity(0.36);
  }

  _startCombatMusic() {
    if (!this.audio.ready) return;
    this.audio.startMusic('combat');
    this.audio.setDucked(this.state === GAME_STATE.PAUSED);
    this.audio.setIntensity(0.55);
  }

  _bindMenuAudio() {
    const unlock = () => {
      if (this.audio.muted) return;
      const inMenu =
        this.state === GAME_STATE.MENU || this.state === GAME_STATE.ENDED;
      if (!inMenu) return;
      if (this.audio.ready) {
        if (!this.audio.musicPlaying) this._startMenuMusic();
        return;
      }
      this.audio.init().then((ok) => {
        if (!ok) return;
        if (
          this.state === GAME_STATE.MENU ||
          this.state === GAME_STATE.ENDED
        ) {
          this._startMenuMusic();
        }
      });
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
  }

  beginMission() {
    this.resetRun();
    this.state = GAME_STATE.PLAYING;
    this.ui.beginRun();
    this.ui.setBestScore(this.best);
    this.ui.setBestDistance(this.bestDistance);
    this.ui.announce('ENDLESS ADVANCE', 'PUSH AS DEEP AS YOU CAN', 3.1);
    this.ui.toast('MACHINE GUN READY', 'health');
    this.input.clear();
    this.effects.reset();
    this.audio.init().then((ok) => {
      if (!ok) return;
      this.audio.setMuted(this.audio.muted);
      this.audio.setVolume(this.audio.masterVolume);
      if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.PAUSED) {
        this._startCombatMusic();
      }
    });
  }

  pauseGame() {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.state = GAME_STATE.PAUSED;
    this.input.clear();
    this.ui.showPause();
    this.audio.setDucked(true);
    this.reticle.visible = false;
    this.ui.setCrosshairVisible(false);
  }

  resumeGame() {
    if (this.state !== GAME_STATE.PAUSED) return;
    this.state = GAME_STATE.PLAYING;
    this.input.clear();
    this.ui.hidePause();
    this.audio.setDucked(false);
  }

  abandonToMenu() {
    this.state = GAME_STATE.MENU;
    this.audio.setDucked(false);
    this.best = Math.max(this.best, this.stats.score);
    this.bestDistance = Math.max(this.bestDistance, this.stats.distance);
    safeStorageSet(SETTINGS.storageKeys.best, String(this.best));
    safeStorageSet(
      SETTINGS.storageKeys.bestDistance,
      String(Math.round(this.bestDistance))
    );
    this.resetRun();
    this.showMenu();
  }

  toggleSound() {
    const muted = this.audio.setMuted(!this.audio.muted);
    this.ui.setAudioMuted(muted);
    if (!muted) {
      this.audio.init().then((ok) => {
        if (!ok) return;
        if (this.state === GAME_STATE.MENU || this.state === GAME_STATE.ENDED) {
          this._startMenuMusic();
        } else if (
          this.state === GAME_STATE.PLAYING ||
          this.state === GAME_STATE.PAUSED
        ) {
          this._startCombatMusic();
        }
      });
    }
  }

  setVolume(value) {
    this.audio.setVolume(value);
    this.ui.setVolumeUI(value);
  }

  toggleCrtFilter() {
    this.crtEnabled = !this.crtEnabled;
    this.engine.setCrtEnabled(this.crtEnabled);
    this.ui.setCrtEnabled(this.crtEnabled);
    safeStorageSet(SETTINGS.storageKeys.crt, this.crtEnabled ? '1' : '0');
    this.ui.toast(
      `CRT FILTER ${this.crtEnabled ? 'ON' : 'OFF'}`,
      this.crtEnabled ? 'health' : 'muted'
    );
  }

  startLoop() {
    this.lastFrameTime = performance.now();
    this.running = true;
    requestAnimationFrame(this._loop);
  }

  _loop = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0), 0.05);
    this.lastFrameTime = now;
    this.visualTime += dt;

    this.input.update();
    this._handleGlobalInput();

    if (this.state === GAME_STATE.PLAYING) {
      this._updatePlaying(dt);
    } else if (this.state === GAME_STATE.MENU) {
      this._updateMenu(dt);
    } else if (this.state === GAME_STATE.ENDED) {
      this._updateEnded(dt);
    } else {
      // Paused: freeze the simulation but keep rendering the frozen frame.
      this.audio.update(dt);
      this.ui.update(dt);
    }

    this.engine.render();
  };

  _handleGlobalInput() {
    if (this.input.consume('mute')) this.toggleSound();
    if (this.input.consume('crt')) {
      this.audio.playUiClick();
      this.toggleCrtFilter();
    }

    if (this.input.consume('pause')) {
      if (this.state === GAME_STATE.PLAYING) this.pauseGame();
      else if (this.state === GAME_STATE.PAUSED) this.resumeGame();
    }

    if (this.input.consume('confirm')) {
      if (this.state === GAME_STATE.MENU) this.beginMission();
      else if (this.state === GAME_STATE.PAUSED) this.resumeGame();
      else if (this.state === GAME_STATE.ENDED) this.beginMission();
    }
  }

  /* ------------------------------------------------------------------------
     Mission update
     ------------------------------------------------------------------------ */

  _updatePlaying(dt) {
    this.stats.time += dt;

    this._updateAimWorld();

    const weaponSlot = this.input.consume('weaponSlot');
    if (weaponSlot) this.player.switchWeapon(weaponSlot);

    const grenadePressed = this.input.consume('grenade');
    const grenadeHeld =
      this.input.isAltFiring() &&
      this.player.grenades > 0 &&
      this.player.grenadeCooldown <= 0;
    if (grenadePressed || grenadeHeld) {
      this.player.throwGrenade(this.aimWorld);
    }
    if (this.input.consume('melee')) {
      this.player.meleeShove();
    }

    this.runSpeedMultiplier = this._runSpeedMultiplier();
    this.player.update(dt);
    this.terrain.updateStreaming(this.player.position.z);
    this._ensureCivilians();
    this._updateBattleTempo(dt);
    this.ui.setBraced(this.player.braced);
    this._updateCoverStatus(dt);

    if (this.player.alive) {
      const forward = this.player.position.z - this.scroll;
      if (forward > SETTINGS.camera.followThreshold) {
        this.scroll = Math.min(
          SETTINGS.scroll.max,
          this.player.position.z - SETTINGS.camera.followThreshold
        );
      }
      this.player.position.z = clamp(
        this.player.position.z,
        this.scroll - SETTINGS.camera.backwardLimit,
        Number.POSITIVE_INFINITY
      );
    }

    // Enemies. Iterate the current length so enemies spawned this frame update
    // on the next tick, avoiding order-of-operations surprises.
    const enemyCount = this.enemies.length;
    for (let i = 0; i < enemyCount; i++) {
      const enemy = this.enemies[i];
      if (enemy && !enemy.removeFlag) enemy.update(dt, this);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removeFlag) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }
    this._updateCivilians(dt);
    this._resolveEntitySeparation();

    this.bullets.update(dt, {
      player: this.player,
      enemies: this.enemies,
      civilians: this.civilians,
      onPlayerHit: (damage, hitPosition, origin) => {
        this._damagePlayer(damage, hitPosition, origin);
      },
      onEnemyHit: (enemy, damage, hitPosition, origin, bullet, weakPoint) => {
        const hitDirection = bullet?.direction
          ? bullet.direction.clone()
          : new THREE.Vector3(0, 0, 1);
        const wasAlive = enemy.alive;
        let appliedDamage = damage;
        const effectPosition = weakPoint
          ? new THREE.Vector3(weakPoint.x, hitPosition.y, weakPoint.z)
          : hitPosition;
        if (weakPoint) {
          appliedDamage *= weakPoint.damageMultiplier || 1;
          enemy.onWeakPointHit?.(weakPoint, appliedDamage, effectPosition);
        }
        const hit = enemy.takeDamage(
          appliedDamage,
          effectPosition,
          origin,
          hitDirection
        );
        if (hit && wasAlive) {
          this.stats.hits++;
          this.effects.showHitmarker(!enemy.alive, Boolean(weakPoint));
          this.audio.playHitmarker(!enemy.alive);
        }
      },
      onCivilianHit: (civilian, damage, hitPosition) => {
        this._onCivilianHit(civilian, hitPosition);
      },
      onBarrelHit: (barrel, hitPosition, bullet) => {
        this._damageBarrel(
          barrel,
          bullet?.damage || 16,
          hitPosition,
          bullet?.faction === 'player'
        );
      },
      onBulletExplosion: (bullet, hitPosition) => {
        const payload = bullet.explosion;
        if (!payload) return;
        this._handleExplosion({
          x: hitPosition.x,
          z: hitPosition.z,
          radius: payload.radius,
          damage: payload.damage,
          mode: 'launcher',
        });
      },
    });

    this.grenades.update(dt, {
      enemies: this.enemies,
      onExplosion: (payload) => this._handleExplosion(payload),
    });

    this._updateDirector(dt);
    this._ensureScheduledPickups();
    this._updatePickups(dt);
    this._updateTimers(dt);
    this._updateAmbient(dt);
    this._updateCombo(dt);
    this._updateBossBar();
    this._updateThreatIndicators(dt);

    const distance = Math.max(0, this.player.position.z);
    this.stats.distance = distance;
    this.threatTier = this._threatTier();
    this.bestDistance = Math.max(this.bestDistance, distance);
    const biome = this.terrain.getBiome(this.player.position.z);
    this.ui.setBestDistance(this.bestDistance);
    this.ui.setRunStatus(
      distance,
      this.bestDistance,
      this.threatTier,
      this._threatTierProgress(),
      biome.phase
    );
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setKills(this.stats.kills);
    this.ui.setScore(this.stats.score);

    this._updateReticle(dt);
    this._checkRunProgress();
    if (this.state !== GAME_STATE.PLAYING) {
      // End of run may have been triggered above. Still render one frame with
      // the final camera state.
      this._finishFrame(dt);
      return;
    }

    this._finishFrame(dt);
  }

  _finishFrame(dt) {
    this._updateMotes(dt);
    this._updateEnvironment(dt);
    this.terrain.update(dt);
    this.particles.update(dt);
    this.lighting.update(dt, this.scroll, this.player.position.x);
    const shake = this.effects.update(dt);
    this.engine.updateCamera({
      scroll: this.scroll,
      dt,
      shakeX: shake.x,
      shakeY: shake.y,
      shakeZ: shake.z,
      shakeRoll: shake.roll,
      menuTime: this.visualTime,
      attract: false,
      focusX: this.player.position.x,
    });
    this._refreshCombatBounds();
    this.audio.setListener(
      new THREE.Vector3(this.player.position.x, 1.8, this.player.position.z),
      this.player.aimDirection
    );

    // Music density follows the intensity of the firefight.
    if (this.player.alive) {
      let nearby = 0;
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const distance = Math.hypot(
          enemy.position.x - this.player.position.x,
          enemy.position.z - this.player.position.z
        );
        if (distance < 24) nearby++;
      }
      const boss = this.enemies.some((enemy) => enemy.alive && enemy.type === 'truck');
      let intensity = 0.4 + Math.min(6, nearby) * 0.065;
      if (boss) intensity += 0.16;
      intensity += Math.min(0.34, Math.max(0, this.player.position.z) / 4500);
      if (this.player.health <= this.player.maxHealth * 0.3) intensity += 0.05;
      this.audio.setIntensity(clamp(intensity, 0.36, 1));
    } else {
      this.audio.setIntensity(0.25);
    }

    this.audio.update(dt);
    this.ui.update(dt);
    this.ui.updateRadar(dt, this._getRadarData());
  }

  _refreshCombatBounds() {
    // getGroundPoint reuses its hit vector, so copy each edge before sampling
    // the next one.
    const bottomHit = this.engine.getGroundPoint(0, -0.985);
    const bottomZ = bottomHit?.z;
    const topHit = this.engine.getGroundPoint(0, 0.985);
    const topZ = topHit?.z;
    // Convert the camera-space edge positions into offsets from the
    // authoritative gameplay scroll so the band cannot lag behind a fast push.
    if (bottomZ !== undefined) {
      const offset = bottomZ - this.engine.scroll;
      // Keep enemy fire comfortably inside the visible lower edge, but let a
      // bypassed enemy walk down to the actual edge before being culled.
      this.combatBounds.bottom = this.scroll + offset + 0.6;
      this.combatBounds.despawnBottom = this.scroll + offset - 0.8;
    }
    if (topZ !== undefined) {
      // Enemy bodies project above their feet, so keep the fire line a little
      // inside the top edge as well.
      this.combatBounds.top = this.scroll + (topZ - this.engine.scroll) - 2.0;
    }
  }

  _updateMenu(dt) {
    this.player.update(dt);
    this._updateMotes(dt);
    this._updateEnvironment(dt);
    this.terrain.update(dt);
    this.particles.update(dt);
    this.lighting.update(dt, 0, 0);
    this.effects.update(dt);
    this.audio.setListener(
      new THREE.Vector3(this.player.position.x, 1.8, this.player.position.z),
      new THREE.Vector3(0, 0, 1)
    );
    this.audio.update(dt);
    this.ui.update(dt);
    this.engine.updateCamera({
      scroll: 0,
      dt,
      menuTime: this.visualTime,
      attract: true,
    });
    this._syncGamepadIndicator();
  }

  _updateEnded(dt) {
    this.stats.time += dt;
    this.player.update(dt);
    this._updateEnvironment(dt);
    this.terrain.update(dt);
    this.particles.update(dt);
    this.lighting.update(dt, this.scroll, this.player.position.x);
    const shake = this.effects.update(dt);
    this.engine.updateCamera({
      scroll: this.scroll,
      dt,
      shakeX: shake.x,
      shakeY: shake.y,
      shakeZ: shake.z,
      shakeRoll: shake.roll,
      menuTime: this.visualTime,
      attract: false,
      focusX: this.player.position.x,
    });
    this.audio.update(dt);
    this.ui.update(dt);
    this._syncGamepadIndicator();
  }

  _syncGamepadIndicator() {
    const active = this.input.getGamepadActive();
    if (active !== this.lastGamepadState) {
      this.lastGamepadState = active;
      this.ui.setPadStatus(active, this.input.pad.id);
    }
  }

  /* ------------------------------------------------------------------------
     Aiming + camera
     ------------------------------------------------------------------------ */

  _updateAimWorld() {
    const input = this.input;
    this.aimAssistTarget = null;

    let assistX = 0;
    let assistY = 0;

    if (input.aimMode === 'stick' && input.pad.connected) {
      const stick = input.aimStick.magnitude > 0 ? input.aimStick : input.lastAimStick;
      this.aimWorld.set(
        this.player.position.x - stick.x * 13,
        0,
        this.player.position.z + stick.z * 13
      );
      const aimScreen = this.engine.projectToScreen({
        x: this.aimWorld.x,
        y: 0.7,
        z: this.aimWorld.z,
      });
      assistX = aimScreen.x;
      assistY = aimScreen.y;
    } else {
      const hit = this.engine.getGroundPoint(input.mouseNDC.x, input.mouseNDC.y);
      if (hit) {
        const dx = hit.x - this.player.position.x;
        const dz = hit.z - this.player.position.z;
        const distance = Math.hypot(dx, dz);
        const maxDistance = 28;
        if (distance > maxDistance) {
          this.aimWorld.set(
            this.player.position.x + (dx / distance) * maxDistance,
            0,
            this.player.position.z + (dz / distance) * maxDistance
          );
        } else {
          this.aimWorld.set(hit.x, 0, hit.z);
        }
      } else {
        this.aimWorld.set(
          this.player.position.x,
          0,
          this.player.position.z + 14
        );
      }
      assistX = input.pointer.x;
      assistY = input.pointer.y;
    }

    // Screen-space target magnetism. The reticle remains a ground plane point,
    // but the shot vector is corrected to the target's torso when the cursor is
    // close enough. This keeps aiming readable from a steep perspective camera.
    let bestDistance = input.aimMode === 'stick' ? 58 : 44;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const worldDistance = Math.hypot(
        enemy.position.x - this.player.position.x,
        enemy.position.z - this.player.position.z
      );
      if (worldDistance > 31) continue;
      this._projectionPoint.set(enemy.position.x, 1.05, enemy.position.z);
      const projected = this.engine.projectToScreen(this._projectionPoint, this._screenPoint);
      if (projected.behind) continue;
      const dist = Math.hypot(projected.x - assistX, projected.y - assistY);
      if (dist < bestDistance) {
        bestDistance = dist;
        this.aimAssistTarget = enemy;
      }
    }
  }

  _updateReticle(dt) {
    const active =
      this.state === GAME_STATE.PLAYING &&
      this.player.alive;
    if (!active) {
      this.reticle.visible = false;
      this.ui.setCrosshairVisible(false);
      return;
    }

    this.reticleTime += dt;
    const overEnemy = Boolean(this.aimAssistTarget?.alive);

    const color = overEnemy ? 0xff6b5e : 0xffe96e;
    this.reticleMaterial.color.setHex(color);
    this.reticleInnerMaterial.color.setHex(overEnemy ? 0xff9d5c : 0x74e0e0);
    this.reticle.position.set(this.aimWorld.x, 0.075, this.aimWorld.z);
    this.reticle.rotation.y += dt * 0.25;
    const pulse =
      1 +
      Math.sin(this.reticleTime * 3.2) * 0.025 +
      (this.player.fireHeld ? 0.08 + Math.sin(this.reticleTime * 21) * 0.03 : 0);
    this.reticle.scale.setScalar(pulse);
    this.reticle.visible = true;

    const projected = this.engine.projectToScreen(
      new THREE.Vector3(this.aimWorld.x, 0.4, this.aimWorld.z)
    );
    const x = clamp(projected.x, 22, window.innerWidth - 22);
    const y = clamp(projected.y, 22, window.innerHeight - 22);
    this.ui.setCrosshair(x, y, {
      visible: !projected.behind,
      overEnemy,
      firing: this.player.fireHeld,
    });
  }

  /* ------------------------------------------------------------------------
     Directors, enemies, and waves
     ------------------------------------------------------------------------ */

  _activeCount(type) {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.alive && (!type || enemy.type === type)) count++;
    }
    return count;
  }

  _activeInfantryCount() {
    let count = 0;
    for (const enemy of this.enemies) {
      if (
        enemy.alive &&
        (enemy.type === 'rifleman' ||
          enemy.type === 'heavy' ||
          enemy.type === 'officer' ||
          enemy.type === 'sapper' ||
          enemy.type === 'fanatic' ||
          enemy.type === 'sniper' ||
          enemy.type === 'hunter')
      ) {
        count++;
      }
    }
    return count;
  }

  _maxActiveInfantry() {
    const { idleTempo, idleMaxInfantry, maxInfantry, truckCapReduction } =
      SETTINGS.difficulty;
    const pressure = clamp01(
      (this.battleTempo - idleTempo) / Math.max(1e-4, 1 - idleTempo)
    );
    const threatBonus = Math.min(
      4,
      Math.floor(Math.max(0, (this.threatTier || 1) - 1) / 3)
    );
    let cap = Math.round(lerp(idleMaxInfantry, maxInfantry, pressure)) + threatBonus;
    if (this.enemies.some((enemy) => enemy.alive && enemy.type === 'truck')) {
      cap = Math.max(2, cap - truckCapReduction);
    }
    return cap;
  }

  _maxSpecialInfantry() {
    return (
      SETTINGS.difficulty.maxSpecialInfantry +
      Math.min(2, Math.floor(Math.max(0, (this.threatTier || 1) - 1) / 4))
    );
  }

  _specialSpawnChance() {
    return Math.min(
      0.5,
      SETTINGS.difficulty.specialSpawnChance +
        Math.max(0, (this.threatTier || 1) - 1) * 0.015
    );
  }

  _activeSpecialCount() {
    let count = 0;
    for (const enemy of this.enemies) {
      if (
        enemy.alive &&
        (enemy.type === 'sapper' ||
          enemy.type === 'fanatic' ||
          enemy.type === 'sniper' ||
          enemy.type === 'hunter')
      ) {
        count++;
      }
    }
    return count;
  }

  _pickEnemyClass(biomeId, difficulty, heavyChance) {
    if (chance(heavyChance)) return HeavyGunner;
    if (this._activeSpecialCount() >= this._maxSpecialInfantry()) {
      return Rifleman;
    }
    const special =
      biomeId === 'wetlands' || biomeId === 'swamp'
        ? Sapper
        : biomeId === 'desert' || biomeId === 'grassland'
          ? Fanatic
          : biomeId === 'city' || biomeId === 'forest'
            ? Sniper
            : biomeId === 'snow'
              ? Hunter
              : null;
    if (!special || !chance(this._specialSpawnChance())) {
      return Rifleman;
    }
    if (special === Sniper && this._activeCount('sniper') >= 1) return Rifleman;
    return special;
  }

  _announceSpecial(EnemyClass) {
    const intros = {
      [Sapper]: ['SAPPER', 'DEMOLITION RUNNER — DROP IT FAST', 'sapper'],
      [Fanatic]: ['FANATIC', 'CLOSE-ASSAULT TROOPER INBOUND', 'fanatic'],
      [Sniper]: ['MARKSMAN', 'LASER SIGHT — BREAK LINE OF FIRE', 'sniper'],
      [Hunter]: ['WHITEOUT HUNTER', 'FLANKING THROUGH THE SQUALL', 'hunter'],
    };
    const intro = intros[EnemyClass];
    if (!intro || this.announced.has(intro[2])) return;
    this.announced.add(intro[2]);
    this.ui.announce(intro[0], intro[1], 2.8, 'danger');
  }

  _updateBattleTempo(dt) {
    // The battlefield keeps its momentum when the player is pushing, but eases
    // off when they hold ground or stop so a stationary fight is less of an
    // endless conveyor belt.
    const ratio = clamp(
      this.player.speed /
        (SETTINGS.player.speed * (this.runSpeedMultiplier || 1)),
      0,
      1
    );
    this.playerMoveRatio = ratio;
    const eased = ratio * ratio * (3 - 2 * ratio);
    const target =
      SETTINGS.difficulty.idleTempo +
      (1 - SETTINGS.difficulty.idleTempo) * eased;
    this.battleTempo = damp(
      this.battleTempo,
      target,
      SETTINGS.difficulty.tempoSmoothing,
      dt
    );
  }

  _damagePlayer(amount, hitPosition = null, sourcePosition = null) {
    const applied = this.player.takeDamage(amount, hitPosition, sourcePosition);
    if (!applied) return false;
    this.stats.damageTaken += amount;
    if (sourcePosition) {
      const dx = sourcePosition.x - this.player.position.x;
      const dz = sourcePosition.z - this.player.position.z;
      if (dx * dx + dz * dz > 0.04) {
        this.ui.showDamageDirection(Math.atan2(-dx, dz));
      }
    }
    return true;
  }

  _updateCoverStatus(dt) {
    this._coverTimer -= dt;
    if (this._coverTimer > 0) return;
    this._coverTimer = 0.18;

    let inCover = false;
    if (this.player.alive) {
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.type === 'mortar' || enemy.type === 'sapper') {
          continue;
        }
        const distance = Math.hypot(
          enemy.position.x - this.player.position.x,
          enemy.position.z - this.player.position.z
        );
        if (distance > 35) continue;
        if (this.terrain.isInCover(this.player.position, enemy.position)) {
          inCover = true;
          break;
        }
      }
    }
    this.player.inCover = inCover;
    this.ui.setCover(inCover);
  }

  _updateThreatIndicators(dt) {
    this._threatTimer -= dt;
    if (this._threatTimer > 0) return;
    this._threatTimer = 0.1;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const threats = [];

    const projectThreat = (worldX, worldZ, label, kind) => {
      const projected = this.engine.projectToScreen({
        x: worldX,
        y: 1.2,
        z: worldZ,
      });
      const offScreen =
        projected.behind ||
        projected.x < 48 ||
        projected.x > width - 48 ||
        projected.y < 96 ||
        projected.y > height - 158;
      if (!offScreen) return;

      let x = projected.x;
      let y = projected.y;
      if (projected.behind) {
        const dx = worldX - this.player.position.x;
        const dz = worldZ - this.player.position.z;
        const angle = Math.atan2(-dx, dz);
        const radius = Math.min(width, height) * 0.36;
        x = cx + Math.sin(angle) * radius;
        y = cy - Math.cos(angle) * radius;
      }
      x = clamp(x, 52, width - 52);
      y = clamp(y, 120, height - 164);
      threats.push({
        x,
        y,
        angle: Math.atan2(cx - x, cy - y),
        label,
        kind,
      });
    };

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (enemy.type === 'mortar') {
        projectThreat(enemy.position.x, enemy.position.z, 'MORTAR', 'mortar');
      } else if (enemy.type === 'truck') {
        projectThreat(enemy.position.x, enemy.position.z, 'ARMOR', 'truck');
      }
    }

    for (const grenade of this.grenades.grenades) {
      if (!grenade.active || grenade.mode !== 'mortar') continue;
      const target = grenade.marker?.group.position ?? grenade.position;
      projectThreat(target.x, target.z, 'SHELL', 'shell');
    }

    this.ui.setThreats(threats.slice(0, 4));
  }

  _difficulty() {
    return clamp(this.player.position.z / 1600, 0, 1);
  }

  _enemyDifficulty() {
    return clamp(
      this._difficulty() + Math.max(0, (this.threatTier || 1) - 1) * 0.03,
      0,
      1.6
    );
  }

  _updateDirector(dt) {
    const difficulty = this._difficulty();
    const enemyDifficulty = this._enemyDifficulty();
    const threat = this.threatTier || 1;
    const scroll = this.scroll;
    const activeTruck = this.enemies.find((enemy) => enemy.alive && enemy.type === 'truck');
    const onslaughtPace = this.battleTempo;
    const maxInfantry = this._maxActiveInfantry();
    const activeInfantry = this._activeInfantryCount();
    const atInfantryCap = activeInfantry >= maxInfantry;

    if (atInfantryCap) {
      // Do not bank reinforcement credit while the field is full. Without
      // this, the timer went deeply negative and the next kill was replaced
      // instantly, even when the player was standing still.
      this.director.regular = Math.max(
        this.director.regular,
        SETTINGS.difficulty.reinforceDelay
      );
    } else {
      this.director.regular -= dt * onslaughtPace;
    }

    if (this.director.regular <= 0) {
      const groupSize = 1 + Math.min(3, Math.floor(Math.max(0, threat - 1) / 3));
      const count = Math.min(
        activeTruck ? Math.max(1, groupSize - 1) : groupSize,
        maxInfantry - activeInfantry
      );
      for (let i = 0; i < count; i++) {
        // Spawn just beyond the new top edge of the camera (scroll + ~27 m).
        const camp = this.terrain.barracks.find(
          (entry) => entry.z > scroll + 19 && entry.z < scroll + 32
        );
        let spawn;
        if (camp && i === 0 && chance(0.42)) {
          const point = this.terrain.findSpawnNear(
            camp.x * 0.82,
            camp.z - rand(2, 5),
            0.8
          );
          spawn = { x: point.x, z: point.z, spot: null };
        } else {
          const zMin = scroll + 28 + rand(0, 2);
          const zMax = zMin + 4;
          spawn = this.terrain.findSpawnPoint(zMin, zMax, {
            preferCover: i === 0 && chance(0.22),
            radius: 0.8,
          });
        }
        const biomeId = this.terrain.getBiome(spawn.z).id;
        const heavyCap = 2 + Math.min(2, Math.floor(Math.max(0, threat - 1) / 5));
        const canSpawnHeavy =
          this._activeCount('heavy') < heavyCap &&
          this.player.position.z > 540 &&
          biomeId !== 'jungle' &&
          biomeId !== 'wetlands';
        const heavyChance = canSpawnHeavy
          ? Math.min(0.32, 0.11 + difficulty * 0.08 + threat * 0.01)
          : 0;
        const EnemyClass = this._pickEnemyClass(
          biomeId,
          difficulty,
          heavyChance
        );
        this._spawnEnemy(EnemyClass, {
          x: spawn.x,
          z: spawn.z,
          difficulty: enemyDifficulty,
          biomeId,
        }, spawn.spot);
        this._announceSpecial(EnemyClass);
      }
      const intervalFloor = Math.max(
        0.95,
        SETTINGS.difficulty.minSpawnInterval - Math.max(0, threat - 1) * 0.03
      );
      const interval = clamp(
        SETTINGS.difficulty.baseSpawnInterval -
          difficulty * 1.15 -
          Math.max(0, threat - 1) * 0.04 +
          rand(-0.35, 0.4),
        intervalFloor,
        3.2
      );
      this.director.regular = interval;
    }

    if (this.player.position.z > SETTINGS.difficulty.mortarUnlockZ) {
      this.director.mortar -= dt * onslaughtPace;
      const mortarCap =
        SETTINGS.difficulty.maxMortars +
        Math.min(2, Math.floor(Math.max(0, threat - 1) / 4));
      if (this.director.mortar <= 0 && this._activeCount('mortar') < mortarCap) {
        const spawn = this.terrain.findSpawnPoint(scroll + 28, scroll + 32, {
          radius: 1.2,
        });
        this._spawnEnemy(MortarTeam, {
          x: clamp(spawn.x, -SETTINGS.mission.width + 3, SETTINGS.mission.width - 3),
          z: spawn.z,
          difficulty: enemyDifficulty,
        });
        this.director.mortar = Math.max(6, rand(13, 22) - Math.max(0, threat - 1) * 0.45);
        if (!this.announced.has('mortar')) {
          this.announced.add('mortar');
          this.ui.announce('NEW THREAT', 'ENEMY MORTAR TEAM SPOTTED', 3, 'danger');
          this.ui.toast('WATCH THE RED TARGET MARKERS', 'danger');
        }
      }
    }

    if (this.player.position.z > SETTINGS.difficulty.officerUnlockZ) {
      this.director.officer -= dt * onslaughtPace;
      const infantryRoom =
        this._maxActiveInfantry() - this._activeInfantryCount();
      if (
        this.director.officer <= 0 &&
        this._activeCount('officer') < SETTINGS.difficulty.maxOfficers &&
        infantryRoom > 0
      ) {
        const spawn = this.terrain.findSpawnPoint(scroll + 29, scroll + 33, {
          radius: 0.8,
          preferCover: chance(0.35),
        });
        this._spawnEnemy(Officer, {
          x: spawn.x,
          z: spawn.z,
          difficulty: enemyDifficulty,
        }, spawn.spot);
        const escorts = Math.min(2, Math.max(0, infantryRoom - 1));
        for (let i = 0; i < escorts; i++) {
          const escort = this.terrain.findSpawnPoint(scroll + 30, scroll + 34, { radius: 0.8 });
          this._spawnEnemy(Rifleman, {
            x: escort.x,
            z: escort.z,
            difficulty: enemyDifficulty,
          }, escort.spot);
        }
        this.director.officer = Math.max(10, rand(24, 36) - Math.max(0, threat - 1) * 0.7);
      }
    }

    // Endless armored response: trucks recur on a rolling distance timer.
    const activeTruckCount = this.enemies.filter((enemy) => enemy.alive && enemy.type === 'truck').length;
    if (
      activeTruckCount === 0 &&
      this.player.position.z >= this.director.nextTruck
    ) {
      const x = rand(-4, 4);
      const z = scroll + 30;
      const variant = this.terrain.getBiome(z).id;
      this._spawnEnemy(
        OfficerTruck,
        { x, z, difficulty: enemyDifficulty, variant },
        null,
        true
      );
      const interval = Math.max(
        SETTINGS.difficulty.truckIntervalMin,
        lerp(
          SETTINGS.difficulty.truckInterval[0],
          SETTINGS.difficulty.truckInterval[1],
          Math.random()
        ) - Math.max(0, threat - 1) * 10
      );
      this.director.nextTruck = this.player.position.z + interval;
    }

    if (!this.announced.has('first-contact') && this.player.position.z > 35) {
      this.announced.add('first-contact');
      this.ui.announce('CONTACT', 'HOSTILES IN THE TREELINE', 2.4, 'danger');
    }
  }

  _spawnEnemy(EnemyClass, options, coverSpot = null, isTruck = false) {
    const biomeId = options.biomeId || this.terrain.getBiome(options.z).id;
    const enemy = new EnemyClass(this, { ...options, biomeId });
    if (coverSpot) {
      enemy.assignCoverSpot(coverSpot);
    }
    this.enemies.push(enemy);
    this.particles.spawnDust(
      new THREE.Vector3(enemy.position.x, 0.3, enemy.position.z),
      1.3,
      0.24
    );
    if (isTruck) {
      this.boss = enemy;
      const label = enemy.displayName || 'ARMORED COMMAND TRUCK';
      this.ui.showBoss(label);
      this.ui.announce('ARMORED RESPONSE', `${label} INBOUND`, 3.2, 'danger');
      this.audio.playDistantWar(enemy.position);
    }
    return enemy;
  }

  spawnTruckInfantry(position) {
    const room = this._maxActiveInfantry() - this._activeInfantryCount();
    if (room <= 0) return;
    const count = Math.min(chance(0.5) ? 2 : 1, room);
    for (let i = 0; i < count; i++) {
      const spot = this.terrain.findSpawnNear(position.x + rand(-2.2, 2.2), position.z + rand(-1.5, 1.5), 0.7);
      const enemy = new Rifleman(this, {
        x: spot.x,
        z: spot.z,
        difficulty: this._enemyDifficulty(),
        biomeId: this.terrain.getBiome(spot.z).id,
      });
      enemy.forcedMove = {
        x: this.player.position.x + rand(-6, 6),
        z: this.player.position.z + rand(3, 8),
      };
      this.enemies.push(enemy);
      this.particles.spawnDust(new THREE.Vector3(spot.x, 0.25, spot.z), 1.1, 0.28);
    }
    if (this.visualTime - (this._lastTruckDeployToast || 0) > 8) {
      this._lastTruckDeployToast = this.visualTime;
      this.ui.toast('TRUCK DEPLOYING INFANTRY', 'danger');
    }
  }

  _resolveEntitySeparation() {
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = a.radius + b.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq > min * min || distSq < 0.0001) continue;
        const dist = Math.sqrt(distSq);
        const push = (min - dist) * 0.5;
        const nx = dx / dist;
        const nz = dz / dist;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }

      if (a.alive && a.type !== 'truck' && this.player.alive) {
        const dx = this.player.position.x - a.position.x;
        const dz = this.player.position.z - a.position.z;
        const min = a.radius + this.player.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq < min * min && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const push = min - dist;
          this.player.position.x += (dx / dist) * push;
          this.player.position.z += (dz / dist) * push;
        }
      }
    }
    for (const enemy of this.enemies) {
      if (enemy.alive) this.terrain.resolveCircle(enemy.position, enemy.radius * 0.7);
    }
  }

  /* ------------------------------------------------------------------------
     Damage, blasts, barrels, pickups
     ------------------------------------------------------------------------ */

  _damageBarrel(barrel, damage, hitPosition, playerCaused = false) {
    if (!barrel.alive) return;
    barrel.playerCaused = Boolean(barrel.playerCaused || playerCaused);
    barrel.health -= damage;
    this.particles.spawnImpact(
      hitPosition || new THREE.Vector3(barrel.x, 1, barrel.z),
      0xffc167,
      new THREE.Vector3(0, 0, 1),
      0.9
    );
    this.audio.playRicochet(hitPosition || new THREE.Vector3(barrel.x, 1, barrel.z));
    if (barrel.health <= 0) {
      this._detonateBarrel(barrel, Boolean(barrel.playerCaused));
    }
  }

  _detonateBarrel(barrel, playerCaused = false) {
    if (!barrel.alive) return;
    if (!this.terrain.destroyBarrel(barrel)) return;
    const position = new THREE.Vector3(barrel.x, 0.55, barrel.z);
    this.particles.spawnExplosion(position, 1.15);
    this.lighting.explosion(position, 0xff8e3c, 320, 24, 0.5);
    this.effects.explosionShake(position, this.player.position, 0.9);
    this.audio.playExplosion(position, 0.9);
    this.terrain.addScorch(position, rand(4, 6));
    this.stats.score += SETTINGS.score.barrel;
    this.ui.setScore(this.stats.score);
    this.ui.setBestScore(Math.max(this.best, this.stats.score));
    this.ui.toast('FUEL BARREL DETONATED', 'health');

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = Math.hypot(
        enemy.position.x - barrel.x,
        enemy.position.z - barrel.z
      );
      if (distance < 6.2) {
        const falloff = 1 - clamp01(distance / 6.2) * 0.7;
        enemy.takeDamage(
          92 * falloff,
          new THREE.Vector3(enemy.position.x, 1.1, enemy.position.z),
          null,
          new THREE.Vector3(enemy.position.x - barrel.x, 0, enemy.position.z - barrel.z).normalize()
        );
      }
    }
    this._damageCiviliansInBlast(position, 6.2, 92, playerCaused);
    const playerDistance = Math.hypot(
      this.player.position.x - barrel.x,
      this.player.position.z - barrel.z
    );
    if (playerDistance < 6.2 && this.player.alive) {
      const falloff = 1 - clamp01(playerDistance / 6.2) * 0.7;
      this._damagePlayer(34 * falloff, position, position);
    }

    for (const other of this.terrain.barrels) {
      if (!other.alive || other === barrel) continue;
      if (Math.hypot(other.x - barrel.x, other.z - barrel.z) < 5.5) {
        this._detonateBarrel(other, playerCaused);
      }
    }
  }

  _handleExplosion(payload) {
    const position = new THREE.Vector3(payload.x, 0.55, payload.z);
    const isMortar = payload.mode === 'mortar';
    const isLauncher = payload.mode === 'launcher';
    const scale = isMortar ? 0.95 : isLauncher ? 0.82 : 1.25;
    this.particles.spawnExplosion(position, scale);
    this.lighting.explosion(position, 0xff9a46, isMortar ? 760 : isLauncher ? 560 : 980, 38, 0.72);
    this.effects.explosionShake(position, this.player.position, isMortar ? 1.1 : isLauncher ? 0.58 : 1.4);
    this.audio.playExplosion(position, scale);
    this.terrain.addScorch(position, rand(5.5, 8.5) * scale);

    const radius = payload.radius;
    // Enemy mortar fire hurts the player and chain-detonates barrels, but does
    // not wipe out its own platoon.
    if (!isMortar) {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const dx = enemy.position.x - payload.x;
        const dz = enemy.position.z - payload.z;
        const distance = Math.hypot(dx, dz);
        if (distance > radius) continue;
        const falloff = 1 - clamp01(distance / radius) * 0.65;
        const direction = new THREE.Vector3(dx, 0, dz);
        if (direction.lengthSq() > 0.001) direction.normalize();
        enemy.takeDamage(
          payload.damage * falloff,
          new THREE.Vector3(enemy.position.x, 1.1, enemy.position.z),
          null,
          direction
        );
      }
      this._damageCiviliansInBlast(position, radius, payload.damage, true);
    }

    const pdx = this.player.position.x - payload.x;
    const pdz = this.player.position.z - payload.z;
    const playerDistance = Math.hypot(pdx, pdz);
    if (playerDistance < radius && this.player.alive) {
      const falloff = 1 - clamp01(playerDistance / radius) * 0.7;
      if (isMortar) {
        this._damagePlayer(
          payload.damage * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          position
        );
      } else if (playerDistance < radius * (isLauncher ? 0.35 : 0.9)) {
        this._damagePlayer(
          (isLauncher ? 12 : SETTINGS.grenade.selfDamage) * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          null
        );
      }
    }

    for (const barrel of this.terrain.barrels) {
      if (!barrel.alive) continue;
      if (Math.hypot(barrel.x - payload.x, barrel.z - payload.z) < radius) {
        this._detonateBarrel(barrel, !isMortar);
      }
    }
  }

  _damageEnemiesInBlast(position, radius, damage, exclude = null) {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy === exclude) continue;
      const dx = enemy.position.x - position.x;
      const dz = enemy.position.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const falloff = 1 - clamp01(distance / radius) * 0.6;
      const direction = new THREE.Vector3(dx, 0, dz);
      if (direction.lengthSq() > 0.001) direction.normalize();
      enemy.takeDamage(
        damage * falloff,
        new THREE.Vector3(enemy.position.x, 1.1, enemy.position.z),
        null,
        direction
      );
    }
  }

  sapperExplosion(position, source = null) {
    const blast = new THREE.Vector3(position.x, 0.55, position.z);
    const radius = 4.3;
    this.particles.spawnExplosion(blast, 1.05);
    this.lighting.explosion(blast, 0xff7a3c, 620, 30, 0.55);
    this.effects.explosionShake(blast, this.player.position, 0.9);
    this.audio.playExplosion(blast, 0.95);
    this.terrain.addScorch(blast, rand(4, 6));
    this._damageEnemiesInBlast(blast, radius, 34, source);
    if (this.player.alive) {
      const distance = Math.hypot(
        this.player.position.x - position.x,
        this.player.position.z - position.z
      );
      if (distance < radius) {
        const falloff = 1 - clamp01(distance / radius) * 0.7;
        this._damagePlayer(
          30 * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          blast
        );
      }
    }
    this.ui.toast('SAPPER DETONATED', 'danger');
  }

  ammoPackExplosion(position, source = null) {
    const blast = new THREE.Vector3(position.x, 0.85, position.z);
    const radius = 3.8;
    this.particles.spawnExplosion(blast, 0.7);
    this.lighting.explosion(blast, 0xffb05a, 360, 18, 0.35);
    this.effects.explosionShake(blast, this.player.position, 0.55);
    this.audio.playExplosion(blast, 0.65);
    this.terrain.addScorch(blast, rand(2.5, 4));
    this._damageEnemiesInBlast(blast, radius, 38, source);
    if (this.player.alive) {
      const distance = Math.hypot(
        this.player.position.x - position.x,
        this.player.position.z - position.z
      );
      if (distance < radius) {
        const falloff = 1 - clamp01(distance / radius) * 0.7;
        this._damagePlayer(
          16 * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          blast
        );
      }
    }
    this.stats.score += 120;
    this.ui.setScore(this.stats.score);
    this.ui.setBestScore(Math.max(this.best, this.stats.score));
    this.ui.toast('AMMO PACK COOK-OFF +120', 'health');
    this.audio.playHitmarker(true);
  }

  truckFuelExplosion(truck) {
    const blast = new THREE.Vector3(truck.position.x, 0.8, truck.position.z);
    this.particles.spawnExplosion(blast, 1.55);
    this.particles.spawnExplosion(
      new THREE.Vector3(truck.position.x + rand(-1, 1), 0.4, truck.position.z + rand(-1, 1)),
      1.0
    );
    this.lighting.explosion(blast, 0xff8b3f, 760, 38, 0.7);
    this.effects.explosionShake(blast, this.player.position, 1.25);
    this.audio.playExplosion(blast, 1.2);
    this.terrain.addScorch(blast, rand(6, 9));
    this.onWeakPointDestroyed(truck, 'fuel');
    this._damageEnemiesInBlast(blast, 6.2, 70, truck);
    if (this.player.alive) {
      const distance = Math.hypot(
        this.player.position.x - truck.position.x,
        this.player.position.z - truck.position.z
      );
      if (distance < 5.5) {
        const falloff = 1 - clamp01(distance / 5.5) * 0.65;
        this._damagePlayer(
          26 * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          blast
        );
      }
    }
    truck.takeDamage(120, blast, null);
  }

  onWeakPointDestroyed(enemy, id) {
    const labels = {
      turret: 'TRUCK TURRET DISABLED',
      fuel: 'FUEL TANK RUPTURED',
    };
    const points = id === 'turret' ? 200 : 300;
    this.stats.score += points;
    this.ui.setScore(this.stats.score);
    this.ui.setBestScore(Math.max(this.best, this.stats.score));
    this.ui.toast(`${labels[id] || 'WEAK POINT DESTROYED'} +${points}`, 'health');
    if (id === 'fuel') {
      this.ui.announce('WEAK POINT', 'FUEL TANK RUPTURED — ARMOR COOKING OFF', 2.4, 'danger');
    }
    this.audio.playHitmarker(true);
  }

  _spawnPickup(type, x, z, extra = {}) {
    const activePickups = this.pickups.filter((pickup) => pickup.active);
    if (activePickups.length > 18) {
      const oldest =
        activePickups.find((pickup) => !pickup.persistent) || activePickups[0];
      if (oldest) this._removePickup(oldest);
    }
    const assets = this.pickupAssets;
    const group = new THREE.Group();
    const isHealth = type === 'health';
    const isWeapon = type === 'weapon';
    const isArmor = type === 'armor';
    const isCalibration = type === 'calibration';
    const weapon = isWeapon ? WEAPON_BY_ID.get(extra.weaponId) : null;
    const weaponStyle =
      isWeapon && weapon ? assets.weaponStyles[weapon.category] : null;

    const box = new THREE.Mesh(assets.box, assets.crateMaterial);
    box.position.y = 0.28;
    box.castShadow = true;
    group.add(box);
    const band = new THREE.Mesh(assets.band, assets.bandMaterial);
    band.position.y = 0.28;
    group.add(band);
    if (weaponStyle) {
      const stripe = new THREE.Mesh(assets.band, weaponStyle.band);
      stripe.position.y = 0.46;
      stripe.scale.set(1.04, 1.5, 1.04);
      group.add(stripe);
    }

    if (isHealth) {
      const crossA = new THREE.Mesh(assets.crossA, assets.healthMaterial);
      crossA.position.y = 0.48;
      group.add(crossA);
      const crossB = new THREE.Mesh(assets.crossB, assets.healthMaterial);
      crossB.position.y = 0.48;
      group.add(crossB);
    } else if (isArmor) {
      const plate = new THREE.Mesh(assets.band, assets.bandMaterial);
      plate.position.y = 0.42;
      plate.scale.set(0.9, 1.5, 0.9);
      group.add(plate);
    } else if (isCalibration) {
      for (let i = -1; i <= 1; i++) {
        const tool = new THREE.Mesh(assets.grenadeGeo, assets.grenadeMaterial);
        tool.position.set(i * 0.16, 0.48, 0);
        tool.scale.set(1, 1.4, 1);
        group.add(tool);
      }
    } else if (!isWeapon) {
      for (let i = 0; i < 3; i++) {
        const grenade = new THREE.Mesh(assets.grenadeGeo, assets.grenadeMaterial);
        grenade.position.set((i - 1) * 0.16, 0.48, 0);
        group.add(grenade);
      }
    }

    const ring = new THREE.Mesh(
      assets.ringGeometry,
      isHealth
        ? assets.healthRing
        : isWeapon
          ? weaponStyle?.ring || assets.weaponRing
          : isArmor
            ? assets.armorRing
            : isCalibration
              ? assets.calibrationRing
              : assets.grenadeRing
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const beam = new THREE.Mesh(
      assets.beamGeometry,
      isHealth
        ? assets.beamHealthMaterial
        : isWeapon
          ? weaponStyle?.beam || assets.weaponBeamMaterial
          : isArmor
            ? assets.armorBeamMaterial
            : isCalibration
              ? assets.calibrationBeamMaterial
              : assets.beamGrenadeMaterial
    );
    beam.position.y = 1.25;
    group.add(beam);

    const glow = new THREE.Sprite(
      isHealth
        ? assets.healthGlow
        : isWeapon
          ? weaponStyle?.glow || assets.weaponGlow
          : isArmor
            ? assets.armorGlow
            : isCalibration
              ? assets.calibrationGlow
              : assets.grenadeGlow
    );
    glow.position.y = 0.75;
    glow.scale.set(isWeapon ? 3.4 : 3.2, isWeapon ? 3.4 : 3.2, 1);
    group.add(glow);

    let icon;
    if (isWeapon && weapon) {
      const gun = getWeaponVisual(weapon.id).mesh;
      gun.scale.setScalar(0.98);
      gun.position.set(0, 1.52, 0.05);
      gun.rotation.set(0, 0.3, 0);
      icon = gun;
      const label = new THREE.Sprite(this._getWeaponLabelMaterial(weapon));
      label.position.y = 1.5;
      label.scale.set(3.6, 1.8, 1);
      label.renderOrder = 50;
      group.add(label);
    } else {
      icon = new THREE.Mesh(
        assets.iconGeometry,
        isHealth
          ? assets.iconHealthMaterial
          : isArmor
            ? assets.armorIconMaterial
            : isCalibration
              ? assets.calibrationIconMaterial
              : assets.iconGrenadeMaterial
      );
      icon.position.y = 1.7;
    }
    group.add(icon);

    group.position.set(x, 0, z);
    this.scene.add(group);
    const pickup = {
      type,
      group,
      ring,
      beam,
      icon,
      iconBaseY: isWeapon ? 1.52 : 1.7,
      weaponId: weapon?.id ?? null,
      weapon,
      persistent: Boolean(extra.persistent),
      lifetime: extra.persistent || isWeapon ? Infinity : 42,
      position: new THREE.Vector3(x, 0, z),
      active: true,
      age: 0,
      baseY: 0,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  _removePickup(pickup) {
    pickup.active = false;
    pickup.group.removeFromParent();
  }

  _clearPickups() {
    for (const pickup of this.pickups) pickup.group.removeFromParent();
    this.pickups.length = 0;
  }

  _updatePickups(dt) {
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      pickup.age += dt;
      pickup.group.rotation.y += dt * 1.3;
      pickup.group.position.y = Math.sin(pickup.age * 2.4) * 0.08;
      pickup.ring.rotation.z += dt * 0.8;
      pickup.beam.scale.y = 0.9 + Math.sin(pickup.age * 4.2) * 0.08;
      pickup.icon.rotation.y += dt * (pickup.type === 'weapon' ? 1.1 : 2.2);
      pickup.icon.position.y =
        pickup.iconBaseY + Math.sin(pickup.age * 2.4) * (pickup.type === 'weapon' ? 0.06 : 0.1);

      if (pickup.age > pickup.lifetime || pickup.position.z < this.scroll - 16) {
        this._removePickup(pickup);
        continue;
      }
      if (!this.player.alive) continue;
      const distance = Math.hypot(
        pickup.position.x - this.player.position.x,
        pickup.position.z - this.player.position.z
      );
      if (distance < 1.7) {
        if (pickup.type === 'health') {
          const healed = this.player.heal(35);
          if (healed > 0) {
            this.ui.toast(`+${Math.round(healed)} VITALS`, 'health');
          } else {
            this.stats.score += 75;
            this.ui.toast('+75 FIELD BONUS', 'health');
          }
          this.audio.playPickup('health');
          this.particles.spawnSmokeColumn(pickup.position, false, true);
        } else if (pickup.type === 'weapon' && pickup.weapon) {
          const acquired = this.player.acquireWeapon(pickup.weapon.id);
          if (acquired) {
            const category = WEAPON_CATEGORIES[acquired.category];
            const previous = acquired.previous?.name;
            this.ui.announce('FIELD ARMORY', `${pickup.weapon.unlockText} ACQUIRED`, 2.8);
            this.ui.toast(
              previous
                ? `${category.label} SLOT — ${previous} → ${pickup.weapon.name}`
                : `${category.label} SLOT — ${pickup.weapon.name} READY`,
              'health'
            );
            this.ui.setScore(this.stats.score);
            this.audio.playPickup('weapon');
            this.particles.spawnMuzzle(
              new THREE.Vector3(pickup.position.x, 1.2, pickup.position.z),
              new THREE.Vector3(0, 0, 1)
            );
            this.refreshWeaponUI();
          } else {
            this.stats.score += 100;
            this.ui.setScore(this.stats.score);
            this.ui.setBestScore(Math.max(this.best, this.stats.score));
            this.ui.toast(`${pickup.weapon.name} CACHE +100`);
            this.audio.playPickup('grenade');
          }
        } else if (pickup.type === 'armor') {
          const applied = this.player.applyArmorUpgrade();
          if (applied) {
            this.stats.score += 150;
            this.ui.setScore(this.stats.score);
            this.ui.announce(
              'ARMOR UPGRADE',
              `PLATE ${this.player.armorTier}/${SETTINGS.progression.maxArmorTier} — MAX VITALS ${this.player.maxHealth}`,
              2.8
            );
            this.ui.toast(
              `${Math.round(this.player.armorDamageReduction * 100)}% INCOMING DAMAGE REDUCTION`,
              'health'
            );
            this.audio.playPickup('weapon');
            this.particles.spawnMuzzle(
              new THREE.Vector3(pickup.position.x, 1.1, pickup.position.z),
              new THREE.Vector3(0, 0, 1)
            );
            this._refreshProgressionUI();
            this.effects.flashDamage(0.05);
          } else {
            this.stats.score += 100;
            this.ui.toast('ARMOR ALREADY MAXED +100', 'health');
            this.audio.playPickup('grenade');
          }
        } else if (pickup.type === 'calibration') {
          const applied = this.player.applyWeaponUpgrade();
          if (applied) {
            this.stats.score += 150;
            this.ui.setScore(this.stats.score);
            this.ui.announce(
              'WEAPON CALIBRATION',
              `FIREPOWER +${Math.round((this.player.weaponDamageMultiplier - 1) * 100)}%`,
              2.8
            );
            this.ui.toast('ALL WEAPONS HIT HARDER', 'health');
            this.audio.playPickup('weapon');
            this.particles.spawnMuzzle(
              new THREE.Vector3(pickup.position.x, 1.1, pickup.position.z),
              new THREE.Vector3(0, 0, 1)
            );
            this._refreshProgressionUI();
          } else {
            this.stats.score += 100;
            this.ui.toast('CALIBRATION ALREADY MAXED +100', 'health');
            this.audio.playPickup('grenade');
          }
        } else {
          const added = this.player.addGrenades(2);
          if (added > 0) {
            this.ui.toast(`+${added} FRAG GRENADES`);
            this.ui.setGrenades(this.player.grenades);
          } else {
            this.stats.score += 75;
            this.ui.toast('+75 FIELD BONUS');
          }
          this.audio.playPickup('grenade');
          this.particles.spawnMuzzle(
            new THREE.Vector3(pickup.position.x, 0.7, pickup.position.z),
            new THREE.Vector3(0, 0, 1)
          );
        }
        this._removePickup(pickup);
      }
    }
    this.pickups = this.pickups.filter((pickup) => pickup.active);
  }

  _pickWeaponDrop(candidates) {
    if (!candidates.length) return null;
    let total = 0;
    const weighted = candidates.map((weapon) => {
      const weight = weapon.joke ? 0.38 : 1;
      total += weight;
      return { weapon, weight };
    });
    let roll = Math.random() * total;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.weapon;
    }
    return candidates[candidates.length - 1];
  }

  _rollDrops(enemy) {
    const position = enemy.position;
    if (enemy.type === 'truck') {
      const candidates = this.player.getWeaponDropCandidates();
      const drop = this._pickWeaponDrop(candidates);
      if (drop && chance(0.85)) {
        this._spawnPickup(
          'weapon',
          position.x + rand(-1.8, 1.8),
          position.z + rand(-1.6, 1.8),
          { weaponId: drop.id }
        );
      }
      for (let i = 0; i < 2; i++) {
        this._spawnPickup('health', position.x + rand(-2.4, 2.4), position.z + rand(-1.6, 2.4));
        this._spawnPickup('grenade', position.x + rand(-2.4, 2.4), position.z + rand(-1.6, 2.4));
      }
      if (
        this.player.armorTier < SETTINGS.progression.maxArmorTier &&
        chance(0.8)
      ) {
        this._spawnPickup('armor', position.x + rand(-1.8, 1.8), position.z + rand(-1.2, 1.8));
      }
      if (
        this.player.damageTier < SETTINGS.progression.maxDamageTier &&
        chance(0.75)
      ) {
        this._spawnPickup('calibration', position.x + rand(-1.8, 1.8), position.z + rand(-1.2, 1.8));
      }
      return;
    }
    if (enemy.type === 'officer') {
      const candidates = this.player.getWeaponDropCandidates();
      const drop = this._pickWeaponDrop(candidates);
      if (drop && chance(0.42)) {
        this._spawnPickup(
          'weapon',
          position.x + rand(-1.4, 1.4),
          position.z + rand(-1, 1),
          { weaponId: drop.id }
        );
      }
      if (chance(0.9)) {
        this._spawnPickup(chance(0.55) ? 'health' : 'grenade', position.x + rand(-1, 1), position.z);
      }
      if (chance(0.35)) {
        this._spawnPickup('grenade', position.x + rand(-1.4, 1.4), position.z + rand(-1, 1));
      }
      if (
        this.player.damageTier < SETTINGS.progression.maxDamageTier &&
        chance(0.2)
      ) {
        this._spawnPickup('calibration', position.x + rand(-1, 1), position.z + rand(-1, 1));
      }
    } else if (enemy.type === 'heavy') {
      if (chance(0.65)) {
        this._spawnPickup(chance(0.6) ? 'health' : 'grenade', position.x, position.z);
      }
    } else if (enemy.type === 'mortar') {
      if (chance(0.45)) this._spawnPickup('grenade', position.x, position.z + rand(-1, 1));
    } else if (enemy.type !== 'truck' && chance(0.23)) {
      this._spawnPickup(chance(0.66) ? 'health' : 'grenade', position.x, position.z);
    }
  }

  /* ------------------------------------------------------------------------
     Kills, combo, mission state
     ------------------------------------------------------------------------ */

  recordShot(count = 1) {
    this.stats.shots += count;
  }

  _comboMultiplier() {
    return Math.min(5, 1 + Math.floor(this.combo / 3));
  }

  onEnemyKilled(enemy) {
    this.stats.kills++;
    this.combo++;
    this.comboTimer = 3.1;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    const multiplier = this._comboMultiplier();
    this.stats.score += enemy.scoreValue * multiplier;
    this.ui.setScore(this.stats.score);
    this.ui.setKills(this.stats.kills);
    this.ui.setBestScore(Math.max(this.best, this.stats.score));
    if (this.combo >= 3) this.ui.setCombo(this.combo, multiplier);
    this._rollDrops(enemy);

    if (enemy.type === 'truck') {
      this.ui.hideBoss();
      this.boss = null;
      const label = enemy.displayName || 'COMMAND TRUCK';
      this.ui.announce('ARMORED THREAT', `${label} DESTROYED`, 2.8);
      this.stats.score += 250;
      this.ui.setScore(this.stats.score);
      this.ui.setBestScore(Math.max(this.best, this.stats.score));
      // Explosion shockwave can kill nearby infantry and hurt the player.
      const position = enemy.position;
      for (const other of this.enemies) {
        if (!other.alive || other === enemy) continue;
        const distance = Math.hypot(other.position.x - position.x, other.position.z - position.z);
        if (distance < 7.2) {
          other.takeDamage(
            160 * (1 - clamp01(distance / 7.2) * 0.6),
            new THREE.Vector3(other.position.x, 1.1, other.position.z),
            null
          );
        }
      }
      if (this.player.alive) {
        const distance = Math.hypot(this.player.position.x - position.x, this.player.position.z - position.z);
        if (distance < 7.2) {
          this._damagePlayer(
            45 * (1 - clamp01(distance / 7.2) * 0.6),
            position,
            position
          );
        }
      }
    } else if (this.combo > 0 && this.combo % 8 === 0) {
      this.ui.toast(`KILL CHAIN ×${multiplier}`, 'health');
    }
  }

  _updateCombo(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.ui.hideCombo();
      }
    }
  }

  _updateBossBar() {
    const truck = this.enemies.find((enemy) => enemy.alive && enemy.type === 'truck');
    if (truck) {
      if (this.boss !== truck) {
        this.boss = truck;
        this.ui.showBoss(truck.displayName || 'ARMORED COMMAND TRUCK');
      }
      this.ui.setBossHealth(truck.health / truck.maxHealth);
    } else if (this.boss) {
      this.boss = null;
      this.ui.hideBoss();
    }
    const threat = this.threatTier || 1;
    if (truck) {
      this.ui.setObjective(
        `DESTROY THE ${truck.displayName || 'ARMORED COMMAND TRUCK'}`
      );
    } else if (threat >= 9) {
      this.ui.setObjective(`THREAT TIER ${threat} — SURVIVE THE ESCALATION`);
    } else if (threat >= 6) {
      this.ui.setObjective(`THREAT TIER ${threat} — KEEP THE LINE MOVING`);
    } else if (threat >= 3) {
      this.ui.setObjective(`THREAT TIER ${threat} — PUSH DEEPER`);
    } else {
      this.ui.setObjective('RUN AS DEEP AS YOU CAN');
    }
  }

  _checkRunProgress() {
    for (const marker of RUN_ANNOUNCEMENTS) {
      if (this.player.position.z >= marker.z && !this.announced.has(`z${marker.z}`)) {
        this.announced.add(`z${marker.z}`);
        this.ui.announce(marker.kicker, marker.text, 2.9, marker.tone);
      }
    }
    if (this.threatTier > (this.lastThreatTier || this.threatTier)) {
      this.ui.announce(
        'THREAT ESCALATION',
        `TIER ${this.threatTier} — PRESSURE INCREASING`,
        2.8,
        'danger'
      );
      this.ui.toast('ENEMY SPEED AND SPAWN RATE RISING', 'danger');
    }
    this.lastThreatTier = this.threatTier;
    if (!this.announced.has('first-contact') && this.player.position.z > 35) {
      this.announced.add('first-contact');
      this.ui.announce('CONTACT', 'HOSTILES IN THE TREELINE', 2.4, 'danger');
    }
  }

  endMission(victory = false) {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.state = GAME_STATE.ENDED;
    this.input.clear();
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.reticle.visible = false;
    this.ui.setCrosshairVisible(false);

    this.audio.playJingle(false);
    this.stats.distance = Math.max(0, this.player.position.z);
    this.stats.accuracy =
      this.stats.shots > 0 ? (this.stats.hits / this.stats.shots) * 100 : 0;
    this.best = Math.max(this.best, this.stats.score);
    this.bestDistance = Math.max(this.bestDistance, this.stats.distance);
    this.stats.best = this.best;
    this.stats.bestDistance = this.bestDistance;
    safeStorageSet(SETTINGS.storageKeys.best, String(this.best));
    safeStorageSet(
      SETTINGS.storageKeys.bestDistance,
      String(Math.round(this.bestDistance))
    );
    this.ui.setBestScore(this.best);
    this.ui.setBestDistance(this.bestDistance);
    this.ui.showEnd(this.stats, false);
    this._startMenuMusic();
    this.audio.setIntensity(0.3);
    this.audio.setDucked(false);
    this.stats.ended = true;
  }

  onPlayerHealthChanged() {
    this.ui.setHealth(Math.max(0, this.player.health), this.player.maxHealth);
    const low =
      this.player.alive &&
      this.player.health <= this.player.maxHealth * 0.3;
    this.effects.setLowHealth(low);
  }

  onPlayerDied() {
    this.stats.deaths++;
    this.lives = Math.max(0, this.lives - 1);
    this.ui.setLives(this.lives);
    this.combo = 0;
    this.comboTimer = 0;
    this.ui.hideCombo();
    this.ui.setHealth(0, this.player.maxHealth);
    this.ui.setBraced(false);
    this.ui.setCover(false);
    this.effects.setLowHealth(false);
    if (this.lives > 0) {
      this.respawnTimer = SETTINGS.player.respawnDelay;
      this.endTimer = 0;
      this.ui.announce('MAN DOWN', 'REINFORCEMENTS INBOUND', 2.4, 'danger');
    } else {
      this.respawnTimer = 0;
      this.endTimer = 2.2;
      this.ui.announce('SIGNAL LOST', 'NO REINFORCEMENTS REMAINING', 2.2, 'danger');
    }
  }

  _updateTimers(dt) {
    if (!this.player.alive) {
      if (this.respawnTimer > 0) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this._respawnPlayer();
      } else if (this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) {
          this.endMission(false);
          return;
        }
      }
    }
  }

  _respawnPlayer() {
    const safe = this.terrain.findSpawnNear(0, this.scroll + 3, 0.7);
    this.player.respawn(clamp(safe.z, this.scroll - 1, this.scroll + 4), safe.x);
    this.player.invulnerability = 2.1;
    this.bullets.clear();
    this.grenades.clear();
    this.input.clear();
    this.effects.reset();
    this.ui.setLives(this.lives);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.announce('BACK IN THE FIGHT', 'THE LINE HOLDS — KEEP MOVING', 2.2);
    this.audio.setIntensity(0.6);
    this.particles.spawnDust(this.player.position, 1.4, 0.3);
  }

  /* ------------------------------------------------------------------------
     Ambience + radar data
     ------------------------------------------------------------------------ */

  _updateMotes(dt) {
    this.moteTimer -= dt;
    if (this.moteTimer > 0) return;
    this.moteTimer = 0.13;
    this.particles.spawnMote(
      new THREE.Vector3(
        this.player.position.x + rand(-17, 17),
        rand(0.8, 7.5),
        this.player.position.z + rand(-8, 22)
      )
    );
  }

  _updateEnvironment(dt, snap = false) {
    const biome = this.terrain.getBiome(this.player.position.z);
    const changed = biome.id !== this.currentBiomeId;
    this.weather.setBiome(biome);
    this.weather.update(dt, this.player.position);
    this.lighting.setMood(biome, snap);

    const k = snap ? 1 : 1 - Math.exp(-0.9 * dt);
    this.fogColorTarget.setHex(biome.fog.color);
    this.backgroundTarget.setHex(biome.fog.background);
    this.scene.fog.color.lerp(this.fogColorTarget, k);
    this.scene.background.lerp(this.backgroundTarget, k);
    this.scene.fog.density = lerp(this.scene.fog.density, biome.fog.density, k);

    if (changed) {
      this.currentBiomeId = biome.id;
      if (!snap && this.state === GAME_STATE.PLAYING) {
        this.ui.announce(biome.entryKicker, biome.entryText, 3.1);
        this.ui.toast(`${biome.label} // ${biome.weather.toUpperCase()}`, 'health');
      }
    }
  }

  _updateAmbient(dt) {
    const playerZ = this.player.position.z;
    for (const source of this.terrain.getSmokeSources()) {
      if (Math.abs(source.z - playerZ) > 60) continue;
      source.timer -= dt;
      if (source.timer <= 0) {
        source.timer = source.rate;
        this.particles.spawnSmokeColumn(
          new THREE.Vector3(source.x, 0.3, source.z),
          source.large,
          Boolean(source.green)
        );
        if (!source.green && chance(0.35)) {
          this.particles.spawnEmber(
            new THREE.Vector3(source.x, 0.6, source.z),
            1.1
          );
        }
      }
    }

    this.warAmbienceTimer -= dt;
    if (this.warAmbienceTimer <= 0) {
      this.warAmbienceTimer = rand(9, 19);
      this.audio.playDistantWar(
        new THREE.Vector3(
          rand(-35, 35),
          1,
          playerZ + rand(18, 40)
        )
      );
    }
  }

  _getRadarData() {
    return {
      player: {
        x: this.player.position.x,
        z: this.player.position.z,
        aimX: this.player.aimDirection.x,
        aimZ: this.player.aimDirection.z,
      },
      enemies: this.enemies,
      pickups: this.pickups,
      scrollZ: this.scroll,
      rivers: this.terrain.rivers,
    };
  }
}

/* --------------------------------------------------------------------------
   Bootstrap
   -------------------------------------------------------------------------- */

async function boot() {
  const canvas = document.querySelector('#game-canvas');
  const ui = {
    setBootProgress: null,
    hideBoot: null,
    showError: null,
  };
  const bootDom = {
    progress: document.querySelector('#boot-progress'),
    status: document.querySelector('#boot-status'),
    screen: document.querySelector('#boot-screen'),
    error: document.querySelector('#error-screen'),
    errorMessage: document.querySelector('#error-message'),
  };

  const setProgress = (value, label) => {
    if (bootDom.progress) bootDom.progress.style.width = `${clamp01(value) * 100}%`;
    if (label && bootDom.status) bootDom.status.textContent = label;
  };
  const showBootError = (message) => {
    bootDom.screen?.classList.add('is-hidden');
    bootDom.error?.classList.remove('is-hidden');
    if (bootDom.errorMessage) bootDom.errorMessage.textContent = message;
  };
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const audio = new AudioManager();
    let game = null;

    const uiManager = new UIManager({
      onStart: () => game?.beginMission(),
      onResume: () => game?.resumeGame(),
      onRestart: () => game?.beginMission(),
      onMenu: () => game?.abandonToMenu(),
      onEndMenu: () => game?.abandonToMenu(),
      onToggleSound: () => game?.toggleSound(),
      onToggleCrt: () => game?.toggleCrtFilter(),
      onVolume: (value) => game?.setVolume(value),
      onUiClick: () => audio.playUiClick(),
      getVolume: () => audio.masterVolume,
      isMuted: () => audio.muted,
      getCrtEnabled: () => game?.crtEnabled ?? true,
    });

    setProgress(0.06, 'INITIALISING RENDER PIPELINE');
    await nextFrame();

    const engine = new Engine(canvas);
    const input = new InputManager(canvas);
    const assets = new AssetLoader();

    setProgress(0.16, LOADING_COPY[0]);
    await assets.preload(ASSET_MANIFEST, (progress, label) => {
      setProgress(0.16 + progress * 0.14, label || LOADING_COPY[1]);
    });

    setProgress(0.34, LOADING_COPY[1]);
    await nextFrame();
    const terrain = new TerrainManager(engine.scene);

    setProgress(0.55, LOADING_COPY[2]);
    await nextFrame();
    const lighting = new DynamicLighting(engine.scene);
    const particles = new ParticleSystem(engine.scene);
    const effects = new ScreenEffects(engine);
    const weather = new WeatherSystem(engine.scene, { audio, effects, lighting });

    setProgress(0.7, LOADING_COPY[3]);
    await nextFrame();
    particles.setViewportHeight(
      engine.renderer.domElement.height || window.innerHeight
    );

    game = new Game({
      engine,
      input,
      audio,
      assets,
      ui: uiManager,
      terrain,
      lighting,
      particles,
      effects,
      weather,
    });

    window.__COMMANDO__ = game;

    setProgress(0.92, LOADING_COPY[4]);
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    setProgress(1, 'READY TO DEPLOY');
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    uiManager.hideBoot();
    game.showMenu();
    game.startLoop();
    uiManager.setAudioMuted(audio.muted);
    uiManager.setVolumeUI(audio.masterVolume);
  } catch (error) {
    console.error('[COMMANDO] Boot failure', error);
    showBootError(
      error?.message
        ? `Renderer failed to initialise: ${error.message}`
        : 'Unable to initialise the battlefield renderer.'
    );
  }
}

boot();
