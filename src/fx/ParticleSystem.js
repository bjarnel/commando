import * as THREE from 'three';
import { getGlowTexture, getSmokeTexture } from '../utils/textures.js';
import { clamp01, lerp, rand, smoothstep } from '../utils/math.js';

const VERTEX_SHADER = /* glsl */ `
  uniform float uScale;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(aSize * uScale / max(0.5, -mvPosition.z), 1.0, 420.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
  }
`;

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

class ParticlePool {
  constructor(scene, capacity, blending, texture, viewportHeight, renderOrder = 5) {
    this.capacity = capacity;
    this.cursor = 0;
    this.scene = scene;

    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.sizeStart = new Float32Array(capacity);
    this.sizeEnd = new Float32Array(capacity);
    this.alphaBase = new Float32Array(capacity);
    this.fadeIn = new Float32Array(capacity);
    this.fadeOutStart = new Float32Array(capacity);
    this.colorStart = new Float32Array(capacity * 3);
    this.colorEnd = new Float32Array(capacity * 3);
    this.bounce = new Uint8Array(capacity);
    this.activeCount = 0;

    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aSize', this.sizeAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: viewportHeight * 0.5 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
    this.geometry = geometry;
  }

  setViewportHeight(height) {
    this.material.uniforms.uScale.value = height * 0.5;
  }

  spawn(options) {
    const {
      x, y, z,
      vx = 0, vy = 0, vz = 0,
      color = 0xffffff,
      colorEnd = color,
      size = 1,
      sizeEnd = size,
      life = 1,
      alpha = 1,
      gravity = 0,
      drag = 0,
      fadeIn = 0.06,
      fadeOutStart = 0.55,
      bounce = false,
    } = options;

    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = index * 3;

    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocity[i3] = vx;
    this.velocity[i3 + 1] = vy;
    this.velocity[i3 + 2] = vz;

    const a = hexToRgb(color);
    const b = hexToRgb(colorEnd);
    this.colorStart[i3] = a[0];
    this.colorStart[i3 + 1] = a[1];
    this.colorStart[i3 + 2] = a[2];
    this.colorEnd[i3] = b[0];
    this.colorEnd[i3 + 1] = b[1];
    this.colorEnd[i3 + 2] = b[2];
    this.colors[i3] = a[0];
    this.colors[i3 + 1] = a[1];
    this.colors[i3 + 2] = a[2];

    this.life[index] = life;
    this.maxLife[index] = life;
    this.sizeStart[index] = size;
    this.sizeEnd[index] = sizeEnd;
    this.sizes[index] = size;
    this.alphaBase[index] = alpha;
    this.alphas[index] = 0;
    this.gravity[index] = gravity;
    this.drag[index] = drag;
    this.fadeIn[index] = fadeIn;
    this.fadeOutStart[index] = fadeOutStart;
    this.bounce[index] = bounce ? 1 : 0;
  }

