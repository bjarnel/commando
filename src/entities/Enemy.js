import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SoldierRig } from './SoldierRig.js';
import { SETTINGS } from '../config/settings.js';
import { getEnemyStyle, getBiomeTint } from '../config/biomes.js';
import { clamp, damp, dampAngle, rand, chance } from '../utils/math.js';
import { getSparkTexture } from '../utils/textures.js';

/* --------------------------------------------------------------------------
   Geometry helpers for enemy hardware
   -------------------------------------------------------------------------- */

function colorize(geometry, hex) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function part(geometry, hex, position, rotation, scale) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0)
    ),
    new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
  );
  geometry.applyMatrix4(matrix);
  colorize(geometry, hex);
  return geometry;
}

function mergeParts(parts) {
  const normalized = parts.map((item) => {
    if (!item.index) return item;
    const flat = item.toNonIndexed();
    item.dispose();
    return flat;
  });
  const geometry = mergeGeometries(normalized, false);
  normalized.forEach((item) => item.dispose());
  if (!geometry) {
    console.error('[Enemy] Geometry merge failed.');
    return new THREE.BufferGeometry();
  }
  return geometry;
}

const vehicleMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.68,
  metalness: 0.32,
});

const turretMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.55,
  metalness: 0.46,
});

/* --------------------------------------------------------------------------
   Base
   -------------------------------------------------------------------------- */

export class Enemy {
  constructor(game, { x, z, type, difficulty = 0, biomeId = null }) {
    this.game = game;
    this.type = type;
    this.biomeId = biomeId || this.game.terrain.getBiome(z).id;
    this.position = new THREE.Vector3(x, 0.032, z);
    this.radius = 0.56;
    this.health = 36;
    this.maxHealth = 36;
    this.speed = 5.2;
    this.scoreValue = 100;
    this.difficulty = clamp(difficulty, 0, 1);
    this.alive = true;
    this.dying = false;
    this.removeFlag = false;
    this.canDespawn = true;
    this.age = Math.random() * 10;
    this.deathTime = 0;
    this.hitPunch = 0;
    this.animSpeed = 0;
    this.coverSpot = null;
    this.rig = null;
    this.extraObjects = [];
    this.damageParticles = 0;
    this.facingAngle = 0;
    this.staggerTimer = 0;
    this.staggerVelocity = new THREE.Vector3();
    this._footTimer = rand(0.05, 0.3);
    this._footSide = chance(0.5) ? 1 : -1;
    this.avoidSide = chance(0.5) ? 1 : -1;
  }

  get bulletRadius() {
    return this.radius * (this.type === 'truck' ? 1.04 : 1.35);
  }

  addRig(style, scale = 1) {
    this.rig = new SoldierRig(style);
    this.rig.root.scale.setScalar(scale);
    this.rig.root.position.copy(this.position);
    this.game.scene.add(this.rig.root);
    return this.rig;
  }

  assignCoverSpot(spot) {
    if (!spot) return;
    this.coverSpot = spot;
    spot.occupied = this;
  }

  update(dt) {
    this.age += dt;
    this.hitPunch = damp(this.hitPunch, 0, 9, dt);

    if (!this.alive) {
      this._updateDeath(dt);
      return;
    }

    const previousX = this.position.x;
    const previousZ = this.position.z;

    // A close-range shove knocks soldiers out of their firing rhythm.
    if (this.staggerTimer > 0) {
      this.staggerTimer = Math.max(0, this.staggerTimer - dt);
      this.cancelCharge?.();
      this.position.x += this.staggerVelocity.x * dt;
      this.position.z += this.staggerVelocity.z * dt;
      this.staggerVelocity.x = damp(this.staggerVelocity.x, 0, 7, dt);
      this.staggerVelocity.z = damp(this.staggerVelocity.z, 0, 7, dt);
      this.game.terrain.resolveCircle(this.position, this.radius);
      this.position.x = clamp(
        this.position.x,
        -SETTINGS.mission.width + 0.8,
        SETTINGS.mission.width - 0.8
      );
      this.animSpeed = damp(this.animSpeed, 0, 9, dt);
      this._updatePresentation(dt, previousX, previousZ);
      return;
    }

    const bounds = this.game.combatBounds;

    // Bypassed enemies used to be allowed to drift far below the camera and
    // keep shooting. Once they fall behind the visible bottom edge they
    // disengage: no firing, just a short hustle back up-field. If the player
    // keeps advancing, they pass the despawn line and are removed off-screen.
    if (this.canDespawn && this.position.z < bounds.bottom) {
      if (this.position.z < bounds.despawnBottom) {
        this.removeFlag = true;
        return;
      }
      this.cancelCharge?.();
      this.facePoint(
        this.game.player.position.x,
        this.game.player.position.z,
        dt,
        7
      );
      this.animSpeed = this.moveToward(
        this.position.x,
        bounds.bottom + 2.2,
        dt,
        this.speed * 1.35
      );
      this._updatePresentation(dt, previousX, previousZ);
      return;
    }

    this.think(dt);
    this._updatePresentation(dt, previousX, previousZ);
  }

  _updatePresentation(dt, previousX, previousZ) {
    const movedX = this.position.x - previousX;
    const movedZ = this.position.z - previousZ;
    if (
      this.alive &&
      movedX * movedX + movedZ * movedZ > 0.000001 &&
      this.game.terrain.isSnow(this.position.z) &&
      this.position.z > this.game.scroll - 4 &&
      this.position.z < this.game.scroll + 30
    ) {
      this._footTimer -= dt;
      if (this._footTimer <= 0) {
        this._footTimer = rand(0.24, 0.38);
        this._footSide *= -1;
        this.game.terrain.addFootprint(
          this.position.x,
          this.position.z,
          Math.atan2(movedX, movedZ),
          this._footSide
        );
      }
    } else {
      this._footTimer = Math.min(this._footTimer, 0.1);
    }

    if (this.rig) {
      this.rig.root.position.set(this.position.x, 0.032, this.position.z);
      this.rig.root.scale.setScalar((this.baseScale || 1) * (1 + this.hitPunch * 0.045));
      this.rig.update(dt, {
        speed: this.animSpeed,
        aiming: true,
      });
    }
  }

  isInCombatBand() {
    const bounds = this.game.combatBounds;
    return this.position.z >= bounds.bottom && this.position.z <= bounds.top;
  }

  think() {}

  getWeakPoints() {
    return null;
  }

  applyShove(fromX, fromZ, force = 6, duration = 0.55, damage = 0) {
    if (!this.alive) return false;
    let dx = this.position.x - fromX;
    let dz = this.position.z - fromZ;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    this.staggerTimer = Math.max(this.staggerTimer, duration);
    this.staggerVelocity.set(dx * force, 0, dz * force);
    this.hitPunch = 1;
    this.cancelCharge?.();
    if (damage > 0) {
      this.health -= damage;
      if (this.health <= 0) this.die();
    }
    return true;
  }

  facePoint(x, z, dt, speed = 11) {
    const angle = Math.atan2(x - this.position.x, z - this.position.z);
    this.facingAngle = dampAngle(this.facingAngle, angle, speed, dt);
    if (this.rig) this.rig.root.rotation.y = this.facingAngle;
    return angle;
  }

  moveToward(tx, tz, dt, speed) {
    const dx = tx - this.position.x;
    const dz = tz - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.18) return 0;
    const step = Math.min(distance, speed * dt);
    let dirX = dx / distance;
    let dirZ = dz / distance;

