import * as THREE from 'three';
import { clamp01, damp, rand } from '../utils/math.js';
import { getGlowTexture, getSmokeTexture } from '../utils/textures.js';

/**
 * Biome weather: rain squalls, snow, dust storms and lightning. All three
 * particle fields follow the player in local space, so the weather feels
 * continuous across the entire corridor without generating the whole level.
 */
export class WeatherSystem {
  constructor(scene, { audio, effects, lighting }) {
    this.scene = scene;
    this.isMobile =
      window.matchMedia?.('(pointer: coarse)').matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    const density = this.isMobile ? 0.68 : 1;
    this.audio = audio;
    this.effects = effects;
    this.lighting = lighting;

    this.levels = { rain: 0, snow: 0, dust: 0, wind: 0, fog: 0 };
    this.targets = { rain: 0, snow: 0, dust: 0, wind: 0, fog: 0 };
    this.fogTarget = 0;
    this.mode = 'clear';
    this.allowLightning = false;
    this.lightningTimer = rand(5, 10);
    this.lightningEnergy = 0;
    this.time = 0;

    this.rainCount = Math.round(440 * density);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(this.rainCount * 6);
    this.rainDrops = [];
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({
        x: rand(-30, 30),
        y: rand(0, 24),
        z: rand(-22, 22),
        speed: rand(22, 34),
        length: rand(0.7, 1.7),
      });
    }
    const rainAttr = new THREE.BufferAttribute(this.rainPositions, 3);
    rainAttr.setUsage(THREE.DynamicDrawUsage);
    this.rainGeometry.setAttribute('position', rainAttr);
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xc5d8d9,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    this.rain.visible = false;
    this.scene.add(this.rain);

