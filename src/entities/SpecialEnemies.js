import * as THREE from 'three';
import { Enemy, Infantry } from './Enemy.js';
import { getEnemyStyle } from '../config/biomes.js';
import { SETTINGS } from '../config/settings.js';
import { clamp, damp, rand, chance } from '../utils/math.js';
import { getGlowTexture } from '../utils/textures.js';

/* --------------------------------------------------------------------------
   Quadruped animals
   -------------------------------------------------------------------------- */

/**
 * Lightweight procedural quadruped used by hounds, boars, crocodiles and
 * bears. It exposes the same minimal rig interface as SoldierRig: `root`,
 * `update()` and `dispose()`.
 */
class QuadrupedRig {
  constructor(options = {}) {
    const {
      bodyColor = 0x5b5145,
      backColor = 0x3a342c,
      bellyColor = 0x8b7c65,
      eyeColor = 0xffa43d,
      length = 1.2,
      width = 0.48,
      height = 0.48,
      legLength = 0.42,
      headLength = 0.46,
      headWidth = 0.38,
      headHeight = 0.34,
      tailLength = 0.55,
      ears = 'pointed',
      tusks = false,
      mane = false,
      stripes = false,
      low = false,
    } = options;

    this.root = new THREE.Group();
    this.time = rand(0, 10);
    this.phase = rand(0, Math.PI * 2);
    this.attackPulse = 0;
    this.materials = [];
    this.geometries = [];

    const mat = (color, roughness = 0.86) => {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0.02,
        flatShading: true,
      });
      this.materials.push(material);
      return material;
    };
    const bodyMaterial = mat(bodyColor);
    const backMaterial = mat(backColor, 0.92);
    const bellyMaterial = mat(bellyColor, 0.9);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: eyeColor });
    const hornMaterial = mat(0xe3d8b1, 0.55);
    this.materials.push(eyeMaterial);

    const bodyY = low ? legLength + height * 0.42 : legLength + height * 0.5;
    this.bodyBaseY = bodyY;
    this.body = new THREE.Group();
    this.body.position.y = bodyY;
    this.root.add(this.body);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(shadowMaterial);
    const shadow = new THREE.Mesh(
      this._track(new THREE.CircleGeometry(Math.max(width, 0.4) * 0.78, 18)),
      shadowMaterial
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.035;
    this.root.add(shadow);

    const body = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(width, height, length)),
      bodyMaterial
    );
    body.castShadow = true;
    this.body.add(body);

    const back = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(width * 0.84, height * 0.22, length * 0.82)),
      backMaterial
    );
    back.position.y = height * 0.52;
    back.position.z = -length * 0.02;
    back.castShadow = true;
    this.body.add(back);

    const belly = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(width * 0.76, height * 0.24, length * 0.74)),
      bellyMaterial
    );
    belly.position.y = -height * 0.42;
    this.body.add(belly);

    if (mane) {
      for (let i = 0; i < 5; i++) {
        const tuft = new THREE.Mesh(
          this._track(new THREE.ConeGeometry(width * 0.16, height * 0.35, 4)),
          backMaterial
        );
        tuft.position.set(0, height * 0.66, -length * 0.32 + i * length * 0.12);
        tuft.rotation.x = rand(-0.4, 0.4);
        this.body.add(tuft);
      }
    }

    if (stripes) {
      for (let i = 0; i < 4; i++) {
        const stripe = new THREE.Mesh(
          this._track(new THREE.BoxGeometry(width * 1.02, height * 0.57, 0.08)),
          backMaterial
        );
        stripe.position.set(0, height * 0.24, -length * 0.28 + i * length * 0.16);
        stripe.rotation.z = rand(-0.15, 0.15);
        this.body.add(stripe);
      }
    }

    this.head = new THREE.Group();
    this.headBaseZ = length * 0.48;
    this.head.position.set(0, height * 0.34, this.headBaseZ);
    this.body.add(this.head);
    const skull = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(headWidth, headHeight, headLength)),
      bodyMaterial
    );
    skull.castShadow = true;
    this.head.add(skull);

    const snout = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(headWidth * 0.62, headHeight * 0.46, headLength * 0.62)),
      bellyMaterial
    );
    snout.position.set(0, -headHeight * 0.18, headLength * 0.58);
    this.head.add(snout);

    const nose = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(headWidth * 0.28, headHeight * 0.2, 0.1)),
      backMaterial
    );
    nose.position.set(0, -headHeight * 0.2, headLength * 0.91);
    this.head.add(nose);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        this._track(new THREE.SphereGeometry(headWidth * 0.065, 6, 5)),
        eyeMaterial
      );
      eye.position.set(side * headWidth * 0.34, headHeight * 0.1, headLength * 0.32);
      this.head.add(eye);

      if (ears === 'pointed') {
        const ear = new THREE.Mesh(
          this._track(new THREE.ConeGeometry(headWidth * 0.16, headHeight * 0.72, 3)),
          bodyMaterial
        );
        ear.position.set(side * headWidth * 0.32, headHeight * 0.67, -headLength * 0.08);
        ear.rotation.z = side * -0.24;
        this.head.add(ear);
      } else if (ears === 'round') {
        const ear = new THREE.Mesh(
          this._track(new THREE.SphereGeometry(headWidth * 0.19, 6, 5)),
          bodyMaterial
        );
        ear.position.set(side * headWidth * 0.4, headHeight * 0.48, -headLength * 0.04);
        ear.scale.y = 0.7;
        this.head.add(ear);
      }

      if (tusks) {
        const tusk = new THREE.Mesh(
          this._track(new THREE.ConeGeometry(0.035, 0.18, 5)),
          hornMaterial
        );
        tusk.position.set(side * headWidth * 0.28, -headHeight * 0.3, headLength * 0.72);
        tusk.rotation.x = -0.35;
        tusk.rotation.z = side * 0.35;
        this.head.add(tusk);
      }
    }

    this.tail = new THREE.Group();
    this.tail.position.set(0, height * 0.28, -length * 0.5);
    this.body.add(this.tail);
    const tail = new THREE.Mesh(
      this._track(new THREE.CylinderGeometry(width * 0.07, width * 0.12, tailLength, 5)),
      backMaterial
    );
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -tailLength * 0.5;
    this.tail.add(tail);

    this.legs = [];
    const legWidth = width * 0.24;
    for (const xSide of [-1, 1]) {
      for (const zSide of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(xSide * width * 0.34, legLength, zSide * length * 0.32);
        this.root.add(pivot);
        const leg = new THREE.Mesh(
          this._track(new THREE.BoxGeometry(legWidth, legLength, legWidth)),
          bodyMaterial
        );
        leg.position.y = -legLength * 0.5;
        leg.castShadow = true;
        pivot.add(leg);
        this.legs.push({ pivot, side: xSide, front: zSide > 0 });
      }
    }
  }

  _track(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  update(dt, { speed = 0 } = {}) {
    this.time += dt;
    const stride = clamp(speed / 7, 0, 1.7);
    this.phase += dt * (2.6 + speed * 1.35);
    this.body.position.y =
      this.bodyBaseY + Math.abs(Math.sin(this.phase * 2)) * 0.045 * stride;
    for (const [index, leg] of this.legs.entries()) {
      const offset = index % 2 === 0 ? Math.PI : 0;
      leg.pivot.rotation.x =
        Math.sin(this.phase + offset + (leg.front ? 0 : Math.PI)) * 0.62 * stride;
    }
    const attack = this.attackPulse
      ? Math.sin(this.attackPulse * Math.PI) * 0.55
      : 0;
    this.head.rotation.x = damp(
      this.head.rotation.x,
      -0.12 + Math.sin(this.time * 2.2) * 0.035 - attack,
      10,
      dt
    );
    this.head.position.z = this.headBaseZ + attack * 0.35;
    this.tail.rotation.y = Math.sin(this.time * 4.4) * 0.24;
    this.tail.rotation.x = -0.25 + Math.sin(this.time * 2.1) * 0.12;
    this.attackPulse = Math.max(0, this.attackPulse - dt * 3.2);
  }

  dispose() {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose?.();
    for (const material of this.materials) material.dispose?.();
  }
}