    // Simple local steering: city blocks are large colliders, and a soldier
    // walking straight into one would otherwise grind in place. Sample the
    // perpendicular directions and commit to the first clear detour.
    const probe = Math.max(0.45, step + this.radius * 0.7);
    if (
      !this.game.terrain.isFree(
        this.position.x + dirX * probe,
        this.position.z + dirZ * probe,
        this.radius * 0.55
      )
    ) {
      let steered = false;
      for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3]) {
        const angle = offset * this.avoidSide;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = dirX * cos - dirZ * sin;
        const rz = dirX * sin + dirZ * cos;
        if (
          this.game.terrain.isFree(
            this.position.x + rx * probe,
            this.position.z + rz * probe,
            this.radius * 0.55
          )
        ) {
          dirX = rx;
          dirZ = rz;
          steered = true;
          break;
        }
      }
      this.avoidSide *= steered ? 1 : -1;
    }

    this.position.x += dirX * step;
    this.position.z += dirZ * step;
    this.game.terrain.resolveCircle(this.position, this.radius);
    this.position.x = clamp(
      this.position.x,
      -SETTINGS.mission.width + 0.8,
      SETTINGS.mission.width - 0.8
    );
    this.position.z = clamp(
      this.position.z,
      this.game.scroll - 16,
      this.game.scroll + 32
    );
    return step / Math.max(dt, 1e-4);
  }

  shootAtPlayer({
    spread = 0.07,
    damage = 9,
    speed = 72,
    range = 46,
    origin = null,
    color = 0xff8d58,
  } = {}) {
    if (!this.rig || !this.game.player.alive || !this.isInCombatBand()) return;
    const muzzle = origin
      ? origin.clone()
      : this.rig.getMuzzleWorldPosition(new THREE.Vector3());
    const player = this.game.player;
    const distance = Math.hypot(
      player.position.x - this.position.x,
      player.position.z - this.position.z
    );
    const leadTime = (distance / speed) * 0.45;
    const target = new THREE.Vector3(
      player.position.x + player.velocity.x * leadTime,
      1.15,
      player.position.z + player.velocity.z * leadTime
    );
    const direction = target.sub(muzzle);
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
    direction.normalize();

    this.game.bullets.spawn({
      origin: muzzle,
      direction,
      speed,
      damage,
      faction: 'enemy',
      spread,
      range,
      color,
    });

    this.game.particles.spawnMuzzle(muzzle, direction);
    this.game.lighting.muzzleFlash(muzzle, 0xff8b4d, 17, 8, 0.06);
    this.game.audio.playGunshot(this.position, true);
    this.rig.triggerMuzzleFlash();
  }

  takeDamage(amount, hitPosition, sourcePosition, hitDirection = null) {
    if (!this.alive) return false;
    let damage = amount;
    if (sourcePosition && this.game.terrain.isInCover(this.position, sourcePosition)) {
      damage *= 0.55;
      this.game.particles.spawnDust(
        hitPosition || new THREE.Vector3(this.position.x, 1.1, this.position.z),
        0.55,
        0.25
      );
    }
    this.health -= damage;
    this.hitPunch = 1;

    const direction = hitDirection || new THREE.Vector3(0, 0, 1);
    this.game.particles.spawnBlood(
      hitPosition || new THREE.Vector3(this.position.x, 1.2, this.position.z),
      direction,
      this.type === 'officer' ? 1.1 : 0.8
    );

    if (this.health <= 0) {
      this.die();
    } else if (chance(0.16)) {
      // A sharp little vocal grunt to sell non-lethal hits.
      this.game.audio.playEnemyDeath(this.position, this.type);
    }
    return true;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.deathTime = 0;
    this.releaseCover();
    this.game.particles.spawnBlood(
      new THREE.Vector3(this.position.x, 1.1, this.position.z),
      new THREE.Vector3(rand(-1, 1), 0, rand(0.2, 1)),
      1.6
    );
    this.game.audio.playEnemyDeath(this.position, this.type);
    this.game.onEnemyKilled(this);
  }

  releaseCover() {
    if (this.coverSpot) {
      this.game.terrain.releaseCoverSpot(this.coverSpot, this);
      this.coverSpot = null;
    }
  }

  _updateDeath(dt) {
    this.deathTime += dt;
    if (this.rig) {
      const fall = Math.min(1, this.deathTime / 0.55);
      const eased = 1 - Math.pow(1 - fall, 2.2);
      this.rig.root.rotation.x = -Math.PI * 0.48 * eased;
      this.rig.root.position.y = 0.032 - Math.max(0, this.deathTime - 0.9) * 0.1;
      if (this.deathTime > 2.5) this.rig.root.visible = false;
    }
    if (this.deathTime > 2.9) this.removeFlag = true;
  }

  dispose() {
    this.releaseCover();
    this.rig?.dispose();
    for (const object of this.extraObjects) {
      object.removeFromParent();
    }
    this.extraObjects.length = 0;
  }
}

/* --------------------------------------------------------------------------
   Infantry
   -------------------------------------------------------------------------- */

export class Infantry extends Enemy {
  constructor(game, options, config) {
    super(game, options);
    this.radius = 0.56;
    this.baseScale = (config.scale ?? 1) * 1.65;
    this.health = config.health + Math.round(options.difficulty * 18);
    this.maxHealth = this.health;
    this.speed = config.speed + (options.difficulty || 0) * 0.8;
    this.scoreValue = config.score;
    this.preferredMin = config.preferredMin;
    this.preferredMax = config.preferredMax;
    this.burstMin = config.burstMin;
    this.burstMax = config.burstMax;
    this.burstGap = config.burstGap;
    this.cooldown = config.cooldown;
    this.baseSpread = config.spread;
    this.bulletDamage = config.bulletDamage;
    this.accuracy = clamp((options.difficulty || 0), 0, 1);
    this.addRig(config.style, this.baseScale);

    this.fireCooldown = rand(0.45, 1.4);
    this.burstRemaining = 0;
    this.burstTimer = 0;
    this.strafeDirection = chance(0.5) ? 1 : -1;
    this.strafeTimer = rand(1.1, 2.5);
    this.coverSeekTimer = rand(0.5, 2.4);
    this.animSpeed = 0;
    this.forcedMove = null;
    this.chargeTime = config.chargeTime || 0;
    this.charging = false;
    this.chargeTimer = 0;
    this.aggressive = Boolean(config.aggressive);
    this.pounce = Boolean(config.pounce);
    this.pounceTimer = 0;
    this.pounceCooldown = rand(2.6, 4.8);
  }

  think(dt) {
    const { game } = this;
    const player = game.player;
    if (!player.alive) {
      this.cancelCharge?.();
      this.animSpeed = damp(this.animSpeed, 0, 8, dt);
      return;
    }

    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distance = Math.hypot(dx, dz) || 0.001;
    this.facePoint(player.position.x, player.position.z, dt, 10);

    const hasLos = game.terrain.hasLineOfSight(this.position, player.position);
    this.strafeTimer -= dt;
    this.coverSeekTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(1.2, 2.8);
      this.strafeDirection *= -1;
    }

    if (this.pounce) {
      this.pounceCooldown -= dt;
      if (this.pounceTimer > 0) {
        this.pounceTimer = Math.max(0, this.pounceTimer - dt);
        if (chance(0.22)) {
          this.game.particles.spawnDust(
            new THREE.Vector3(this.position.x, 0.2, this.position.z),
            1.0,
            0.24
          );
        }
      } else if (
        this.pounceCooldown <= 0 &&
        distance > 4 &&
        distance < 17
      ) {
        this.pounceTimer = 0.55;
        this.pounceCooldown = rand(3.5, 6);
        this.game.particles.spawnDust(
          new THREE.Vector3(this.position.x, 0.2, this.position.z),
          1.4,
          0.32
        );
      }
    }

