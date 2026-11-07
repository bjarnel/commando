import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { InputManager } from './core/InputManager.js';
import { AudioManager } from './core/AudioManager.js';
import { AssetLoader } from './core/AssetLoader.js';
import { Player } from './entities/Player.js';
import { Officer, OfficerTruck, MortarTeam, Rifleman, HeavyGunner } from './entities/Enemy.js';
import { BulletSystem } from './entities/Bullet.js';
import { GrenadeSystem } from './entities/Grenade.js';
import { TerrainManager } from './environment/TerrainManager.js';
import { DynamicLighting } from './environment/DynamicLighting.js';
import { ParticleSystem } from './fx/ParticleSystem.js';
import { ScreenEffects } from './fx/ScreenEffects.js';
import { WeatherSystem } from './fx/WeatherSystem.js';
import { UIManager } from './ui/UIManager.js';
import { SETTINGS, GAME_STATE } from './config/settings.js';
import { ASSET_MANIFEST, LOADING_COPY } from './config/assets.js';
import { WEAPONS, WEAPON_BY_ID, WEAPON_CACHES } from './config/weapons.js';
import { getWeaponVisual } from './entities/WeaponModels.js';
import { clamp, clamp01, lerp, rand, chance, pick } from './utils/math.js';
import { getGlowTexture } from './utils/textures.js';

const EXTRACTION_Z = SETTINGS.mission.extractionZ;