class Beast extends Enemy {
  constructor(game, options, config) {
    super(game, options);
    this.type = config.type;
    this.radius = config.radius;
    this.baseScale = config.scale ?? 1;
    this.health = config.health + Math.round((options.difficulty || 0) * config.healthScale);
    this.maxHealth = this.health;
    this.speed = config.speed + (options.difficulty || 0) * 0.7;
    this.scoreValue = config.score;
    this.canDespawn = true;
    this.animSpeed = 0;
    this.attackRange = config.attackRange;
    this.attackDamage = config.attackDamage;
    this.attackCooldownMax = config.attackCooldown ?? 1.0;
    this.attackCooldown = rand(0.3, 0.9);
    this.attackTimer = 0;
    this.lungeTimer = 0;
    this.lungeCooldown = rand(1.5, 3.2);
    this.lungeSpeed = config.lungeSpeed ?? 1.65;
    this.rig = new QuadrupedRig(config.rig);
    this.rig.root.position.copy(this.position);
    this.game.scene.add(this.rig.root);
  }

  assignCoverSpot() {
    // Animals and bike raiders ignore cover by design.
  }

  think(dt) {
    const player = this.game.player;
    if (!player.alive) {
      this.animSpeed = damp(this.animSpeed, 0, 8, dt);
      return;
    }
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distance = Math.hypot(dx, dz) || 0.001;
    const hasLos = this.game.terrain.hasLineOfSight(this.position, player.position);
    this.facePoint(player.position.x, player.position.z, dt, 14);

    this.lungeCooldown -= dt;
    if (this.lungeTimer > 0) {
      this.lungeTimer = Math.max(0, this.lungeTimer - dt);
    } else if (this.lungeCooldown <= 0 && distance > 3.2 && distance < 11) {
      this.lungeTimer = rand(0.28, 0.46);
      this.lungeCooldown = rand(2.2, 4.0);
      this.game.particles.spawnDust(
        new THREE.Vector3(this.position.x, 0.2, this.position.z),
        1.1,
        0.3
      );
    }

    const pressure = (0.9 + 0.1 * this.game.battleTempo) *
      (this.lungeTimer > 0 ? this.lungeSpeed : 1);
    this.animSpeed = this.moveToward(
      player.position.x,
      player.position.z,
      dt,
      this.speed * pressure
    );

    this.attackCooldown -= dt;
    if (distance <= this.attackRange && this.attackCooldown <= 0 && hasLos) {
      this.attackCooldown = this.attackCooldownMax;
      this.attackTimer = 0.24;
      this.rig.attackPulse = 1;
      this.game._damagePlayer(
        this.attackDamage,
        new THREE.Vector3(player.position.x, 1.0, player.position.z),
        this.position
      );
      this.game.effects.addShake(0.12);
      this.game.audio.playMeleeImpact?.(this.position);
      this.game.particles.spawnDust(
        new THREE.Vector3(player.position.x, 0.4, player.position.z),
        0.8,
        0.3
      );
    }
    this.attackTimer = Math.max(0, this.attackTimer - dt);
  }
}