    // Try to occupy nearby cover if not already doing so.
    if (
      !this.aggressive &&
      !this.coverSpot &&
      this.coverSeekTimer <= 0 &&
      distance > 6 &&
      hasLos
    ) {
      this.coverSeekTimer = rand(2.5, 5.5);
      if (chance(0.42)) {
        const spot = game.terrain.findCoverSpotNear(
          this.position.x,
          this.position.z,
          6.5,
          this
        );
        if (spot) {
          game.terrain.claimCoverSpot(spot, this);
          this.coverSpot = spot;
        }
      }
    }

    let targetX = this.position.x;
    let targetZ = this.position.z;
    let desiredSpeed = 0;

    if (this.aggressive) {
      // Fanatics trade cover and patience for a fast, weaving close assault.
      const desiredDistance = this.preferredMin + 1.2;
      const nx = dx / distance;
      const nz = dz / distance;
      const flank = Math.sin(this.age * 1.8 + this.strafeDirection) * 1.8;
      targetX = player.position.x - nx * desiredDistance + -nz * flank;
      targetZ = player.position.z - nz * desiredDistance + nx * flank;
      desiredSpeed = this.speed;
    } else if (this.coverSpot) {
      targetX = this.coverSpot.x;
      targetZ = this.coverSpot.z;
      const coverDistance = Math.hypot(targetX - this.position.x, targetZ - this.position.z);
      if (coverDistance > 0.65) {
        desiredSpeed = this.speed * 0.95;
      } else if (distance < 5.5) {
        // Cover is compromised by a close assault — break away.
        targetX = this.position.x - (dx / distance) * 4;
        targetZ = this.position.z - (dz / distance) * 4;
        desiredSpeed = this.speed;
        this.releaseCover();
      }
    } else if (distance < this.preferredMin) {
      targetX = this.position.x - (dx / distance) * 3.2;
      targetZ = this.position.z - (dz / distance) * 3.2;
      desiredSpeed = this.speed;
    } else if (distance > this.preferredMax || !hasLos) {
      const desiredDistance = this.preferredMin + 2;
      const nx = dx / distance;
      const nz = dz / distance;
      const flank = this.strafeDirection * (distance > 15 ? 3.4 : 1.5);
      targetX = player.position.x - nx * desiredDistance + -nz * flank;
      targetZ = player.position.z - nz * desiredDistance + nx * flank;
      desiredSpeed = this.speed * (hasLos ? 0.88 : 1);
    } else {
      // Circle-strafe inside the engagement envelope.
      const nx = dx / distance;
      const nz = dz / distance;
      targetX = this.position.x + -nz * this.strafeDirection * 3.1;
      targetZ = this.position.z + nx * this.strafeDirection * 3.1;
      desiredSpeed = this.speed * 0.48;
      if (!hasLos) {
        targetX = player.position.x;
        targetZ = player.position.z;
        desiredSpeed = this.speed;
      }
    }

    if (this.burstRemaining > 0) {
      desiredSpeed *= 0.5;
    }

    if (this.forcedMove) {
      targetX = this.forcedMove.x;
      targetZ = this.forcedMove.z;
      desiredSpeed = this.speed;
      if (Math.hypot(targetX - this.position.x, targetZ - this.position.z) < 0.5) {
        this.forcedMove = null;
      }
    }

    const pressure =
      (0.84 + 0.16 * this.game.battleTempo) *
      (this.pounceTimer > 0 ? 1.7 : 1);
    this.animSpeed = this.moveToward(
      targetX,
      targetZ,
      dt,
      desiredSpeed * pressure
    );
    if (desiredSpeed < 0.1) this.animSpeed = 0;

    // Weapon logic ----------------------------------------------------------
    if (this.charging) {
      this.chargeTimer -= dt;
      this._updateCharge?.(dt, distance);
      if (this.chargeTimer <= 0) {
        this.charging = false;
        this._hideChargeVisual?.();
        if (this.isInCombatBand() && hasLos && distance < 31) {
          this._fireRound(distance);
        }
        this.fireCooldown = this.cooldown * rand(0.9, 1.2);
      }
    } else if (this.burstRemaining > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._fireRound(distance);
        this.burstRemaining--;
        this.burstTimer = this.burstGap;
        if (this.burstRemaining <= 0) {
          this.fireCooldown = this.cooldown * rand(0.8, 1.25);
        }
      }
    } else {
      this.fireCooldown -= dt * this.game.battleTempo;
      if (this.fireCooldown <= 0) {
        if (this.isInCombatBand() && hasLos && distance < 27 && distance > 2.2) {
          if (this.chargeTime > 0) {
            this.charging = true;
            this.chargeTimer = this.chargeTime;
            this._showChargeVisual?.(distance);
          } else {
            this.burstRemaining = Math.round(rand(this.burstMin, this.burstMax));
            this.burstTimer = 0;
          }
        } else {
          this.fireCooldown = 0.25;
        }
      }
    }
  }

  cancelCharge() {
    if (!this.charging) return;
    this.charging = false;
    this.chargeTimer = 0;
    this._hideChargeVisual?.();
  }

  _fireRound(distance) {
    const movingPenalty = clamp(this.animSpeed / 6, 0, 1) * 0.04;
    const distancePenalty = clamp(distance / 40, 0, 1) * 0.035;
    const spread = this.baseSpread * (1.2 - this.accuracy * 0.5) + movingPenalty + distancePenalty;
    this.shootAtPlayer({
      spread,
      damage: this.bulletDamage + Math.round(this.accuracy * 2),
      speed: 72 + this.accuracy * 12,
      range: 45,
    });
  }
}

export class Rifleman extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 34,
      speed: 4.8,
      score: SETTINGS.score.rifleman,
      preferredMin: 7.5,
      preferredMax: 14.5,
      burstMin: 3,
      burstMax: 4,
      burstGap: 0.135,
      cooldown: 1.95,
      spread: 0.125,
      bulletDamage: 6,
      style: getEnemyStyle(biomeId, 'rifleman'),
    });
    this.type = 'rifleman';
  }
}

export class HeavyGunner extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 128,
      speed: 4.05,
      score: SETTINGS.score.heavy,
      preferredMin: 8,
      preferredMax: 15.5,
      burstMin: 6,
      burstMax: 9,
      burstGap: 0.115,
      cooldown: 2.35,
      spread: 0.095,
      bulletDamage: 9,
      scale: 1.12,
      style: getEnemyStyle(biomeId, 'heavy'),
    });
    this.type = 'heavy';
    this.dropTable = true;
    this.ammoPackDestroyed = false;
    this.ammoPackMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3c22,
      emissive: 0x5a220c,
      emissiveIntensity: 0.25,
      roughness: 0.6,
      metalness: 0.3,
    });
    this.ammoPack = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.24, 0.18),
      this.ammoPackMaterial
    );
    this.ammoPack.position.set(0.44, 1.18, -0.02);
    this.ammoPack.castShadow = true;
    this.rig.root.add(this.ammoPack);
  }

  getWeakPoints() {
    if (this.ammoPackDestroyed) return null;
    const scale = this.baseScale || 1;
    const lx = 0.44;
    const lz = -0.02;
    const c = Math.cos(this.facingAngle);
    const s = Math.sin(this.facingAngle);
    return [
      {
        id: 'ammo',
        x: this.position.x + (lx * c + lz * s) * scale,
        z: this.position.z + (-lx * s + lz * c) * scale,
        radius: 0.3 * scale,
        damageMultiplier: 1.75,
      },
    ];
  }

  onWeakPointHit(weakPoint) {
    if (weakPoint.id !== 'ammo' || this.ammoPackDestroyed) return false;
    this.ammoPackDestroyed = true;
    this.ammoPack.visible = false;
    this.game.ammoPackExplosion(
      new THREE.Vector3(this.position.x, 1.2, this.position.z),
      this
    );
    return true;
  }

  dispose() {
    this.ammoPack.geometry.dispose();
    this.ammoPackMaterial.dispose();
    super.dispose();
  }
}

