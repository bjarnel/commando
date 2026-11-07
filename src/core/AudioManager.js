import { clamp, clamp01, rand } from '../utils/math.js';
import { SETTINGS } from '../config/settings.js';

/* --------------------------------------------------------------------------
   Original theme material. The harmonic language and arpeggio-driven pulse
   voices are a love letter to the SID chip; the melody itself is original.
   -------------------------------------------------------------------------- */

const CHORDS = [
  { root: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { root: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70] }, // Bb
  { root: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] }, // F
  { root: 33, pad: [45, 49, 52, 57], arp: [57, 61, 64, 69] }, // A
];

const LEAD_PATTERNS = [
  [74, null, 77, null, 76, null, 74, null, 69, null, 72, null, 74, null, 77, null],
  [70, null, 74, null, 77, null, 74, null, 72, null, 70, null, 69, null, 72, null],
  [77, null, 76, null, 77, null, 81, null, 79, null, 77, null, 76, null, 72, null],
  [69, null, 73, null, 76, null, 81, null, 79, null, 76, null, 73, null, 76, null],
];

const BASS_PATTERN = [
  0, null, 0, 12, null, 0, 7, null,
  0, null, 0, 12, 7, null, 5, 7,
];

const KICK_STEPS = new Set([0, 6, 8, 14]);
const SNARE_STEPS = new Set([4, 12]);

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function safeStorageGet(key, fallback = null) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable in private contexts */
  }
}

