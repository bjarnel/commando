/**
 * Small, dependency-free math helpers shared by every system.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Framerate independent exponential smoothing. */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export function dampVec2(x, z, tx, tz, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  return { x: lerp(x, tx, t), z: lerp(z, tz, t) };
}

export function normalizeAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** Interpolate angles the short way around the circle. */
export function dampAngle(current, target, lambda, dt) {
  const delta = normalizeAngle(target - current);
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export const angleLerp = (a, b, t) => a + normalizeAngle(b - a) * t;

export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function chance(p) {
  return Math.random() < p;
}

/** Deterministic mulberry32 PRNG for reproducible level dressing. */
export function seededRandom(seed = 0x1a2b3c4d) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomUnitVector(out = { x: 0, z: 0 }) {
  const a = Math.random() * TAU;
  out.x = Math.cos(a);
  out.z = Math.sin(a);
  return out;
}

/** 2D segment vs circle intersection. Returns the entry t (0..1) or null. */
export function segmentCircle2D(x1, z1, x2, z2, cx, cz, radius) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const fx = x1 - cx;
  const fz = z1 - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    return fx * fx + fz * fz <= radius * radius ? 0 : null;
  }
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  if (c <= 0) return 0;
  return null;
}

/** Distance from a point to a 2D segment. */
export function distanceToSegment2D(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return Math.hypot(px - x1, pz - z1);
  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = clamp01(t);
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

export const formatScore = (value) =>
  Math.max(0, Math.floor(value)).toString().padStart(6, '0');

export const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const approach = (current, target, maxDelta) => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};
