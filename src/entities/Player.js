import * as THREE from 'three';
import { SoldierRig } from './SoldierRig.js';
import { getWeaponVisual } from './WeaponModels.js';
import { WEAPONS, WEAPON_BY_SLOT } from '../config/weapons.js';
import { SETTINGS, GAME_STATE } from '../config/settings.js';
import { clamp, damp, approach } from '../utils/math.js';

/**
 * Player soldier: full 360-degree steering, smooth aim interpolation, a
 * machine gun with spread/recoil, frag grenades and layered damage feedback.
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.position = new THREE.Vector3(0, 0.032, SETTINGS.mission.startZ);
    this.velocity = new THREE.Vector3();
    this.aimDirection = new THREE.Vector3(0, 0, 1);
    this.radius = 0.56;
    this.health = SETTINGS.player.maxHealth;
    this.maxHealth = SETTINGS.player.maxHealth;
    this.grenades = SETTINGS.player.grenades;
    this.maxGrenades = SETTINGS.player.maxGrenades;
    this.alive = true;
    this.enabled = true;
    this.fireCooldown = 0;
    this.grenadeCooldown = 0;
    this.invulnerability = 0;
    this.deathTime = 0;
    this.footstepTimer = 0;
    this.throwTimer = 0;
    this.speed = 0;
    this.fireHeld = false;
    this.timeSinceDamage = 999;

    this.unlockedWeapons = new Set([1]);
    this.weaponSlot = 1;
    this.weapon = WEAPONS[0];

    const colors = SETTINGS.colors;
    this.rig = new SoldierRig({
      uniform: colors.playerUniform,
      uniformDark: 0x303822,
      vest: colors.playerVest,
      accent: colors.playerAccent,
      skin: colors.skin,
      helmet: colors.helmet,
      headgear: 'helmet',
      weapon: 'none',
      radio: true,
    });
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = 0;
    this.rig.root.scale.setScalar(SETTINGS.player.visualScale);
    game.scene.add(this.rig.root);
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id));

    // A restrained ground marker keeps the player readable against the dense
    // jungle floor without turning into a glowing gamey icon.
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd08a,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const markerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.69, 36),
      markerMaterial
    );
    markerRing.rotation.x = -Math.PI / 2;
    markerRing.position.y = 0.04;
    markerRing.renderOrder = 3;
    this.rig.root.add(markerRing);
    const markerArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.32, 3),
      markerMaterial
    );
    markerArrow.rotation.x = Math.PI / 2;
    markerArrow.rotation.z = Math.PI;
    markerArrow.position.set(0, 0.04, 0.86);
    markerArrow.renderOrder = 3;
    this.rig.root.add(markerArrow);

    this.shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0xa8e7c9,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.shieldMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.88, 40),
      this.shieldMaterial
    );
    this.shieldMesh.rotation.x = -Math.PI / 2;
    this.shieldMesh.position.y = 0.045;
    this.shieldMesh.renderOrder = 3;
    this.shieldMesh.visible = false;
    this.rig.root.add(this.shieldMesh);

    this._muzzle = new THREE.Vector3();
    this._bulletOrigin = new THREE.Vector3();
    this._bulletDirection = new THREE.Vector3();
    this._aimTarget = new THREE.Vector3();
    this._lastSafePosition = this.position.clone();
  }

  reset(spawnZ = SETTINGS.mission.startZ, spawnX = 0) {
    this.position.set(spawnX, 0.032, spawnZ);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.grenades = SETTINGS.player.grenades;
    this.alive = true;
    this.enabled = true;
    this.fireCooldown = 0;
    this.grenadeCooldown = 0;
    this.invulnerability = 1.8;
    this.deathTime = 0;
    this.throwTimer = 0;
    this.timeSinceDamage = 999;
    this.aimDirection.set(0, 0, 1);
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id));
    this.rig.root.visible = true;
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.root.position.copy(this.position);
    this.shieldMesh.visible = true;
    this.rig.legLeft.rotation.x = 0;
    this.rig.legRight.rotation.x = 0;
    this.rig.body.rotation.x = 0;
    this.rig.body.position.y = 0;
    this._lastSafePosition.copy(this.position);
  }

  update(dt) {
    const { game } = this;
    const playing = game.state === GAME_STATE.PLAYING;

    if (!this.alive) {
      this.deathTime += dt;
      this.rig.root.rotation.x = damp(this.rig.root.rotation.x, -Math.PI / 2.15, 4, dt);
      this.rig.root.position.y = damp(this.rig.root.position.y, -0.15, 2, dt);
      if (this.deathTime > 1.6) this.rig.root.visible = false;
      return;
    }

    if (!playing || !this.enabled) {
      this.rig.update(dt, { speed: 0, aiming: true });
      return;
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    this.invulnerability = Math.max(0, this.invulnerability - dt);
    this.timeSinceDamage += dt;

    // Slow field regeneration after a lull in incoming fire.
    if (
      this.health < this.maxHealth &&
      this.timeSinceDamage > SETTINGS.player.regenDelay
    ) {
      const before = Math.ceil(this.health);
      this.health = Math.min(
        this.maxHealth,
        this.health + SETTINGS.player.regenRate * dt
      );
      if (Math.ceil(this.health) !== before) {
        game.onPlayerHealthChanged();
      }
    }

    // Movement -----------------------------------------------------------------
    const input = game.input;
    const move = input.move;
    // Screen-space right is world -X for this camera orientation.
    const targetVx = -move.x * SETTINGS.player.speed;
    const targetVz = move.z * SETTINGS.player.speed;
    const rate = move.magnitude > 0.01 ? SETTINGS.player.acceleration : SETTINGS.player.friction;
    this.velocity.x = approach(this.velocity.x, targetVx, rate * dt);
    this.velocity.z = approach(this.velocity.z, targetVz, rate * dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    game.terrain.resolveCircle(this.position, this.radius);
    this.position.x = clamp(
      this.position.x,
      -SETTINGS.mission.width + 0.8,
      SETTINGS.mission.width - 0.8
    );
    this.position.z = clamp(
      this.position.z,
      game.scroll - SETTINGS.camera.backwardLimit,
      SETTINGS.mission.extractionZ + 8
    );
    this.position.y = 0.032;

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.speed > 0.2) this._lastSafePosition.copy(this.position);

    // Aim ----------------------------------------------------------------------
    const assist = game.aimAssistTarget;
    if (assist?.alive) {
      this._aimTarget.set(assist.position.x, 0.6, assist.position.z);
    } else {
      this._aimTarget.copy(game.aimWorld);
      this._aimTarget.y = 0.6;
    }
    const dx = this._aimTarget.x - this.position.x;
    const dz = this._aimTarget.z - this.position.z;
    if (dx * dx + dz * dz > 0.01) {
      this.aimDirection.set(dx, 0, dz).normalize();
      const yaw = Math.atan2(dx, dz);
      this.rig.faceAngle(yaw, dt, SETTINGS.player.turnSpeed);
    }

    // Weapon -------------------------------------------------------------------
    this.fireHeld = input.isFiring();
    if (this.fireHeld && this.fireCooldown <= 0) {
      this.fireCooldown = this.weapon.fireRate;
      this._fireWeapon();
    }

    // FX -----------------------------------------------------------------------
    if (this.speed > 2.2) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = clamp(0.23 - this.speed * 0.01, 0.11, 0.22);
        if (game.terrain.isSnow(this.position.z)) {
          const movementYaw = Math.atan2(this.velocity.x, this.velocity.z);
          this._footSide = -(this._footSide || 1);
          game.terrain.addFootprint(
            this.position.x,
            this.position.z,
            movementYaw,
            this._footSide
          );
        } else {
          game.particles.spawnFootstep(this.position);
        }
      }
    } else {
      this.footstepTimer = 0;
    }

    this.throwTimer = Math.max(0, this.throwTimer - dt);
    const throwPose =
      this.throwTimer > 0
        ? Math.sin((1 - this.throwTimer / 0.36) * Math.PI)
        : 0;

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.x = 0;
    this.rig.root.position.y = 0.032;
    this.rig.update(dt, {
      speed: this.speed,
      aiming: true,
      throwPose,
    });

    // Invulnerability is communicated with a soft shield ring rather than
    // flickering the whole silhouette out of existence.
    this.rig.root.visible = true;
    this.shieldMesh.visible = this.invulnerability > 0;
    if (this.shieldMesh.visible) {
      this.shieldMaterial.opacity =
        0.16 + (Math.sin(this.invulnerability * 14) * 0.5 + 0.5) * 0.16;
    }
  }

  _fireWeapon() {
    const { game } = this;
    const weapon = this.weapon;
    this.rig.triggerMuzzleFlash();
    this.rig.getMuzzleWorldPosition(this._muzzle);

    // Start the tracer at the actual muzzle, then converge on the assisted
    // target / ground reticle rather than firing parallel to it.
    this._bulletOrigin.copy(this._muzzle);
    const target = game.aimAssistTarget?.alive
      ? game.aimAssistTarget.position
      : game.aimWorld;
    this._bulletDirection.set(
      target.x - this._muzzle.x,
      0,
      target.z - this._muzzle.z
    );
    if (this._bulletDirection.lengthSq() < 0.01) {
      this._bulletDirection.copy(this.aimDirection);
    }
    this._bulletDirection.normalize();

    for (let i = 0; i < weapon.pellets; i++) {
      game.bullets.spawn({
        origin: this._bulletOrigin,
        direction: this._bulletDirection,
        speed: weapon.speed,
        damage: weapon.damage,
        faction: 'player',
        spread: weapon.spread,
        range: weapon.range,
        color: weapon.tracerColor,
      });
    }

    game.particles.spawnMuzzle(this._muzzle, this._bulletDirection);
    if (weapon.pellets > 1) {
      for (let i = 0; i < 5; i++) {
        game.particles.spawnMuzzle(this._muzzle, this._bulletDirection);
      }
    }
    game.lighting.muzzleFlash(
      this._muzzle,
      weapon.flashColor,
      weapon.flashIntensity,
      weapon.flashDistance,
      weapon.id === 'm870' ? 0.13 : 0.075
    );
    game.audio.playGunshot(this.position, false, weapon.audioProfile);
    game.effects.addShake(weapon.shake);
    game.recordShot(weapon.pellets);
  }

  resetLoadout() {
    this.unlockedWeapons = new Set([1]);
    this.weaponSlot = 1;
    this.weapon = WEAPONS[0];
    this.fireCooldown = 0;
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id));
  }

  unlockWeapon(idOrSlot) {
    const weapon =
      typeof idOrSlot === 'string'
        ? WEAPONS.find((entry) => entry.id === idOrSlot)
        : WEAPON_BY_SLOT.get(Number(idOrSlot));
    if (!weapon) return false;
    if (this.unlockedWeapons.has(weapon.slot)) return false;
    this.unlockedWeapons.add(weapon.slot);
    return true;
  }

  getLockedWeapons() {
    return WEAPONS.filter((weapon) => !this.unlockedWeapons.has(weapon.slot));
  }

  switchWeapon(slot) {
    const weapon = WEAPON_BY_SLOT.get(Number(slot));
    if (!weapon) return false;
    const { game } = this;
    if (!this.unlockedWeapons.has(weapon.slot)) {
      game.ui.toast(`${weapon.name} // NOT ACQUIRED`, 'danger');
      game.audio.playUiClick();
      return false;
    }
    if (this.weaponSlot === weapon.slot) return true;
    this.weaponSlot = weapon.slot;
    this.weapon = weapon;
    this.fireCooldown = Math.max(this.fireCooldown, 0.16);
    this.rig.equipWeapon(getWeaponVisual(weapon.id));
    game.refreshWeaponUI();
    game.audio.playWeaponSwitch();
    game.effects.addShake(0.01);
    return true;
  }

  throwGrenade(target) {
    const { game } = this;
    if (!this.alive || game.state !== GAME_STATE.PLAYING) return false;

    if (this.grenadeCooldown > 0) return false;
    if (this.grenades <= 0) {
      game.ui.toast('NO FRAG GRENADES', 'danger');
      game.audio.playUiClick();
      return false;
    }

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const clamped = clamp(distance, 3.2, SETTINGS.grenade.maxRange);
    const nx = distance > 0.001 ? dx / distance : 0;
    const nz = distance > 0.001 ? dz / distance : 1;
    const landing = new THREE.Vector3(
      clamp(this.position.x + nx * clamped, -SETTINGS.mission.width, SETTINGS.mission.width),
      0.14,
      clamp(this.position.z + nz * clamped, game.scroll - 6, SETTINGS.mission.length)
    );

    const origin = new THREE.Vector3(this.position.x, 1.35, this.position.z);
    game.grenades.spawnPlayerGrenade(origin, landing, {
      radius: SETTINGS.grenade.radius,
      damage: SETTINGS.grenade.damage,
    });

    this.grenades--;
    this.grenadeCooldown = SETTINGS.grenade.throwCooldown;
    game.stats.grenadesThrown++;
    game.ui.setGrenades(this.grenades);
    game.audio.playPinPull(this.position);
    game.audio.playGrenadeThrow(this.position);
    this.throwTimer = 0.36;
    game.effects.addShake(0.03);
    return true;
  }

  addGrenades(amount) {
    const before = this.grenades;
    this.grenades = clamp(this.grenades + amount, 0, this.maxGrenades);
    return this.grenades - before;
  }

  heal(amount) {
    const before = this.health;
    this.health = clamp(this.health + amount, 0, this.maxHealth);
    this.game.onPlayerHealthChanged();
    return this.health - before;
  }

  takeDamage(amount, hitPosition = null, sourcePosition = null) {
    const { game } = this;
    if (!this.alive || this.invulnerability > 0 || game.state !== GAME_STATE.PLAYING) return false;

    let damage = amount;
    if (sourcePosition && game.terrain.isInCover(this.position, sourcePosition)) {
      damage *= 0.55;
      game.ui.toast('COVER ABSORBED THE HIT', 'muted');
    }

    this.health = clamp(this.health - damage, 0, this.maxHealth);
    this.timeSinceDamage = 0;
    this.invulnerability = 0.34;
    game.effects.flashDamage(clamp(damage / 24, 0.3, 1));
    game.effects.addShake(0.24);
    game.audio.playPlayerHit();
    game.particles.spawnBlood(
      hitPosition || new THREE.Vector3(this.position.x, 1.2, this.position.z),
      new THREE.Vector3(0, 0, 1),
      0.6
    );
    game.onPlayerHealthChanged();

    if (this.health <= 0) {
      this.die();
    }
    return true;
  }

  die() {
    if (!this.alive) return;
    const { game } = this;
    this.alive = false;
    this.deathTime = 0;
    this.velocity.set(0, 0, 0);
    this.shieldMesh.visible = false;
    this.rig.root.rotation.x = 0;
    game.particles.spawnBlood(
      new THREE.Vector3(this.position.x, 1.1, this.position.z),
      new THREE.Vector3(0, 0, 1),
      1.6
    );
    game.particles.spawnDust(this.position, 1.8, 0.35);
    game.effects.addShake(0.75);
    game.effects.flashDamage(1);
    game.audio.playEnemyDeath(this.position, 'officer');
    game.onPlayerDied();
  }

  respawn(spawnZ, spawnX = 0) {
    this.reset(spawnZ, spawnX);
    this.game.onPlayerHealthChanged();
    this.game.ui.setGrenades(this.grenades);
  }

  getForward(out = new THREE.Vector3()) {
    return out.copy(this.aimDirection);
  }

  getLastSafePosition() {
    return this._lastSafePosition.clone();
  }

  dispose() {
    this.rig.dispose();
  }
}
