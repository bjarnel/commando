import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, rand } from '../utils/math.js';
import { getGlowTexture } from '../utils/textures.js';

const GRAVITY = 24;

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

function mergeColored(parts) {
  const normalized = parts.map((item) => {
    if (!item.index) return item;
    const flat = item.toNonIndexed();
    item.dispose();
    return flat;
  });
  const geometry = mergeGeometries(normalized, false);
  normalized.forEach((item) => item.dispose());
  if (!geometry) {
    console.error('[Grenade] Geometry merge failed.');
    return new THREE.BufferGeometry();
  }
  return geometry;
}

function makeGrenadeGeometry() {
  const body = new THREE.SphereGeometry(0.15, 9, 7);
  body.scale(1, 1.22, 1);
  colorize(body, 0x444c2f);
  const top = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8);
  top.translate(0, 0.18, 0);
  colorize(top, 0x2e3127);
  const lever = new THREE.BoxGeometry(0.04, 0.03, 0.24);
  lever.translate(0.08, 0.14, -0.02);
  colorize(lever, 0x8d8a73);
  const band = new THREE.CylinderGeometry(0.155, 0.155, 0.035, 10);
  band.translate(0, 0.02, 0);
  colorize(band, 0x8d7c4b);
  return mergeColored([body, top, lever, band]);
}

function makeSpudGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.17, 9, 7);
  body.scale(1.18, 0.88, 1.28);
  colorize(body, 0xc9a15f);
  parts.push(body);
  const spots = [
    [0.06, 0.1, 0.06, 0.032],
    [-0.08, 0.04, -0.09, 0.024],
    [0.02, -0.1, -0.1, 0.02],
    [0.12, -0.04, 0.08, 0.018],
  ];
  for (const [x, y, z, size] of spots) {
    const spot = new THREE.SphereGeometry(size, 6, 5);
    spot.translate(x, y, z);
    colorize(spot, 0x8a6a3d);
    parts.push(spot);
  }
  return mergeColored(parts);
}

class GrenadeInstance {
  constructor(mesh) {
    this.mesh = mesh;
    this.active = false;
    this.mode = 'frag';
    this.faction = 'player';
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.fuse = 0;
    this.flightTime = 0;
    this.radius = 4;
    this.damage = 80;
    this.whistle = null;
    this.marker = null;
    this.flight = 0;
    this.trailTimer = 0;
    this.age = 0;
    this.kind = 'frag';
    this.toxin = null;
    this.nuke = false;
    this.destructive = false;
    this.trailColor = 0x8c8b7e;
    this.trailTimerStep = 0.055;
  }
}

/**
 * Pooled arc projectiles for both thrown frag grenades and enemy mortar
 * shells. Damage/visuals are delegated to the game through onExplosion, while
 * the system handles trajectory, bounce, fuses, targeting warnings and smoke.
 */
