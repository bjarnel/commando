import * as THREE from 'three';
import { SETTINGS } from '../config/settings.js';
import { clamp01, damp } from '../utils/math.js';

class FlashLight {
  constructor() {
    this.light = new THREE.PointLight(0xffffff, 0, 10, 2);
    this.light.visible = false;
    this.life = 0;
    this.maxLife = 0;
    this.peak = 0;
    this.distance = 0;
  }

  flash(position, color, intensity, distance, duration) {
    this.light.position.copy(position);
    this.light.color.setHex(color);
    this.light.distance = distance;
    this.light.visible = true;
    this.life = duration;
    this.maxLife = duration;
    this.peak = intensity;
    this.light.intensity = intensity;
  }

  update(dt) {
    if (this.life <= 0) {
      if (this.light.visible) {
        this.light.visible = false;
        this.light.intensity = 0;
      }
      return;
    }
    this.life -= dt;
    const t = clamp01(this.life / this.maxLife);
    this.light.intensity = this.peak * t * t;
    if (this.life <= 0) {
      this.light.visible = false;
      this.light.intensity = 0;
    }
  }
}

/**
 * Warm late-afternoon sun, soft sky bounce, pooled muzzle flashes and big
 * explosion lights. The sun rig follows the scroll anchor and casts real soft
 * shadows across the visible battlefield.
 */
export class DynamicLighting {
  constructor(scene) {
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight(0xb9d0cd, 0x51452c, 1.22);
    scene.add(this.hemi);

    const mobile =
      window.matchMedia?.('(pointer: coarse)').matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    this.sun = new THREE.DirectionalLight(SETTINGS.colors.sun, 2.15);
    this.sun.position.set(-25, 48, -20);
    this.sun.castShadow = !mobile;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.camera.left = -34;
    this.sun.shadow.camera.right = 34;
    this.sun.shadow.camera.top = 34;
    this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = mobile ? 2 : 4;
    this.sun.target.position.set(0, 0, 10);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool bounce from the camera side lifts character silhouettes out of the
    // warm ground without flattening the long directional shadows.
    this.fill = new THREE.DirectionalLight(0xa9c6cf, 0.68);
    this.fill.position.set(16, 22, -28);
    this.fill.target.position.set(0, 0, 10);
    scene.add(this.fill);
    scene.add(this.fill.target);

    this.rim = new THREE.DirectionalLight(0xffd59c, 0.32);
    this.rim.position.set(20, 12, 25);
    this.rim.target.position.set(0, 0, 5);
    scene.add(this.rim);
    scene.add(this.rim.target);

    this.muzzleLights = Array.from({ length: 4 }, () => new FlashLight());
    this.explosionLights = Array.from({ length: 3 }, () => new FlashLight());
    for (const flash of [...this.muzzleLights, ...this.explosionLights]) {
      scene.add(flash.light);
    }

    this.focusZ = 10;
    this.time = 0;

    this.mood = {
      sunColor: new THREE.Color(SETTINGS.colors.sun),
      sunIntensity: 2.12,
      hemiSky: new THREE.Color(0xb9d0cd),
      hemiGround: new THREE.Color(0x51452c),
      hemiIntensity: 1.22,
      fillColor: new THREE.Color(0xa9c6cf),
      fillIntensity: 0.68,
    };
    this.moodTargets = {
      sunColor: this.mood.sunColor.clone(),
      sunIntensity: this.mood.sunIntensity,
      hemiSky: this.mood.hemiSky.clone(),
      hemiGround: this.mood.hemiGround.clone(),
      hemiIntensity: this.mood.hemiIntensity,
      fillColor: this.mood.fillColor.clone(),
      fillIntensity: this.mood.fillIntensity,
    };
  }