export class Officer extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 64,
      speed: 6.4,
      score: SETTINGS.score.officer,
      preferredMin: 6.5,
      preferredMax: 12.5,
      burstMin: 4,
      burstMax: 5,
      burstGap: 0.105,
      cooldown: 1.35,
      spread: 0.095,
      bulletDamage: 8,
      scale: 1.03,
      style: getEnemyStyle(biomeId, 'officer'),
    });
    this.type = 'officer';
    this.dropTable = true;
  }
}

/* --------------------------------------------------------------------------
   Biome specialists
   -------------------------------------------------------------------------- */

export class Fanatic extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 30,
      speed: 7.1,
      score: SETTINGS.score.fanatic,
      preferredMin: 4.2,
      preferredMax: 8.2,
      burstMin: 2,
      burstMax: 3,
      burstGap: 0.1,
      cooldown: 1.5,
      spread: 0.15,
      bulletDamage: 5,
      scale: 1.02,
      style: {
        ...getEnemyStyle(biomeId, 'rifleman'),
        accent: 0xd24a2f,
        headgear: 'cap',
      },
      aggressive: true,
    });
    this.type = 'fanatic';
  }
}

export class Sniper extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 46,
      speed: 4.2,
      score: SETTINGS.score.sniper,
      preferredMin: 17,
      preferredMax: 23,
      burstMin: 1,
      burstMax: 1,
      burstGap: 0.1,
      cooldown: 3.1,
      spread: 0.006,
      bulletDamage: 14,
      scale: 1.0,
      style: {
        ...getEnemyStyle(biomeId, 'officer'),
        headgear: 'cap',
      },
      chargeTime: 0.9,
    });
    this.type = 'sniper';

    this._laserMuzzle = new THREE.Vector3();
    this.laserGeometry = new THREE.BufferGeometry();
    this.laserGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    this.laserMaterial = new THREE.LineBasicMaterial({
      color: 0xff4a32,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.laser = new THREE.Line(this.laserGeometry, this.laserMaterial);
    this.laser.frustumCulled = false;
    this.laser.renderOrder = 6;
    this.laser.visible = false;
    this.game.scene.add(this.laser);
  }

  _showChargeVisual() {
    this.laser.visible = true;
    this.game.audio.playSniperCharge?.(this.position, this.chargeTime);
  }

  _updateCharge() {
    if (!this.laser.visible || !this.game.player.alive) return;
    this.rig.getMuzzleWorldPosition(this._laserMuzzle);
    const positions = this.laserGeometry.attributes.position;
    positions.setXYZ(
      0,
      this._laserMuzzle.x,
      Math.max(1.15, this._laserMuzzle.y),
      this._laserMuzzle.z
    );
    positions.setXYZ(
      1,
      this.game.player.position.x,
      1.12,
      this.game.player.position.z
    );
    positions.needsUpdate = true;
    this.laserGeometry.computeBoundingSphere();
    this.laserMaterial.opacity = 0.35 + (Math.sin(this.age * 42) * 0.5 + 0.5) * 0.4;
  }

  _hideChargeVisual() {
    this.laser.visible = false;
  }

  _fireRound(distance) {
    const spread = this.baseSpread + clamp(distance / 80, 0, 1) * 0.004;
    this.shootAtPlayer({
      spread,
      damage: this.bulletDamage,
      speed: 150,
      range: 60,
      color: 0xff5a38,
    });
    this.game.effects.addShake(0.05);
  }

  die() {
    this.laser.visible = false;
    super.die();
  }

  dispose() {
    this.laser.removeFromParent();
    this.laserGeometry.dispose();
    this.laserMaterial.dispose();
    super.dispose();
  }
}

export class Hunter extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 38,
      speed: 6.5,
      score: SETTINGS.score.hunter,
      preferredMin: 4.5,
      preferredMax: 9,
      burstMin: 3,
      burstMax: 4,
      burstGap: 0.1,
      cooldown: 1.7,
      spread: 0.13,
      bulletDamage: 7,
      scale: 1.0,
      style: {
        ...getEnemyStyle(biomeId, 'rifleman'),
        accent: 0x9f4a2e,
        headgear: 'cap',
      },
      pounce: true,
    });
    this.type = 'hunter';
  }
}

export class Sapper extends Enemy {
  constructor(game, options) {
    super(game, { ...options, type: 'sapper' });
    this.type = 'sapper';
    this.radius = 0.5;
    this.baseScale = 1.55;
    this.health = 26 + Math.round(this.difficulty * 10);
    this.maxHealth = this.health;
    this.speed = 7.4 + this.difficulty * 1.1;
    this.scoreValue = SETTINGS.score.sapper;
    this.canDespawn = true;
    this.arming = false;
    this.fuse = 0;
    this.beepTimer = 0;
    this.exploded = false;

    const style = {
      ...getEnemyStyle(this.biomeId, 'mortar'),
      weapon: 'none',
      headgear: 'cap',
      accent: 0xd04a2c,
    };
    this.addRig(style, this.baseScale);

    this.chargePackMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b2a1f,
      emissive: 0x5a1b10,
      emissiveIntensity: 0.35,
      roughness: 0.62,
      metalness: 0.22,
    });
    this.chargePack = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.34, 0.18),
      this.chargePackMaterial
    );
    this.chargePack.position.set(0, 1.18, -0.28);
    this.chargePack.castShadow = true;
    this.rig.root.add(this.chargePack);
  }

  think(dt) {
    const player = this.game.player;
    if (!player.alive) return;
    this.facePoint(player.position.x, player.position.z, dt, 10);

    if (this.arming) {
      this.fuse -= dt;
      this.beepTimer -= dt;
      const pulse = 0.5 + (Math.sin(this.age * 28) * 0.5 + 0.5);
      this.chargePackMaterial.emissiveIntensity = 0.5 + pulse * 2.2;
      this.chargePack.scale.setScalar(1 + pulse * 0.12);
      if (this.beepTimer <= 0) {
        this.beepTimer = 0.16;
        this.game.audio.playSapperBeep?.(this.position);
      }
      if (this.fuse <= 0) this._detonate();
      return;
    }

    const pressure = 0.84 + 0.16 * this.game.battleTempo;
    this.animSpeed = this.moveToward(
      player.position.x,
      player.position.z,
      dt,
      this.speed * pressure
    );

    const distance = Math.hypot(
      player.position.x - this.position.x,
      player.position.z - this.position.z
    );
    if (distance < 2.7) {
      this.arming = true;
      this.fuse = 0.65;
      this.beepTimer = 0;
      this.animSpeed = 0;
      this.game.audio.playSapperBeep?.(this.position);
    }
  }

  _detonate() {
    if (!this.alive || this.exploded) return;
    this.exploded = true;
    this.game.sapperExplosion(this.position, this);
    this.die();
  }

  die() {
    if (!this.alive) return;
    const alreadyExploded = this.exploded;
    super.die();
    if (!alreadyExploded) {
      this.exploded = true;
      this.game.sapperExplosion(this.position, this);
    }
  }

  dispose() {
    this.chargePack.geometry.dispose();
    this.chargePackMaterial.dispose();
    super.dispose();
  }
}

/* --------------------------------------------------------------------------
   Mortar team
   -------------------------------------------------------------------------- */

