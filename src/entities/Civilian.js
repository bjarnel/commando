import * as THREE from 'three';
import { SoldierRig } from './SoldierRig.js';
import { clamp, damp, rand, chance } from '../utils/math.js';

const ADULT_PALETTES = [
  { shirt: 0x7d6b4c, pants: 0x4d4535, accent: 0xb88b58 },
  { shirt: 0x6f7a56, pants: 0x414734, accent: 0xc0a472 },
  { shirt: 0x7c5c5d, pants: 0x4b3b3d, accent: 0xc5a46e },
  { shirt: 0x5d7180, pants: 0x39434a, accent: 0xb9a06f },
  { shirt: 0x8a6e45, pants: 0x53452f, accent: 0xd0b27b },
];

const CHILD_PALETTES = [
  { shirt: 0xb65c45, pants: 0x5c4438, accent: 0xe0b16f },
  { shirt: 0x5d8f9b, pants: 0x3e5056, accent: 0xd8c17b },
  { shirt: 0xc39a45, pants: 0x5a4d33, accent: 0xeee0a8 },
  { shirt: 0x7d8f5b, pants: 0x485038, accent: 0xd5c58d },
];

const SKIN_TONES = [0xc39a71, 0x8b6849, 0xa97c58, 0x6f513a];
const HAIR_TONES = [0x3b2a1c, 0x241b14, 0x5a3e26, 0x7a5a38, 0x2b2a28];

export class Civilian {
  constructor(game, { x, z, variant = 'woman' }) {
    this.game = game;
    this.variant = variant;
    this.child = variant === 'child';
    this.position = new THREE.Vector3(x, 0.032, z);
    this.home = new THREE.Vector3(x, 0.032, z);
    this.alive = true;
    this.removeFlag = false;
    this.age = 0;
    this.animSpeed = 0;
    this.panic = 0;
    this.wanderTimer = rand(0.5, 2.5);
    this.wanderAngle = rand(0, Math.PI * 2);
    this.wanderRadius = rand(2.5, 7);

    const palette = this.child
      ? CHILD_PALETTES[Math.floor(Math.random() * CHILD_PALETTES.length)]
      : ADULT_PALETTES[Math.floor(Math.random() * ADULT_PALETTES.length)];
    const skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    const hair = HAIR_TONES[Math.floor(Math.random() * HAIR_TONES.length)];
    this.rig = new SoldierRig({
      uniform: palette.shirt,
      uniformDark: palette.pants,
      vest: palette.shirt,
      accent: palette.accent,
      skin,
      helmet: hair,
      headgear: 'none',
      weapon: 'none',
      radio: false,
      hair,
      longHair: !this.child && (variant === 'woman' || chance(0.12)),
      civilian: true,
    });
    const scale = this.child ? 1.0 : variant === 'woman' ? 1.56 : 1.64;
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = rand(0, Math.PI * 2);
    this.rig.root.scale.setScalar(scale);
    game.scene.add(this.rig.root);

    this.speed = this.child ? 2.2 : 1.7;
    this.fleeSpeed = this.child ? 4.8 : 3.5;
    this._moveX = 0;
    this._moveZ = 0;
  }

  update(dt) {
    const { game } = this;
    const player = game.player;
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

    const moveX = targetX - this.position.x;
    const moveZ = targetZ - this.position.z;
    const distance = Math.hypot(moveX, moveZ);
    if (distance > 0.01 && speed > 0) {
      const step = Math.min(distance, speed * dt);
      this.position.x += (moveX / distance) * step;
      this.position.z += (moveZ / distance) * step;
      this._moveX = moveX / distance;
      this._moveZ = moveZ / distance;
      this.animSpeed = damp(this.animSpeed, speed, 8, dt);
    } else {
      this.animSpeed = damp(this.animSpeed, 0, 8, dt);
    }

    game.terrain.resolveCircle(this.position, 0.32);
    this.position.x = clamp(
      this.position.x,
      -game.terrain.playableHalfWidth + 1,
      game.terrain.playableHalfWidth - 1
    );
    this.position.z = clamp(
      this.position.z,
      game.scroll - 10,
      game.scroll + 58
    );

    this.rig.root.position.set(this.position.x, 0.032, this.position.z);
    if (this.animSpeed > 0.25) {
      this.rig.faceAngle(Math.atan2(this._moveX, this._moveZ), dt, 8);
    } else if (playerDistance < 18) {
      this.rig.faceAngle(Math.atan2(dx, dz), dt, 4);
    }
    this.rig.update(dt, { speed: this.animSpeed, aiming: false });

    if (
      this.position.z < game.scroll - 22 ||
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
