import * as THREE from 'three';
import { segmentCircle2D, rand } from '../utils/math.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpZeroScale = new THREE.Vector3(0, 0, 0);
const tmpPosition = new THREE.Vector3();

class Bullet {
  constructor() {
    this.active = false;
    this.position = new THREE.Vector3();
    this.previous = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, 1);
    this.quaternion = new THREE.Quaternion();
    this.origin = new THREE.Vector3();
    this.faction = 'player';
    this.damage = 10;
    this.speed = 100;
    this.range = 50;
    this.traveled = 0;
    this.life = 1;
    this.age = 0;
    this.tracerColor = 0xffd08a;
    this.trailTimer = 0;
    this.weakPoint = null;
    this.explosion = null;
  }
}

/**
 * Fast pooled projectile system. Projectiles are rendered with a single
 * instanced mesh (plus a soft halo) and collide using 2D segment/circle tests
 * against terrain, soldiers, the player and explosive barrels.
 */
export class BulletSystem {
  constructor(scene, { terrain, particles, audio }) {
    this.scene = scene;
    this.terrain = terrain;
    this.particles = particles;
    this.audio = audio;
    this.capacity = 200;
    this.cursor = 0;
    this.bullets = Array.from({ length: this.capacity }, () => new Bullet());

    this.coreGeometry = new THREE.BoxGeometry(0.042, 0.042, 2.1);
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.core = new THREE.InstancedMesh(this.coreGeometry, this.coreMaterial, this.capacity);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.frustumCulled = false;
    this.core.renderOrder = 7;
    this.core.castShadow = false;
    this.core.receiveShadow = false;
    for (let i = 0; i < this.capacity; i++) {
      this.core.setColorAt(i, new THREE.Color(0xffd08a));
    }
    scene.add(this.core);

    this.haloGeometry = new THREE.BoxGeometry(0.16, 0.16, 2.3);
    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.halo = new THREE.InstancedMesh(this.haloGeometry, this.haloMaterial, this.capacity);
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 6;
    for (let i = 0; i < this.capacity; i++) {
      this.halo.setColorAt(i, new THREE.Color(0xffa45c));
    }
    scene.add(this.halo);

    this.activeCount = 0;
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._hideAll();
  }