/**
 * Procedural audio engine:
 *  - a look-ahead sequenced synth score with pulse leads, detuned pads,
 *    arpeggios and synthesized percussion
 *  - fully positional Web Audio SFX for weapons, explosions, ricochets and
 *    voice-like enemy deaths
 *  - generated convolution reverb, master compression and gesture unlocking
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this._initPromise = null;
    this.muted = safeStorageGet(SETTINGS.storageKeys.muted) === '1';
    const storedVolume = Number(safeStorageGet(SETTINGS.storageKeys.volume, '0.8'));
    this.masterVolume = clamp(Number.isFinite(storedVolume) ? storedVolume : 0.8, 0, 1);
    this.intensity = 0.25;
    this.targetIntensity = 0.25;
    this.ducked = false;
    this.musicPlaying = false;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.stepDuration = 60 / 128 / 4;
    this.musicTimer = null;
    this.layerGains = null;
    this._lastGunshot = 0;
    this._chimeNotes = new Set();
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return true;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.warn('[Audio] Web Audio API unavailable; running silent.');
      return false;
    }

    try {
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this._buildNoiseBuffers();
      this._buildGraph();
      this._buildWaveTables();
      this.ready = true;
      this.startAmbience();
      await this.ctx.resume().catch(() => {});
      this._installGestureUnlock();
      return true;
    } catch (error) {
      console.warn('[Audio] Failed to initialise audio.', error);
      this.ready = false;
      return false;
    }
  }

  _installGestureUnlock() {
    const unlock = () => {
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  _buildNoiseBuffers() {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;

    const white = ctx.createBuffer(1, rate * 2, rate);
    const whiteData = white.getChannelData(0);
    for (let i = 0; i < whiteData.length; i++) {
      whiteData[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = white;

    const brown = ctx.createBuffer(1, rate * 4, rate);
    const brownData = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < brownData.length; i++) {
      const whiteSample = Math.random() * 2 - 1;
      last = (last + 0.018 * whiteSample) / 1.018;
      brownData[i] = clamp(last * 3.2, -1, 1);
    }
    this.brownNoiseBuffer = brown;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.28;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    // Reverb plate generated from decaying noise.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.6, 2.8);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.42;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    this.musicInput = ctx.createGain();
    this.musicInput.gain.value = 0.9;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 12500;
    this.musicFilter.Q.value = 0.6;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.72;
    this.musicInput.connect(this.musicFilter);
    this.musicFilter.connect(this.musicGain);
    this.musicGain.connect(this.master);

    this.musicReverb = ctx.createGain();
    this.musicReverb.gain.value = 0.22;
    this.musicGain.connect(this.musicReverb);
    this.musicReverb.connect(this.reverb);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.88;
    this.sfxGain.connect(this.master);
    this.sfxReverb = ctx.createGain();
    this.sfxReverb.gain.value = 0.09;
    this.sfxGain.connect(this.sfxReverb);
    this.sfxReverb.connect(this.reverb);

    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0.55;
    this.ambienceGain.connect(this.master);

    // Continuous weather beds. The WeatherSystem crossfades targets between
    // rain hiss, wind and dust gust noise.
    this.weatherAudio = {
      rain: ctx.createGain(),
      wind: ctx.createGain(),
      lastRain: 0,
      lastWind: 0,
    };
    this.weatherAudio.rain.gain.value = 0;
    this.weatherAudio.wind.gain.value = 0;
    this.weatherAudio.rain.connect(this.master);
    this.weatherAudio.wind.connect(this.master);

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = this.noiseBuffer;
    rainSource.loop = true;
    const rainHigh = ctx.createBiquadFilter();
    rainHigh.type = 'highpass';
    rainHigh.frequency.value = 900;
    const rainLow = ctx.createBiquadFilter();
    rainLow.type = 'lowpass';
    rainLow.frequency.value = 6200;
    rainSource.connect(rainHigh);
    rainHigh.connect(rainLow);
    rainLow.connect(this.weatherAudio.rain);
    rainSource.start();

    const windSource = ctx.createBufferSource();
    windSource.buffer = this.brownNoiseBuffer;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 460;
    windFilter.Q.value = 0.7;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.09;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.01;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(this.weatherAudio.wind.gain);
    windSource.connect(windFilter);
    windFilter.connect(this.weatherAudio.wind);
    windSource.start();
    windLfo.start();
    this.weatherWindLfo = windLfo;

    // Lead echo.
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0.32;
    this.echoDelay = ctx.createDelay(0.6);
    this.echoDelay.delayTime.value = this.stepDuration * 3;
    this.echoFilter = ctx.createBiquadFilter();
    this.echoFilter.type = 'lowpass';
    this.echoFilter.frequency.value = 2400;
    this.echoFeedback = ctx.createGain();
    this.echoFeedback.gain.value = 0.26;
    this.echoReturn = ctx.createGain();
    this.echoReturn.gain.value = 0.45;
    this.echoSend.connect(this.echoDelay);
    this.echoDelay.connect(this.echoFilter);
    this.echoFilter.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    this.echoFilter.connect(this.echoReturn);
    this.echoReturn.connect(this.musicInput);

    this.layerGains = {
      bass: this._layer(0.22),
      arp: this._layer(0.055),
      lead: this._layer(0.11),
      pad: this._layer(0.11),
      drums: this._layer(0.16),
    };
    this.layerGains.lead.connect(this.echoSend);

    this._configureListener();
  }

  _layer(value) {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    gain.connect(this.musicInput);
    return gain;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[i] = last * Math.pow(1 - i / length, decay) * (channel ? 0.92 : 1);
      }
    }
    return impulse;
  }

  _buildWaveTables() {
    const ctx = this.ctx;
    const createPulse = (duty) => {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        real[i] = Math.sin(i * Math.PI * duty) / (i * Math.PI);
        imag[i] = (1 - Math.cos(i * Math.PI * duty)) / (i * Math.PI);
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    };
    this.pulse25 = createPulse(0.25);
    this.pulse50 = createPulse(0.5);
  }

  _configureListener() {
    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = 0;
      listener.positionY.value = 2;
      listener.positionZ.value = 0;
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = 1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else if (listener.setPosition) {
      listener.setPosition(0, 2, 0);
      listener.setOrientation(0, 0, 1, 0, 1, 0);
    }
  }

  /** Listener lives near the player's boots, not at the high camera. */
  setListener(position, forward = null) {
    if (!this.ready) return;
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = forward?.x ?? 0;
    const fz = forward?.z ?? 1;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, t, 0.02);
      listener.positionY.setTargetAtTime(position.y ?? 2, t, 0.02);
      listener.positionZ.setTargetAtTime(position.z, t, 0.02);
      listener.forwardX.setTargetAtTime(fx, t, 0.03);
      listener.forwardY.setTargetAtTime(0, t, 0.03);
      listener.forwardZ.setTargetAtTime(fz, t, 0.03);
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else if (listener.setPosition) {
      listener.setPosition(position.x, position.y ?? 2, position.z);
      listener.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /* ------------------------------------------------------------------------
     Music
     ------------------------------------------------------------------------ */

  startMusic() {
    if (!this.ready) return;
    if (this.musicPlaying) {
      this.setIntensity(Math.max(this.intensity, 0.6));
      return;
    }
    this.musicPlaying = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.musicTimer = window.setInterval(() => this._scheduleAhead(), 25);
    this.musicGain.gain.setTargetAtTime(this.ducked ? 0.18 : 0.72, this.ctx.currentTime, 0.3);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ready) {
      this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3);
    }
  }

  setIntensity(value) {
    this.targetIntensity = clamp01(value);
  }

  setDucked(ducked) {
    this.ducked = ducked;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(ducked ? 0.16 : 0.72, t, 0.25);
    this.musicFilter.frequency.setTargetAtTime(ducked ? 1100 : 12500, t, 0.3);
  }

  update(dt) {
    if (!this.ready) return;
    this.intensity += (this.targetIntensity - this.intensity) * (1 - Math.exp(-2.2 * dt));
    if (!this.layerGains) return;

    const i = this.intensity;
    const duck = this.ducked ? 0.25 : 1;
    const targets = {
      bass: (0.1 + 0.16 * i) * duck,
      arp: (0.015 + 0.07 * i) * duck,
      lead: (0.035 + 0.11 * i) * duck,
      pad: (0.09 + 0.03 * i) * duck,
      drums: (0.06 + 0.15 * i) * duck,
    };
    const now = this.ctx.currentTime;
    for (const [name, value] of Object.entries(targets)) {
      const gain = this.layerGains[name];
      if (Math.abs(gain.gain.value - value) > 0.003) {
        gain.gain.setTargetAtTime(value, now, 0.22);
      }
    }
  }

  _scheduleAhead() {
    if (!this.ready || !this.musicPlaying) return;
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now - 0.2) {
      this.nextStepTime = now + 0.05;
    }
    while (this.nextStepTime < now + 0.12) {
      // A tiny lift on off-beat sixteenths gives the march a human swing.
      const swing = this.stepIndex % 2 === 1 ? 0.011 : 0;
      this._scheduleStep(this.stepIndex, this.nextStepTime + swing);
      this.nextStepTime += this.stepDuration;
      this.stepIndex++;
    }
  }

  _scheduleStep(step, time) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = CHORDS[bar];
    const intensity = this.intensity;

    if (s === 0) {
      this._pad(chord.pad, time, this.stepDuration * 15.5);
    }

    if (intensity > 0.14) {
      if (KICK_STEPS.has(s)) this._kick(time, intensity);
      if (SNARE_STEPS.has(s)) this._snare(time, intensity);
      if (s % 2 === 0) this._hat(time, 0.05 + intensity * 0.04);
      if (bar === 3 && s === 15 && intensity > 0.55) this._snare(time + this.stepDuration * 0.5, intensity * 0.6);
    }

    const bassOffset = BASS_PATTERN[s];
    if (bassOffset !== null) {
      this._bass(chord.root + bassOffset, time, this.stepDuration * 0.9, 0.14 + intensity * 0.08);
    }

    if (intensity > 0.3 && s % 2 === 0) {
      const arp = chord.arp;
      const note = arp[(step + bar) % arp.length] + (s % 8 === 6 ? 12 : 0);
      this._arp(note, time, this.stepDuration * 0.75);
    }

    if (intensity > 0.4) {
      const melody = LEAD_PATTERNS[bar][s];
      if (melody !== null && melody !== undefined) {
        const duration = this.stepDuration * (s === 14 ? 2.1 : 1.6);
        this._lead(melody, time, duration);
      }
    }
  }

  _lead(midi, time, duration) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.setPeriodicWave(this.pulse25);
    osc2.setPeriodicWave(this.pulse50);
    osc.frequency.value = midiToFreq(midi);
    osc2.frequency.value = midiToFreq(midi) * 1.003;
    osc2.detune.value = 6;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.8;
    filter.frequency.setValueAtTime(4200, time);
    filter.frequency.exponentialRampToValueAtTime(2100, time + duration);

    const gain = ctx.createGain();
    const peak = 0.15;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(peak * 0.55, time + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 5.4;
    vibratoGain.gain.value = 5;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.detune);
    vibratoGain.connect(osc2.detune);
    vibrato.start(time + 0.08);
    vibrato.stop(time + duration + 0.02);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.layerGains.lead);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.02);
    osc2.stop(time + duration + 0.02);
    const cleanup = [osc, osc2, filter, gain, vibrato, vibratoGain];
    osc2.onended = () => cleanup.forEach((node) => this._safeDisconnect(node));
  }

  _bass(midi, time, duration, level) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.pulse50);
    osc.frequency.value = midiToFreq(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(midi) * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(640, time);
    filter.frequency.exponentialRampToValueAtTime(280, time + duration);
    filter.Q.value = 3.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(level, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(level * 0.6, time + duration * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.layerGains.bass);
    osc.start(time);
    sub.start(time);
    osc.stop(time + duration + 0.02);
    sub.stop(time + duration + 0.02);
    const cleanup = [osc, sub, filter, gain];
    osc.onended = () => cleanup.forEach((node) => this._safeDisconnect(node));
  }

  _arp(midi, time, duration) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.pulse25);
    osc.frequency.value = midiToFreq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = midiToFreq(midi) * 2.2;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.12, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.layerGains.arp);
    osc.start(time);
    osc.stop(time + duration + 0.02);
    osc.onended = () => [osc, filter, gain].forEach((node) => this._safeDisconnect(node));
  }

  _pad(notes, time, duration) {
    const ctx = this.ctx;
    const nodes = [];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(620, time + duration);
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.034, time + 0.4);
    gain.gain.setValueAtTime(0.034, time + Math.max(0.5, duration - 0.7));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain);
    gain.connect(this.layerGains.pad);

    notes.forEach((midi, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = (index % 2 ? 7 : -7) + index * 0.8;
      const voice = ctx.createGain();
      voice.gain.value = 0.24;
      osc.connect(voice);
      voice.connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.05);
      nodes.push(osc, voice);
    });
    nodes.push(filter, gain);
    const first = nodes[0];
    if (first) first.onended = () => nodes.forEach((node) => this._safeDisconnect(node));
  }

  _kick(time, intensity) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    const gain = ctx.createGain();
    const peak = 0.42 + intensity * 0.22;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain);
    gain.connect(this.layerGains.drums);
    osc.start(time);
    osc.stop(time + 0.24);
    osc.onended = () => [osc, gain].forEach((node) => this._safeDisconnect(node));
  }

  _snare(time, intensity) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1700;
    band.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 420;
    const gain = ctx.createGain();
    const peak = 0.17 + intensity * 0.13;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
    noise.connect(band);
    band.connect(high);
    high.connect(gain);
    gain.connect(this.layerGains.drums);
    noise.start(time);
    noise.stop(time + 0.2);
    noise.onended = () => [noise, band, high, gain].forEach((node) => this._safeDisconnect(node));
  }

  _hat(time, level) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 7400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    noise.connect(high);
    high.connect(gain);
    gain.connect(this.layerGains.drums);
    noise.start(time);
    noise.stop(time + 0.05);
    noise.onended = () => [noise, high, gain].forEach((node) => this._safeDisconnect(node));
  }

  /* ------------------------------------------------------------------------
     Ambience
     ------------------------------------------------------------------------ */

  setWeather(rain = 0, wind = 0, dust = 0) {
    if (!this.ready || !this.weatherAudio) return;
    const t = this.ctx.currentTime;
    const targetRain = clamp01(rain) * 0.055;
    const targetWind = clamp01(Math.max(wind, dust * 0.8)) * 0.032;
    if (Math.abs(targetRain - this.weatherAudio.lastRain) > 0.002) {
      this.weatherAudio.lastRain = targetRain;
      this.weatherAudio.rain.gain.setTargetAtTime(targetRain, t, 0.9);
    }
    if (Math.abs(targetWind - this.weatherAudio.lastWind) > 0.002) {
      this.weatherAudio.lastWind = targetWind;
      this.weatherAudio.wind.gain.setTargetAtTime(targetWind, t, 0.9);
    }
  }

  playThunder(strength = 1) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gainOut = ctx.createGain();
    gainOut.gain.value = 0.7 * strength;
    gainOut.connect(this.master);
    gainOut.connect(this.reverb);

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.brownNoiseBuffer;
    rumble.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(160, now);
    low.frequency.exponentialRampToValueAtTime(55, now + 1.8);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.5, now + 0.05);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.1);
    rumble.connect(low);
    low.connect(rumbleGain);
    rumbleGain.connect(gainOut);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, now);
    sub.frequency.exponentialRampToValueAtTime(21, now + 1.6);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.22, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    sub.connect(subGain);
    subGain.connect(gainOut);

    rumble.start(now);
    rumble.stop(now + 2.2);
    sub.start(now);
    sub.stop(now + 1.9);
    this._cleanup([rumble, low, rumbleGain, sub, subGain, gainOut], sub);
  }

  startAmbience() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = this.brownNoiseBuffer;
    wind.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.055;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    wind.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceGain);
    wind.start();
    lfo.start();

    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 43;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.012;
    const droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.033;
    const droneLfoGain = ctx.createGain();
    droneLfoGain.gain.value = 0.006;
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(droneGain.gain);
    drone.connect(droneGain);
    droneGain.connect(this.ambienceGain);
    drone.start();
    droneLfo.start();
  }

  /* ------------------------------------------------------------------------
     Spatial SFX
     ------------------------------------------------------------------------ */

  _createOutput(position, gainValue = 1) {
    const ctx = this.ctx;
    let node = this.sfxGain;
    let panner = null;
    if (position) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 9;
      panner.maxDistance = 100;
      panner.rolloffFactor = 1.15;
      if (panner.positionX) {
        panner.positionX.value = position.x || 0;
        panner.positionY.value = position.y ?? 1.2;
        panner.positionZ.value = position.z || 0;
      } else if (panner.setPosition) {
        panner.setPosition(position.x || 0, position.y ?? 1.2, position.z || 0);
      }
      panner.connect(this.sfxGain);
      panner.connect(this.sfxReverb);
      node = panner;
    }
    const out = ctx.createGain();
    out.gain.value = gainValue;
    out.connect(node);
    out.__cleanupNodes = [out, panner];
    return { input: out, panner, out };
  }

  _safeDisconnect(node) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  _cleanup(nodes, source) {
    if (!source) return;
    source.onended = () => {
      nodes.forEach((node) => {
        node.__cleanupNodes?.forEach((extra) => this._safeDisconnect(extra));
        this._safeDisconnect(node);
      });
    };
  }

  _guardSfx() {
    return this.ready && this.ctx && !this.muted && this.ctx.state === 'running';
  }

  playGunshot(position = null, enemy = false, profile = null) {
    if (!this._guardSfx()) return;
    const now = this.ctx.currentTime;
    if (now - this._lastGunshot < 0.012) return;
    this._lastGunshot = now;
    const ctx = this.ctx;
    const kind = profile || (enemy ? 'enemy' : 'lmg');
    const profiles = {
      lmg: { high: 420, low: 3000, peak: 0.26, bodyStart: 145, bodyEnd: 48, bodyGain: 0.19, length: 0.11 },
      rifle: { high: 720, low: 5200, peak: 0.18, bodyStart: 220, bodyEnd: 80, bodyGain: 0.09, length: 0.08 },
      shotgun: { high: 220, low: 2200, peak: 0.4, bodyStart: 110, bodyEnd: 32, bodyGain: 0.33, length: 0.24 },
      dmr: { high: 950, low: 6800, peak: 0.3, bodyStart: 260, bodyEnd: 58, bodyGain: 0.18, length: 0.16 },
      enemy: { high: 650, low: 4300, peak: 0.15, bodyStart: 190, bodyEnd: 90, bodyGain: 0.1, length: 0.095 },
    };
    const p = profiles[kind] || profiles.lmg;
    const { input } = this._createOutput(position, enemy ? 0.8 : 1);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.playbackRate.value = kind === 'shotgun' ? rand(0.72, 0.9) : rand(0.92, 1.1);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = p.high;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = p.low;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(p.peak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + p.length);
    noise.connect(high);
    high.connect(low);
    low.connect(noiseGain);
    noiseGain.connect(input);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(p.bodyStart, now);
    body.frequency.exponentialRampToValueAtTime(p.bodyEnd, now + p.length * 0.9);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(p.bodyGain, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + p.length * 1.1);
    body.connect(bodyGain);
    bodyGain.connect(input);

    noise.start(now, Math.random() * 1.2);
    noise.stop(now + p.length + 0.01);
    body.start(now);
    body.stop(now + p.length * 1.15);
    this._cleanup([noise, high, low, noiseGain, body, bodyGain, input], body);
  }

  playWeaponSwitch() {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const output = this._createOutput(null, 0.55);
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(430 + i * 310, now + i * 0.045);
      osc.frequency.exponentialRampToValueAtTime(220 + i * 100, now + i * 0.045 + 0.035);
      const gain = ctx.createGain();
      const t = now + i * 0.045;
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      osc.connect(gain);
      gain.connect(output.input);
      osc.start(t);
      osc.stop(t + 0.055);
    }
    window.setTimeout(() => this._safeDisconnect(output.input), 250);
  }

  playExplosion(position = null, scale = 1) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, clamp(0.8 * scale, 0.35, 1.3));

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noise.playbackRate.value = rand(0.8, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2300, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + 1.1 * scale);
    lp.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5 * scale, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25 * scale);
    noise.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(input);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(88, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.8 * scale);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.4 * scale, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95 * scale);
    sub.connect(subGain);
    subGain.connect(input);

    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const crackHigh = ctx.createBiquadFilter();
    crackHigh.type = 'highpass';
    crackHigh.frequency.value = 1800;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.18 * scale, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    crack.connect(crackHigh);
    crackHigh.connect(crackGain);
    crackGain.connect(input);

    noise.start(now);
    noise.stop(now + 1.3 * scale);
    crack.start(now, Math.random());
    crack.stop(now + 0.16);
    sub.start(now);
    sub.stop(now + 1.05 * scale);
    this._cleanup([noise, lp, noiseGain, sub, subGain, crack, crackHigh, crackGain, input], sub);
  }

  playGrenadeThrow(position = null) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.6);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, now);
    bp.frequency.exponentialRampToValueAtTime(2100, now + 0.25);
    bp.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(input);
    noise.start(now, Math.random());
    noise.stop(now + 0.33);
    this._cleanup([noise, bp, gain, input], noise);
  }

  playPinPull(position = null) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.5);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(1300, now + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(input);
    osc.start(now);
    osc.stop(now + 0.08);
    this._cleanup([osc, gain, input], osc);
  }

  playBounce(position = null) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.5);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(rand(220, 300), now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain);
    gain.connect(input);
    osc.start(now);
    osc.stop(now + 0.11);
    this._cleanup([osc, gain, input], osc);
  }

  playRicochet(position = null) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.36);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(1900, 3000), now);
    osc.frequency.exponentialRampToValueAtTime(rand(400, 700), now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(input);
    osc.start(now);
    osc.stop(now + 0.19);
    this._cleanup([osc, gain, input], osc);
  }

  playEnemyDeath(position = null, type = 'rifleman') {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.6);
    const osc = ctx.createOscillator();
    osc.type = type === 'officer' ? 'sawtooth' : 'triangle';
    const start = type === 'officer' ? 150 : 110;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.38);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(720, now);
    formant.frequency.exponentialRampToValueAtTime(260, now + 0.35);
    formant.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(formant);
    formant.connect(gain);
    gain.connect(input);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 850;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.09, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(input);

    osc.start(now);
    osc.stop(now + 0.44);
    noise.start(now, Math.random());
    noise.stop(now + 0.3);
    this._cleanup([osc, formant, gain, noise, noiseFilter, noiseGain, input], osc);
  }

  playPlayerHit() {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const output = this._createOutput(null, 0.9);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output.input);
    osc.start(now);
    osc.stop(now + 0.32);
    this._cleanup([osc, filter, gain, output.input], osc);
  }

  playHitmarker(kill = false) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const output = this._createOutput(null, 0.55);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kill ? 1650 : 1250, now);
    osc.frequency.exponentialRampToValueAtTime(kill ? 2200 : 1550, now + 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(output.input);
    osc.start(now);
    osc.stop(now + 0.07);
    this._cleanup([osc, gain, output.input], osc);
  }

  playPickup(kind = 'health') {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const output = this._createOutput(null, 0.55);
    const notes =
      kind === 'weapon'
        ? [523, 659, 784, 1047]
        : kind === 'grenade'
          ? [660, 880]
          : [520, 780, 1040];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = now + index * 0.07;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(gain);
      gain.connect(output.input);
      osc.start(t);
      osc.stop(t + 0.15);
    });
    window.setTimeout(
      () => this._safeDisconnect(output.input),
      500 + notes.length * 80
    );
  }

  playMortarLaunch(position = null) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const { input } = this._createOutput(position, 0.8);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(input);
    noise.start(now, Math.random());
    noise.stop(now + 0.42);

    const ping = ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(720, now);
    ping.frequency.exponentialRampToValueAtTime(360, now + 0.2);
    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(0.06, now);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    ping.connect(pingGain);
    pingGain.connect(input);
    ping.start(now);
    ping.stop(now + 0.23);
    this._cleanup([noise, filter, gain, ping, pingGain, input], ping);
  }

  playMortarWhistle(position = null, duration = 2.2) {
    if (!this._guardSfx()) return { stop() {} };
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const { input } = this._createOutput(position, 0.45);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1150, now);
    osc.frequency.exponentialRampToValueAtTime(290, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.02, now + duration * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(input);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    this._cleanup([osc, gain, input], osc);
    return {
      stop: () => {
        try {
          const t = this.ctx.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.value, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
          osc.stop(t + 0.1);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  playUiClick() {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const output = this._createOutput(null, 0.4);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(output.input);
    osc.start(now);
    osc.stop(now + 0.07);
    this._cleanup([osc, gain, output.input], osc);
  }

  playHeartbeat(volume = 1) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const output = this._createOutput(null, 0.35 * volume);
    [0, 0.16].forEach((offset, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(68 - index * 10, now + offset);
      osc.frequency.exponentialRampToValueAtTime(36, now + offset + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(index ? 0.1 : 0.18, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
      osc.connect(gain);
      gain.connect(output.input);
      osc.start(now + offset);
      osc.stop(now + offset + 0.17);
    });
    window.setTimeout(() => this._safeDisconnect(output.input), 350);
  }

  playJingle(victory = true) {
    if (!this._guardSfx()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.08;
    const output = this._createOutput(null, 0.7);
    output.input.connect(this.sfxReverb);
    const notes = victory ? [62, 66, 69, 74, 78, 81] : [57, 53, 50, 45];
    notes.forEach((midi, index) => {
      const start = now + index * (victory ? 0.15 : 0.23);
      const dur = victory ? (index === notes.length - 1 ? 1.4 : 0.32) : 0.6;
      const osc = ctx.createOscillator();
      osc.type = index % 2 ? 'triangle' : 'sine';
      osc.frequency.value = midiToFreq(midi);
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = midiToFreq(midi) * 2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.18;
      osc.connect(gain);
      osc2.connect(overtoneGain);
      overtoneGain.connect(gain);
      gain.connect(output.input);
      osc.start(start);
      osc2.start(start);
      osc.stop(start + dur + 0.03);
      osc2.stop(start + dur + 0.03);
    });
    window.setTimeout(() => this._safeDisconnect(output.input), (victory ? 3 : 2) * 1000);
  }

  playDistantWar(position = null) {
    if (!this._guardSfx()) return;
    // A muffled, low-pass explosion used as battlefield ambience.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const { input } = this._createOutput(position, 0.25);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(input);
    noise.start(now, Math.random());
    noise.stop(now + 0.95);
    this._cleanup([noise, filter, gain, input], noise);
  }

  /* ------------------------------------------------------------------------
     Mixer controls
     ------------------------------------------------------------------------ */

  setMuted(muted) {
    this.muted = Boolean(muted);
    safeStorageSet(SETTINGS.storageKeys.muted, this.muted ? '1' : '0');
    if (this.ready) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, t, 0.03);
    }
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  setVolume(value) {
    this.masterVolume = clamp(value, 0, 1);
    safeStorageSet(SETTINGS.storageKeys.volume, String(this.masterVolume));
    if (this.ready && !this.muted) {
      this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.04);
    }
    return this.masterVolume;
  }

  async resume() {
    if (!this.ready) return;
    if (this.ctx.state !== 'running') {
      await this.ctx.resume().catch(() => {});
      if (this.musicPlaying) this.nextStepTime = this.ctx.currentTime + 0.1;
    }
  }

  async suspend() {
    if (!this.ready) return;
    if (this.ctx.state === 'running') await this.ctx.suspend().catch(() => {});
  }

  isReady() {
    return this.ready;
  }
}