export class WarHound extends Beast {
  constructor(game, options) {
    super(game, options, {
      type: 'warhound',
      radius: 0.44,
      scale: 1.02,
      health: 26,
      healthScale: 12,
      speed: 9.0,
      score: SETTINGS.score.warhound,
      attackRange: 2.0,
      attackDamage: 8,
      attackCooldown: 0.95,
      lungeSpeed: 1.8,
      rig: {
        bodyColor: 0x71675a,
        backColor: 0x4a433a,
        bellyColor: 0xa1937b,
        eyeColor: 0xffa43d,
        length: 1.2,
        width: 0.46,
        height: 0.46,
        legLength: 0.42,
        headLength: 0.44,
        headWidth: 0.36,
        headHeight: 0.34,
        tailLength: 0.58,
        ears: 'pointed',
        mane: true,
      },
    });
  }
}

export class Razorback extends Beast {
  constructor(game, options) {
    super(game, options, {
      type: 'razorback',
      radius: 0.66,
      scale: 1.18,
      health: 70,
      healthScale: 20,
      speed: 7.0,
      score: SETTINGS.score.razorback,
      attackRange: 2.4,
      attackDamage: 14,
      attackCooldown: 1.25,
      lungeSpeed: 1.9,
      rig: {
        bodyColor: 0x604a35,
        backColor: 0x3c2d21,
        bellyColor: 0x8a6d4a,
        eyeColor: 0xff5d2f,
        length: 1.35,
        width: 0.68,
        height: 0.58,
        legLength: 0.34,
        headLength: 0.48,
        headWidth: 0.44,
        headHeight: 0.36,
        tailLength: 0.34,
        ears: 'round',
        tusks: true,
      },
    });
  }
}