  update(dt) {
    let active = 0;
    for (let index = 0; index < this.capacity; index++) {
      let life = this.life[index];
      if (life <= 0) {
        if (this.alphas[index] !== 0) {
          this.alphas[index] = 0;
          this.sizes[index] = 0;
        }
        continue;
      }

      life -= dt;
      this.life[index] = life;
      const i3 = index * 3;
      if (life <= 0) {
        this.alphas[index] = 0;
        this.sizes[index] = 0;
        continue;
      }
      active++;

      const dragFactor = Math.exp(-this.drag[index] * dt);
      this.velocity[i3] *= dragFactor;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * dragFactor + this.gravity[index] * dt;
      this.velocity[i3 + 2] *= dragFactor;

      this.positions[i3] += this.velocity[i3] * dt;
      this.positions[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocity[i3 + 2] * dt;

      if (this.bounce[index] && this.positions[i3 + 1] < 0.04) {
        this.positions[i3 + 1] = 0.04;
        this.velocity[i3 + 1] *= -0.26;
        this.velocity[i3] *= 0.72;
        this.velocity[i3 + 2] *= 0.72;
      }

      const t = 1 - life / this.maxLife[index];
      const size = lerp(this.sizeStart[index], this.sizeEnd[index], smoothstep(0, 1, t));
      this.sizes[index] = size;
      const fadeIn = this.fadeIn[index];
      const fadeOutStart = this.fadeOutStart[index];
      const fade =
        smoothstep(0, Math.max(0.001, fadeIn), t) *
        (1 - smoothstep(fadeOutStart, 1, t));
      this.alphas[index] = this.alphaBase[index] * fade;
      this.colors[i3] = lerp(this.colorStart[i3], this.colorEnd[i3], t);
      this.colors[i3 + 1] = lerp(this.colorStart[i3 + 1], this.colorEnd[i3 + 1], t);
      this.colors[i3 + 2] = lerp(this.colorStart[i3 + 2], this.colorEnd[i3 + 2], t);
    }
    this.activeCount = active;
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.activeCount = 0;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.additive = new ParticlePool(
      scene,
      900,
      THREE.AdditiveBlending,
      getGlowTexture(),
      window.innerHeight * 0.5,
      6
    );
    this.soft = new ParticlePool(
      scene,
      760,
      THREE.NormalBlending,
      getSmokeTexture(),
      window.innerHeight * 0.5,
      5
    );

    this.ringGeometry = new THREE.RingGeometry(0.35, 0.5, 40);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffb15e,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.rings.push({ mesh, material, life: 0, maxLife: 0.5, radius: 4 });
    }
    this.ringCursor = 0;
    this._tmpColor = new THREE.Color();

    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const material = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xfff0ca,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 7;
      scene.add(sprite);
      this.flashes.push({
        sprite,
        material,
        life: 0,
        maxLife: 0.3,
        startScale: 1,
        endScale: 4,
      });
    }
    this.flashCursor = 0;