  setMood(biome, immediate = false) {
    if (!biome?.sun || !biome?.hemi) return;
    const targets = this.moodTargets;
    targets.sunColor.setHex(biome.sun.color);
    targets.sunIntensity = biome.sun.intensity;
    targets.hemiSky.setHex(biome.hemi.sky);
    targets.hemiGround.setHex(biome.hemi.ground);
    targets.hemiIntensity = biome.hemi.intensity;
    targets.fillColor.setHex(biome.fill.color);
    targets.fillIntensity = biome.fill.intensity;
    if (immediate) {
      this.mood.sunColor.copy(targets.sunColor);
      this.mood.sunIntensity = targets.sunIntensity;
      this.mood.hemiSky.copy(targets.hemiSky);
      this.mood.hemiGround.copy(targets.hemiGround);
      this.mood.hemiIntensity = targets.hemiIntensity;
      this.mood.fillColor.copy(targets.fillColor);
      this.mood.fillIntensity = targets.fillIntensity;
      this._applyMood();
    }
  }

  _applyMood() {
    this.sun.color.copy(this.mood.sunColor);
    this.sun.intensity = this.mood.sunIntensity;
    this.hemi.color.copy(this.mood.hemiSky);
    this.hemi.groundColor.copy(this.mood.hemiGround);
    this.hemi.intensity = this.mood.hemiIntensity;
    this.fill.color.copy(this.mood.fillColor);
    this.fill.intensity = this.mood.fillIntensity;
  }

  muzzleFlash(position, color = 0xffb15c, intensity = 24, distance = 8, duration = 0.085) {
    let target = this.muzzleLights.find((light) => light.life <= 0);
    if (!target) {
      target = this.muzzleLights.reduce((a, b) => (a.life < b.life ? a : b));
    }
    const p = position.clone();
    p.y = Math.max(1.1, p.y);
    target.flash(p, color, intensity, distance, duration);
  }

  explosion(position, color = 0xff8734, intensity = 420, distance = 34, duration = 0.55) {
    let target = this.explosionLights.find((light) => light.life <= 0);
    if (!target) {
      target = this.explosionLights.reduce((a, b) => (a.life < b.life ? a : b));
    }
    const p = position.clone();
    p.y = 2;
    target.flash(p, color, intensity, distance, duration);
  }

  update(dt, focusZ = this.focusZ, playerX = 0) {
    this.time += dt;
    this.focusZ = damp(this.focusZ, focusZ, 8, dt);

    // Quantise the shadow focus slightly to reduce shimmer while advancing.
    const targetZ = Math.round((this.focusZ + 7) / 2) * 2;
    const targetX = Math.round(playerX * 0.32 * 2) / 2;
    this.sun.target.position.set(targetX, 0, targetZ);
    this.sun.position.set(targetX - 23, 48, targetZ - 20);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();

    this.fill.position.set(targetX + 16, 24, targetZ - 26);
    this.fill.target.position.set(targetX, 0.5, targetZ + 1);
    this.fill.target.updateMatrixWorld();

    this.rim.position.set(targetX + 22, 14, targetZ + 24);
    this.rim.target.position.set(targetX, 0, targetZ + 3);
    this.rim.target.updateMatrixWorld();

    const t = this.time;
    for (const flash of this.muzzleLights) flash.update(dt);
    for (const flash of this.explosionLights) flash.update(dt);

    const k = 1 - Math.exp(-1.15 * dt);
    this.mood.sunColor.lerp(this.moodTargets.sunColor, k);
    this.mood.hemiSky.lerp(this.moodTargets.hemiSky, k);
    this.mood.hemiGround.lerp(this.moodTargets.hemiGround, k);
    this.mood.fillColor.lerp(this.moodTargets.fillColor, k);
    this.mood.sunIntensity +=
      (this.moodTargets.sunIntensity - this.mood.sunIntensity) * k;
    this.mood.hemiIntensity +=
      (this.moodTargets.hemiIntensity - this.mood.hemiIntensity) * k;
    this.mood.fillIntensity +=
      (this.moodTargets.fillIntensity - this.mood.fillIntensity) * k;

    this._applyMood();
    // Barely perceptible sun warmth drift.
    this.sun.intensity += Math.sin(t * 0.06) * 0.04;
  }
}