export class BogLurker extends Beast {
  constructor(game, options) {
    super(game, options, {
      type: 'boglurker',
      radius: 0.8,
      scale: 1.14,
      health: 96,
      healthScale: 24,
      speed: 5.5,
      score: SETTINGS.score.boglurker,
      attackRange: 2.8,
      attackDamage: 19,
      attackCooldown: 1.35,
      lungeSpeed: 1.7,
      rig: {
        bodyColor: 0x4e7046,
        backColor: 0x31522f,
        bellyColor: 0x829861,
        eyeColor: 0xd7ff52,
        length: 1.95,
        width: 0.58,
        height: 0.34,
        legLength: 0.23,
        headLength: 0.62,
        headWidth: 0.46,
        headHeight: 0.28,
        tailLength: 0.85,
        ears: 'none',
        low: true,
      },
    });
  }
}

export class SnowBear extends Beast {
  constructor(game, options) {
    super(game, options, {
      type: 'bear',
      radius: 0.92,
      scale: 1.55,
      health: 190,
      healthScale: 34,
      speed: 5.7,
      score: SETTINGS.score.bear,
      attackRange: 2.9,
      attackDamage: 25,
      attackCooldown: 1.55,
      lungeSpeed: 1.55,
      rig: {
        bodyColor: 0x8b755b,
        backColor: 0x5d4b39,
        bellyColor: 0xb7a084,
        eyeColor: 0xffd45c,
        length: 1.5,
        width: 0.82,
        height: 0.82,
        legLength: 0.4,
        headLength: 0.54,
        headWidth: 0.48,
        headHeight: 0.42,
        tailLength: 0.22,
        ears: 'round',
        mane: true,
      },
    });
  }
}

/* --------------------------------------------------------------------------
   Humanoids with vehicles / shields
   -------------------------------------------------------------------------- */

export class BikeRaider extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 56,
      speed: 10.2,
      score: SETTINGS.score.bike,
      preferredMin: 6.5,
      preferredMax: 15,
      burstMin: 3,
      burstMax: 5,
      burstGap: 0.11,
      cooldown: 1.6,
      spread: 0.16,
      bulletDamage: 6,
      scale: 1.0,
      aggressive: true,
      style: {
        ...getEnemyStyle(biomeId, 'rifleman'),
        accent: 0xf0a13a,
        headgear: 'helmet',
      },
    });
    this.type = 'bike';
    this.radius = 0.62;
    this.baseScale = 1.48;
    this.rig.root.scale.setScalar(this.baseScale);
    this._buildBike();
  }

  assignCoverSpot() {
    // Drive-by raiders never stop for cover.
  }

  _buildBike() {
    this.bikeMaterials = [];
    this.bikeGeometries = [];
    this.wheelPivots = [];
    const mat = (color, metalness = 0.65) => {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness,
      });
      this.bikeMaterials.push(material);
      return material;
    };
    const geo = (geometry) => {
      this.bikeGeometries.push(geometry);
      return geometry;
    };
    const frame = new THREE.Group();
    frame.position.y = 0.28;
    frame.scale.setScalar(0.82);
    this.rig.root.add(frame);

    const body = new THREE.Mesh(geo(new THREE.BoxGeometry(0.3, 0.22, 1.1)), mat(0x3e4439));
    body.position.y = 0.2;
    body.castShadow = true;
    frame.add(body);
    const seat = new THREE.Mesh(geo(new THREE.BoxGeometry(0.34, 0.1, 0.42)), mat(0x1e211b, 0.2));
    seat.position.set(0, 0.38, -0.18);
    frame.add(seat);
    const tank = new THREE.Mesh(geo(new THREE.BoxGeometry(0.27, 0.22, 0.46)), mat(0x75653f, 0.4));
    tank.position.set(0, 0.38, 0.16);
    frame.add(tank);
    const bars = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 6)), mat(0x8a8b7e));
    bars.rotation.z = Math.PI / 2;
    bars.position.set(0, 0.58, 0.56);
    frame.add(bars);
    const headlight = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 10)), mat(0xffd58a, 0.2));
    headlight.rotation.x = Math.PI / 2;
    headlight.position.set(0, 0.42, 0.66);
    frame.add(headlight);
    const exhaust = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.045, 0.065, 0.55, 6)), mat(0x5d5e55, 0.9));
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.18, 0.13, -0.42);
    frame.add(exhaust);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.26, 0.27, 0.48);
      frame.add(pivot);
      const wheel = new THREE.Mesh(geo(new THREE.TorusGeometry(0.27, 0.065, 7, 18)), mat(0x151714, 0.3));
      wheel.rotation.y = Math.PI / 2;
      pivot.add(wheel);
      this.wheelPivots.push(pivot);
      const rearPivot = new THREE.Group();
      rearPivot.position.set(side * 0.26, 0.27, -0.46);
      frame.add(rearPivot);
      const rearWheel = new THREE.Mesh(geo(new THREE.TorusGeometry(0.27, 0.065, 7, 18)), mat(0x151714, 0.3));
      rearWheel.rotation.y = Math.PI / 2;
      rearPivot.add(rearWheel);
      this.wheelPivots.push(rearPivot);
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xffbf63,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    glow.position.set(0, 0.42, 0.7);
    glow.scale.set(1.1, 1.1, 1);
    frame.add(glow);
    this.bikeLight = glow;
  }

  _updatePresentation(dt, previousX, previousZ) {
    super._updatePresentation(dt, previousX, previousZ);
    for (const pivot of this.wheelPivots) {
      pivot.rotation.x -= this.animSpeed * dt * 2.8;
    }
    this.rig.body.rotation.x = 0.18 + Math.sin(this.age * 5) * 0.02;
  }

  die() {
    if (!this.alive) return;
    const position = this.position.clone();
    super.die();
    this.game._handleExplosion({
      x: position.x,
      z: position.z,
      radius: 3.2,
      damage: 34,
      mode: 'launcher',
    });
    this.game.particles.spawnExplosion(new THREE.Vector3(position.x, 0.9, position.z), 1.1);
  }

  dispose() {
    this.rig.root.remove(this.bikeLight?.parent);
    for (const geometry of this.bikeGeometries) geometry.dispose?.();
    for (const material of this.bikeMaterials) material.dispose?.();
    this.bikeLight?.material?.dispose?.();
    super.dispose();
  }
}