    this.snowCount = Math.round(760 * density);
    this.snowGeometry = new THREE.BufferGeometry();
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.snowFlakes = [];
    for (let i = 0; i < this.snowCount; i++) {
      this.snowFlakes.push({
        x: rand(-32, 32),
        y: rand(0, 23),
        z: rand(-22, 22),
        speed: rand(1.4, 3.6),
        phase: rand(0, Math.PI * 2),
        drift: rand(0.3, 1.2),
      });
    }
    const snowAttr = new THREE.BufferAttribute(this.snowPositions, 3);
    snowAttr.setUsage(THREE.DynamicDrawUsage);
    this.snowGeometry.setAttribute('position', snowAttr);
    this.snowMaterial = new THREE.PointsMaterial({
      map: getGlowTexture(),
      color: 0xffffff,
      size: 0.24,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      alphaTest: 0.02,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.snow = new THREE.Points(this.snowGeometry, this.snowMaterial);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 8;
    this.snow.visible = false;
    this.scene.add(this.snow);

    this.dustCount = Math.round(520 * density);
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustPositions = new Float32Array(this.dustCount * 6);
    this.dustParticles = [];
    for (let i = 0; i < this.dustCount; i++) {
      this.dustParticles.push({
        x: rand(-34, 34),
        y: rand(0.2, 8),
        z: rand(-20, 20),
        speed: rand(8, 20),
        length: rand(0.8, 3.2),
        height: rand(-0.2, 0.6),
      });
    }
    const dustAttr = new THREE.BufferAttribute(this.dustPositions, 3);
    dustAttr.setUsage(THREE.DynamicDrawUsage);
    this.dustGeometry.setAttribute('position', dustAttr);
    this.dustMaterial = new THREE.LineBasicMaterial({
      color: 0xe6cfa2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.dust = new THREE.LineSegments(this.dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 8;
    this.dust.visible = false;
    this.scene.add(this.dust);

    this.lightningLight = new THREE.DirectionalLight(0xdde9ff, 0);
    this.lightningLight.position.set(20, 55, -20);
    this.lightningLight.target.position.set(0, 0, 0);
    this.scene.add(this.lightningLight);
    this.scene.add(this.lightningLight.target);

    this.fogCount = Math.round(150 * density);
    this.fogGeometry = new THREE.BufferGeometry();
    this.fogPositions = new Float32Array(this.fogCount * 3);
    this.fogScales = new Float32Array(this.fogCount);
    this.fogParticles = [];
    for (let i = 0; i < this.fogCount; i++) {
      const angle = rand(0, Math.PI * 2);
      const radius = Math.sqrt(rand(9, 34 * 34));
      this.fogParticles.push({
        x: Math.cos(angle) * radius,
        y: rand(0.3, 7.5),
        z: Math.sin(angle) * radius * 0.9,
        speed: rand(0.18, 0.9),
        drift: rand(-0.4, 0.4),
        phase: rand(0, Math.PI * 2),
        size: rand(8, 22),
      });
      this.fogScales[i] = this.fogParticles[i].size;
    }
    const fogAttr = new THREE.BufferAttribute(this.fogPositions, 3);
    fogAttr.setUsage(THREE.DynamicDrawUsage);
    this.fogGeometry.setAttribute('position', fogAttr);
    this.fogGeometry.setAttribute(
      'aScale',
      new THREE.BufferAttribute(this.fogScales, 1)
    );
    this.fogMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: getSmokeTexture() },
        color: { value: new THREE.Color(0xc9cbc0) },
        opacity: { value: 0 },
        uPointScale: { value: 420 },
        uNearFade: { value: new THREE.Vector2(3.5, 16) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute float aScale;
        uniform float uPointScale;
        uniform vec2 uNearFade;
        varying float vDistance;
        varying float vNear;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDistance = length(position.xz);
          vNear = smoothstep(uNearFade.x, uNearFade.y, vDistance);
          gl_PointSize = aScale * (uPointScale / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 color;
        uniform float opacity;
        varying float vDistance;
        varying float vNear;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          float alpha = tex.a * opacity * vNear;
          alpha *= 0.55 + 0.45 * smoothstep(6.0, 34.0, vDistance);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.fog = new THREE.Points(this.fogGeometry, this.fogMaterial);
    this.fog.frustumCulled = false;
    this.fog.renderOrder = 7;
    this.fog.visible = false;
    this.scene.add(this.fog);

    this.lastWeatherAudio = '';
  }

  setFog(factor = 0) {
    this.fogTarget = clamp01(factor);
    this.targets.fog = this.fogTarget;
  }

  setBiome(biome) {
    this.mode = biome.weather;
    this.targets.rain = biome.atmosphere.rain;
    this.targets.snow = biome.atmosphere.snow;
    this.targets.dust = biome.atmosphere.dust;
    this.targets.wind = biome.atmosphere.wind;
    this.allowLightning = biome.atmosphere.lightning;
    if (!this.allowLightning) {
      this.lightningTimer = rand(6, 12);
      this.lightningEnergy = 0;
    }
  }

  _seedSnow() {
    for (let i = 0; i < this.snowCount; i++) {
      this.snowPositions[i * 3] = rand(-32, 32);
      this.snowPositions[i * 3 + 1] = rand(0, 23);
      this.snowPositions[i * 3 + 2] = rand(-22, 22);
    }
    this.snowGeometry.attributes.position.needsUpdate = true;
  }

  _updateRain(dt, player) {
    const level = this.levels.rain;
    if (level < 0.01) {
      this.rain.visible = false;
      return;
    }
    this.rain.visible = true;
    this.rainMaterial.opacity = 0.34 * level;
    this.rain.position.set(player.x, 0, player.z);
    const windX = 1.4 + this.levels.wind * 1.8;
    const windZ = 0.5;
    for (let i = 0; i < this.rainCount; i++) {
      const drop = this.rainDrops[i];
      drop.y -= drop.speed * dt;
      drop.x += windX * dt;
      drop.z += windZ * dt;
      if (drop.y < 0) {
        drop.y += 24;
        drop.x = rand(-30, 30);
        drop.z = rand(-22, 22);
      }
      if (drop.x > 32) drop.x -= 64;
      if (drop.z > 24) drop.z -= 48;
      const i6 = i * 6;
      this.rainPositions[i6] = drop.x;
      this.rainPositions[i6 + 1] = drop.y;
      this.rainPositions[i6 + 2] = drop.z;
      this.rainPositions[i6 + 3] = drop.x + windX * 0.055;
      this.rainPositions[i6 + 4] = drop.y + drop.length;
      this.rainPositions[i6 + 5] = drop.z + windZ * 0.055;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
  }

  _updateSnow(dt, player) {
    const level = this.levels.snow;
    if (level < 0.01) {
      this.snow.visible = false;
      return;
    }
    if (!this.snow.visible) {
      this.snow.visible = true;
      this._seedSnow();
    }
    this.snowMaterial.opacity = 0.82 * level;
    this.snow.position.set(player.x, 0, player.z);
    const windX = 0.7 + this.levels.wind * 1.2;
    for (let i = 0; i < this.snowCount; i++) {
      const flake = this.snowFlakes[i];
      flake.y -= flake.speed * dt;
      flake.x += (windX + Math.sin(this.time * 0.9 + flake.phase) * 0.5) * dt;
      flake.z += Math.cos(this.time * 0.7 + flake.phase) * 0.25 * dt;
      if (flake.y < 0) {
        flake.y += 23;
        flake.x = rand(-32, 32);
        flake.z = rand(-22, 22);
      }
      if (flake.x > 34) flake.x -= 68;
      if (flake.z > 24) flake.z -= 48;
      this.snowPositions[i * 3] = flake.x;
      this.snowPositions[i * 3 + 1] = flake.y;
      this.snowPositions[i * 3 + 2] = flake.z;
    }
    this.snowGeometry.attributes.position.needsUpdate = true;
  }

  _updateDust(dt, player) {
    const level = this.levels.dust;
    if (level < 0.01) {
      this.dust.visible = false;
      return;
    }
    this.dust.visible = true;
    this.dustMaterial.opacity = 0.42 * level;
    this.dust.position.set(player.x, 0, player.z);
    const wind = 12 + this.levels.wind * 18;
    for (let i = 0; i < this.dustCount; i++) {
      const grain = this.dustParticles[i];
      grain.x += wind * dt;
      grain.z += Math.sin(this.time * 0.6 + i * 0.4) * 2.2 * dt;
      if (grain.x > 37) {
        grain.x -= 74;
        grain.y = rand(0.2, 8);
        grain.z = rand(-20, 20);
      }
      const i6 = i * 6;
      this.dustPositions[i6] = grain.x;
      this.dustPositions[i6 + 1] = grain.y;
      this.dustPositions[i6 + 2] = grain.z;
      this.dustPositions[i6 + 3] = grain.x - grain.length;
      this.dustPositions[i6 + 4] = grain.y + grain.height;
      this.dustPositions[i6 + 5] = grain.z - grain.length * 0.2;
    }
    this.dustGeometry.attributes.position.needsUpdate = true;
  }

  _updateFog(dt, player) {
    const level = this.levels.fog;
    if (level < 0.015) {
      this.fog.visible = false;
      return;
    }
    if (!this.fog.visible) this.fog.visible = true;
    this.fogMaterial.uniforms.opacity.value = 0.34 * level;
    this.fogMaterial.uniforms.uPointScale.value = window.innerHeight * 0.42;
    this.fogMaterial.uniforms.uNearFade.value.set(3.5, 12 + level * 8);
    this.fog.position.set(player.x, 0, player.z);
    for (let i = 0; i < this.fogCount; i++) {
      const puff = this.fogParticles[i];
      puff.x += (puff.speed + this.levels.wind * 0.8) * dt;
      puff.z += puff.drift * dt;
      puff.y += Math.sin(this.time * 0.25 + puff.phase) * 0.02;
      if (puff.x > 32) puff.x -= 64;
      if (puff.z > 26) puff.z -= 48;
      this.fogPositions[i * 3] = puff.x;
      this.fogPositions[i * 3 + 1] = puff.y;
      this.fogPositions[i * 3 + 2] = puff.z;
    }
    this.fogGeometry.attributes.position.needsUpdate = true;
  }

  _updateLightning(dt, player) {
    this.lightningLight.position.set(player.x + 22, 55, player.z - 24);
    this.lightningLight.target.position.set(player.x, 0, player.z + 2);
    this.lightningLight.target.updateMatrixWorld();

    this.lightningEnergy = Math.max(0, this.lightningEnergy - dt * 7.5);
    this.lightningLight.intensity = this.lightningEnergy * 5.2;

    if (!this.allowLightning) return;
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = rand(5, 12);
      this.lightningEnergy = rand(0.7, 1.25);
      this.effects?.flashLightning?.();
      const delay = rand(300, 900);
      window.setTimeout(() => this.audio?.playThunder?.(rand(0.6, 1)), delay);
    }
  }

  update(dt, player) {
    this.time += dt;
    const smoothing = 1 - Math.exp(-1.2 * dt);
    for (const key of Object.keys(this.levels)) {
      this.levels[key] += (this.targets[key] - this.levels[key]) * smoothing;
    }
    this._updateRain(dt, player);
    this._updateSnow(dt, player);
    this._updateDust(dt, player);
    this._updateFog(dt, player);
    this._updateLightning(dt, player);

    const audioKey = `${Math.round(this.levels.rain * 10)}-${Math.round(this.levels.wind * 10)}-${Math.round(this.levels.dust * 10)}`;
    if (audioKey !== this.lastWeatherAudio) {
      this.lastWeatherAudio = audioKey;
      this.audio?.setWeather?.(
        this.levels.rain,
        this.levels.wind,
        this.levels.dust
      );
    }
  }

  reset() {
    this.levels = { rain: 0, snow: 0, dust: 0, wind: 0, fog: 0 };
    this.targets = { rain: 0, snow: 0, dust: 0, wind: 0, fog: 0 };
    this.fogTarget = 0;
    this.mode = 'clear';
    this.allowLightning = false;
    this.lightningEnergy = 0;
    this.lightningLight.intensity = 0;
    this.rain.visible = false;
    this.snow.visible = false;
    this.dust.visible = false;
    this.fog.visible = false;
    this.lastWeatherAudio = '';
  }
}
