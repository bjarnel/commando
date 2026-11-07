import * as THREE from 'three';
import { SoldierRig } from './SoldierRig.js';
import { clamp, damp, rand, chance } from '../utils/math.js';

const WOMAN_PALETTES = [
  { shirt: 0xd9536f, bottoms: 0x354f8a, accent: 0xffd166, hatColor: 0xff8fab },
  { shirt: 0x4cc9d8, bottoms: 0x7a3e8f, accent: 0xfff0a8, hatColor: 0xffffff },
  { shirt: 0xffc857, bottoms: 0x2f5d50, accent: 0xd94f6a, hatColor: 0xffe0a3 },
  { shirt: 0x9b5de5, bottoms: 0x3a3a6a, accent: 0x6ff7f0, hatColor: 0xf5c6ff },
  { shirt: 0xff8fab, bottoms: 0x2f4b78, accent: 0xfff3b0, hatColor: 0xd9536f },
  { shirt: 0x7ee08a, bottoms: 0x8a4b2f, accent: 0xffffff, hatColor: 0xffffcc },
];

const MAN_PALETTES = [
  { shirt: 0x4f7fd9, bottoms: 0x6b4b2f, accent: 0xffd166, hatColor: 0x4b3a2a },
  { shirt: 0xe07a5f, bottoms: 0x3d5a80, accent: 0xfff3b0, hatColor: 0x2f2a22 },
  { shirt: 0x7bc96f, bottoms: 0x5c4033, accent: 0xffffff, hatColor: 0x8a6e45 },
  { shirt: 0xf2c14e, bottoms: 0x4a3f35, accent: 0x2f6690, hatColor: 0x66523a },
  { shirt: 0xb0a7ff, bottoms: 0x3a2e5a, accent: 0xffe066, hatColor: 0x3a2e5a },
  { shirt: 0x66d9e8, bottoms: 0x5a4632, accent: 0xffc2d1, hatColor: 0x2f6690 },
];

const CHILD_PALETTES = [
  { shirt: 0xff6b6b, bottoms: 0x4dabf7, accent: 0xffd43b, hatColor: 0xff8787 },
  { shirt: 0x4dabf7, bottoms: 0xffd43b, accent: 0xffffff, hatColor: 0x74c0fc },
  { shirt: 0xffd43b, bottoms: 0x69db7c, accent: 0xff6b6b, hatColor: 0xffe066 },
  { shirt: 0x69db7c, bottoms: 0xda77f2, accent: 0xffffff, hatColor: 0x8ce99a },
  { shirt: 0xda77f2, bottoms: 0xffa94d, accent: 0xffffff, hatColor: 0xe599f7 },
  { shirt: 0xffa94d, bottoms: 0x4dabf7, accent: 0xffffff, hatColor: 0xffc078 },
];

const SKIN_TONES = [0xc39a71, 0x8b6849, 0xa97c58, 0x6f513a, 0xd7ab86];
const HAIR_TONES = [0x3b2a1c, 0x241b14, 0x5a3e26, 0x7a5a38, 0x2b2a28, 0xb98a4b, 0x9a9a96];

function pickPalette(variant) {
  const source =
    variant === 'child'
      ? CHILD_PALETTES
      : variant === 'woman'
        ? WOMAN_PALETTES
        : MAN_PALETTES;
  return source[Math.floor(Math.random() * source.length)];
}

function pickHat(variant, child) {
  const roll = Math.random();
  if (child) {
    if (roll < 0.14) return 'flatcap';
    if (roll < 0.22) return 'straw';
    return 'none';
  }
  if (variant === 'woman') {
    if (roll < 0.28) return 'straw';
    if (roll < 0.5) return 'headscarf';
    return 'none';
  }
  if (roll < 0.22) return 'flatcap';
  if (roll < 0.34) return 'straw';
  if (roll < 0.42) return 'beanie';
  return 'none';
}

/**
 * Non-combatants. They cannot be mistaken for soldiers: bright civilian
 * clothing, bare arms, skirts/shorts and sun hats replace the military plate
 * carriers and helmets. Shooting one costs a reinforcement.
 */
export class Civilian {
  constructor(game, { x, z, variant = 'woman' }) {
    this.game = game;
    this.variant = variant;
    this.child = variant === 'child';
    this.girl = this.child && chance(0.5);
    this.position = new THREE.Vector3(x, 0.032, z);
    this.home = new THREE.Vector3(x, 0.032, z);
    this.radius = 0.42;
    this.alive = true;
    this.removeFlag = false;
    this.deathTime = 0;
    this.age = 0;
    this.animSpeed = 0;
    this.panic = 0;
    this.wanderTimer = rand(0.5, 2.5);
    this.wanderAngle = rand(0, Math.PI * 2);
    this.wanderRadius = rand(2.5, 7);

    const palette = pickPalette(variant);
    const skirt =
      variant === 'woman' ? chance(0.7) : this.girl && chance(0.55);
    const shorts = this.child && !skirt;
    const shortSleeves = this.child || variant === 'woman' || chance(0.55);
    const hat = pickHat(variant, this.child);
    const skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    const hair = HAIR_TONES[Math.floor(Math.random() * HAIR_TONES.length)];
    this.rig = new SoldierRig({
      uniform: palette.shirt,
      uniformDark: palette.bottoms,
      vest: palette.shirt,
      accent: palette.accent,
      skin,
      helmet: hair,
      headgear: 'none',
      weapon: 'none',
      radio: false,
      hair,
      longHair:
        variant === 'woman' ||
        (this.girl && chance(0.7)) ||
        (!this.child && chance(0.1)),
      civilian: true,
      civilianKind: variant,
      skirt,
      shorts,
      hat,
      hatColor: palette.hatColor,
      shortSleeves,
    });
    const scale = this.child ? 1.02 : variant === 'woman' ? 1.58 : 1.67;
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = rand(0, Math.PI * 2);
    this.rig.root.scale.setScalar(scale);
    game.scene.add(this.rig.root);

    this.speed = this.child ? 2.35 : 1.75;
    this.fleeSpeed = this.child ? 5 : 3.7;
    this._moveX = 0;
    this._moveZ = 0;
  }