  _hideAll() {
    tmpMatrix.compose(tmpPosition.set(0, -100, 0), new THREE.Quaternion(), tmpZeroScale);
    for (let i = 0; i < this.capacity; i++) {
      this.core.setMatrixAt(i, tmpMatrix);
      this.halo.setMatrixAt(i, tmpMatrix);
    }
    this.core.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  spawn({
    origin,
    direction,
    speed = 120,
    damage = 10,
    faction = 'player',
    spread = 0,
    range = 48,
    color = faction === 'player' ? 0xffdda6 : 0xff8852,
    explosion = null,
  }) {
    const index = this.cursor;
    const bullet = this.bullets[index];
    this.cursor = (this.cursor + 1) % this.capacity;

    tmpDir.copy(direction).setY(0);
    if (tmpDir.lengthSq() < 0.0001) tmpDir.set(0, 0, 1);
    tmpDir.normalize();
    if (spread > 0) {
      const angle = rand(-spread, spread);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = tmpDir.x * cos - tmpDir.z * sin;
      const z = tmpDir.x * sin + tmpDir.z * cos;
      tmpDir.set(x, 0, z).normalize();
    }

    bullet.active = true;
    bullet.position.copy(origin);
    bullet.position.y = 1.16;
    bullet.previous.copy(bullet.position);
    bullet.origin.copy(origin);
    bullet.direction.copy(tmpDir);
    bullet.velocity.copy(tmpDir).multiplyScalar(speed);
    bullet.faction = faction;
    bullet.damage = damage;
    bullet.speed = speed;
    bullet.range = range;
    bullet.traveled = 0;
    bullet.age = 0;
    bullet.life = range / speed + 0.1;
    bullet.tracerColor = color;
    bullet.trailTimer = 0;
    bullet.weakPoint = null;
    bullet.explosion = explosion;
    bullet.quaternion.setFromUnitVectors(Z_AXIS, tmpDir);

    this._color.setHex(color);
    this.core.setColorAt(index, this._color);
    this._color.setHex(faction === 'player' ? 0xffbb76 : 0xff5c30);
    this.halo.setColorAt(index, this._color);
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    return bullet;
  }

  update(dt, context) {
    const { player, enemies, onPlayerHit, onEnemyHit, onBarrelHit } = context;
    const playerAlive = player?.alive;

    for (let index = 0; index < this.capacity; index++) {
      const bullet = this.bullets[index];
      if (!bullet.active) {
        tmpMatrix.compose(tmpPosition.set(0, -100, 0), new THREE.Quaternion(), tmpZeroScale);
        this.core.setMatrixAt(index, tmpMatrix);
        this.halo.setMatrixAt(index, tmpMatrix);
        continue;
      }

      bullet.age += dt;
      bullet.traveled += bullet.speed * dt;
      if (bullet.age > bullet.life || bullet.traveled > bullet.range) {
        if (bullet.explosion) context.onBulletExplosion?.(bullet, bullet.position);
        bullet.active = false;
        tmpMatrix.compose(tmpPosition.set(0, -100, 0), new THREE.Quaternion(), tmpZeroScale);
        this.core.setMatrixAt(index, tmpMatrix);
        this.halo.setMatrixAt(index, tmpMatrix);
        continue;
      }

      bullet.previous.copy(bullet.position);
      bullet.position.addScaledVector(bullet.velocity, dt);

      let nearestT = Infinity;
      let hitType = null;
      let hitEnemy = null;
      let hitWeakPoint = null;
      let hitBarrel = null;

      const obstacle = this.terrain.firstObstacleHit(bullet.previous, bullet.position);
      if (obstacle) {
        nearestT = obstacle.t;
        hitType = 'obstacle';
      }

      if (bullet.faction === 'player') {
        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          const t = segmentCircle2D(
            bullet.previous.x,
            bullet.previous.z,
            bullet.position.x,
            bullet.position.z,
            enemy.position.x,
            enemy.position.z,
            enemy.bulletRadius ?? enemy.radius
          );
          if (t === null) continue;

          // Component hitboxes sit inside the body, and a fast projectile can
          // hit the outer body circle before its frame segment reaches the
          // component. Trace the shot onward from the body entry so internal
          // weak points still register.
          let weakPoint = null;
          let nearestWeak = Infinity;
          const weakPoints = enemy.getWeakPoints?.();
          if (weakPoints) {
            const entryX =
              bullet.previous.x + (bullet.position.x - bullet.previous.x) * t;
            const entryZ =
              bullet.previous.z + (bullet.position.z - bullet.previous.z) * t;
            const reach =
              (enemy.bulletRadius ?? enemy.radius) * 2 + 1.2;
            const endX = entryX + bullet.direction.x * reach;
            const endZ = entryZ + bullet.direction.z * reach;
            for (const point of weakPoints) {
              const weakT = segmentCircle2D(
                bullet.previous.x,
                bullet.previous.z,
                endX,
                endZ,
                point.x,
                point.z,
                point.radius
              );
              if (weakT !== null && weakT < nearestWeak) {
                nearestWeak = weakT;
                weakPoint = point;
              }
            }
          }

          if (t < nearestT) {
            nearestT = t;
            hitType = 'enemy';
            hitEnemy = enemy;
            hitWeakPoint = weakPoint;
          }
        }
      } else if (playerAlive) {
        const t = segmentCircle2D(
          bullet.previous.x,
          bullet.previous.z,
          bullet.position.x,
          bullet.position.z,
          player.position.x,
          player.position.z,
          player.radius
        );
        if (t !== null && t < nearestT) {
          nearestT = t;
          hitType = 'player';
        }
      }

      for (const barrel of this.terrain.barrels) {
        if (!barrel.alive) continue;
        const t = segmentCircle2D(
          bullet.previous.x,
          bullet.previous.z,
          bullet.position.x,
          bullet.position.z,
          barrel.x,
          barrel.z,
          barrel.radius
        );
        if (t !== null && t < nearestT) {
          nearestT = t;
          hitType = 'barrel';
          hitBarrel = barrel;
        }
      }

      if (hitType) {
        const hitX = bullet.previous.x + (bullet.position.x - bullet.previous.x) * nearestT;
        const hitZ = bullet.previous.z + (bullet.position.z - bullet.previous.z) * nearestT;
        const hitPosition = new THREE.Vector3(hitX, 1.1, hitZ);
        const hasAudio = Math.random() < 0.5;

        if (hitType === 'enemy' && hitEnemy) {
          bullet.weakPoint = hitWeakPoint;
          onEnemyHit?.(
            hitEnemy,
            bullet.damage,
            hitPosition,
            bullet.origin,
            bullet,
            hitWeakPoint
          );
        } else if (hitType === 'player') {
          onPlayerHit?.(bullet.damage, hitPosition, bullet.origin, bullet);
        } else if (hitType === 'barrel' && hitBarrel) {
          onBarrelHit?.(hitBarrel, hitPosition, bullet);
        } else {
          this.particles.spawnImpact(hitPosition, 0xc8b896, bullet.direction, 0.7);
          if (hasAudio) this.audio.playRicochet(hitPosition);
        }

        if (bullet.explosion) context.onBulletExplosion?.(bullet, hitPosition);

        bullet.active = false;
        tmpMatrix.compose(tmpPosition.set(0, -100, 0), new THREE.Quaternion(), tmpZeroScale);
        this.core.setMatrixAt(index, tmpMatrix);
        this.halo.setMatrixAt(index, tmpMatrix);
        continue;
      }

      // Long tracers stretch along their direction and sit at chest height.
      this._dummy.position.copy(bullet.position);
      this._dummy.position.y = 1.16;
      this._dummy.quaternion.copy(bullet.quaternion);
      this._dummy.scale.set(1, 1, 1);
      this._dummy.updateMatrix();
      this.core.setMatrixAt(index, this._dummy.matrix);
      this.halo.setMatrixAt(index, this._dummy.matrix);
    }

    this.core.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const bullet of this.bullets) bullet.active = false;
    this._hideAll();
    this.activeCount = 0;
  }
}