const PROGRESS_ANNOUNCEMENTS = [
  { z: 190, kicker: 'CONTACT', text: 'ENEMY MORTARS IN THE TREELINE', tone: 'danger' },
  { z: 1375, kicker: 'EXTRACTION', text: 'LZ DELTA AHEAD — GET TO THE PAD', tone: '' },
];

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
    this.aimWorld = new THREE.Vector3(0, 0, 12);
    this.aimAssistTarget = null;
    this._screenPoint = { x: 0, y: 0 };
    this._projectionPoint = new THREE.Vector3();
    this.enemies = [];
    this.pickups = [];
    this.boss = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.lives = SETTINGS.player.lives;
    this.best = Number(safeStorageGet(SETTINGS.storageKeys.best, '0')) || 0;
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.warAmbienceTimer = rand(5, 12);
    this.menuParticleTimer = 0;
    this.moteTimer = 0;
    this.lastGamepadState = false;
    this.stats = this._createStats();
    this.truckMilestones = [...SETTINGS.difficulty.truckMilestones];
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
    this._updateParticlesViewport();
    this.resetRun();
    this.player.rig.root.visible = true;
    this.state = GAME_STATE.MENU;

    this.engine.onResize = () => this._updateParticlesViewport();
  }

  _createStats() {
    return {
      score: 0,
      kills: 0,
      deaths: 0,
      shots: 0,
      hits: 0,
      grenadesThrown: 0,
      damageTaken: 0,
      maxCombo: 0,
      time: 0,
      distance: 0,
      accuracy: 0,
      best: 0,
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
      ringGeometry: new THREE.RingGeometry(0.42, 0.5, 24),
    };
  }

  _initReticle() {
    this.reticle = new THREE.Group();
    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc47a,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.reticleInnerMaterial = this.reticleMaterial.clone();
    this.reticleInnerMaterial.color.setHex(0xffe1b1);
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
    this.bullets.clear();
    this.grenades.clear();
    this._clearPickups();
    this.particles.clear();
    this.terrain.reset();
    this.effects.reset();
    this.player.reset(SETTINGS.mission.startZ, 0);
    this.player.resetLoadout();
    this.player.rig.root.visible = true;

    this.scroll = 0;
    this.engine.scroll = 0;
    this.aimWorld.set(0, 0, 12);
    this.aimAssistTarget = null;
    this.currentBiomeId = null;
    this.weather?.reset();
    this.lives = SETTINGS.player.lives;
    this.combo = 0;
    this.comboTimer = 0;
    this.stats = this._createStats();
    this.stats.best = this.best;
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.boss = null;
    this.truckMilestones = [...SETTINGS.difficulty.truckMilestones];
    this.announced = new Set();
    this.director = {
      regular: 1.4,
      mortar: 9,
      officer: 18,
      trucksUsed: new Set(),
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
    this.ui.setMission(
      this.player.position.z,
      EXTRACTION_Z,
      this.terrain.getBiome(this.player.position.z).phase
    );
    this.ui.setObjective('ADVANCE TO THE EXTRACTION ZONE');
    this.ui.hideBoss();
    this.ui.hideCombo();
    this.ui.hideBanner();
    this.ui.setLowHealth(false);
    this.effects.setLowHealth(false);
    this.refreshWeaponUI();
    this._spawnWeaponCaches();
    this._updateEnvironment(0.016, true);
  }

  refreshWeaponUI() {
    this.ui.setWeapons(
      Array.from(this.player.unlockedWeapons).sort((a, b) => a - b),
      this.player.weaponSlot
    );
  }

  _spawnWeaponCaches() {
    for (const cache of WEAPON_CACHES) {
      const closest = this.terrain.findSpawnNear(
        this.terrain.getRoadX(cache.z) + cache.side * 5.4,
        cache.z,
        1.2
      );
      this._spawnPickup('weapon', closest.x, closest.z, {
        weaponId: cache.weaponId,
      });
    }
  }

  showMenu() {
    this.state = GAME_STATE.MENU;
    this.input.clear();
    this.audio.stopMusic();
    this.audio.setDucked(false);
    this.audio.setIntensity(0.14);
    this.aimWorld.set(0, 0, 12);
    this.reticle.visible = false;
    this.ui.showStartScreen(this.best);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setLives(this.lives);
    this.ui.setScore(0);
    this.player.rig.root.visible = true;
  }

  beginMission() {
    this.resetRun();
    this.state = GAME_STATE.PLAYING;
    this.ui.beginRun();
    this.ui.setBestScore(this.best);
    this.ui.announce('MISSION UPDATE', 'ADVANCE TO THE EXTRACTION ZONE', 3.1);
    this.ui.toast('MACHINE GUN READY', 'health');
    this.input.clear();
    this.effects.reset();
    this.audio.init().then((ok) => {
      if (!ok) return;
      this.audio.setMuted(this.audio.muted);
      this.audio.setVolume(this.audio.masterVolume);
      if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.PAUSED) {
        this.audio.startMusic();
        this.audio.setDucked(this.state === GAME_STATE.PAUSED);
        this.audio.setIntensity(0.55);
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
    this.audio.stopMusic();
    this.audio.setDucked(false);
    this.resetRun();
    this.showMenu();
  }

  toggleSound() {
    const muted = this.audio.setMuted(!this.audio.muted);
    this.ui.setAudioMuted(muted);
    if (!muted) {
      this.audio.init().then(() => {
        if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.PAUSED) {
          this.audio.startMusic();
          this.audio.setDucked(this.state === GAME_STATE.PAUSED);
        }
      });
    }
  }

  setVolume(value) {
    this.audio.setVolume(value);
    this.ui.setVolumeUI(value);
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

    if (this.input.consume('grenade')) {
      this.player.throwGrenade(this.aimWorld);
    }

    this.player.update(dt);

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
        EXTRACTION_Z + 10
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
    this._resolveEntitySeparation();

    this.bullets.update(dt, {
      player: this.player,
      enemies: this.enemies,
      onPlayerHit: (damage, hitPosition, origin) => {
        this.stats.damageTaken += damage;
        this.player.takeDamage(damage, hitPosition, origin);
      },
      onEnemyHit: (enemy, damage, hitPosition, origin, bullet) => {
        const hitDirection = bullet?.direction
          ? bullet.direction.clone()
          : new THREE.Vector3(0, 0, 1);
        const wasAlive = enemy.alive;
        const hit = enemy.takeDamage(damage, hitPosition, origin, hitDirection);
        if (hit && wasAlive) {
          this.stats.hits++;
          this.effects.showHitmarker(!enemy.alive);
          this.audio.playHitmarker(!enemy.alive);
        }
      },
      onBarrelHit: (barrel, hitPosition, bullet) => {
        this._damageBarrel(barrel, bullet?.damage || 16, hitPosition);
      },
    });

    this.grenades.update(dt, {
      enemies: this.enemies,
      onExplosion: (payload) => this._handleExplosion(payload),
    });

    this._updateDirector(dt);
    this._updatePickups(dt);
    this._updateTimers(dt);
    this._updateAmbient(dt);
    this._updateCombo(dt);
    this._updateBossBar();

    const distance = Math.max(0, this.player.position.z);
    this.stats.distance = distance;
    this.ui.setMission(
      distance,
      EXTRACTION_Z,
      this.terrain.getBiome(this.player.position.z).phase
    );
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setGrenades(this.player.grenades);
    this.ui.setKills(this.stats.kills);
    this.ui.setScore(this.stats.score);

    this._updateReticle(dt);
    this._checkMissionProgress();
    if (this.state !== GAME_STATE.PLAYING) {
      // End of mission may have been triggered above. Still render one frame
      // with the final camera state.
      this._finishFrame(dt);
      return;
    }

    this._checkVictory();
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
      if (this.player.health <= 30) intensity += 0.05;
      this.audio.setIntensity(clamp(intensity, 0.36, 1));
    } else {
      this.audio.setIntensity(0.25);
    }

    this.audio.update(dt);
    this.ui.update(dt);
    this.ui.updateRadar(dt, this._getRadarData());
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

    const color = overEnemy ? 0xff6b46 : 0xffc47a;
    this.reticleMaterial.color.setHex(color);
    this.reticleInnerMaterial.color.setHex(overEnemy ? 0xffb08b : 0xffe1b1);
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
      if (enemy.alive && (enemy.type === 'rifleman' || enemy.type === 'heavy')) {
        count++;
      }
    }
    return count;
  }

  _difficulty() {
    return clamp(this.player.position.z / 1250, 0, 1);
  }

  _updateDirector(dt) {
    const difficulty = this._difficulty();
    const scroll = this.scroll;
    const activeTruck = this.enemies.find((enemy) => enemy.alive && enemy.type === 'truck');

    this.director.regular -= dt;
    if (this.director.regular <= 0 && this._activeInfantryCount() < SETTINGS.difficulty.maxInfantry) {
      const groupSize = 1 + Math.min(2, Math.floor(this.player.position.z / 430));
      const count = activeTruck ? Math.max(1, groupSize - 1) : groupSize;
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
        const canSpawnHeavy =
          this._activeCount('heavy') < 2 &&
          this.player.position.z > 540 &&
          (biomeId === 'desert' || biomeId === 'city' || biomeId === 'snow');
        const heavyChance = canSpawnHeavy ? 0.11 + difficulty * 0.08 : 0;
        const EnemyClass = chance(heavyChance) ? HeavyGunner : Rifleman;
        this._spawnEnemy(EnemyClass, {
          x: spawn.x,
          z: spawn.z,
          difficulty,
          biomeId,
        }, spawn.spot);
      }
      const interval = clamp(
        SETTINGS.difficulty.baseSpawnInterval -
          difficulty * 1.15 +
          rand(-0.35, 0.4),
        SETTINGS.difficulty.minSpawnInterval,
        3.2
      );
      this.director.regular = interval;
    }

    if (this.player.position.z > SETTINGS.difficulty.mortarUnlockZ) {
      this.director.mortar -= dt;
      if (this.director.mortar <= 0 && this._activeCount('mortar') < SETTINGS.difficulty.maxMortars) {
        const spawn = this.terrain.findSpawnPoint(scroll + 28, scroll + 32, {
          radius: 1.2,
        });
        this._spawnEnemy(MortarTeam, {
          x: clamp(spawn.x, -SETTINGS.mission.width + 3, SETTINGS.mission.width - 3),
          z: spawn.z,
          difficulty,
        });
        this.director.mortar = rand(13, 22);
        if (!this.announced.has('mortar')) {
          this.announced.add('mortar');
          this.ui.announce('NEW THREAT', 'ENEMY MORTAR TEAM SPOTTED', 3, 'danger');
          this.ui.toast('WATCH THE RED TARGET MARKERS', 'danger');
        }
      }
    }

    if (this.player.position.z > SETTINGS.difficulty.officerUnlockZ) {
      this.director.officer -= dt;
      if (this.director.officer <= 0 && this._activeCount('officer') < SETTINGS.difficulty.maxOfficers) {
        const spawn = this.terrain.findSpawnPoint(scroll + 29, scroll + 33, {
          radius: 0.8,
          preferCover: chance(0.35),
        });
        this._spawnEnemy(Officer, {
          x: spawn.x,
          z: spawn.z,
          difficulty,
        }, spawn.spot);
        for (let i = 0; i < 2; i++) {
          const escort = this.terrain.findSpawnPoint(scroll + 30, scroll + 34, { radius: 0.8 });
          this._spawnEnemy(Rifleman, {
            x: escort.x,
            z: escort.z,
            difficulty,
          }, escort.spot);
        }
        this.director.officer = rand(24, 36);
      }
    }

    // Truck milestones.
    const activeTruckCount = this.enemies.filter((enemy) => enemy.alive && enemy.type === 'truck').length;
    if (activeTruckCount === 0) {
      for (let i = 0; i < this.truckMilestones.length; i++) {
        const milestone = this.truckMilestones[i];
        if (
          !this.director.trucksUsed.has(i) &&
          this.player.position.z >= milestone - 170
        ) {
          this.director.trucksUsed.add(i);
          const x = rand(-4, 4);
          const z = Math.min(scroll + 30, EXTRACTION_Z - 24);
          this._spawnEnemy(OfficerTruck, { x, z, difficulty }, null, true);
          break;
        }
      }
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
      this.ui.showBoss('ARMORED COMMAND TRUCK');
      this.ui.announce('ARMORED RESPONSE', 'COMMAND TRUCK INBOUND', 3.2, 'danger');
      this.audio.playDistantWar(enemy.position);
    }
    return enemy;
  }

  spawnTruckInfantry(position) {
    if (this._activeInfantryCount() >= SETTINGS.difficulty.maxInfantry) return;
    const count = chance(0.5) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const spot = this.terrain.findSpawnNear(position.x + rand(-2.2, 2.2), position.z + rand(-1.5, 1.5), 0.7);
      const enemy = new Rifleman(this, {
        x: spot.x,
        z: spot.z,
        difficulty: this._difficulty(),
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

  _damageBarrel(barrel, damage, hitPosition) {
    if (!barrel.alive) return;
    barrel.health -= damage;
    this.particles.spawnImpact(
      hitPosition || new THREE.Vector3(barrel.x, 1, barrel.z),
      0xffc167,
      new THREE.Vector3(0, 0, 1),
      0.9
    );
    this.audio.playRicochet(hitPosition || new THREE.Vector3(barrel.x, 1, barrel.z));
    if (barrel.health <= 0) this._detonateBarrel(barrel);
  }

  _detonateBarrel(barrel) {
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
    const playerDistance = Math.hypot(
      this.player.position.x - barrel.x,
      this.player.position.z - barrel.z
    );
    if (playerDistance < 6.2 && this.player.alive) {
      const falloff = 1 - clamp01(playerDistance / 6.2) * 0.7;
      this.player.takeDamage(34 * falloff, position, null);
    }

    for (const other of this.terrain.barrels) {
      if (!other.alive || other === barrel) continue;
      if (Math.hypot(other.x - barrel.x, other.z - barrel.z) < 5.5) {
        this._detonateBarrel(other);
      }
    }
  }

  _handleExplosion(payload) {
    const position = new THREE.Vector3(payload.x, 0.55, payload.z);
    const scale = payload.mode === 'mortar' ? 0.95 : 1.25;
    this.particles.spawnExplosion(position, scale);
    this.lighting.explosion(position, 0xff9a46, payload.mode === 'mortar' ? 760 : 980, 38, 0.72);
    this.effects.explosionShake(position, this.player.position, payload.mode === 'mortar' ? 1.1 : 1.4);
    this.audio.playExplosion(position, scale);
    this.terrain.addScorch(position, rand(5.5, 8.5) * scale);

    const radius = payload.radius;
    // Enemy mortar fire hurts the player and chain-detonates barrels, but does
    // not wipe out its own platoon.
    if (payload.mode !== 'mortar') {
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
    }

    const pdx = this.player.position.x - payload.x;
    const pdz = this.player.position.z - payload.z;
    const playerDistance = Math.hypot(pdx, pdz);
    if (playerDistance < radius && this.player.alive) {
      const falloff = 1 - clamp01(playerDistance / radius) * 0.7;
      if (payload.mode === 'mortar') {
        this.player.takeDamage(
          payload.damage * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          null
        );
      } else if (playerDistance < radius * 0.9) {
        this.player.takeDamage(
          SETTINGS.grenade.selfDamage * falloff,
          new THREE.Vector3(this.player.position.x, 1.1, this.player.position.z),
          null
        );
      }
    }

    for (const barrel of this.terrain.barrels) {
      if (!barrel.alive) continue;
      if (Math.hypot(barrel.x - payload.x, barrel.z - payload.z) < radius) {
        this._detonateBarrel(barrel);
      }
    }
  }

  _spawnPickup(type, x, z, extra = {}) {
    if (this.pickups.filter((pickup) => pickup.active).length > 18) {
      const oldest = this.pickups.find((pickup) => pickup.active);
      if (oldest) this._removePickup(oldest);
    }
    const assets = this.pickupAssets;
    const group = new THREE.Group();
    const isHealth = type === 'health';
    const isWeapon = type === 'weapon';
    const weapon = isWeapon ? WEAPON_BY_ID.get(extra.weaponId) : null;

    const box = new THREE.Mesh(assets.box, assets.crateMaterial);
    box.position.y = 0.28;
    box.castShadow = true;
    group.add(box);
    const band = new THREE.Mesh(assets.band, assets.bandMaterial);
    band.position.y = 0.28;
    group.add(band);

    if (isHealth) {
      const crossA = new THREE.Mesh(assets.crossA, assets.healthMaterial);
      crossA.position.y = 0.48;
      group.add(crossA);
      const crossB = new THREE.Mesh(assets.crossB, assets.healthMaterial);
      crossB.position.y = 0.48;
      group.add(crossB);
    } else if (!isWeapon) {
      for (let i = 0; i < 3; i++) {
        const grenade = new THREE.Mesh(assets.grenadeGeo, assets.grenadeMaterial);
        grenade.position.set((i - 1) * 0.16, 0.48, 0);
        group.add(grenade);
      }
    }

    const ring = new THREE.Mesh(
      assets.ringGeometry,
      isHealth ? assets.healthRing : isWeapon ? assets.weaponRing : assets.grenadeRing
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const beam = new THREE.Mesh(
      assets.beamGeometry,
      isHealth
        ? assets.beamHealthMaterial
        : isWeapon
          ? assets.weaponBeamMaterial
          : assets.beamGrenadeMaterial
    );
    beam.position.y = 1.25;
    group.add(beam);

    const glow = new THREE.Sprite(
      isHealth ? assets.healthGlow : isWeapon ? assets.weaponGlow : assets.grenadeGlow
    );
    glow.position.y = 0.75;
    glow.scale.set(isWeapon ? 3.8 : 3.2, isWeapon ? 3.8 : 3.2, 1);
    group.add(glow);

    let icon;
    if (isWeapon && weapon) {
      const gun = getWeaponVisual(weapon.id).mesh;
      gun.scale.setScalar(0.8);
      gun.position.set(0, 1.45, 0.05);
      gun.rotation.set(0, 0.3, 0);
      icon = gun;
    } else {
      icon = new THREE.Mesh(
        assets.iconGeometry,
        isHealth ? assets.iconHealthMaterial : assets.iconGrenadeMaterial
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
      iconBaseY: isWeapon ? 1.45 : 1.7,
      weaponId: weapon?.id ?? null,
      weapon,
      lifetime: isWeapon ? Infinity : 42,
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
          const slot = pickup.weapon.slot;
          const newlyUnlocked = this.player.unlockWeapon(pickup.weapon.id);
          if (newlyUnlocked) {
            this.player.switchWeapon(slot);
            this.ui.announce('FIELD ARMORY', `${pickup.weapon.unlockText} ACQUIRED`, 2.8);
            this.ui.toast(`PRESS ${slot} TO EQUIP ${pickup.weapon.name}`, 'health');
            this.ui.setScore(this.stats.score);
            this.audio.playPickup('weapon');
            this.particles.spawnMuzzle(
              new THREE.Vector3(pickup.position.x, 1.2, pickup.position.z),
              new THREE.Vector3(0, 0, 1)
            );
          } else {
            this.stats.score += 100;
            this.ui.setScore(this.stats.score);
            this.ui.setBestScore(Math.max(this.best, this.stats.score));
            this.ui.toast(`${pickup.weapon.name} CACHE +100`);
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

  _rollDrops(enemy) {
    const position = enemy.position;
    if (enemy.type === 'truck') {
      const locked = this.player.getLockedWeapons();
      if (locked.length && chance(0.85)) {
        this._spawnPickup(
          'weapon',
          position.x + rand(-1.8, 1.8),
          position.z + rand(-1.6, 1.8),
          { weaponId: pick(locked).id }
        );
      }
      for (let i = 0; i < 2; i++) {
        this._spawnPickup('health', position.x + rand(-2.4, 2.4), position.z + rand(-1.6, 2.4));
        this._spawnPickup('grenade', position.x + rand(-2.4, 2.4), position.z + rand(-1.6, 2.4));
      }
      return;
    }
    if (enemy.type === 'officer') {
      if (this.player.getLockedWeapons().length && chance(0.42)) {
        this._spawnPickup(
          'weapon',
          position.x + rand(-1.4, 1.4),
          position.z + rand(-1, 1),
          { weaponId: pick(this.player.getLockedWeapons()).id }
        );
      }
      if (chance(0.9)) {
        this._spawnPickup(chance(0.55) ? 'health' : 'grenade', position.x + rand(-1, 1), position.z);
      }
      if (chance(0.35)) {
        this._spawnPickup('grenade', position.x + rand(-1.4, 1.4), position.z + rand(-1, 1));
      }
    } else if (enemy.type === 'heavy') {
      if (chance(0.65)) {
        this._spawnPickup(chance(0.6) ? 'health' : 'grenade', position.x, position.z);
      }
    } else if (enemy.type === 'mortar') {
      if (chance(0.45)) this._spawnPickup('grenade', position.x, position.z + rand(-1, 1));
    } else if (enemy.type !== 'truck' && chance(0.19)) {
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
      this.ui.announce('ARMORED THREAT', 'COMMAND TRUCK DESTROYED', 2.8);
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
          this.player.takeDamage(45 * (1 - clamp01(distance / 7.2) * 0.6), position, null);
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
        this.ui.showBoss('ARMORED COMMAND TRUCK');
      }
      this.ui.setBossHealth(truck.health / truck.maxHealth);
    } else if (this.boss) {
      this.boss = null;
      this.ui.hideBoss();
    }
    if (truck) {
      this.ui.setObjective('DESTROY THE ARMORED COMMAND TRUCK');
    } else if (this.player.position.z > EXTRACTION_Z - 210) {
      this.ui.setObjective('REACH LZ DELTA — EXTRACTION AWAITS');
    } else if (this.player.position.z > 950) {
      this.ui.setObjective('BREAK THROUGH THE FINAL DEFENSIVE LINE');
    } else if (this.player.position.z > 420) {
      this.ui.setObjective('PUSH DEEP INTO THE JUNGLE');
    } else {
      this.ui.setObjective('ADVANCE TO THE EXTRACTION ZONE');
    }
  }

  _checkMissionProgress() {
    for (const marker of PROGRESS_ANNOUNCEMENTS) {
      if (this.player.position.z >= marker.z && !this.announced.has(`z${marker.z}`)) {
        this.announced.add(`z${marker.z}`);
        this.ui.announce(marker.kicker, marker.text, 2.9, marker.tone);
      }
    }
    if (!this.announced.has('extraction-call') && this.player.position.z > EXTRACTION_Z - 170) {
      this.announced.add('extraction-call');
      this.ui.announce('EXTRACTION', 'LZ DELTA IS JUST AHEAD', 3);
    }
  }

  _checkVictory() {
    if (!this.player.alive) return;
    if (this.player.position.z >= EXTRACTION_Z - 1.5) {
      this.endMission(true);
    }
  }

  endMission(victory) {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.state = GAME_STATE.ENDED;
    this.input.clear();
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.reticle.visible = false;
    this.ui.setCrosshairVisible(false);

    if (victory) {
      this.stats.score += SETTINGS.mission.victoryScoreBonus;
      this.ui.setScore(this.stats.score);
      this.stats.distance = EXTRACTION_Z;
      const pad = new THREE.Vector3(this.terrain.extraction.x, 0.5, this.terrain.extraction.z);
      for (let i = 0; i < 5; i++) {
        this.particles.spawnSmokeColumn(
          new THREE.Vector3(pad.x + rand(-2.5, 2.5), 0.5, pad.z + rand(-2.5, 2.5)),
          true,
          true
        );
      }
      this.audio.playJingle(true);
    } else {
      this.audio.playJingle(false);
    }

    this.stats.distance = victory ? EXTRACTION_Z : this.player.position.z;
    this.stats.accuracy =
      this.stats.shots > 0 ? (this.stats.hits / this.stats.shots) * 100 : 0;
    this.best = Math.max(this.best, this.stats.score);
    this.stats.best = this.best;
    safeStorageSet(SETTINGS.storageKeys.best, String(this.best));
    this.ui.setBestScore(this.best);
    this.ui.showEnd(this.stats, victory);
    this.audio.setIntensity(0.18);
    this.audio.setDucked(false);
    this.stats.ended = true;
  }

  onPlayerHealthChanged() {
    this.ui.setHealth(Math.max(0, this.player.health), this.player.maxHealth);
    const low = this.player.alive && this.player.health <= 30;
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

    if (this.player.position.z >= EXTRACTION_Z - 1 && this.player.alive) {
      // handled in _checkVictory
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
    this.ui.announce('BACK IN THE FIGHT', 'LZ DELTA STILL STANDS', 2.2);
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
        this.announced.add(`biome-${biome.id}`);
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
      extractionZ: EXTRACTION_Z,
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
      onVolume: (value) => game?.setVolume(value),
      onUiClick: () => audio.playUiClick(),
      getVolume: () => audio.masterVolume,
      isMuted: () => audio.muted,
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
