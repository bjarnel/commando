import { clamp01, formatScore, formatTime } from '../utils/math.js';
import { WEAPONS, WEAPON_CATEGORIES, CATEGORY_ORDER } from '../config/weapons.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const RANKS = [
  { threshold: 0, label: 'GREENHORN' },
  { threshold: 4000, label: 'SQUAD LEADER' },
  { threshold: 10000, label: 'JUNGLE VETERAN' },
  { threshold: 20000, label: 'COMMANDO' },
  { threshold: 35000, label: 'IRON TIDE LEGEND' },
];

export class UIManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.bannerTimer = 0;
    this.radarClock = 0;
    this.radarFrameAccumulator = 0;
    this.lastScore = -1;
    this.lastGrenades = -1;
    this.lastLives = -1;
    this.lastHealth = -1;
    this.hudVisible = false;

    this.el = {
      hud: $('#hud'),
      body: document.body,
      score: $('#score'),
      hudBest: $('#hud-best'),
      hudKills: $('#hud-kills'),
      distance: $('#distance-value'),
      bestDistanceValue: $('#best-distance-value'),
      threatValue: $('#threat-value'),
      objective: $('#objective-line'),
      progressFill: $('#progress-fill'),
      progressMarker: $('#progress-marker'),
      missionPhase: $('#mission-phase'),
      healthValue: $('#health-value'),
      healthMax: $('#health-max'),
      healthFill: $('#health-fill'),
      armorValue: $('#armor-value'),
      calibrationValue: $('#calibration-value'),
      statusPanel: $('.status-panel'),
      braceIndicator: $('#brace-indicator'),
      coverIndicator: $('#cover-indicator'),
      damageIndicators: $('#damage-indicators'),
      threatIndicators: $('#threat-indicators'),
      grenadeValue: $('#grenade-value'),
      livesValue: $('#lives-value'),
      livesPips: $('#lives-pips'),
      bossBar: $('#boss-bar'),
      bossLabel: $('#boss-label'),
      bossFill: $('#boss-fill'),
      comboBadge: $('#combo-badge'),
      comboX: $('#combo-x'),
      comboCount: $('#combo-count'),
      weaponSlotLabel: $('#weapon-slot-label'),
      weaponName: $('#weapon-name'),
      weaponType: $('#weapon-type'),
      weaponFeed: $('#weapon-feed'),
      weaponSlots: $('#weapon-slots'),
      banner: $('#banner'),
      bannerKicker: $('#banner-kicker'),
      bannerText: $('#banner-text'),
      toasts: $('#toasts'),
      crosshair: $('#crosshair'),
      hitmarker: $('#hitmarker'),
      radar: $('#radar'),
      radarRange: $('#radar-range'),
      radarCoords: $('#radar-coords'),
      padStatus: $('#pad-status'),
      crtToggle: $('#crt-toggle'),
      soundToggle: $('#sound-toggle'),
      startOverlay: $('#overlay-start'),
      pauseOverlay: $('#overlay-pause'),
      endOverlay: $('#overlay-end'),
      bootScreen: $('#boot-screen'),
      bootProgress: $('#boot-progress'),
      bootStatus: $('#boot-status'),
      errorScreen: $('#error-screen'),
      errorMessage: $('#error-message'),
      menuBest: $('#menu-best'),
      menuBestDistance: $('#menu-best-distance'),
      menuRank: $('#menu-rank'),
      endKicker: $('#end-kicker'),
      endTitle: $('#end-title'),
      endSubtitle: $('#end-subtitle'),
      endScore: $('#end-score'),
      endKills: $('#end-kills'),
      endAccuracy: $('#end-accuracy'),
      endDistance: $('#end-distance'),
      endTime: $('#end-time'),
      endGrenades: $('#end-grenades'),
      endBest: $('#end-best'),
      endBestDistance: $('#end-best-distance'),
      volumeSlider: $('#volume-slider'),
      volumeReadout: $('#volume-readout'),
      startButton: $('#start-button'),
    };

    this._buildLivesPips();
    this._buildWeaponSlots();
    this._buildThreatMarkers();
    this._bindButtons();
    this._bindRadar();
    this.setAudioMuted(Boolean(this.callbacks.isMuted?.()));
    this.setCrtEnabled(Boolean(this.callbacks.getCrtEnabled?.() ?? true));
    const volume = this.callbacks.getVolume?.() ?? 0.8;
    this.setVolumeUI(volume);
  }

  _bindButtons() {
    const bind = (button, callbackName) => {
      button?.addEventListener('click', () => {
        this.callbacks.onUiClick?.();
        button.blur();
        this.callbacks[callbackName]?.();
      });
    };
    bind(this.el.startButton, 'onStart');
    bind($('#resume-button'), 'onResume');
    bind($('#restart-button'), 'onRestart');
    bind($('#menu-button'), 'onMenu');
    bind($('#redeploy-button'), 'onRestart');
    bind($('#end-menu-button'), 'onEndMenu');

    this.el.soundToggle?.addEventListener('click', () => {
      this.callbacks.onToggleSound?.();
    });

    this.el.crtToggle?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onToggleCrt?.();
    });

    this.el.volumeSlider?.addEventListener('input', (event) => {
      const value = Number(event.target.value) / 100;
      this.setVolumeUI(value);
      this.callbacks.onVolume?.(value);
    });
  }

  _buildLivesPips() {
    if (!this.el.livesPips) return;
    this.el.livesPips.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('span');
      pip.className = 'life-pip';
      this.el.livesPips.appendChild(pip);
    }
    this.lifePips = $$('#lives-pips .life-pip');
  }

  _buildWeaponSlots() {
    if (!this.el.weaponSlots) return;
    this.el.weaponSlots.innerHTML = '';
    this.weaponSlotElements = CATEGORY_ORDER.map((category, index) => {
      const slot = document.createElement('div');
      slot.className = 'weapon-slot';
      slot.dataset.slot = String(index + 1);
      slot.innerHTML = `<b>${index + 1}</b><span class="wpn-name">—</span>`;
      this.el.weaponSlots.appendChild(slot);
      return slot;
    });
    this.setWeapons({}, 2);
  }

  setWeapons(inventory = {}, activeSlot = 2) {
    const activeCategory = CATEGORY_ORDER[activeSlot - 1];
    const weapon =
      inventory[activeCategory] ||
      WEAPONS.find((entry) => entry.id === 'm16') ||
      WEAPONS[0];
    if (this.el.weaponName) this.el.weaponName.textContent = weapon.name;
    if (this.el.weaponType) this.el.weaponType.textContent = weapon.type;
    if (this.el.weaponFeed) this.el.weaponFeed.textContent = weapon.feed;
    if (this.el.weaponSlotLabel) {
      const label = WEAPON_CATEGORIES[activeCategory]?.label || 'PRIMARY';
      this.el.weaponSlotLabel.textContent = `${label} // ${weapon.reloadLabel}`;
    }
    for (const slot of this.weaponSlotElements || []) {
      const index = Number(slot.dataset.slot) - 1;
      const category = CATEGORY_ORDER[index];
      const entry = inventory[category];
      slot.classList.toggle('unlocked', Boolean(entry));
      slot.classList.toggle('active', index + 1 === activeSlot);
      const name = slot.querySelector('.wpn-name');
      if (name) name.textContent = entry ? entry.short : '—';
    }
  }

  _buildThreatMarkers() {
    this.threatMarkers = [];
    if (!this.el.threatIndicators) return;
    for (let i = 0; i < 4; i++) {
      const root = document.createElement('div');
      root.className = 'threat-marker';
      root.innerHTML = '<i class="tm-arrow"></i><b class="tm-label"></b>';
      this.el.threatIndicators.appendChild(root);
      this.threatMarkers.push({
        root,
        label: root.querySelector('.tm-label'),
        arrow: root.querySelector('.tm-arrow'),
      });
    }
  }

  _bindRadar() {
    this.radarCtx = this.el.radar?.getContext('2d') || null;
  }

  /* ------------------------------------------------------------------------
     Boot / error
     ------------------------------------------------------------------------ */

  setBootProgress(value, label = null) {
    if (this.el.bootProgress) this.el.bootProgress.style.width = `${clamp01(value) * 100}%`;
    if (label && this.el.bootStatus) this.el.bootStatus.textContent = label;
  }

  hideBoot() {
    this.el.bootScreen?.classList.add('is-hidden');
  }

  showError(message) {
    this.el.bootScreen?.classList.add('is-hidden');
    if (this.el.errorScreen) {
      this.el.errorScreen.classList.remove('is-hidden');
      if (this.el.errorMessage) this.el.errorMessage.textContent = message;
    }
  }

  /* ------------------------------------------------------------------------
     Screen state
     ------------------------------------------------------------------------ */

  showStartScreen(bestScore = 0) {
    this.el.startOverlay?.classList.remove('is-hidden');
    this.el.pauseOverlay?.classList.add('is-hidden');
    this.el.endOverlay?.classList.add('is-hidden');
    this.el.endOverlay?.classList.remove('is-victory');
    this.el.hud?.classList.add('is-hidden');
    this.hudVisible = false;
    this.el.body.classList.remove('is-playing', 'is-paused', 'is-ended', 'low-health');
    this.el.body.classList.add('is-menu', 'ui-open');
    this.setBestScore(bestScore);
    this.setCrosshairVisible(false);
    this.hideBoss();
    this.setLowHealth(false);
    this.hideBanner();
    this.clearCombatIndicators();
  }

  beginRun() {
    this.el.startOverlay?.classList.add('is-hidden');
    this.el.pauseOverlay?.classList.add('is-hidden');
    this.el.endOverlay?.classList.add('is-hidden');
    this.el.hud?.classList.remove('is-hidden');
    this.el.body.classList.remove('is-menu', 'is-paused', 'is-ended', 'ui-open');
    this.el.body.classList.add('is-playing');
    this.hudVisible = true;
    this.setCrosshairVisible(true);
    this.clearCombatIndicators();
  }

  showPause() {
    this.el.pauseOverlay?.classList.remove('is-hidden');
    this.el.body.classList.add('is-paused', 'ui-open');
    this.setCrosshairVisible(false);
  }

  hidePause() {
    this.el.pauseOverlay?.classList.add('is-hidden');
    this.el.body.classList.remove('is-paused', 'ui-open');
    this.setCrosshairVisible(true);
  }

  showEnd(stats, victory = false) {
    this.el.endOverlay?.classList.remove('is-hidden');
    this.el.endOverlay?.classList.toggle('is-victory', victory);
    this.el.body.classList.remove('is-playing', 'is-paused');
    this.el.body.classList.add('is-ended', 'ui-open');
    this.setCrosshairVisible(false);
    this.clearCombatIndicators();
    this.hideBoss();
    this.el.pauseOverlay?.classList.add('is-hidden');

    if (this.el.endKicker) this.el.endKicker.textContent = victory ? 'EXTRACTION CONFIRMED' : 'SIGNAL LOST';
    if (this.el.endTitle) this.el.endTitle.textContent = victory ? 'MISSION COMPLETE' : 'KILLED IN ACTION';
    if (this.el.endSubtitle) {
      this.el.endSubtitle.textContent = victory
        ? 'LZ Delta is secure. The river line is broken.'
        : 'The line keeps what it takes. Redeploy and push further.';
    }
    if (this.el.endScore) this.el.endScore.textContent = formatScore(stats.score);
    if (this.el.endKills) this.el.endKills.textContent = String(stats.kills).padStart(2, '0');
    if (this.el.endAccuracy) this.el.endAccuracy.textContent = `${Math.round(stats.accuracy)}%`;
    if (this.el.endDistance) this.el.endDistance.textContent = `${Math.round(stats.distance)} M`;
    if (this.el.endTime) this.el.endTime.textContent = formatTime(stats.time);
    if (this.el.endGrenades) this.el.endGrenades.textContent = String(stats.grenadesThrown).padStart(2, '0');
    if (this.el.endBest) this.el.endBest.textContent = formatScore(stats.best);
    if (this.el.endBestDistance) {
      this.el.endBestDistance.textContent = `${Math.round(stats.bestDistance || 0)} M`;
    }
  }

  hideEnd() {
    this.el.endOverlay?.classList.add('is-hidden');
    this.el.body.classList.remove('is-ended');
  }

  setCrosshairVisible(visible) {
    if (!this.el.crosshair) return;
    this.el.crosshair.classList.toggle('is-hidden', !visible);
    if (!visible) this.el.hitmarker?.classList.remove('show');
  }

  /* ------------------------------------------------------------------------
     HUD values
     ------------------------------------------------------------------------ */

  setScore(score) {
    if (score === this.lastScore) return;
    this.lastScore = score;
    if (this.el.score) this.el.score.textContent = formatScore(score);
  }

  setKills(kills) {
    if (this.el.hudKills) this.el.hudKills.textContent = String(kills).padStart(2, '0');
  }

  setBestScore(score) {
    if (this.el.hudBest) this.el.hudBest.textContent = formatScore(score);
    if (this.el.menuBest) this.el.menuBest.textContent = formatScore(score);
    if (this.el.endBest) this.el.endBest.textContent = formatScore(score);
    if (this.el.menuRank) {
      let rank = RANKS[0].label;
      for (const entry of RANKS) {
        if (score >= entry.threshold) rank = entry.label;
      }
      this.el.menuRank.textContent = rank;
    }
  }

  setBestDistance(metres = 0) {
    const text = String(Math.round(metres)).padStart(4, '0');
    if (this.el.bestDistanceValue) this.el.bestDistanceValue.textContent = text;
    if (this.el.menuBestDistance) {
      this.el.menuBestDistance.textContent = `${Math.round(metres)} M`;
    }
    if (this.el.endBestDistance) {
      this.el.endBestDistance.textContent = `${Math.round(metres)} M`;
    }
  }

  setHealth(health, maxHealth = 100) {
    const rounded = Math.ceil(health);
    if (rounded !== this.lastHealth) {
      this.lastHealth = rounded;
      if (this.el.healthValue) this.el.healthValue.textContent = String(rounded);
    }
    if (this.el.healthMax) this.el.healthMax.textContent = `/${Math.round(maxHealth)}`;
    const ratio = clamp01(health / maxHealth);
    if (this.el.healthFill) this.el.healthFill.style.width = `${ratio * 100}%`;
    this.el.statusPanel?.classList.toggle('warning', ratio <= 0.6 && ratio > 0.3);
    this.el.statusPanel?.classList.toggle('critical', ratio <= 0.3);
  }

  setArmor(reduction = 0) {
    if (!this.el.armorValue) return;
    this.el.armorValue.textContent = `${Math.round(reduction * 100)}%`;
  }

  setCalibration(multiplier = 1) {
    if (!this.el.calibrationValue) return;
    this.el.calibrationValue.textContent = `+${Math.round((multiplier - 1) * 100)}%`;
  }

  setBraced(active) {
    this.el.braceIndicator?.classList.toggle('active', Boolean(active));
  }

  setCover(active) {
    this.el.coverIndicator?.classList.toggle('active', Boolean(active));
  }

  showDamageDirection(angle) {
    if (!this.el.damageIndicators) return;
    const arc = document.createElement('i');
    arc.className = 'damage-arc';
    arc.style.setProperty('--angle', `${angle}rad`);
    this.el.damageIndicators.appendChild(arc);
    while (this.el.damageIndicators.children.length > 8) {
      this.el.damageIndicators.firstElementChild?.remove();
    }
    window.setTimeout(() => arc.remove(), 950);
  }

  setThreats(threats = []) {
    if (!this.threatMarkers?.length) return;
    for (let i = 0; i < this.threatMarkers.length; i++) {
      const marker = this.threatMarkers[i];
      const threat = threats[i];
      if (!threat) {
        marker.root.classList.remove('active');
        continue;
      }
      marker.root.classList.add('active');
      marker.root.className = `threat-marker active kind-${threat.kind || 'enemy'}`;
      marker.root.style.left = `${threat.x}px`;
      marker.root.style.top = `${threat.y}px`;
      marker.root.style.setProperty('--rot', `${threat.angle || 0}rad`);
      marker.label.textContent = threat.label || 'THREAT';
    }
  }

  clearCombatIndicators() {
    this.setBraced(false);
    this.setCover(false);
    this.setThreats([]);
    if (this.el.damageIndicators) this.el.damageIndicators.innerHTML = '';
  }

  setLowHealth(active) {
    this.el.body.classList.toggle('low-health', active);
  }

  setGrenades(count) {
    if (count === this.lastGrenades) return;
    this.lastGrenades = count;
    if (this.el.grenadeValue) {
      this.el.grenadeValue.textContent = String(count).padStart(2, '0');
      this.el.grenadeValue.classList.remove('bump');
      void this.el.grenadeValue.offsetWidth;
      this.el.grenadeValue.classList.add('bump');
    }
  }

  setLives(lives) {
    if (lives === this.lastLives) return;
    this.lastLives = lives;
    if (this.el.livesValue) this.el.livesValue.textContent = String(lives).padStart(2, '0');
    this.lifePips.forEach((pip, index) => {
      pip.classList.toggle('spent', index >= lives);
    });
  }

  setRunStatus(distance, bestDistance, threatTier, tierProgress, phase = null) {
    const metres = Math.max(0, Math.round(distance));
    if (this.el.distance) this.el.distance.textContent = String(metres).padStart(4, '0');
    if (this.el.bestDistanceValue) {
      this.el.bestDistanceValue.textContent = String(
        Math.max(0, Math.round(bestDistance))
      ).padStart(4, '0');
    }
    if (this.el.threatValue) {
      this.el.threatValue.textContent = String(threatTier).padStart(2, '0');
    }
    const ratio = clamp01(tierProgress);
    if (this.el.progressFill) this.el.progressFill.style.width = `${ratio * 100}%`;
    if (this.el.progressMarker) this.el.progressMarker.style.left = `${ratio * 100}%`;
    if (this.el.missionPhase) this.el.missionPhase.textContent = phase || 'ADVANCE';
    if (this.el.radarCoords) {
      this.el.radarCoords.textContent = `Z ${String(metres).padStart(4, '0')} / BEST ${Math.round(bestDistance)} M`;
    }
  }

  setObjective(text) {
    if (this.el.objective && this.el.objective.textContent !== text) {
      this.el.objective.textContent = text;
    }
  }

  setCombo(count, multiplier) {
    if (!this.el.comboBadge) return;
    if (count < 3) {
      this.hideCombo();
      return;
    }
    this.el.comboBadge.classList.remove('is-hidden');
    this.el.comboX.textContent = `×${multiplier}`;
    this.el.comboCount.textContent = `${count} KILL${count === 1 ? '' : 'S'}`;
    this.el.comboBadge.classList.remove('pulse');
    void this.el.comboBadge.offsetWidth;
    this.el.comboBadge.classList.add('pulse');
  }

  hideCombo() {
    this.el.comboBadge?.classList.add('is-hidden');
  }

  showBoss(name) {
    if (!this.el.bossBar) return;
    this.el.bossBar.classList.remove('is-hidden');
    if (this.el.bossLabel) this.el.bossLabel.textContent = name;
    if (this.el.bossFill) this.el.bossFill.style.width = '100%';
  }

  setBossHealth(ratio) {
    if (this.el.bossFill) this.el.bossFill.style.width = `${clamp01(ratio) * 100}%`;
  }

  hideBoss() {
    this.el.bossBar?.classList.add('is-hidden');
  }

  setPadStatus(active, id = '') {
    if (!this.el.padStatus) return;
    this.el.padStatus.classList.toggle('active', active);
    if (active) {
      const short = id.split('(')[0].trim();
      this.el.padStatus.textContent = `GAMEPAD // ${short || 'ONLINE'}`;
    } else {
      this.el.padStatus.textContent = 'KEYBOARD + MOUSE';
    }
  }

  setAudioMuted(muted) {
    this.el.soundToggle?.classList.toggle('muted', Boolean(muted));
    this.el.soundToggle?.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.el.soundToggle?.setAttribute(
      'aria-label',
      muted ? 'Enable sound' : 'Mute sound'
    );
  }

  setCrtEnabled(enabled) {
    const on = Boolean(enabled);
    this.el.crtToggle?.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.el.crtToggle?.setAttribute(
      'aria-label',
      on ? 'Disable CRT filter' : 'Enable CRT filter'
    );
    this.el.crtToggle?.setAttribute(
      'title',
      on ? 'Disable CRT filter [C]' : 'Enable CRT filter [C]'
    );
    const label = this.el.crtToggle?.querySelector('.crt-label');
    if (label) label.textContent = on ? 'CRT' : 'OFF';
    this.el.body?.classList.toggle('crt-disabled', !on);
  }

  setVolumeUI(value) {
    const pct = Math.round(clamp01(value) * 100);
    if (this.el.volumeSlider) {
      this.el.volumeSlider.value = String(pct);
      this.el.volumeSlider.style.setProperty('--fill', `${pct}%`);
    }
    if (this.el.volumeReadout) this.el.volumeReadout.textContent = String(pct);
  }

  /* ------------------------------------------------------------------------
     Crosshair, banner, toasts
     ------------------------------------------------------------------------ */

  setCrosshair(x, y, { visible = true, overEnemy = false, firing = false } = {}) {
    if (!this.el.crosshair) return;
    this.el.crosshair.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    if (this.el.hitmarker) {
      this.el.hitmarker.style.left = `${x}px`;
      this.el.hitmarker.style.top = `${y}px`;
    }
    this.setCrosshairVisible(visible);
    this.el.crosshair.classList.toggle('over-enemy', overEnemy);
    this.el.crosshair.classList.toggle('firing', firing);
  }

  announce(kicker, text, duration = 2.6, tone = '') {
    if (!this.el.banner) return;
    this.el.bannerKicker.textContent = kicker;
    this.el.bannerText.textContent = text;
    this.el.banner.classList.remove('visible', 'danger');
    if (tone === 'danger') this.el.banner.classList.add('danger');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('visible');
    this.bannerTimer = duration;
  }

  hideBanner() {
    this.el.banner?.classList.remove('visible');
    this.bannerTimer = 0;
  }

  toast(text, tone = '') {
    if (!this.el.toasts) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.textContent = text;
    this.el.toasts.appendChild(toast);
    while (this.el.toasts.children.length > 3) {
      this.el.toasts.firstElementChild?.remove();
    }
    window.setTimeout(() => toast.remove(), 2700);
  }

  /* ------------------------------------------------------------------------
     Radar
     ------------------------------------------------------------------------ */

  updateRadar(dt, data) {
    this.radarFrameAccumulator += dt;
    this.radarClock += dt;
    if (this.radarFrameAccumulator < 1 / 30) return;
    this.radarFrameAccumulator = 0;
    if (!this.radarCtx || !this.el.radar || !this.hudVisible) return;
    const canvas = this.el.radar;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = this.radarCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const viewBack = 15;
    const viewForward = 48;
    const xRange = 31;
    // The chase camera mirrors world X (screen-right = world -X), so the
    // tactical map uses the same orientation as the view.
    const toX = (wx) => w / 2 - ((wx - data.player.x) / xRange) * (w / 2);
    const toY = (wz) =>
      h * (1 - (wz - (data.player.z - viewBack)) / (viewForward + viewBack));

    // Grid.
    ctx.strokeStyle = 'rgba(116, 224, 224, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = (h / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const x = (w / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // River bands.
    for (const river of data.rivers || []) {
      const y = toY(river.z);
      if (y < -20 || y > h + 20) continue;
      const band = Math.max(4, (river.width / (viewForward + viewBack)) * h);
      const grad = ctx.createLinearGradient(0, y - band / 2, 0, y + band / 2);
      grad.addColorStop(0, 'rgba(116, 224, 224, 0)');
      grad.addColorStop(0.5, 'rgba(116, 224, 224, 0.32)');
      grad.addColorStop(1, 'rgba(116, 224, 224, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - band / 2, w, band);
    }

    // Scroll anchor (the point of no return).
    const scrollY = toY(data.scrollZ);
    if (scrollY > -10 && scrollY < h + 10) {
      ctx.strokeStyle = 'rgba(255, 233, 110, 0.4)';
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(0, scrollY);
      ctx.lineTo(w, scrollY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Radar sweep from the player marker.
    const px = toX(data.player.x);
    const py = toY(data.player.z);
    const sweep = this.radarClock * 1.35;
    const sweepRadius = Math.max(w, h) * 0.7;
    const grad = ctx.createConicGradient
      ? ctx.createConicGradient(sweep, px, py)
      : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(126, 224, 107, 0.16)');
      grad.addColorStop(0.12, 'rgba(126, 224, 107, 0.04)');
      grad.addColorStop(0.25, 'rgba(126, 224, 107, 0)');
      grad.addColorStop(1, 'rgba(126, 224, 107, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, sweepRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(126, 224, 107, 0.25)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(sweep) * sweepRadius, py + Math.sin(sweep) * sweepRadius);
      ctx.stroke();
    }

    // Enemies.
    for (const enemy of data.enemies || []) {
      if (!enemy.alive) continue;
      const x = toX(enemy.position.x);
      const y = toY(enemy.position.z);
      if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
      const isTruck = enemy.type === 'truck';
      const isOfficer = enemy.type === 'officer';
      const isMortar = enemy.type === 'mortar';
      const isHeavy = enemy.type === 'heavy';
      ctx.save();
      ctx.translate(x, y);
      if (isTruck) {
        ctx.fillStyle = 'rgba(255, 107, 94, 0.95)';
        ctx.shadowColor = 'rgba(255, 90, 50, 0.9)';
        ctx.shadowBlur = 8;
        ctx.fillRect(-4, -4, 8, 8);
        ctx.strokeStyle = 'rgba(255, 233, 110, 0.8)';
        ctx.strokeRect(-4, -4, 8, 8);
      } else if (isOfficer) {
        ctx.fillStyle = 'rgba(255, 233, 110, 0.95)';
        ctx.shadowColor = 'rgba(255, 233, 110, 0.75)';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (isMortar) {
        ctx.strokeStyle = 'rgba(255, 157, 92, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -3.4);
        ctx.lineTo(3.4, 0);
        ctx.lineTo(0, 3.4);
        ctx.lineTo(-3.4, 0);
        ctx.closePath();
        ctx.stroke();
      } else if (isHeavy) {
        ctx.fillStyle = 'rgba(255, 157, 92, 0.95)';
        ctx.shadowColor = 'rgba(255, 140, 60, 0.75)';
        ctx.shadowBlur = 5;
        ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
      } else {
        ctx.fillStyle = 'rgba(255, 107, 94, 0.9)';
        ctx.shadowColor = 'rgba(255, 90, 50, 0.6)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Pickups.
    for (const pickup of data.pickups || []) {
      if (!pickup.active) continue;
      const x = toX(pickup.position.x);
      const y = toY(pickup.position.z);
      ctx.save();
      ctx.translate(x, y);
      if (pickup.type === 'weapon') {
        const categoryColor =
          pickup.weapon?.category === 'light'
            ? 'rgba(255, 233, 110, 0.95)'
            : pickup.weapon?.category === 'heavy'
              ? 'rgba(196, 123, 255, 0.95)'
              : 'rgba(116, 224, 224, 0.95)';
        ctx.strokeStyle = categoryColor;
        ctx.lineWidth = 1.4;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(0, -3.6);
        ctx.lineTo(3.6, 0);
        ctx.lineTo(0, 3.6);
        ctx.lineTo(-3.6, 0);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeStyle =
          pickup.type === 'health'
            ? 'rgba(126, 224, 107, 0.9)'
            : pickup.type === 'armor'
              ? 'rgba(116, 224, 224, 0.9)'
              : 'rgba(255, 157, 92, 0.9)';
        ctx.lineWidth = 1.4;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(0, -3);
        ctx.lineTo(0, 3);
        ctx.moveTo(-3, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Player and aim direction.
    const angle = Math.atan2(-(data.player.aimX ?? 0), data.player.aimZ ?? 1);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(126, 224, 107, 0.95)';
    ctx.shadowColor = 'rgba(126, 224, 107, 0.85)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Aim line.
    ctx.strokeStyle = 'rgba(116, 224, 224, 0.3)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(
      px - (data.player.aimX ?? 0) * 26,
      py - (data.player.aimZ ?? 1) * 26
    );
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner brackets.
    ctx.strokeStyle = 'rgba(116, 224, 224, 0.45)';
    ctx.lineWidth = 1;
    const c = 8;
    ctx.beginPath();
    ctx.moveTo(0, c); ctx.lineTo(0, 0); ctx.lineTo(c, 0);
    ctx.moveTo(w - c, 0); ctx.lineTo(w, 0); ctx.lineTo(w, c);
    ctx.moveTo(0, h - c); ctx.lineTo(0, h); ctx.lineTo(c, h);
    ctx.moveTo(w - c, h); ctx.lineTo(w, h); ctx.lineTo(w, h - c);
    ctx.stroke();
  }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }
}