export class MortarTeam extends Enemy {
  constructor(game, options) {
    super(game, options);
    this.type = 'mortar';
    this.radius = 1.1;
    this.health = 92 + Math.round(this.difficulty * 40);
    this.maxHealth = this.health;
    this.scoreValue = SETTINGS.score.mortar;
    this.canDespawn = true;
    this.baseScale = 1.6;
    const mortarStyle = {
      ...getEnemyStyle(this.biomeId, 'mortar'),
      weapon: 'none',
    };
    this.addRig(mortarStyle, 1.6);
    this.shellCooldown = rand(2.2, 4.2);
    this.firing = 0;
    this.animSpeed = 0;
    this._buildEmplacement();
  }

  _buildEmplacement() {
    const parts = [];
    // Base plate
    parts.push(part(new THREE.CylinderGeometry(0.55, 0.65, 0.16, 12), 0x3d4038, { x: 0, y: 0.12, z: 0 }));
    // Angled tube, aimed toward -Z.
    const tube = new THREE.CylinderGeometry(0.085, 0.11, 1.7, 10);
    tube.translate(0, 0.85, 0);
    tube.applyMatrix4(
      new THREE.Matrix4().makeRotationX(-0.62)
    );
    colorize(tube, 0x2a2e27);
    parts.push(tube);
    const collar = new THREE.CylinderGeometry(0.145, 0.145, 0.2, 10);
    collar.translate(0, 1.68, 0);
    colorize(collar, 0x474a3d);
    parts.push(collar);
    for (const side of [-1, 1]) {
      parts.push(
        part(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 5), 0x3b3e32, {
          x: side * 0.36,
          y: 0.6,
          z: -0.15,
        }, { x: -0.25, y: 0, z: side * 0.45 })
      );
    }
    // Shell crate.
    parts.push(part(new THREE.BoxGeometry(0.7, 0.35, 0.45), 0x4b4a2a, { x: 0.9, y: 0.22, z: 0.3 }));
    // Sandbag screen.
    for (let i = 0; i < 6; i++) {
      parts.push(
        part(
          new THREE.SphereGeometry(0.5, 8, 6),
          0x8d7d59,
          { x: -1.2 + i * 0.75, y: 0.32, z: -0.85 },
          { x: 0, y: rand(-0.1, 0.1), z: 0 },
          { x: 1.25, y: 0.42, z: 0.7 }
        )
      );
    }
    const geometry = mergeParts(parts);
    this.emplacement = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.04 })
    );
    this.emplacement.position.set(this.position.x, 0.02, this.position.z);
    this.emplacement.scale.setScalar(1.2);
    this.emplacement.castShadow = true;
    this.emplacement.receiveShadow = true;
    this.game.scene.add(this.emplacement);
    this.extraObjects.push(this.emplacement);

    // A spotter/loader gives the position a two-man silhouette.
    this.spotter = new SoldierRig({
      ...getEnemyStyle(this.biomeId, 'mortar'),
      weapon: 'none',
    });
    this.spotter.root.position.set(this.position.x - 1.5, 0.032, this.position.z - 0.5);
    this.spotter.root.scale.setScalar(1.4);
    this.spotter.root.rotation.y = rand(-0.4, 0.4);
    this.game.scene.add(this.spotter.root);
    this.extraObjects.push(this.spotter.root);
    this.spotterPhase = rand(0, 6);

    // Keep the team from spawning inside their own sandbag screen.
    this.position.z += 0.9;
    this.emplacementCollider = this.game.terrain.addCollider({
      x: this.position.x,
      z: this.position.z - 0.5,
      radius: 1.1,
      type: 'mortar',
      blocksMovement: true,
      blocksBullets: false,
    });
  }

  think(dt) {
    const player = this.game.player;
    if (!player.alive || !this.isInCombatBand()) return;
    const distance = Math.hypot(
      player.position.x - this.position.x,
      player.position.z - this.position.z
    );
    this.facePoint(player.position.x, player.position.z, dt, 5);
    this.spotter.root.rotation.y = damp(
      this.spotter.root.rotation.y,
      Math.atan2(player.position.x - this.spotter.root.position.x, player.position.z - this.spotter.root.position.z),
      4,
      dt
    );
    this.spotter.update(dt, { speed: 0, aiming: true });

    this.shellCooldown -= dt * this.game.battleTempo;
    if (this.firing > 0) {
      this.firing -= dt;
      if (this.firing <= 0) this._launchShell(distance);
    }
    if (this.shellCooldown <= 0 && distance > 5 && distance < 72) {
      this.shellCooldown = (5.8 + rand(0, 2.8)) * (1.15 - this.difficulty * 0.25);
      this.firing = 0.5;
    }
  }

  _launchShell(distance) {
    if (!this.game.player.alive || !this.isInCombatBand()) return;
    const player = this.game.player;
    const duration = clamp(1.85 + distance * 0.013, 1.9, 2.5);
    const lead = duration * 0.52;
    const target = new THREE.Vector3(
      clamp(player.position.x + player.velocity.x * lead + rand(-2.2, 2.2), -SETTINGS.mission.width, SETTINGS.mission.width),
      0.14,
      clamp(player.position.z + player.velocity.z * lead + rand(-2.0, 2.0), this.game.scroll - 2, this.game.scroll + 80)
    );
    const muzzle = new THREE.Vector3(
      this.position.x,
      1.6,
      this.position.z - 0.5
    );
    this.game.grenades.spawnMortarShell(muzzle, target, {
      duration,
      radius: 4.4,
      damage: 23 + Math.round(this.difficulty * 7),
    });
    this.game.particles.spawnMuzzle(muzzle, new THREE.Vector3(0, 0, -1));
    this.game.particles.spawnDust(
      new THREE.Vector3(this.position.x, 0.2, this.position.z - 0.5),
      1.8,
      0.35
    );
    this.game.lighting.muzzleFlash(muzzle, 0xffa85c, 32, 13, 0.18);
    this.game.audio.playMortarLaunch(muzzle);
    this.animSpeed = 0;
  }

  applyShove(fromX, fromZ, force = 6, duration = 0.55, damage = 0) {
    if (!this.alive) return false;
    this.hitPunch = 1;
    if (damage > 0) {
      this.health -= damage;
      if (this.health <= 0) this.die();
    }
    return true;
  }

  die() {
    super.die();
    if (!this.removeFlag) {
      const position = new THREE.Vector3(this.position.x, 0.5, this.position.z);
      this.game.particles.spawnExplosion(position, 1.2);
      this.game.lighting.explosion(position, 0xff8d48, 220, 20, 0.4);
    }
  }

  dispose() {
    if (this.emplacementCollider) this.emplacementCollider.disabled = true;
    this.spotter?.dispose();
    super.dispose();
  }
}

/* --------------------------------------------------------------------------
   Armored officer truck
   -------------------------------------------------------------------------- */