export class GrenadeSystem {
  constructor(scene, { particles, audio }) {
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.poolSize = 20;
    this.geometry = makeGrenadeGeometry();
    this.spudGeometry = makeSpudGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.68,
      metalness: 0.25,
    });
    this.glowMaterial = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: 0xffc47b,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.grenades = [];
    for (let i = 0; i < this.poolSize; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.visible = false;
      const glow = new THREE.Sprite(this.glowMaterial);
      glow.scale.set(0.85, 0.85, 1);
      mesh.add(glow);
      scene.add(mesh);
      this.grenades.push(new GrenadeInstance(mesh));
    }

    this.markers = [];
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({
        color: 0xff5b3d,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });
      const innerMaterial = material.clone();
      innerMaterial.color.setHex(0xffb06b);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.72, 36), material);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 8;
      group.add(ring);
      const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.74, 0.82, 24), innerMaterial);
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.renderOrder = 8;
      group.add(innerRing);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0xff5c34,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      glow.scale.set(5, 3, 1);
      glow.position.y = 0.3;
      glow.renderOrder = 8;
      group.add(glow);
      group.visible = false;
      group.position.y = 0.06;
      scene.add(group);
      this.markers.push({ group, ring, innerRing, material, innerMaterial, glow });
    }
    this.markerCursor = 0;
    this._tmpTarget = new THREE.Vector3();
  }

  _acquireMarker() {
    const marker = this.markers[this.markerCursor];
    this.markerCursor = (this.markerCursor + 1) % this.markers.length;
    return marker;
  }

  _getFreeGrenade() {
    for (const grenade of this.grenades) {
      if (!grenade.active) return grenade;
    }
    // Recycle the oldest slot rather than dropping the throw.
    return this.grenades[0];
  }

  spawnPlayerGrenade(origin, target, { radius = 4.6, damage = 90 } = {}) {
    const grenade = this._getFreeGrenade();
    if (grenade.active) this._deactivate(grenade);
    const distance = Math.hypot(target.x - origin.x, target.z - origin.z);
    const flightTime = clamp(0.62 + distance / 32, 0.78, 1.45);
    const start = origin.clone();
    start.y = Math.max(1.25, start.y + 0.2);
    const destination = target.clone();
    destination.y = 0.14;

    grenade.active = true;
    grenade.mode = 'frag';
    grenade.faction = 'player';
    grenade.kind = 'frag';
    grenade.toxin = null;
    grenade.nuke = false;
    grenade.destructive = false;
    grenade.trailColor = 0x8c8b7e;
    grenade.trailTimerStep = 0.055;
    grenade.position.copy(start);
    grenade.velocity.set(
      (destination.x - start.x) / flightTime,
      (destination.y - start.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
      (destination.z - start.z) / flightTime
    );
    grenade.spin.set(rand(-6, 6), rand(2, 8), rand(-6, 6));
    grenade.fuse = flightTime + 1.0;
    grenade.flightTime = flightTime;
    grenade.radius = radius;
    grenade.damage = damage;
    grenade.flight = 0;
    grenade.age = 0;
    grenade.trailTimer = 0;
    grenade.marker = null;
    grenade.whistle = null;
    grenade.mesh.visible = true;
    grenade.mesh.geometry = this.geometry;
    grenade.mesh.scale.setScalar(1);
    grenade.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    return grenade;
  }

  spawnLauncherShell(
    origin,
    target,
    { radius = 4.2, damage = 78, visual = 'shell', toxin = null, destructive = true } = {}
  ) {
    const grenade = this._getFreeGrenade();
    if (grenade.active) this._deactivate(grenade);
    const distance = Math.hypot(target.x - origin.x, target.z - origin.z);
    const muzzleSpeed = 58;
    const flightTime = Math.max(0.08, distance / muzzleSpeed);
    const start = origin.clone();
    start.y = Math.max(1.2, start.y);
    const destination = target.clone();
    destination.y = 0.14;

    grenade.active = true;
    grenade.mode = 'launcher';
    grenade.faction = 'player';
    grenade.kind = visual;
    grenade.toxin = toxin;
    grenade.nuke = false;
    grenade.destructive = destructive;
    grenade.trailColor = visual === 'toxin' ? 0x9dff7b : 0x8c8b7e;
    grenade.trailTimerStep = 0.055;
    grenade.position.copy(start);
    grenade.velocity.set(
      (destination.x - start.x) / flightTime,
      (destination.y - start.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
      (destination.z - start.z) / flightTime
    );
    grenade.spin.set(rand(-5, 5), rand(4, 9), rand(-5, 5));
    grenade.fuse = flightTime + 0.35;
    grenade.flightTime = flightTime;
    grenade.radius = radius;
    grenade.damage = damage;
    grenade.flight = 0;
    grenade.age = 0;
    grenade.trailTimer = 0;
    grenade.marker = null;
    grenade.whistle = null;
    grenade.mesh.visible = true;
    grenade.mesh.geometry =
      visual === 'potato' ? this.spudGeometry : this.geometry;
    grenade.mesh.scale.setScalar(visual === 'potato' ? 0.95 : 0.82);
    grenade.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    return grenade;
  }

  spawnRocket(
    origin,
    target,
    {
      radius = 6.4,
      damage = 210,
      speed = 46,
      kind = 'rocket',
      nuke = false,
      toxin = null,
      destructive = true,
    } = {}
  ) {
    const grenade = this._getFreeGrenade();
    if (grenade.active) this._deactivate(grenade);
    const start = origin.clone();
    start.y = Math.max(1.25, start.y);
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const distance = Math.hypot(dx, dz) || 1;
    const flightTime = Math.max(0.1, distance / Math.max(12, speed));

    grenade.active = true;
    grenade.mode = 'rocket';
    grenade.faction = 'player';
    grenade.kind = kind;
    grenade.toxin = toxin;
    grenade.nuke = nuke;
    grenade.destructive = destructive;
    grenade.trailColor = nuke ? 0xffe6a0 : 0xd8cfc0;
    grenade.trailTimerStep = nuke ? 0.022 : 0.035;
    grenade.position.copy(start);
    grenade.velocity.set(dx / flightTime, 0, dz / flightTime);
    grenade.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
    grenade.fuse = flightTime + 0.12;
    grenade.flightTime = flightTime;
    grenade.radius = radius;
    grenade.damage = damage;
    grenade.flight = 0;
    grenade.age = 0;
    grenade.trailTimer = 0;
    grenade.marker = null;
    grenade.whistle = null;
    grenade.mesh.visible = true;
    grenade.mesh.geometry = this.geometry;
    grenade.mesh.scale.setScalar(nuke ? 1.15 : 0.88);
    grenade.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    return grenade;
  }

  spawnMortarShell(origin, target, { duration = 2.15, radius = 4.2, damage = 32 } = {}) {
    const grenade = this._getFreeGrenade();
    if (grenade.active) this._deactivate(grenade);
    const start = origin.clone();
    start.y = Math.max(1.4, start.y);
    const destination = target.clone();
    destination.y = 0.14;

    grenade.active = true;
    grenade.mode = 'mortar';
    grenade.faction = 'enemy';
    grenade.kind = 'mortar';
    grenade.toxin = null;
    grenade.nuke = false;
    grenade.destructive = false;
    grenade.trailColor = 0x8c8b7e;
    grenade.trailTimerStep = 0.055;
    grenade.position.copy(start);
    grenade.velocity.set(
      (destination.x - start.x) / duration,
      (destination.y - start.y + 0.5 * GRAVITY * duration * duration) / duration,
      (destination.z - start.z) / duration
    );
    grenade.spin.set(rand(-4, 4), rand(2, 5), rand(-4, 4));
    grenade.fuse = duration + 0.4;
    grenade.flightTime = duration;
    grenade.radius = radius;
    grenade.damage = damage;
    grenade.flight = 0;
    grenade.age = 0;
    grenade.trailTimer = 0;
    grenade.mesh.visible = true;
    grenade.mesh.geometry = this.geometry;
    grenade.mesh.scale.setScalar(1.35);
    grenade.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));

    const marker = this._acquireMarker();
    marker.group.visible = true;
    marker.group.position.set(destination.x, 0.065, destination.z);
    marker.baseScale = radius / 1.72;
    marker.group.scale.setScalar(marker.baseScale);
    marker.material.opacity = 0.7;
    marker.innerMaterial.opacity = 0.6;
    marker.glow.material.opacity = 0.55;
    grenade.marker = marker;

    grenade.whistle = this.audio?.playMortarWhistle?.(
      new THREE.Vector3(destination.x, 1, destination.z),
      duration
    ) || null;
    return grenade;
  }

  _deactivate(grenade) {
    grenade.active = false;
    grenade.mesh.visible = false;
    if (grenade.marker) {
      grenade.marker.group.visible = false;
      grenade.marker = null;
    }
    grenade.whistle?.stop?.();
    grenade.whistle = null;
  }

  _explode(grenade, context) {
    if (!grenade.active) return;
    const payload = {
      position: grenade.position.clone(),
      x: grenade.position.x,
      z: grenade.position.z,
      radius: grenade.radius,
      damage: grenade.damage,
      mode: grenade.mode,
      faction: grenade.faction,
      kind: grenade.kind,
      toxin: grenade.toxin,
      nuke: grenade.nuke,
      destructive: grenade.destructive,
    };
    this.particles.spawnGrenadeTrail(grenade.position);
    this._deactivate(grenade);
    context.onExplosion?.(payload);
  }

  update(dt, context) {
    for (const grenade of this.grenades) {
      if (!grenade.active) continue;
      grenade.age += dt;
      grenade.flight += dt;
      grenade.fuse -= dt;

      const prevY = grenade.position.y;
      if (grenade.mode !== 'rocket') {
        grenade.velocity.y -= GRAVITY * dt;
      }
      grenade.position.addScaledVector(grenade.velocity, dt);
      grenade.mesh.position.copy(grenade.position);
      grenade.mesh.rotation.x += grenade.spin.x * dt;
      grenade.mesh.rotation.y += grenade.spin.y * dt;
      grenade.mesh.rotation.z += grenade.spin.z * dt;

      grenade.trailTimer -= dt;
      if (grenade.trailTimer <= 0) {
        grenade.trailTimer = grenade.trailTimerStep || 0.055;
        if (grenade.mode === 'rocket') {
          this.particles.spawnRocketTrail(grenade.position, {
            nuke: grenade.nuke,
            color: grenade.trailColor,
          });
        } else {
          this.particles.spawnGrenadeTrail(grenade.position, {
            color: grenade.trailColor,
          });
        }
      }

      // Player frag grenades, shells and rockets detonate on a direct body hit.
      if (
        (grenade.mode === 'frag' ||
          grenade.mode === 'launcher' ||
          grenade.mode === 'rocket') &&
        grenade.faction === 'player' &&
        context.enemies
      ) {
        for (const enemy of context.enemies) {
          if (!enemy.alive) continue;
          const dx = enemy.position.x - grenade.position.x;
          const dz = enemy.position.z - grenade.position.z;
          if (
            dx * dx + dz * dz < (enemy.radius + 0.6) * (enemy.radius + 0.6) &&
            grenade.position.y > 0.4 &&
            grenade.position.y < 2.3
          ) {
            this._explode(grenade, context);
            break;
          }
        }
        if (!grenade.active) continue;
      }

      // Ground collision.
      if (grenade.position.y <= 0.16) {
        grenade.position.y = 0.16;
        if (
          grenade.mode === 'mortar' ||
          grenade.mode === 'launcher' ||
          grenade.mode === 'rocket'
        ) {
          this._explode(grenade, context);
          continue;
        }
        if (grenade.velocity.y < -1.2) {
          this.audio?.playBounce?.(grenade.position);
          this.particles.spawnDust(grenade.position, 1.2, 0.32);
        }
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.38;
        grenade.velocity.x *= 0.68;
        grenade.velocity.z *= 0.68;
        if (grenade.velocity.y < 1.2) grenade.velocity.y = 0;
        grenade.mesh.position.y = 0.16;
      } else if (grenade.position.y > 0.16) {
        // A tiny bounce sound when crossing the ground plane was handled above.
        if (prevY > 0.16 && grenade.position.y < 0.16) {
          this.particles.spawnDust(grenade.position, 0.6, 0.2);
        }
      }

      if (grenade.mode === 'mortar' && grenade.marker) {
        const remaining = Math.max(0, grenade.fuse);
        const pulse = 1 + Math.sin(grenade.age * 13) * 0.045;
        grenade.marker.group.scale.setScalar(
          (grenade.marker.baseScale || 1) * pulse
        );
        grenade.marker.group.rotation.y += dt * 0.8;
        const urgency = clamp(1 - remaining / (grenade.flightTime + 0.4), 0, 1);
        grenade.marker.material.opacity = 0.35 + urgency * 0.6;
        grenade.marker.innerMaterial.opacity = 0.3 + urgency * 0.5;
        grenade.marker.glow.material.opacity = 0.35 + urgency * 0.4;
      }

      if (grenade.fuse <= 0) {
        this._explode(grenade, context);
      }
    }
  }

  clear() {
    for (const grenade of this.grenades) {
      if (grenade.active) this._deactivate(grenade);
      grenade.mesh.visible = false;
    }
    for (const marker of this.markers) marker.group.visible = false;
  }
}
