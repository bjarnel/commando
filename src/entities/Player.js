import * as THREE from 'three';
import { SoldierRig } from './SoldierRig.js';
import { getWeaponVisual } from './WeaponModels.js';
import { WEAPONS, WEAPON_BY_ID, WEAPON_CATEGORIES, CATEGORY_ORDER, CATEGORY_BY_SLOT, STARTING_LOADOUT } from '../config/weapons.js';
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
    this.armorTier = 0;
    this.damageTier = 0;
    this.weaponDamageMultiplier = 1;
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
    this.braced = false;
    this.braceTimer = 0;
    this.meleeCooldown = 0;
    this.meleeTimer = 0;
    this.inCover = false;

    this.inventory = {};
    for (const category of CATEGORY_ORDER) {
      this.inventory[category] = WEAPON_BY_ID.get(STARTING_LOADOUT[category]);
    }
    this.weaponCategory = 'assault';
    this.weaponSlot = WEAPON_CATEGORIES.assault.slot;
    this.weapon = this.inventory.assault;

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
    this._buildArmorVisuals();
    this.setArmorVisualTier(0);
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id, { tier: this.damageTier }));

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

  _buildArmorVisuals() {
    const armorMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d5852,
      roughness: 0.48,
      metalness: 0.46,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x343b35,
      roughness: 0.62,
      metalness: 0.3,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9a45d,
      roughness: 0.44,
      metalness: 0.38,
    });

    const make = (geometry, material, parent, position, rotation = null, scale = null) => {
      const mesh = new THREE.Mesh(geometry, material);
      if (position) mesh.position.set(position[0], position[1], position[2]);
      if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const body = this.rig.body;
    const chest = make(
      new THREE.BoxGeometry(0.46, 0.32, 0.13),
      armorMaterial,
      body,
      [0, 1.34, 0.225]
    );
    const chestAccent = make(
      new THREE.BoxGeometry(0.3, 0.05, 0.02),
      accentMaterial,
      body,
      [0, 1.47, 0.3]
    );

    const shoulders = [];
    for (const [arm, side] of [
      [this.rig.armLeft, -1],
      [this.rig.armRight, 1],
    ]) {
      shoulders.push(
        make(
          new THREE.SphereGeometry(0.12, 7, 5),
          armorMaterial,
          arm,
          [side * 0.01, -0.015, 0.01],
          null,
          [1.25, 0.78, 1.12]
        )
      );
    }

    const hips = [];
    for (const side of [-1, 1]) {
      hips.push(
        make(
          new THREE.BoxGeometry(0.15, 0.2, 0.09),
          armorMaterial,
          body,
          [side * 0.21, 1.02, 0.12],
          [0, 0, side * 0.08]
        )
      );
    }

    const thighs = [];
    for (const leg of [this.rig.legLeft, this.rig.legRight]) {
      thighs.push(
        make(
          new THREE.BoxGeometry(0.145, 0.22, 0.075),
          armorMaterial,
          leg,
          [0, -0.19, 0.07]
        )
      );
    }

    const backpack = make(
      new THREE.BoxGeometry(0.36, 0.42, 0.08),
      darkMaterial,
      body,
      [0, 1.33, -0.4]
    );
    const collar = make(
      new THREE.BoxGeometry(0.32, 0.09, 0.09),
      armorMaterial,
      body,
      [0, 1.58, 0.15]
    );
    const helmetPlate = make(
      new THREE.BoxGeometry(0.22, 0.055, 0.16),
      armorMaterial,
      body,
      [0, 2.045, 0.015]
    );
    const helmetAccent = make(
      new THREE.BoxGeometry(0.06, 0.03, 0.02),
      accentMaterial,
      body,
      [0, 2.05, 0.11]
    );

    this.armorVisuals = {
      chest,
      chestAccent,
      shoulders,
      hips,
      thighs,
      backpack,
      collar,
      helmetPlate,
      helmetAccent,
    };
  }

  setArmorVisualTier(tier) {
    const visuals = this.armorVisuals;
    if (!visuals) return;
    const t = Math.max(0, Math.min(4, tier));
    visuals.chest.visible = t >= 1;
    visuals.chestAccent.visible = t >= 1;
    for (const mesh of visuals.shoulders) mesh.visible = t >= 2;
    for (const mesh of visuals.hips) mesh.visible = t >= 2;
    for (const mesh of visuals.thighs) mesh.visible = t >= 3;
    visuals.backpack.visible = t >= 3;
    visuals.collar.visible = t >= 4;
    visuals.helmetPlate.visible = t >= 4;
    visuals.helmetAccent.visible = t >= 4;
    visuals.chest.scale.set(1 + t * 0.025, 1, 1 + t * 0.055);
    visuals.chestAccent.position.z = 0.3 + t * 0.006;
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
    this.braced = false;
    this.braceTimer = 0;
    this.meleeCooldown = 0;
    this.meleeTimer = 0;
    this.inCover = false;
    this.aimDirection.set(0, 0, 1);
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id, { tier: this.damageTier }));
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
    this.grenadeCooldown = Math.max(
      0,
      this.grenadeCooldown -
        dt * (this.braced ? SETTINGS.player.braceGrenadeMultiplier : 1)
    );
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    this.invulnerability = Math.max(0, this.invulnerability - dt);
    this.timeSinceDamage += dt;

    // Holding ground for a moment steadies the weapon and speeds recovery.
    if (this.speed <= SETTINGS.player.braceSpeed) {
      this.braceTimer += dt;
    } else {
      this.braceTimer = 0;
    }
    this.braced = this.braceTimer >= SETTINGS.player.braceDelay;

    // Slow field regeneration after a lull in incoming fire.
    if (
      this.health < this.maxHealth &&
      this.timeSinceDamage > SETTINGS.player.regenDelay
    ) {
      const before = Math.ceil(this.health);
      const regen =
        SETTINGS.player.regenRate *
        (this.braced ? SETTINGS.player.braceRegenMultiplier : 1);
      this.health = Math.min(
        this.maxHealth,
        this.health + regen * dt
      );
      if (Math.ceil(this.health) !== before) {
        game.onPlayerHealthChanged();
      }
    }

    // Movement -----------------------------------------------------------------
    const input = game.input;
    const move = input.move;
    const maxSpeed = SETTINGS.player.speed * (game.runSpeedMultiplier || 1);
    // Screen-space right is world -X for this camera orientation.
    const targetVx = -move.x * maxSpeed;
    const targetVz = move.z * maxSpeed;
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
      Number.POSITIVE_INFINITY
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
    const meleePose =
      this.meleeTimer > 0
        ? Math.sin((1 - this.meleeTimer / 0.28) * Math.PI)
        : 0;

    this.rig.update(dt, {
      speed: this.speed,
      aiming: true,
      throwPose,
      meleePose,
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

    const damage = Math.max(1, Math.round(weapon.damage * this.weaponDamageMultiplier));
    const explosion = weapon.explosion
      ? {
          radius: weapon.explosion.radius,
          damage: Math.round(
            weapon.explosion.damage * this.weaponDamageMultiplier
          ),
        }
      : null;

    if (weapon.ballistic) {
      const dx = target.x - this.position.x;
      const dz = target.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      const range = clamp(distance, 3.5, weapon.range);
      const nx = distance > 0.001 ? dx / distance : this.aimDirection.x;
      const nz = distance > 0.001 ? dz / distance : this.aimDirection.z;
      const landing = new THREE.Vector3(
        clamp(
          this.position.x + nx * range,
          -SETTINGS.mission.width + 0.5,
          SETTINGS.mission.width - 0.5
        ),
        0.14,
        clamp(
          this.position.z + nz * range,
          game.scroll - 4,
          Number.POSITIVE_INFINITY
        )
      );
      game.grenades.spawnLauncherShell(this._muzzle, landing, {
        radius: explosion?.radius ?? 4.2,
        damage: explosion?.damage ?? damage,
      });
    } else {
      const spread =
        weapon.spread *
        (this.braced ? SETTINGS.player.braceSpreadMultiplier : 1);
      for (let i = 0; i < weapon.pellets; i++) {
        game.bullets.spawn({
          origin: this._bulletOrigin,
          direction: this._bulletDirection,
          speed: weapon.speed,
          damage,
          faction: 'player',
          spread,
          range: weapon.range,
          color: weapon.tracerColor,
          explosion,
        });
      }
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
    game.effects.addShake(
      weapon.shake *
        (this.braced ? SETTINGS.player.braceShakeMultiplier : 1)
    );
    game.recordShot(weapon.pellets);
  }

  resetLoadout() {
    this.inventory = {};
    for (const category of CATEGORY_ORDER) {
      this.inventory[category] = WEAPON_BY_ID.get(STARTING_LOADOUT[category]);
    }
    this.weaponCategory = 'assault';
    this.weaponSlot = WEAPON_CATEGORIES.assault.slot;
    this.weapon = this.inventory.assault;
    this.fireCooldown = 0;
    this.armorTier = 0;
    this.damageTier = 0;
    this.weaponDamageMultiplier = 1;
    this.maxHealth = SETTINGS.player.maxHealth;
    this.health = this.maxHealth;
    this.setArmorVisualTier(0);
    this.rig.equipWeapon(getWeaponVisual(this.weapon.id, { tier: this.damageTier }));
  }

  acquireWeapon(id) {
    const weapon = WEAPON_BY_ID.get(id);
    if (!weapon) return null;
    const category = weapon.category;
    const previous = this.inventory[category];
    if (previous?.id === weapon.id) return null;
    this.inventory[category] = weapon;
    this.switchWeapon(WEAPON_CATEGORIES[category].slot);
    return {
      weapon,
      previous,
      category,
      slot: WEAPON_CATEGORIES[category].slot,
    };
  }

  getWeaponDropCandidates() {
    return WEAPONS.filter(
      (weapon) => this.inventory[weapon.category]?.id !== weapon.id
    );
  }

  switchWeapon(slot) {
    const category = CATEGORY_BY_SLOT.get(Number(slot));
    if (!category) return false;
    const weapon = this.inventory[category];
    if (!weapon) return false;
    const { game } = this;
    if (this.weaponCategory === category && this.weapon?.id === weapon.id) {
      return true;
    }
    this.weaponCategory = category;
    this.weaponSlot = WEAPON_CATEGORIES[category].slot;
    this.weapon = weapon;
    this.fireCooldown = Math.max(this.fireCooldown, 0.16);
    this.rig.equipWeapon(getWeaponVisual(weapon.id, { tier: this.damageTier }));
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
      clamp(this.position.z + nz * clamped, game.scroll - 6, Number.POSITIVE_INFINITY)
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

  meleeShove() {
    const { game } = this;
    if (!this.alive || game.state !== GAME_STATE.PLAYING) return false;
    if (this.meleeCooldown > 0) return false;

    this.meleeCooldown = SETTINGS.player.meleeCooldown;
    this.meleeTimer = 0.28;
    this.braceTimer = 0;
    this.invulnerability = Math.max(
      this.invulnerability,
      SETTINGS.player.meleeInvulnerability
    );

    const range = SETTINGS.player.meleeRange;
    let hits = 0;
    for (const enemy of game.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - this.position.x;
      const dz = enemy.position.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.001 || distance > range + enemy.radius) continue;
      const facing =
        (dx * this.aimDirection.x + dz * this.aimDirection.z) / distance;
      if (facing < -0.1) continue;

      if (enemy.type === 'truck') {
        enemy.takeDamage(
          12,
          new THREE.Vector3(this.position.x, 1.2, this.position.z),
          this.position
        );
        hits++;
        continue;
      }

      const hurt = enemy.applyShove(
        this.position.x,
        this.position.z,
        SETTINGS.player.meleeShove,
        SETTINGS.player.meleeStagger,
        SETTINGS.player.meleeDamage
      );
      if (hurt) {
        hits++;
      }
    }

    if (hits > 0) {
      game.effects.showHitmarker(false);
      game.effects.addShake(0.12);
      game.audio.playMeleeImpact(this.position);
      game.particles.spawnDust(
        new THREE.Vector3(
          this.position.x + this.aimDirection.x * 1.4,
          0.3,
          this.position.z + this.aimDirection.z * 1.4
        ),
        1.1,
        0.28
      );
    } else {
      game.effects.addShake(0.04);
      game.audio.playMeleeSwing(this.position);
    }
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

  applyArmorUpgrade() {
    const progression = SETTINGS.progression;
    if (this.armorTier >= progression.maxArmorTier) return false;
    this.armorTier++;
    this.maxHealth =
      SETTINGS.player.maxHealth + this.armorTier * progression.armorHealthBonus;
    this.health = Math.min(this.maxHealth, this.health + 40);
    this.setArmorVisualTier(this.armorTier);
    return true;
  }

  applyWeaponUpgrade() {
    const progression = SETTINGS.progression;
    if (this.damageTier >= progression.maxDamageTier) return false;
    this.damageTier++;
    this.weaponDamageMultiplier =
      1 + this.damageTier * progression.damageBonusPerTier;
    this.rig.equipWeapon(
      getWeaponVisual(this.weapon.id, { tier: this.damageTier })
    );
    return true;
  }

  get armorDamageReduction() {
    return this.armorTier * SETTINGS.progression.armorDamageReduction;
  }

  takeDamage(amount, hitPosition = null, sourcePosition = null) {
    const { game } = this;
    if (!this.alive || this.invulnerability > 0 || game.state !== GAME_STATE.PLAYING) return false;

    let damage = amount;
    if (sourcePosition && game.terrain.isInCover(this.position, sourcePosition)) {
      damage *= 0.55;
      game.ui.toast('COVER ABSORBED THE HIT', 'muted');
    }
    if (this.armorDamageReduction > 0) {
      damage *= 1 - this.armorDamageReduction;
    }

    this.health = clamp(this.health - damage, 0, this.maxHealth);
    this.timeSinceDamage = 0;
    this.invulnerability = 0.38;
    this.braceTimer = 0;
    this.braced = false;
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