function buildTruckGeometry() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(2.55, 0.55, 4.9), 0x474d37, { x: 0, y: 0.78, z: 0 }));
  parts.push(part(new THREE.BoxGeometry(2.35, 1.15, 2.8), 0x5d6644, { x: 0, y: 1.55, z: -0.45 }));
  parts.push(part(new THREE.BoxGeometry(2.15, 1.0, 1.5), 0x4e563b, { x: 0, y: 1.55, z: 1.6 }));
  parts.push(part(new THREE.BoxGeometry(2.02, 0.42, 0.06), 0x17231f, { x: 0, y: 1.8, z: 2.36 }));
  parts.push(part(new THREE.BoxGeometry(2.1, 0.48, 0.06), 0x17231f, { x: 0, y: 1.76, z: 0.86 }));
  parts.push(part(new THREE.BoxGeometry(2.4, 0.16, 4.6), 0x313627, { x: 0, y: 2.25, z: -0.6 }));
  parts.push(part(new THREE.BoxGeometry(0.22, 0.9, 3.9), 0x30372a, { x: -1.22, y: 0.95, z: -0.8 }));
  parts.push(part(new THREE.BoxGeometry(0.22, 0.9, 3.9), 0x30372a, { x: 1.22, y: 0.95, z: -0.8 }));
  parts.push(part(new THREE.BoxGeometry(2.5, 0.25, 0.24), 0x24291e, { x: 0, y: 0.65, z: 2.45 }));
  parts.push(part(new THREE.BoxGeometry(2.5, 0.25, 0.24), 0x24291e, { x: 0, y: 0.65, z: -2.45 }));
  parts.push(part(new THREE.BoxGeometry(0.08, 0.08, 1.0), 0x2b2f24, { x: 0.9, y: 2.35, z: -2.9 }));
  parts.push(part(new THREE.BoxGeometry(0.8, 0.38, 0.02), 0x9d2b22, { x: 0.5, y: 2.46, z: -2.9 }));
  parts.push(part(new THREE.BoxGeometry(0.16, 0.16, 0.16), 0xffc06a, { x: -1.05, y: 1.25, z: 2.38 }));
  // Wheels
  for (const x of [-1.28, 1.28]) {
    for (const z of [-1.7, 0.2, 1.75]) {
      parts.push(
        part(new THREE.CylinderGeometry(0.48, 0.48, 0.32, 12), 0x1b1d19, {
          x,
          y: 0.5,
          z,
        }, { x: 0, y: 0, z: Math.PI / 2 })
      );
      parts.push(
        part(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 8), 0x595b4d, {
          x,
          y: 0.5,
          z,
        }, { x: 0, y: 0, z: Math.PI / 2 })
      );
    }
  }
  return mergeParts(parts);
}

const TRUCK_VARIANTS = {
  standard: {
    label: 'ARMORED COMMAND TRUCK',
    speed: 5.8,
    health: 1,
    turretBurst: 4,
    deploy: [6.5, 9.5],
  },
  wetlands: {
    label: 'RIVER PATROL BOAT',
    speed: 7.2,
    health: 0.95,
    turretBurst: 4,
    deploy: [8, 11],
    pontoons: true,
  },
  desert: {
    label: 'SHIELDED APC',
    speed: 4.5,
    health: 1.18,
    turretBurst: 5,
    deploy: [7, 10],
    armor: 0.82,
    armorPlates: true,
  },
  city: {
    label: 'SIEGE MORTAR CARRIER',
    speed: 5.0,
    health: 1.08,
    turretBurst: 4,
    deploy: [8, 12],
    mortar: true,
  },
  snow: {
    label: 'SNOWCAT MORTAR CARRIER',
    speed: 4.8,
    health: 1.1,
    turretBurst: 3,
    deploy: [7, 10],
    mortar: true,
    tracks: true,
  },
};

function buildTurretGeometry() {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.45, 0.55, 0.24, 10), 0x343b2b, { x: 0, y: 0.1, z: 0 }));
  parts.push(part(new THREE.BoxGeometry(0.5, 0.42, 0.9), 0x2b3025, { x: 0, y: 0.35, z: 0 }));
  parts.push(part(new THREE.BoxGeometry(0.85, 0.5, 0.12), 0x525c42, { x: 0, y: 0.42, z: 0.3 }));
  parts.push(part(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 7), 0x1d211b, {
    x: 0,
    y: 0.36,
    z: 0.9,
  }, { x: Math.PI / 2, y: 0, z: 0 }));
  parts.push(part(new THREE.BoxGeometry(0.16, 0.16, 0.22), 0x7f7a55, { x: 0, y: 0.36, z: 1.42 }));
  return mergeParts(parts);
}