    this.blobs = [];
    const blobGeometry = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff8a2c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(blobGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.blobs.push({
        mesh,
        material,
        life: 0,
        maxLife: 0.4,
        startScale: 0.5,
        endScale: 2,
      });
    }
    this.blobCursor = 0;
  }

  spawnBlob(position, startScale, endScale, life, color = 0xff8a2c) {
    const blob = this.blobs[this.blobCursor];
    this.blobCursor = (this.blobCursor + 1) % this.blobs.length;
    blob.mesh.position.copy(position);
    blob.mesh.position.x += rand(-0.5, 0.5);
    blob.mesh.position.y += rand(0.2, 1.2);
    blob.mesh.position.z += rand(-0.5, 0.5);
    blob.mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    blob.mesh.scale.setScalar(startScale);
    blob.mesh.visible = true;
    blob.material.color.setHex(color);
    blob.material.opacity = 0.62;
    blob.life = life;
    blob.maxLife = life;
    blob.startScale = startScale;
    blob.endScale = endScale;
  }

  spawnFlash(position, startScale, endScale, life = 0.3, color = 0xfff0ca) {
    const flash = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    flash.sprite.position.set(position.x, position.y + 0.6, position.z);
    flash.material.color.setHex(color);
    flash.material.opacity = 0.95;
    flash.sprite.scale.setScalar(startScale);
    flash.sprite.visible = true;
    flash.life = life;
    flash.maxLife = life;
    flash.startScale = startScale;
    flash.endScale = endScale;
  }

  setViewportHeight(heightPx) {
    this.additive.setViewportHeight(heightPx);
    this.soft.setViewportHeight(heightPx);
  }

  spawnMuzzle(position, direction) {
    const add = this.additive;
    for (let i = 0; i < 5; i++) {
      const spread = 0.45;
      add.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: direction.x * rand(4, 11) + rand(-spread, spread),
        vy: rand(0.3, 2.1),
        vz: direction.z * rand(4, 11) + rand(-spread, spread),
        color: 0xffe0a0,
        colorEnd: 0xff7b25,
        size: rand(0.18, 0.42),
        sizeEnd: 0.04,
        life: rand(0.08, 0.2),
        gravity: 2,
        drag: 2.5,
        fadeIn: 0.01,
        fadeOutStart: 0.25,
      });
    }
    this.soft.spawn({
      x: position.x,
      y: position.y + 0.05,
      z: position.z,
      vx: direction.x * 1.2,
      vy: 0.55,
      vz: direction.z * 1.2,
      color: 0xa89b7d,
      colorEnd: 0x6e6a5e,
      size: 0.2,
      sizeEnd: 0.7,
      life: rand(0.35, 0.7),
      alpha: 0.18,
      gravity: 0.25,
      drag: 2.4,
      fadeIn: 0.1,
      fadeOutStart: 0.35,
    });
    // Hot brass.
    add.spawn({
      x: position.x,
      y: position.y,
      z: position.z,
      vx: rand(-2.2, 2.2),
      vy: rand(1.4, 3.4),
      vz: rand(-1.4, 1.4),
      color: 0xffcf7b,
      colorEnd: 0xc57c31,
      size: 0.07,
      sizeEnd: 0.035,
      life: rand(0.4, 0.8),
      gravity: 15,
      bounce: true,
      fadeIn: 0.01,
      fadeOutStart: 0.8,
    });
  }

  spawnImpact(position, color = 0xffd08a, direction = { x: 0, z: 1 }, scale = 1) {
    const add = this.additive;
    for (let i = 0; i < 6; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1.5, 6) * scale;
      add.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: Math.cos(angle) * speed + direction.x * 2,
        vy: rand(0.4, 3.2) * scale,
        vz: Math.sin(angle) * speed + direction.z * 2,
        color,
        colorEnd: 0x9c3a12,
        size: rand(0.1, 0.28) * scale,
        sizeEnd: 0.02,
        life: rand(0.1, 0.32),
        gravity: 9,
        drag: 1.5,
        fadeIn: 0.01,
        fadeOutStart: 0.3,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.soft.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: rand(-0.8, 0.8),
        vy: rand(0.1, 0.9),
        vz: rand(-0.8, 0.8),
        color: 0x8d8068,
        colorEnd: 0x54554a,
        size: rand(0.24, 0.5) * scale,
        sizeEnd: rand(0.6, 1.1) * scale,
        life: rand(0.4, 0.8),
        alpha: 0.24,
        gravity: 0.2,
        drag: 2,
        fadeIn: 0.05,
        fadeOutStart: 0.3,
      });
    }
  }

  spawnBlood(position, direction, amount = 1) {
    for (let i = 0; i < 7 * amount; i++) {
      this.soft.spawn({
        x: position.x + rand(-0.15, 0.15),
        y: position.y + rand(-0.25, 0.35),
        z: position.z + rand(-0.15, 0.15),
        vx: direction.x * rand(0.5, 3.5) + rand(-2, 2),
        vy: rand(0.4, 2.8),
        vz: direction.z * rand(0.5, 3.5) + rand(-2, 2),
        color: 0x7f2117,
        colorEnd: 0x3b0c08,
        size: rand(0.09, 0.24),
        sizeEnd: rand(0.02, 0.08),
        life: rand(0.35, 0.8),
        alpha: 0.8,
        gravity: 13,
        drag: 0.8,
        bounce: i % 3 === 0,
        fadeIn: 0.01,
        fadeOutStart: 0.7,
      });
    }
    this.soft.spawn({
      x: position.x,
      y: position.y + 0.1,
      z: position.z,
      vx: direction.x * 0.8,
      vy: 0.4,
      vz: direction.z * 0.8,
      color: 0x5d1a12,
      colorEnd: 0x34201a,
      size: 0.45,
      sizeEnd: 1.4,
      life: 0.55,
      alpha: 0.28,
      gravity: -0.2,
      drag: 1.4,
      fadeIn: 0.02,
      fadeOutStart: 0.25,
    });
  }

  spawnDust(position, scale = 1, alpha = 0.24) {
    for (let i = 0; i < 2; i++) {
      this.soft.spawn({
        x: position.x + rand(-0.35, 0.35),
        y: 0.15,
        z: position.z + rand(-0.35, 0.35),
        vx: rand(-0.6, 0.6),
        vy: rand(0.2, 0.8),
        vz: rand(-0.6, 0.6),
        color: 0x9a8e6f,
        colorEnd: 0x63675a,
        size: rand(0.28, 0.6) * scale,
        sizeEnd: rand(0.9, 1.7) * scale,
        life: rand(0.5, 1.1),
        alpha,
        gravity: 0.12,
        drag: 1.6,
        fadeIn: 0.12,
        fadeOutStart: 0.2,
      });
    }
  }

  spawnMote(position) {
    this.soft.spawn({
      x: position.x,
      y: position.y,
      z: position.z,
      vx: rand(-0.12, 0.22),
      vy: rand(-0.04, 0.12),
      vz: rand(-0.15, 0.1),
      color: 0xe9e2c6,
      colorEnd: 0xb7bfa4,
      size: rand(0.035, 0.09),
      sizeEnd: rand(0.08, 0.16),
      life: rand(3.2, 6.5),
      alpha: rand(0.06, 0.14),
      gravity: 0,
      drag: 0.1,
      fadeIn: 0.3,
      fadeOutStart: 0.45,
    });
  }

  spawnFootstep(position) {
    this.soft.spawn({
      x: position.x + rand(-0.18, 0.18),
      y: 0.08,
      z: position.z + rand(-0.18, 0.18),
      vx: rand(-0.2, 0.2),
      vy: rand(0.15, 0.35),
      vz: rand(-0.15, 0.15),
      color: 0x7d755f,
      colorEnd: 0x565a4d,
      size: 0.2,
      sizeEnd: 0.75,
      life: rand(0.4, 0.7),
      alpha: 0.16,
      gravity: 0,
      drag: 2.2,
      fadeIn: 0.15,
      fadeOutStart: 0.2,
    });
  }

  spawnGrenadeTrail(position, { color = 0x8c8b7e } = {}) {
    this.soft.spawn({
      x: position.x + rand(-0.08, 0.08),
      y: position.y,
      z: position.z + rand(-0.08, 0.08),
      vx: rand(-0.2, 0.2),
      vy: rand(0.15, 0.5),
      vz: rand(-0.2, 0.2),
      color,
      colorEnd: 0x55574f,
      size: 0.16,
      sizeEnd: 0.7,
      life: rand(0.5, 0.9),
      alpha: 0.18,
      gravity: 0.45,
      drag: 1.3,
      fadeIn: 0.15,
      fadeOutStart: 0.3,
    });
  }

  spawnRocketTrail(position, { nuke = false, color = 0xd8cfc0 } = {}) {
    this.additive.spawn({
      x: position.x + rand(-0.08, 0.08),
      y: position.y + rand(-0.05, 0.05),
      z: position.z + rand(-0.08, 0.08),
      vx: rand(-0.6, 0.6),
      vy: rand(-0.1, 0.5),
      vz: rand(-0.6, 0.6),
      color: nuke ? 0xfff2c0 : 0xffc06b,
      colorEnd: nuke ? 0xff8a2c : 0xd64316,
      size: nuke ? rand(0.28, 0.55) : rand(0.16, 0.34),
      sizeEnd: 0.02,
      life: rand(0.14, 0.3),
      gravity: 0.4,
      drag: 2.4,
      fadeIn: 0.01,
      fadeOutStart: 0.25,
    });
    for (let i = 0; i < (nuke ? 3 : 2); i++) {
      this.soft.spawn({
        x: position.x + rand(-0.15, 0.15),
        y: position.y + rand(-0.1, 0.15),
        z: position.z + rand(-0.15, 0.15),
        vx: rand(-0.4, 0.4),
        vy: rand(0.1, 0.65),
        vz: rand(-0.4, 0.4),
        color,
        colorEnd: 0x4e5148,
        size: rand(0.18, 0.38) * (nuke ? 1.4 : 1),
        sizeEnd: rand(0.8, 1.6) * (nuke ? 1.5 : 1),
        life: rand(0.7, 1.4),
        alpha: nuke ? 0.3 : 0.22,
        gravity: 0.2,
        drag: 1.1,
        fadeIn: 0.08,
        fadeOutStart: 0.3,
      });
    }
  }

  spawnFireCone(position, direction, scale = 1) {
    const angle = Math.atan2(direction.x, direction.z);
    const count = Math.max(3, Math.round(6 * scale));
    for (let i = 0; i < count; i++) {
      const spread = rand(-0.42, 0.42);
      const speed = rand(5, 13) * scale;
      const dirX = Math.sin(angle + spread);
      const dirZ = Math.cos(angle + spread);
      this.additive.spawn({
        x: position.x,
        y: position.y + rand(-0.1, 0.15),
        z: position.z,
        vx: dirX * speed + rand(-0.7, 0.7),
        vy: rand(0.4, 2.2),
        vz: dirZ * speed + rand(-0.7, 0.7),
        color: i % 4 === 0 ? 0xfff5b0 : 0xffa12c,
        colorEnd: 0x8c1d05,
        size: rand(0.35, 0.85) * scale,
        sizeEnd: rand(0.1, 0.4) * scale,
        life: rand(0.28, 0.62),
        gravity: -0.7,
        drag: 1.8,
        fadeIn: 0.02,
        fadeOutStart: 0.45,
      });
    }
    if (Math.random() < 0.55) {
      this.soft.spawn({
        x: position.x + direction.x * rand(2, 7) * scale,
        y: rand(0.3, 1.5),
        z: position.z + direction.z * rand(2, 7) * scale,
        vx: direction.x * rand(0.5, 2),
        vy: rand(0.5, 1.4),
        vz: direction.z * rand(0.5, 2),
        color: 0x4b453c,
        colorEnd: 0x211f1b,
        size: rand(0.4, 0.9) * scale,
        sizeEnd: rand(1.4, 2.6) * scale,
        life: rand(0.9, 1.8),
        alpha: 0.2,
        gravity: 0.25,
        drag: 0.9,
        fadeIn: 0.1,
        fadeOutStart: 0.3,
      });
    }
  }

  spawnPlasmaBurst(position, color = 0x9ff6ff) {
    this.spawnFlash(position, 0.4, 1.9, 0.16, color);
    for (let i = 0; i < 8; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(2, 8);
      this.additive.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: Math.cos(angle) * speed,
        vy: rand(0.4, 3),
        vz: Math.sin(angle) * speed,
        color,
        colorEnd: 0x2a53a8,
        size: rand(0.12, 0.34),
        sizeEnd: 0.01,
        life: rand(0.12, 0.32),
        gravity: 3,
        drag: 2.2,
        fadeIn: 0.01,
        fadeOutStart: 0.3,
      });
    }
  }

  spawnToxinCloud(position, scale = 1) {
    for (let i = 0; i < 4; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0, 2.4) * scale;
      this.soft.spawn({
        x: position.x + Math.cos(angle) * dist,
        y: rand(0.2, 1.6),
        z: position.z + Math.sin(angle) * dist,
        vx: Math.cos(angle) * rand(0.2, 1.3),
        vy: rand(0.1, 0.8),
        vz: Math.sin(angle) * rand(0.2, 1.3),
        color: i % 2 ? 0x9dd85a : 0x74a84a,
        colorEnd: 0x2f4a1f,
        size: rand(0.8, 1.7) * scale,
        sizeEnd: rand(2.2, 4.2) * scale,
        life: rand(2.2, 4.4),
        alpha: 0.24,
        gravity: 0.06,
        drag: 0.35,
        fadeIn: 0.2,
        fadeOutStart: 0.35,
      });
    }
    if (Math.random() < 0.3) {
      this.additive.spawn({
        x: position.x + rand(-2, 2),
        y: rand(0.3, 1.4),
        z: position.z + rand(-2, 2),
        vx: rand(-0.4, 0.4),
        vy: rand(0.2, 1),
        vz: rand(-0.4, 0.4),
        color: 0xc8ff8c,
        colorEnd: 0x4a7a2c,
        size: rand(0.05, 0.12),
        sizeEnd: 0.01,
        life: rand(0.6, 1.4),
        gravity: -0.2,
        drag: 0.6,
        fadeIn: 0.1,
        fadeOutStart: 0.5,
      });
    }
  }

  spawnDebris(position, color = 0x8a8578, scale = 1) {
    for (let i = 0; i < Math.round(12 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(2, 11) * scale;
      this.soft.spawn({
        x: position.x + rand(-0.6, 0.6),
        y: rand(0.2, 1.6),
        z: position.z + rand(-0.6, 0.6),
        vx: Math.cos(angle) * speed,
        vy: rand(1.5, 7) * scale,
        vz: Math.sin(angle) * speed,
        color,
        colorEnd: 0x3f4038,
        size: rand(0.18, 0.55) * scale,
        sizeEnd: rand(0.06, 0.18) * scale,
        life: rand(0.8, 1.7),
        alpha: 0.85,
        gravity: 16,
        drag: 0.6,
        bounce: true,
        fadeIn: 0.01,
        fadeOutStart: 0.75,
      });
    }
    for (let i = 0; i < Math.round(5 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      this.soft.spawn({
        x: position.x + Math.cos(angle) * rand(0, 1.4),
        y: rand(0.2, 1.2),
        z: position.z + Math.sin(angle) * rand(0, 1.4),
        vx: Math.cos(angle) * rand(0.2, 1.4),
        vy: rand(0.2, 1.4),
        vz: Math.sin(angle) * rand(0.2, 1.4),
        color: 0x86806d,
        colorEnd: 0x4b4d43,
        size: rand(0.6, 1.4) * scale,
        sizeEnd: rand(2.2, 4) * scale,
        life: rand(1.4, 3.2),
        alpha: 0.26,
        gravity: 0.15,
        drag: 0.7,
        fadeIn: 0.15,
        fadeOutStart: 0.3,
      });
    }
  }

  spawnNuke(position) {
    this.spawnFlash(position, 5, 42, 0.9, 0xffffff);
    this.spawnFlash(position, 4, 26, 0.65, 0xfff0c0);
    this.spawnBlob(position, 2, 14, 0.9, 0xfff3c4);
    this.spawnBlob(position, 3, 20, 1.1, 0xffb24d);
    this.spawnBlob(position, 4, 26, 1.3, 0xff6a1e);

    // Fireball core.
    for (let i = 0; i < 90; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(5, 34);
      this.additive.spawn({
        x: position.x + rand(-2, 2),
        y: rand(0.5, 4.5),
        z: position.z + rand(-2, 2),
        vx: Math.cos(angle) * speed,
        vy: rand(4, 26),
        vz: Math.sin(angle) * speed,
        color: i % 4 === 0 ? 0xffffff : 0xffd27a,
        colorEnd: 0x8c1c08,
        size: rand(2, 6),
        sizeEnd: rand(0.4, 1.8),
        life: rand(0.8, 2.2),
        gravity: -3,
        drag: 1.1,
        fadeIn: 0.01,
        fadeOutStart: 0.4,
      });
    }

    // Mushroom stem and cap.
    for (let i = 0; i < 60; i++) {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(0, 5);
      this.soft.spawn({
        x: position.x + Math.cos(angle) * radius,
        y: rand(0.5, 12),
        z: position.z + Math.sin(angle) * radius,
        vx: Math.cos(angle) * rand(0.6, 4),
        vy: rand(4, 15),
        vz: Math.sin(angle) * rand(0.6, 4),
        color: i % 3 === 0 ? 0xc7b48b : 0x8e8270,
        colorEnd: 0x3b3a33,
        size: rand(2, 5),
        sizeEnd: rand(8, 15),
        life: rand(3.5, 7),
        alpha: rand(0.3, 0.55),
        gravity: 0.3,
        drag: 0.35,
        fadeIn: 0.12,
        fadeOutStart: 0.4,
      });
    }

    // Ground ring of dust and ash.
    for (let i = 0; i < 70; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(10, 34);
      this.soft.spawn({
        x: position.x,
        y: 0.15,
        z: position.z,
        vx: Math.cos(angle) * speed,
        vy: rand(0.2, 3),
        vz: Math.sin(angle) * speed,
        color: 0xa79b80,
        colorEnd: 0x46463c,
        size: rand(0.8, 2.4),
        sizeEnd: rand(5, 11),
        life: rand(2.2, 5),
        alpha: 0.3,
        gravity: 0,
        drag: 0.55,
        fadeIn: 0.05,
        fadeOutStart: 0.3,
      });
    }

    this.spawnShockwave(position, 46, 0xfff0c8, 1.5);
    this.spawnShockwave(position, 30, 0xffa65e, 1.1);
    this.spawnShockwave(position, 16, 0xffffff, 0.7);
  }

  spawnSmokeColumn(position, large = false, green = false) {
    this.soft.spawn({
      x: position.x + rand(-0.7, 0.7),
      y: green ? 0.75 : 0.5,
      z: position.z + rand(-0.7, 0.7),
      vx: rand(-0.45, 0.45) + 0.25,
      vy: rand(0.7, large ? 2.1 : 1.4),
      vz: rand(-0.25, 0.35),
      color: green ? 0x8faf6b : 0x5a5548,
      colorEnd: green ? 0x556d47 : 0x2c3029,
      size: large ? rand(1.1, 2.1) : rand(0.6, 1.4),
      sizeEnd: large ? rand(4.2, 6.2) : rand(2.2, 3.6),
      life: large ? rand(2.8, 4.4) : rand(1.7, 2.8),
      alpha: green ? 0.24 : large ? 0.2 : 0.12,
      gravity: 0.12,
      drag: 0.5,
      fadeIn: 0.2,
      fadeOutStart: 0.35,
    });
  }

  spawnEmber(position, spread = 0.6) {
    this.additive.spawn({
      x: position.x + rand(-spread, spread),
      y: rand(0.2, 1.2),
      z: position.z + rand(-spread, spread),
      vx: rand(-0.5, 0.9),
      vy: rand(0.6, 2.4),
      vz: rand(-0.5, 0.6),
      color: 0xffb35c,
      colorEnd: 0xff3b0a,
      size: rand(0.06, 0.16),
      sizeEnd: 0.01,
      life: rand(0.9, 1.9),
      gravity: -0.3,
      drag: 0.4,
      fadeIn: 0.1,
      fadeOutStart: 0.5,
    });
  }

  spawnExplosion(position, scale = 1) {
    const add = this.additive;
    const soft = this.soft;

    // A big camera-facing flash plus a point-sprite core gives the blast a
    // readable silhouette even against a bright sunlit field.
    this.spawnFlash(
      position,
      1.7 * scale,
      6.4 * scale,
      0.26,
      0xffe2a6
    );
    this.spawnBlob(position, 0.5 * scale, 3.2 * scale, 0.42, 0xff9a35);
    this.spawnBlob(position, 0.4 * scale, 2.4 * scale, 0.32, 0xffc76a);
    this.spawnBlob(position, 0.6 * scale, 4.0 * scale, 0.52, 0xd65019);
    add.spawn({
      x: position.x,
      y: position.y + 0.5,
      z: position.z,
      color: 0xfff8df,
      colorEnd: 0xff7a22,
      size: 3.4 * scale,
      sizeEnd: 8.5 * scale,
      life: 0.3,
      alpha: 1,
      fadeIn: 0.01,
      fadeOutStart: 0.08,
    });

    // Expanding fireball made from surprisingly large point sprites.
    for (let i = 0; i < Math.round(26 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1.8, 9.5) * scale;
      add.spawn({
        x: position.x + rand(-0.5, 0.5),
        y: position.y + rand(0.2, 1.3),
        z: position.z + rand(-0.5, 0.5),
        vx: Math.cos(angle) * speed,
        vy: rand(1.8, 9) * scale,
        vz: Math.sin(angle) * speed,
        color: i % 3 === 0 ? 0xfff3c5 : 0xffa63c,
        colorEnd: 0x9c1e05,
        size: rand(1.1, 2.8) * scale,
        sizeEnd: rand(0.25, 1.0) * scale,
        life: rand(0.42, 1.1),
        gravity: -1.8,
        drag: 2.4,
        fadeIn: 0.02,
        fadeOutStart: 0.38,
      });
    }

    // A vertical column of flame and grit.
    for (let i = 0; i < Math.round(8 * scale); i++) {
      add.spawn({
        x: position.x + rand(-0.5, 0.5),
        y: position.y + rand(0.2, 0.8),
        z: position.z + rand(-0.5, 0.5),
        vx: rand(-1.1, 1.1),
        vy: rand(4.5, 11) * scale,
        vz: rand(-1.1, 1.1),
        color: 0xfff0b3,
        colorEnd: 0xff4b14,
        size: rand(1.2, 2.6) * scale,
        sizeEnd: 0.4 * scale,
        life: rand(0.4, 0.9),
        gravity: -2.2,
        drag: 1.2,
        fadeIn: 0.02,
        fadeOutStart: 0.3,
      });
    }

    // Debris / high velocity sparks.
    for (let i = 0; i < Math.round(18 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(6, 19) * scale;
      add.spawn({
        x: position.x,
        y: position.y + rand(0.2, 1),
        z: position.z,
        vx: Math.cos(angle) * speed,
        vy: rand(2, 15) * scale,
        vz: Math.sin(angle) * speed,
        color: 0xffc06b,
        colorEnd: 0xff4312,
        size: rand(0.1, 0.26) * scale,
        sizeEnd: 0.01,
        life: rand(0.4, 1.1),
        gravity: 17,
        drag: 0.55,
        bounce: true,
        fadeIn: 0.01,
        fadeOutStart: 0.6,
      });
    }

    // Dark smoke that lingers.
    for (let i = 0; i < Math.round(20 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0, 2.6) * scale;
      soft.spawn({
        x: position.x + Math.cos(angle) * dist,
        y: position.y + rand(0.3, 2.1),
        z: position.z + Math.sin(angle) * dist,
        vx: Math.cos(angle) * rand(0.2, 1.7),
        vy: rand(0.5, 2.4),
        vz: Math.sin(angle) * rand(0.2, 1.7),
        color: 0x575247,
        colorEnd: 0x22241e,
        size: rand(1.4, 3.1) * scale,
        sizeEnd: rand(4.0, 8.0) * scale,
        life: rand(1.8, 4.0),
        alpha: rand(0.22, 0.42),
        gravity: 0.22,
        drag: 0.65,
        fadeIn: 0.12,
        fadeOutStart: 0.28,
      });
    }

    // Ground-hugging dust ring.
    for (let i = 0; i < Math.round(12 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      soft.spawn({
        x: position.x,
        y: 0.12,
        z: position.z,
        vx: Math.cos(angle) * rand(4, 10) * scale,
        vy: rand(0.1, 1.1),
        vz: Math.sin(angle) * rand(4, 10) * scale,
        color: 0x93876a,
        colorEnd: 0x505246,
        size: 0.5 * scale,
        sizeEnd: rand(2.0, 3.8) * scale,
        life: rand(0.8, 1.8),
        alpha: 0.22,
        gravity: 0,
        drag: 2.2,
        fadeIn: 0.05,
        fadeOutStart: 0.28,
      });
    }

    this.spawnShockwave(position, 6.2 * scale, 0xffa856, 0.6);
    this.spawnShockwave(position, 3.4 * scale, 0xfff0c9, 0.3);
  }

  spawnShockwave(position, radius, color = 0xffb05e, life = 0.45) {
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    ring.mesh.position.set(position.x, 0.07, position.z);
    ring.mesh.scale.setScalar(0.25);
    ring.mesh.visible = true;
    ring.material.color.setHex(color);
    ring.material.opacity = 0.9;
    ring.life = life;
    ring.maxLife = life;
    ring.radius = radius;
  }

  update(dt) {
    this.additive.update(dt);
    this.soft.update(dt);

    for (const flash of this.flashes) {
      if (flash.life <= 0) {
        if (flash.sprite.visible) flash.sprite.visible = false;
        continue;
      }
      flash.life -= dt;
      const t = clamp01(1 - flash.life / flash.maxLife);
      const scale = lerp(flash.startScale, flash.endScale, 1 - Math.pow(1 - t, 2.4));
      flash.sprite.scale.setScalar(scale);
      flash.material.opacity = 0.9 * Math.pow(1 - t, 1.7);
      if (flash.life <= 0) flash.sprite.visible = false;
    }

    for (const blob of this.blobs) {
      if (blob.life <= 0) {
        if (blob.mesh.visible) blob.mesh.visible = false;
        continue;
      }
      blob.life -= dt;
      const t = clamp01(1 - blob.life / blob.maxLife);
      const scale = lerp(
        blob.startScale,
        blob.endScale,
        1 - Math.pow(1 - t, 2.8)
      );
      blob.mesh.scale.setScalar(scale);
      blob.mesh.rotation.x += dt * 1.2;
      blob.mesh.rotation.y += dt * 0.9;
      blob.material.opacity = 0.62 * Math.pow(1 - t, 1.5);
      if (blob.life <= 0) blob.mesh.visible = false;
    }

    for (const ring of this.rings) {
      if (ring.life <= 0) {
        if (ring.mesh.visible) ring.mesh.visible = false;
        continue;
      }
      ring.life -= dt;
      const t = clamp01(1 - ring.life / ring.maxLife);
      const scale = lerp(0.3, ring.radius, 1 - Math.pow(1 - t, 2.2));
      ring.mesh.scale.setScalar(scale);
      ring.material.opacity = 0.9 * Math.pow(1 - t, 1.8);
      if (ring.life <= 0) ring.mesh.visible = false;
    }
  }

  clear() {
    this.additive.clear();
    this.soft.clear();
    for (const ring of this.rings) {
      ring.life = 0;
      ring.mesh.visible = false;
    }
    for (const flash of this.flashes) {
      flash.life = 0;
      flash.sprite.visible = false;
    }
    for (const blob of this.blobs) {
      blob.life = 0;
      blob.mesh.visible = false;
    }
  }

  getActiveCount() {
    return this.additive.activeCount + this.soft.activeCount;
  }
}