  kill() {
    if (!this.alive) return false;
    this.alive = false;
    this.deathTime = 0;
    this.panic = 0;
    return true;
  }

  update(dt) {
    const { game } = this;
    const player = game.player;

    if (!this.alive) {
      this.deathTime += dt;
      this.animSpeed = damp(this.animSpeed, 0, 8, dt);
      this.rig.root.rotation.x = damp(this.rig.root.rotation.x, -Math.PI / 2.15, 4, dt);
      this.rig.root.position.y = damp(this.rig.root.position.y, -0.15, 2, dt);
      this.rig.update(dt, { speed: 0, aiming: false });
      if (this.deathTime > 2.2) this.removeFlag = true;
      return;
    }

    this.age += dt;
    this.wanderTimer -= dt;
    this.panic = Math.max(0, this.panic - dt);

    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const playerDistance = Math.hypot(dx, dz);

    let nearestThreat = null;
    let nearestThreatDistance = Infinity;
    if (player.alive) {
      nearestThreat = player;
      nearestThreatDistance = playerDistance;
    }
    for (const enemy of game.enemies) {
      if (!enemy.alive || enemy.type === 'mortar') continue;
      const edx = enemy.position.x - this.position.x;
      const edz = enemy.position.z - this.position.z;
      const distance = Math.hypot(edx, edz);
      if (distance < nearestThreatDistance) {
        nearestThreat = enemy;
        nearestThreatDistance = distance;
      }
    }

    if (
      nearestThreatDistance < 9 ||
      (player.alive && player.fireHeld && playerDistance < 34) ||
      (nearestThreat && nearestThreat.type !== 'player' && nearestThreatDistance < 14)
    ) {
      this.panic = Math.max(this.panic, 1.25);
    }

    // If the scrolling camera has passed their original home, drift the
    // wandering anchor forward instead of letting them moonwalk against the
    // bottom edge of the screen.
    if (this.home.z < game.scroll + 2) {
      this.home.z = game.scroll + rand(4, 12);
      this.wanderAngle = rand(0, Math.PI * 2);
    }

    let targetX = this.home.x;
    let targetZ = this.home.z;
    let speed = 0;

    if (this.panic > 0 && nearestThreat) {
      const nx = (this.position.x - nearestThreat.position.x) || rand(-1, 1);
      const nz = (this.position.z - nearestThreat.position.z) || rand(-1, 1);
      const length = Math.hypot(nx, nz) || 1;
      targetX = this.position.x + (nx / length) * 10;
      targetZ = this.position.z + (nz / length) * 10;
      speed = this.fleeSpeed;
    } else {
      if (this.wanderTimer <= 0) {
        this.wanderTimer = rand(1.2, 3.4);
        this.wanderAngle = rand(0, Math.PI * 2);
        this.wanderRadius = rand(2, 7);
      }
      targetX = this.home.x + Math.cos(this.wanderAngle) * this.wanderRadius;
      targetZ = this.home.z + Math.sin(this.wanderAngle) * this.wanderRadius;
      const distanceHome = Math.hypot(
        targetX - this.position.x,
        targetZ - this.position.z
      );
      speed = distanceHome > 0.4 ? this.speed : 0;
    }

    targetX = clamp(
      targetX,
      -game.terrain.playableHalfWidth + 1.2,
      game.terrain.playableHalfWidth - 1.2
    );

    const prevX = this.position.x;
    const prevZ = this.position.z;
    const moveX = targetX - this.position.x;
    const moveZ = targetZ - this.position.z;
    const distance = Math.hypot(moveX, moveZ);
    if (distance > 0.01 && speed > 0) {
      const step = Math.min(distance, speed * dt);
      this.position.x += (moveX / distance) * step;
      this.position.z += (moveZ / distance) * step;
      this._moveX = moveX / distance;
      this._moveZ = moveZ / distance;
    }

    game.terrain.resolveCircle(this.position, 0.32);
    this.position.x = clamp(
      this.position.x,
      -game.terrain.playableHalfWidth + 1,
      game.terrain.playableHalfWidth - 1
    );

    const actualX = this.position.x - prevX;
    const actualZ = this.position.z - prevZ;
    const actualDistance = Math.hypot(actualX, actualZ);
    const actualSpeed = dt > 0 ? actualDistance / dt : 0;
    this.animSpeed = damp(this.animSpeed, actualSpeed, 10, dt);

    this.rig.root.position.set(this.position.x, 0.032, this.position.z);
    if (actualDistance > 0.0015) {
      // Face the direction the body actually travelled after collision
      // resolution, not the intended target direction.
      this.rig.faceAngle(Math.atan2(actualX, actualZ), dt, 11);
    } else if (playerDistance < 18) {
      this.rig.faceAngle(Math.atan2(dx, dz), dt, 4);
    }
    this.rig.update(dt, { speed: this.animSpeed, aiming: false });

    if (
      this.position.z < game.scroll - 8 ||
      this.position.z > game.scroll + 82
    ) {
      this.removeFlag = true;
    }
  }

  dispose() {
    this.rig.dispose();
    this.rig.root.removeFromParent();
  }
}