export class RiotTrooper extends Infantry {
  constructor(game, options) {
    const biomeId = options.biomeId || game.terrain.getBiome(options.z).id;
    super(game, options, {
      health: 118,
      speed: 3.5,
      score: SETTINGS.score.riot,
      preferredMin: 7,
      preferredMax: 13,
      burstMin: 3,
      burstMax: 4,
      burstGap: 0.14,
      cooldown: 2.2,
      spread: 0.11,
      bulletDamage: 8,
      scale: 1.06,
      style: {
        ...getEnemyStyle(biomeId, 'heavy'),
        accent: 0xe0b45c,
        headgear: 'helmet',
      },
    });
    this.type = 'riot';
    this.radius = 0.64;
    this.baseScale = 1.7;
    this.shieldMaterial = new THREE.MeshStandardMaterial({
      color: 0x3f4548,
      roughness: 0.52,
      metalness: 0.62,
      emissive: 0x1b2428,
      emissiveIntensity: 0.2,
    });
    this.shieldGeometry = new THREE.BoxGeometry(0.78, 1.02, 0.14);
    this.shield = new THREE.Mesh(this.shieldGeometry, this.shieldMaterial);
    this.shield.position.set(0, 1.28, 0.46);
    this.shield.rotation.x = -0.08;
    this.shield.castShadow = true;
    this.rig.root.add(this.shield);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.09, 0.03),
      new THREE.MeshBasicMaterial({ color: 0xffd260 })
    );
    stripe.position.set(0, 1.53, 0.55);
    this.shield.add(stripe);
    this.shieldStripe = stripe;
    this.shieldStripeMaterial = stripe.material;
  }

  takeDamage(amount, hitPosition, sourcePosition, hitDirection = null) {
    if (!this.alive) return false;
    let damage = amount;
    if (sourcePosition) {
      const forwardX = Math.sin(this.facingAngle);
      const forwardZ = Math.cos(this.facingAngle);
      const dx = sourcePosition.x - this.position.x;
      const dz = sourcePosition.z - this.position.z;
      const length = Math.hypot(dx, dz) || 1;
      const facing = (dx * forwardX + dz * forwardZ) / length;
      if (facing > 0.15) {
        damage *= 0.34;
        this.game.particles.spawnFlash?.(
          hitPosition || new THREE.Vector3(this.position.x, 1.2, this.position.z),
          0.3,
          0.9,
          0.12,
          0xffe49a
        );
      }
    }
    return super.takeDamage(damage, hitPosition, sourcePosition, hitDirection);
  }

  dispose() {
    this.shieldGeometry.dispose();
    this.shieldMaterial.dispose();
    this.shieldStripeMaterial.dispose();
    super.dispose();
  }
}