export class OfficerTruck extends Enemy {
  constructor(game, options) {
    super(game, options);
    this.type = 'truck';
    this.variant =
      TRUCK_VARIANTS[options.variant] ||
      TRUCK_VARIANTS[this.biomeId] ||
      TRUCK_VARIANTS.standard;
    this.displayName = this.variant.label;
    this.radius = 2.35;
    this.baseScale = 1.25;
    this.health =
      (360 + Math.round(this.difficulty * 140)) * this.variant.health;
    this.maxHealth = this.health;
    this.scoreValue = SETTINGS.score.truck;
    this.canDespawn = false;
    this.speed = this.variant.speed;
    this.preferredDistance = 15;
    this.lanePhase = rand(0, Math.PI * 2);
    this.turretYaw = 0;
    this.burstRemaining = 0;
    this.burstTimer = 0;
    this.fireCooldown = rand(2, 3.6);
    this.deployCooldown = rand(3.5, 6);
    this.animSpeed = 0;
    this.turretRecoil = 0;
    this.smokeTimer = 0;
    this.turretHealth = 95 + Math.round(this.difficulty * 35);
    this.fuelHealth = 55 + Math.round(this.difficulty * 25);
    this.turretDisabled = false;
    this.fuelDestroyed = false;
    this.mortarCooldown = rand(4, 6.5);

    this.truckRoot = new THREE.Group();
    this.truckRoot.position.copy(this.position);
    this.game.scene.add(this.truckRoot);

    const biomeTint = getBiomeTint(this.biomeId);
    this.hullMaterial = vehicleMaterial.clone();
    this.hullMaterial.color.setHex(biomeTint);
    this.hull = new THREE.Mesh(buildTruckGeometry(), this.hullMaterial);
    this.hull.castShadow = true;
    this.hull.receiveShadow = true;
    this.truckRoot.add(this.hull);

    this.turret = new THREE.Group();
    this.turret.position.set(0, 2.15, -0.55);
    this.truckRoot.add(this.turret);
    this.turretMaterial = turretMaterial.clone();
    this.turretMaterial.color.setHex(biomeTint);
    this.turretMesh = new THREE.Mesh(buildTurretGeometry(), this.turretMaterial);
    this.turretMesh.castShadow = true;
    this.turret.add(this.turretMesh);

    this.turretMuzzle = new THREE.Object3D();
    this.turretMuzzle.position.set(0, 0.36, 1.5);
    this.turret.add(this.turretMuzzle);

    this.turretFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getSparkTexture(),
        color: 0xffc677,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.turretFlash.scale.setScalar(1.1);
    this.turretFlash.position.copy(this.turretMuzzle.position);
    this.turretFlash.visible = false;
    this.turret.add(this.turretFlash);

    // Glowing headlamps.
    this.headlights = [];
    for (const x of [-0.8, 0.8]) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 7, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd69b, toneMapped: false })
      );
      lamp.position.set(x, 1.1, 2.38);
      this.truckRoot.add(lamp);
      this.headlights.push(lamp);
    }

    this._tmpPlayer = new THREE.Vector3();
    this._turretWorld = new THREE.Vector3();
    this._dustTimer = 0;

    this._buildVariantHardware();
  }

  _buildVariantHardware() {
    const hardware = new THREE.MeshStandardMaterial({
      color: 0x434942,
      roughness: 0.62,
      metalness: 0.38,
    });

    if (this.variant.pontoons) {
      for (const side of [-1, 1]) {
        const pontoon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.36, 0.36, 4.8, 10),
          hardware
        );
        pontoon.rotation.x = Math.PI / 2;
        pontoon.position.set(side * 1.62, 0.45, 0);
        pontoon.castShadow = true;
        pontoon.receiveShadow = true;
        this.truckRoot.add(pontoon);
      }
    }

    if (this.variant.armorPlates) {
      const plateMaterial = new THREE.MeshStandardMaterial({
        color: 0x505752,
        roughness: 0.55,
        metalness: 0.5,
      });
      const frontPlate = new THREE.Mesh(
        new THREE.BoxGeometry(2.65, 0.85, 0.18),
        plateMaterial
      );
      frontPlate.position.set(0, 1.2, 2.3);
      frontPlate.rotation.x = -0.22;
      frontPlate.castShadow = true;
      this.truckRoot.add(frontPlate);
      for (const side of [-1, 1]) {
        const skirt = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.55, 3.9),
          plateMaterial
        );
        skirt.position.set(side * 1.38, 0.72, -0.2);
        skirt.castShadow = true;
        this.truckRoot.add(skirt);
      }
    }

    if (this.variant.tracks) {
      const trackMaterial = new THREE.MeshStandardMaterial({
        color: 0x242724,
        roughness: 0.85,
        metalness: 0.22,
      });
      for (const side of [-1, 1]) {
        const track = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.72, 4.6),
          trackMaterial
        );
        track.position.set(side * 1.38, 0.42, 0);
        track.castShadow = true;
        this.truckRoot.add(track);
      }
    }

    if (this.variant.mortar) {
      const mortarMaterial = new THREE.MeshStandardMaterial({
        color: 0x2c302a,
        roughness: 0.5,
        metalness: 0.56,
      });
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 1.5, 10),
        mortarMaterial
      );
      tube.position.set(0, 1.85, -1.85);
      tube.rotation.x = -0.72;
      tube.castShadow = true;
      this.truckRoot.add(tube);
      const mount = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.42, 0.24, 10),
        mortarMaterial
      );
      mount.position.set(0, 1.3, -1.55);
      this.truckRoot.add(mount);
    }

    this.fuelDrumMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a3324,
      roughness: 0.58,
      metalness: 0.4,
    });
    this.fuelDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.8, 10),
      this.fuelDrumMaterial
    );
    this.fuelDrum.position.set(-1.0, 1.0, -2.1);
    this.fuelDrum.castShadow = true;
    this.truckRoot.add(this.fuelDrum);
  }

  think(dt) {
    const player = this.game.player;
    if (!player.alive) {
      this.animSpeed = damp(this.animSpeed, 0, 4, dt);
      return;
    }
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distance = Math.hypot(dx, dz) || 0.001;

    const lane = Math.sin(this.age * 0.46 + this.lanePhase) * 6.8;
    let targetX = clamp(player.position.x + lane, -SETTINGS.mission.width + 4, SETTINGS.mission.width - 4);
    let targetZ = player.position.z + 8.2 + Math.sin(this.age * 0.31 + 1.2) * 1.4;
    if (distance < 6) {
      targetX = this.position.x - (dx / distance) * 6;
      targetZ = player.position.z + 10;
    }
    targetZ = clamp(targetZ, this.game.scroll + 4, this.game.scroll + 17);

    const moveDx = targetX - this.position.x;
    const moveDz = targetZ - this.position.z;
    const moveDist = Math.hypot(moveDx, moveDz);
    let desiredSpeed = clamp(moveDist * 1.5, 0, this.speed);
    if (moveDist < 0.5) desiredSpeed = 0;
    if (moveDist > 0.01) {
      this.position.x += (moveDx / moveDist) * desiredSpeed * dt;
      this.position.z += (moveDz / moveDist) * desiredSpeed * dt;
      this.game.terrain.resolveCircle(this.position, this.radius);
      this.position.x = clamp(this.position.x, -SETTINGS.mission.width + 2, SETTINGS.mission.width - 2);
      this.position.z = clamp(this.position.z, this.game.scroll + 2, this.game.scroll + 27);
    }
    this.animSpeed = desiredSpeed;

    const facing = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
    this.facingAngle = dampAngle(this.facingAngle, facing, 2.7, dt);
    this.truckRoot.rotation.y = this.facingAngle;

    // Turret tracks independently.
    const targetTurretYaw = Math.atan2(dx, dz) - this.facingAngle;
    this.turret.rotation.y = dampAngle(this.turret.rotation.y, targetTurretYaw, 8, dt);
    this.turretRecoil = damp(this.turretRecoil, 0, 13, dt);
    this.turretMesh.position.z = -this.turretRecoil * 0.08;

    this._updateTurretFire(dt, distance);
    this._updateDeployment(dt);
    if (this.variant.mortar) this._updateMortar(dt, distance);
    this._updateDamageSmoke(dt);
  }

  _updateTurretFire(dt, distance) {
    if (this.turretDisabled) return;
    if (this.burstRemaining > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._fireTurret();
        this.burstRemaining--;
        this.burstTimer = 0.13;
        if (this.burstRemaining <= 0) this.fireCooldown = rand(3.2, 4.4);
      }
      return;
    }
    this.fireCooldown -= dt * this.game.battleTempo;
    if (
      this.fireCooldown <= 0 &&
      distance < 28 &&
      this.game.terrain.hasLineOfSight(this.position, this.game.player.position)
    ) {
      this.burstRemaining =
        this.variant.turretBurst + Math.floor(this.difficulty * 2);
      this.burstTimer = 0;
    }
  }

  _fireTurret() {
    if (!this.game.player.alive || !this.isInCombatBand()) return;
    this.turretMuzzle.getWorldPosition(this._turretWorld);
    const player = this.game.player;
    const distance = player.position.distanceTo(this.position);
    const lead = (distance / 105) * 0.5;
    const target = new THREE.Vector3(
      player.position.x + player.velocity.x * lead,
      1.15,
      player.position.z + player.velocity.z * lead
    );
    const direction = target.sub(this._turretWorld);
    direction.y = 0;
    direction.normalize();
    this.game.bullets.spawn({
      origin: this._turretWorld,
      direction,
      speed: 100,
      damage: 5,
      faction: 'enemy',
      spread: 0.07,
      range: 48,
      color: 0xffa06a,
    });
    this.game.particles.spawnMuzzle(
      this._turretWorld,
      new THREE.Vector3(direction.x, 0, direction.z)
    );
    this.game.lighting.muzzleFlash(this._turretWorld, 0xffb066, 24, 10, 0.07);
    this.game.audio.playGunshot(this._turretWorld, true);
    this.turretFlash.visible = true;
    this.turretFlash.material.rotation = Math.random() * Math.PI * 2;
    this.turretRecoil = 1;
    window.setTimeout(() => {
      this.turretFlash.visible = false;
    }, 55);
  }

  _updateDeployment(dt) {
    this.deployCooldown -= dt * this.game.battleTempo;
    if (this.deployCooldown <= 0) {
      this.deployCooldown = rand(this.variant.deploy[0], this.variant.deploy[1]);
      if (this.alive && this.game.player.alive) {
        this.game.spawnTruckInfantry(new THREE.Vector3(this.position.x, 0, this.position.z - 2.5));
        this.game.particles.spawnDust(
          new THREE.Vector3(this.position.x, 0.2, this.position.z - 3),
          1.5,
          0.3
        );
      }
    }
  }

  _updateMortar(dt, distance) {
    if (!this.game.player.alive) return;
    this.mortarCooldown -= dt * this.game.battleTempo;
    if (
      this.mortarCooldown <= 0 &&
      distance < 62 &&
      this.isInCombatBand()
    ) {
      this.mortarCooldown = rand(8, 12);
      const player = this.game.player;
      const duration = 2.15;
      const target = new THREE.Vector3(
        clamp(
          player.position.x + player.velocity.x * 0.9 + rand(-1.4, 1.4),
          -SETTINGS.mission.width,
          SETTINGS.mission.width
        ),
        0.14,
        clamp(
          player.position.z + player.velocity.z * 0.9 + rand(-1.4, 1.4),
          this.game.scroll - 2,
          this.game.scroll + 80
        )
      );
      const muzzle = new THREE.Vector3(
        this.position.x,
        2.3,
        this.position.z - 2.1
      );
      this.game.grenades.spawnMortarShell(muzzle, target, {
        duration,
        radius: 3.9,
        damage: 18 + Math.round(this.difficulty * 6),
      });
      this.game.particles.spawnMuzzle(muzzle, new THREE.Vector3(0, 0.4, -1));
      this.game.particles.spawnDust(
        new THREE.Vector3(this.position.x, 0.3, this.position.z - 2.1),
        1.8,
        0.34
      );
      this.game.lighting.muzzleFlash(muzzle, 0xffa85c, 28, 12, 0.16);
      this.game.audio.playMortarLaunch(muzzle);
    }
  }

  _updateDamageSmoke(dt) {
    const healthRatio = this.health / this.maxHealth;
    if (this.turretDisabled) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.22;
        this.game.particles.spawnSmokeColumn(
          new THREE.Vector3(this.position.x, 2.4, this.position.z - 0.5),
          false,
          false
        );
      }
    }
    if (healthRatio < 0.55) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = healthRatio < 0.25 ? 0.09 : 0.18;
        this.game.particles.spawnSmokeColumn(
          new THREE.Vector3(this.position.x + rand(-0.8, 0.8), 1.9, this.position.z - 0.4),
          healthRatio < 0.25
        );
        if (chance(0.4)) {
          this.game.particles.spawnEmber(
            new THREE.Vector3(this.position.x, 2.0, this.position.z - 0.3),
            0.9
          );
        }
      }
    }
  }

  update(dt) {
    this.age += dt;
    this.hitPunch = damp(this.hitPunch, 0, 8, dt);
    if (!this.alive) {
      this._updateDeath(dt);
      return;
    }
    this.think(dt);
    this.truckRoot.position.set(
      this.position.x,
      0.035 + Math.sin(this.age * 9) * 0.012 + this.hitPunch * 0.015,
      this.position.z
    );
    this.truckRoot.rotation.z = damp(
      this.truckRoot.rotation.z,
      clamp(-this.animSpeed * 0.003, -0.018, 0.018),
      4,
      dt
    );
    this.truckRoot.scale.setScalar((1 + this.hitPunch * 0.02) * (this.baseScale || 1));
    this.truckRoot.rotation.x = damp(this.truckRoot.rotation.x, 0, 3, dt);

    if (this.animSpeed > 1.5) {
      this._dustTimer -= dt;
      if (this._dustTimer <= 0) {
        this._dustTimer = 0.17;
        this.game.particles.spawnDust(
          new THREE.Vector3(
            this.position.x + rand(-1.2, 1.2),
            0.05,
            this.position.z - 2.4
          ),
          1.5,
          0.22
        );
      }
    }

    // The truck is a physical threat and gently shoulders the player aside.
    const player = this.game.player;
    if (player.alive) {
      const px = player.position.x - this.position.x;
      const pz = player.position.z - this.position.z;
      const dist = Math.hypot(px, pz);
      const minDist = this.radius + player.radius + 0.1;
      if (dist < minDist && dist > 0.001) {
        player.position.x += (px / dist) * (minDist - dist);
        player.position.z += (pz / dist) * (minDist - dist);
      }
    }
  }

  takeDamage(amount, hitPosition, sourcePosition) {
    if (!this.alive) return false;
    let damage = amount;
    if (this.variant.armor && sourcePosition) {
      const forwardX = Math.sin(this.facingAngle);
      const forwardZ = Math.cos(this.facingAngle);
      const dx = sourcePosition.x - this.position.x;
      const dz = sourcePosition.z - this.position.z;
      const length = Math.hypot(dx, dz) || 1;
      const facing = (dx * forwardX + dz * forwardZ) / length;
      if (facing > 0.2) damage *= this.variant.armor;
    }
    this.health -= damage;
    this.hitPunch = 1;
    const hit = hitPosition || new THREE.Vector3(this.position.x, 1.5, this.position.z);
    this.game.particles.spawnImpact(hit, 0xffc06a, new THREE.Vector3(0, 0, 1), 1.2);
    this.game.audio.playRicochet(hit);
    if (this.health <= 0) this.die();
    return true;
  }

  _weakPointWorld(id, lx, lz, radius, damageMultiplier) {
    const scale = this.baseScale || 1;
    const c = Math.cos(this.facingAngle);
    const s = Math.sin(this.facingAngle);
    return {
      id,
      x: this.position.x + (lx * c + lz * s) * scale,
      z: this.position.z + (-lx * s + lz * c) * scale,
      radius: radius * scale,
      damageMultiplier,
    };
  }

  getWeakPoints() {
    const points = [];
    if (!this.turretDisabled) {
      points.push(this._weakPointWorld('turret', 0, -0.55, 0.42, 1.3));
    }
    if (!this.fuelDestroyed) {
      points.push(this._weakPointWorld('fuel', -1.0, -2.1, 0.38, 1.9));
    }
    return points;
  }

  onWeakPointHit(weakPoint, damage, hitPosition) {
    if (weakPoint.id === 'turret' && !this.turretDisabled) {
      this.turretHealth -= damage;
      this.game.particles.spawnImpact(
        hitPosition,
        0xffb066,
        new THREE.Vector3(0, 0, 1),
        1.3
      );
      this.game.audio.playRicochet(hitPosition);
      this.turretRecoil = 1;
      if (this.turretHealth <= 0) {
        this.turretDisabled = true;
        this.turret.rotation.z = 0.42;
        this.turretFlash.visible = false;
        this.game.onWeakPointDestroyed(this, 'turret');
      }
      return true;
    }
    if (weakPoint.id === 'fuel' && !this.fuelDestroyed) {
      this.fuelHealth -= damage;
      this.game.particles.spawnImpact(
        hitPosition,
        0xffc06a,
        new THREE.Vector3(0, 0, 1),
        1.6
      );
      this.game.audio.playRicochet(hitPosition);
      if (this.fuelHealth <= 0) {
        this.fuelDestroyed = true;
        this.fuelDrum.visible = false;
        this.game.truckFuelExplosion(this);
      }
      return true;
    }
    return false;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.deathTime = 0;
    const position = new THREE.Vector3(this.position.x, 0.7, this.position.z);
    this.game.particles.spawnExplosion(position, 2.1);
    this.game.particles.spawnExplosion(
      new THREE.Vector3(this.position.x + 0.8, 0.3, this.position.z - 1),
      1.2
    );
    this.game.lighting.explosion(position, 0xff8138, 900, 44, 0.8);
    this.game.effects.explosionShake(position, this.game.player.position, 1.6);
    this.game.audio.playExplosion(this.position, 1.5);
    this.game.terrain.addScorch(position, 9);
    this.game.onEnemyKilled(this);
  }

  _updateDeath(dt) {
    this.deathTime += dt;
    const t = Math.min(1, this.deathTime / 1.2);
    this.truckRoot.rotation.z = damp(this.truckRoot.rotation.z, 0.28, 2.2, dt);
    this.truckRoot.rotation.x = damp(this.truckRoot.rotation.x, 0.1, 2, dt);
    this.truckRoot.position.y = damp(this.truckRoot.position.y, -0.35, 1.2, dt);
    this.turretFlash.visible = false;
    if (this.deathTime > 0.5 && this.deathTime < 2.4) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        this.game.particles.spawnSmokeColumn(
          new THREE.Vector3(this.position.x, 1.4, this.position.z),
          true
        );
        this.game.particles.spawnEmber(
          new THREE.Vector3(this.position.x + rand(-0.8, 0.8), 1.2, this.position.z),
          1.1
        );
      }
    }
    this.truckRoot.visible = t < 1 || this.deathTime < 4.5;
    if (this.deathTime > 4.8) this.removeFlag = true;
  }

  dispose() {
    this.truckRoot.removeFromParent();
    this.extraObjects.length = 0;
  }
}
