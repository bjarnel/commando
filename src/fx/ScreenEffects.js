import { clamp, clamp01 } from '../utils/math.js';

/**
 * Camera trauma and screen-space feedback. The shake curve is trauma-squared,
 * which keeps light fire subtle while explosions hit hard.
 */
export class ScreenEffects {
  constructor(engine) {
    this.engine = engine;
    this.trauma = 0;
    this.time = 0;
    this.maxTranslation = 1.1;
    this.maxRoll = 0.012;
    this.lowHealth = false;
    this.hitmarker = document.querySelector('#hitmarker');
    this.damageFlash = document.querySelector('#damage-flash');
    this.lightningFlash = document.querySelector('#lightning-flash');
    this.crosshair = document.querySelector('#crosshair');
    this._shake = { x: 0, y: 0, z: 0, roll: 0 };

    this.blindOverlay = document.createElement('div');
    this.blindOverlay.id = 'nuke-blind';
    this.blindOverlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.blindOverlay);
    this.blindTime = 0;
    this.blindDuration = 0;
  }

  blind(duration = 3.2, peak = 1) {
    this.blindDuration = Math.max(0.2, duration);
    this.blindTime = this.blindDuration;
    this.blindPeak = peak;
    this.trauma = 1;
    this.blindOverlay.classList.add('active');
    void this.blindOverlay.offsetWidth;
    this.blindOverlay.style.opacity = String(Math.min(1, peak));
  }

  nukeBlast() {
    this.trauma = 1;
    this.flashDamage(1);
    this.blind(3.6, 1);
  }

  flashLightning() {
    if (!this.lightningFlash) return;
    this.lightningFlash.classList.remove('flash');
    void this.lightningFlash.offsetWidth;
    this.lightningFlash.classList.add('flash');
    window.setTimeout(() => this.lightningFlash?.classList.remove('flash'), 260);
  }

  addShake(amount) {
    this.trauma = clamp01(this.trauma + amount);
  }

  explosionShake(position, playerPosition, strength = 1) {
    const distance = Math.hypot(position.x - playerPosition.x, position.z - playerPosition.z);
    const falloff = clamp01(1 - distance / 34);
    this.addShake(0.22 + falloff * 0.62 * strength);
  }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (this.blindTime > 0) {
      this.blindTime = Math.max(0, this.blindTime - dt);
      const t = 1 - this.blindTime / this.blindDuration;
      const fade = t < 0.12 ? 1 : Math.pow(1 - (t - 0.12) / 0.88, 1.6);
      const pulse = 1 + Math.sin(this.time * 28) * 0.04;
      this.blindOverlay.style.opacity = String(
        Math.max(0, Math.min(1, fade * (this.blindPeak || 1) * pulse))
      );
      if (this.blindTime <= 0) {
        this.blindOverlay.classList.remove('active');
        this.blindOverlay.style.opacity = '0';
      }
    }
    const intensity = this.trauma * this.trauma;
    const t = this.time;
    const nx = Math.sin(t * 83.1) * 0.6 + Math.sin(t * 37.7 + 1.7) * 0.4;
    const ny = Math.cos(t * 71.3 + 0.4) * 0.55 + Math.sin(t * 29.9 + 2.1) * 0.45;
    const nz = Math.sin(t * 61.7 + 2.4) * 0.5;
    const roll = Math.sin(t * 47.3 + 0.9) * 0.6 + Math.sin(t * 19.7) * 0.4;
    this._shake.x = nx * intensity * this.maxTranslation;
    this._shake.y = ny * intensity * this.maxTranslation * 0.8;
    this._shake.z = nz * intensity * this.maxTranslation * 0.55;
    this._shake.roll = roll * intensity * this.maxRoll;
    return this._shake;
  }

  getShake() {
    return this._shake;
  }

  flashDamage(intensity = 1) {
    if (!this.damageFlash) return;
    this.damageFlash.classList.remove('hit');
    // Force reflow so the animation can restart immediately.
    void this.damageFlash.offsetWidth;
    this.damageFlash.style.opacity = String(0.45 + intensity * 0.55);
    this.damageFlash.classList.add('hit');
    window.setTimeout(() => {
      this.damageFlash?.classList.remove('hit');
      if (this.damageFlash) this.damageFlash.style.opacity = '0';
    }, 440);
  }

  showHitmarker(kill = false, weakPoint = false) {
    if (!this.hitmarker) return;
    this.hitmarker.classList.remove('show');
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.classList.toggle('weak', weakPoint);
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    window.setTimeout(() => this.hitmarker?.classList.remove('show'), 240);
  }

  setLowHealth(active) {
    if (active === this.lowHealth) return;
    this.lowHealth = active;
    document.body.classList.toggle('low-health', active);
  }

  reset() {
    this.trauma = 0;
    this.blindTime = 0;
    this.blindDuration = 0;
    this.blindOverlay?.classList.remove('active');
    if (this.blindOverlay) this.blindOverlay.style.opacity = '0';
    this.setLowHealth(false);
    this.hitmarker?.classList.remove('show', 'kill', 'weak');
  }
}
