import * as THREE from 'three';

/**
 * All textures are generated at runtime on canvases. Nothing here requires a
 * network request, which keeps the game playable from a single local checkout.
 */

const cache = new Map();

function makeCanvas(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function hash2i(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function wrap(v, period) {
  return ((v % period) + period) % period;
}

function valueNoise(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);
  const a = hash2i(x0, y0);
  const b = hash2i(x1, y0);
  const c = hash2i(x0, y1);
  const d = hash2i(x1, y1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

function fbm(x, y, basePeriod = 8, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * period, y * period, period) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }
  return value / total;
}

function toTexture(canvas, options = {}) {
  const {
    repeat = [1, 1],
    colorSpace = THREE.SRGBColorSpace,
    wrap = THREE.RepeatWrapping,
    anisotropy = 8,
    minFilter = THREE.LinearMipmapLinearFilter,
    magFilter = THREE.LinearFilter,
  } = options;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = minFilter;
  texture.magFilter = magFilter;
  texture.needsUpdate = true;
  return texture;
}

function mixPalette(stops, t) {
  const clamped = Math.min(0.9999, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const a = stops[index];
  const b = stops[Math.min(stops.length - 1, index + 1)];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ];
}

function generateGroundCanvas(size = 512) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const stops = [
    [26, 37, 19],
    [45, 61, 26],
    [70, 89, 37],
    [111, 120, 61],
    [96, 76, 43],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const broad = fbm(nx, ny, 7, 4);
      const mid = fbm(nx + 4.13, ny + 7.27, 19, 3);
      const micro = fbm(nx + 19.7, ny + 3.2, 44, 2);
      const fine = valueNoise(nx * 256, ny * 256, 256);
      const dry = Math.max(0, mid * mid * 1.45 - 0.32);
      const t = Math.min(1, broad * 0.62 + mid * 0.38 + fine * 0.03 - dry * 0.12);
      const color = mixPalette(stops, t);
      const grit = (fine - 0.5) * 25 + (micro - 0.5) * 12 + (hash2i(x * 3, y * 3) - 0.5) * 8;
      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, Math.min(255, color[0] + grit + dry * 18));
      data[idx + 1] = Math.max(0, Math.min(255, color[1] + grit * 0.94 + dry * 12));
      data[idx + 2] = Math.max(0, Math.min(255, color[2] + grit * 0.65));
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Dry grass flecks, stones and scuffs.
  let seed = 129381;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.lineCap = 'round';
  for (let i = 0; i < 2400; i++) {
    const x = random() * size;
    const y = random() * size;
    const len = 1.5 + random() * 7;
    const light = random() > 0.48;
    ctx.strokeStyle = light
      ? `rgba(168, 159, 93, ${0.12 + random() * 0.2})`
      : `rgba(19, 31, 14, ${0.16 + random() * 0.22})`;
    ctx.lineWidth = 0.7 + random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 2.2, y - len);
    ctx.stroke();
  }
  for (let i = 0; i < 320; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 0.6 + random() * 2.8;
    ctx.fillStyle = random() > 0.55
      ? `rgba(28, 30, 20, ${0.28 + random() * 0.2})`
      : `rgba(158, 145, 102, ${0.18 + random() * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.65, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 45; i++) {
    const x = random() * size;
    const y = random() * size;
    ctx.fillStyle = `rgba(208, 198, 161, ${0.14 + random() * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + random() * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

export function heightToNormalCanvas(source, strength = 2.4) {
  const size = source.width;
  const src = source.getContext('2d').getImageData(0, 0, size, size).data;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(size, size);
  const dest = out.data;
  const sample = (x, y) => {
    const ix = (x + size) % size;
    const iy = (y + size) % size;
    const idx = (iy * size + ix) * 4;
    return (src[idx] * 0.299 + src[idx + 1] * 0.587 + src[idx + 2] * 0.114) / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const t = sample(x, y - 1);
      const b = sample(x, y + 1);
      let nx = (l - r) * strength;
      let ny = (b - t) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const idx = (y * size + x) * 4;
      dest[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dest[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dest[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dest[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function makeGroundTextures() {
  const ground = generateGroundCanvas(512);
  const groundCanvas = makeCanvas(512);
  const gctx = groundCanvas.getContext('2d');
  gctx.drawImage(ground, 0, 0);

  const normalCanvas = heightToNormalCanvas(ground, 2.1);
  const rough = makeCanvas(256);
  const rctx = rough.getContext('2d');
  const grad = rctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#8d8d8d');
  grad.addColorStop(0.5, '#777777');
  grad.addColorStop(1, '#9a9a9a');
  rctx.fillStyle = grad;
  rctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * 0.25;
    rctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},255,255,${a * 0.2})`;
    rctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  return {
    map: toTexture(groundCanvas, { repeat: [1, 1], anisotropy: 16 }),
    normalMap: toTexture(normalCanvas, {
      repeat: [1, 1],
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    }),
    roughnessMap: toTexture(rough, {
      repeat: [1, 1],
      colorSpace: THREE.NoColorSpace,
      anisotropy: 4,
    }),
  };
}

export function getGroundTextures() {
  if (!cache.has('ground')) cache.set('ground', makeGroundTextures());
  return cache.get('ground');
}

/* --------------------------------------------------------------------------
   Biome ground textures
   -------------------------------------------------------------------------- */

const BIOME_GROUND_PALETTES = {
  desert: [
    [151, 125, 79],
    [192, 161, 105],
    [219, 187, 127],
    [233, 205, 151],
    [168, 134, 83],
  ],
  city: [
    [45, 49, 48],
    [66, 70, 68],
    [83, 86, 82],
    [55, 58, 56],
    [103, 104, 97],
  ],
  snow: [
    [172, 190, 196],
    [203, 217, 220],
    [226, 235, 235],
    [241, 246, 245],
    [186, 203, 209],
  ],
  grass: [
    [91, 112, 55],
    [122, 135, 71],
    [155, 153, 82],
    [183, 170, 94],
    [105, 118, 62],
  ],
  swamp: [
    [52, 61, 43],
    [65, 72, 49],
    [78, 80, 53],
    [43, 53, 40],
    [94, 88, 58],
  ],
};

function makeBiomeGroundCanvas(kind) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const palette = BIOME_GROUND_PALETTES[kind] || BIOME_GROUND_PALETTES.desert;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const broad = fbm(nx + (kind === 'city' ? 8.2 : 2.4), ny + 4.7, kind === 'city' ? 4 : 7, 4);
      const mid = fbm(nx + 13.2, ny + 6.1, 19, 3);
      const micro = fbm(nx + 23.4, ny + 17.8, 45, 2);
      const fine = valueNoise(nx * 256, ny * 256, 256);
      const t = Math.min(1, broad * 0.6 + mid * 0.34 + fine * 0.06);
      const color = mixPalette(palette, t);
      let grain = (fine - 0.5) * (kind === 'snow' ? 10 : 22) + (micro - 0.5) * 9;
      let r = color[0] + grain;
      let g = color[1] + grain;
      let b = color[2] + grain * 0.9;

      if (kind === 'desert') {
        const ripple = Math.sin((ny * 55 + nx * 14) * Math.PI) * (0.5 + mid * 0.5);
        r += ripple * 9;
        g += ripple * 7;
        b += ripple * 3;
      } else if (kind === 'city') {
        const seam = Math.min(
          Math.abs((nx * 6) % 1 - 0.5),
          Math.abs((ny * 8) % 1 - 0.5)
        );
        if (seam < 0.018) {
          r -= 15;
          g -= 15;
          b -= 14;
        }
      } else if (kind === 'snow') {
        const drift = Math.sin((ny * 24 + nx * 6) * Math.PI) * (0.45 + mid * 0.55);
        r += drift * 8;
        g += drift * 9;
        b += drift * 10;
      } else if (kind === 'grass') {
        const blades = Math.sin((ny * 90 + nx * 20) * Math.PI) * (0.4 + mid * 0.6);
        r += blades * 7;
        g += blades * 10;
        b += blades * 3;
      } else if (kind === 'swamp') {
        const wetRaw = Math.min(1, Math.max(0, (broad - 0.28) / 0.34));
        const wet = wetRaw * wetRaw * (3 - 2 * wetRaw) * (0.5 + mid * 0.5);
        r -= wet * 11;
        g -= wet * 7;
        b -= wet * 4;
        const algae = Math.sin((ny * 38 + nx * 11) * Math.PI) * (0.3 + fine * 0.7);
        g += algae * 5;
      }

      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, Math.min(255, r));
      data[idx + 1] = Math.max(0, Math.min(255, g));
      data[idx + 2] = Math.max(0, Math.min(255, b));
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  let seed = kind === 'snow' ? 92731 : kind === 'city' ? 33829 : 61203;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (kind === 'desert') {
    ctx.lineCap = 'round';
    for (let i = 0; i < 58; i++) {
      const y = random() * size;
      const amplitude = 2 + random() * 8;
      ctx.strokeStyle = `rgba(${random() > 0.5 ? '112, 88, 55' : '239, 218, 169'}, ${0.08 + random() * 0.14})`;
      ctx.lineWidth = 0.8 + random() * 1.7;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 16) {
        const yy = y + Math.sin(x * 0.025 + random() * 0.5) * amplitude;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(87, 70, 45, ${0.15 + random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 0.6 + random() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'city') {
    ctx.lineCap = 'round';
    for (let i = 0; i < 48; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.strokeStyle = `rgba(19, 22, 21, ${0.18 + random() * 0.22})`;
      ctx.lineWidth = 0.6 + random() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (let j = 0; j < 4; j++) {
        px += (random() - 0.5) * 36;
        py += (random() - 0.5) * 26;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${random() > 0.45 ? '182, 173, 142' : '20, 23, 22'}, ${0.06 + random() * 0.16})`;
      ctx.fillRect(random() * size, random() * size, 1 + random() * 4, 1 + random() * 2.5);
    }
    // Faded municipal markings.
    ctx.strokeStyle = 'rgba(194, 176, 117, 0.18)';
    ctx.lineWidth = 8;
    ctx.setLineDash([34, 26]);
    ctx.beginPath();
    ctx.moveTo(size * 0.48, 0);
    ctx.lineTo(size * 0.52, size);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (kind === 'grass') {
    ctx.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.strokeStyle = `rgba(${random() > 0.5 ? '77, 97, 46' : '196, 184, 108'}, ${0.12 + random() * 0.18})`;
      ctx.lineWidth = 0.5 + random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 2, y - 2 - random() * 5);
      ctx.stroke();
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? '221, 207, 122' : '91, 111, 52'}, ${0.12 + random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 0.6 + random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'swamp') {
    for (let i = 0; i < 80; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.fillStyle = `rgba(${random() > 0.5 ? '25, 34, 24' : '116, 107, 67'}, ${0.1 + random() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        4 + random() * 28,
        2 + random() * 13,
        random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(${random() > 0.4 ? '72, 93, 48' : '143, 143, 94'}, ${0.1 + random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 0.5 + random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const y = random() * size;
      ctx.strokeStyle = `rgba(${random() > 0.5 ? '147, 174, 189' : '249, 252, 251'}, ${0.12 + random() * 0.2})`;
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 18) {
        const yy = y + Math.sin(x * 0.02 + random() * 2) * (3 + random() * 6);
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(${random() > 0.3 ? '244, 250, 252' : '129, 157, 169'}, ${0.16 + random() * 0.28})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 0.5 + random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

export function getBiomeGroundTextures(kind) {
  const key = `biome-${kind}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = makeBiomeGroundCanvas(kind);
  const normal = heightToNormalCanvas(canvas, kind === 'snow' ? 1.2 : 2.0);
  const result = {
    map: toTexture(canvas, { repeat: [1, 1], anisotropy: 16 }),
    normalMap: toTexture(normal, {
      repeat: [1, 1],
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    }),
  };
  cache.set(key, result);
  return result;
}

export function getFootprintTexture() {
  if (cache.has('footprint')) return cache.get('footprint');
  const size = 96;
  const height = 160;
  const canvas = makeCanvas(size, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, height);

  const gradient = ctx.createRadialGradient(size / 2, 56, 4, size / 2, 80, 78);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(size / 2, 84, 29, 55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Heel block.
  ctx.beginPath();
  ctx.ellipse(size / 2, 128, 22, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const y = 58 + i * 20;
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(72, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(48, 42, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 8,
  });
  cache.set('footprint', texture);
  return texture;
}

function makeRoadCanvas() {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const n = fbm(nx + 2.2, ny + 1.8, 6, 5);
      const tire = Math.exp(-Math.pow((Math.abs(nx - 0.32) - 0.12) / 0.055, 2)) +
        Math.exp(-Math.pow((Math.abs(nx - 0.32) - 0.32) / 0.055, 2));
      const base = mixPalette(
        [
          [65, 51, 33],
          [92, 73, 46],
          [124, 101, 63],
          [78, 61, 38],
        ],
        n
      );
      const trench = tire * 14;
      const edge = Math.min(1, Math.min(nx, 1 - nx) / 0.16);
      const alpha = Math.round(255 * Math.min(1, Math.pow(edge, 0.58) * 0.97));
      const grain = (valueNoise(nx * 180, ny * 180, 180) - 0.5) * 26 - tire * 4;
      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, base[0] + grain - trench);
      data[idx + 1] = Math.max(0, base[1] + grain - trench * 0.9);
      data[idx + 2] = Math.max(0, base[2] + grain - trench * 0.75);
      data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.2;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(39, 34, 24, 0.3)' : 'rgba(169, 148, 103, 0.24)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

export function getRoadTextures() {
  if (cache.has('road')) return cache.get('road');
  const canvas = makeRoadCanvas();
  const normal = heightToNormalCanvas(canvas, 1.5);
  const result = {
    map: toTexture(canvas, { repeat: [1, 1], anisotropy: 8 }),
    normalMap: toTexture(normal, {
      repeat: [1, 1],
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    }),
  };
  cache.set('road', result);
  return result;
}

function makeSandbagCanvas() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const weave = (Math.sin(nx * Math.PI * 120) + Math.sin(ny * Math.PI * 96)) * 4.5;
      const n = fbm(nx + 11.3, ny + 4.7, 8, 4);
      const base = mixPalette(
        [
          [96, 86, 57],
          [130, 116, 78],
          [151, 134, 91],
          [108, 99, 68],
        ],
        n
      );
      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, base[0] + weave);
      data[idx + 1] = Math.max(0, base[1] + weave);
      data[idx + 2] = Math.max(0, base[2] + weave * 0.7);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = 'rgba(49, 45, 30, 0.34)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const y = (i / 9) * size + 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + Math.sin(i) * 3);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(217, 196, 143, 0.15)';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 11, y + Math.random() * 3);
    ctx.stroke();
  }
  return canvas;
}

export function getSandbagTextures() {
  if (cache.has('sandbag')) return cache.get('sandbag');
  const canvas = makeSandbagCanvas();
  const normal = heightToNormalCanvas(canvas, 1.8);
  const result = {
    map: toTexture(canvas, { repeat: [1, 1], anisotropy: 8 }),
    normalMap: toTexture(normal, {
      repeat: [1, 1],
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    }),
  };
  cache.set('sandbag', result);
  return result;
}

export function getWoodTexture() {
  if (cache.has('wood')) return cache.get('wood');
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5b4127';
  ctx.fillRect(0, 0, size, size);
  const plank = 42;
  for (let y = 0; y < size; y += plank) {
    const tone = 72 + Math.random() * 26;
    ctx.fillStyle = `rgb(${tone + 20}, ${tone - 8}, ${tone - 30})`;
    ctx.fillRect(0, y + 2, size, plank - 3);
    ctx.strokeStyle = 'rgba(24, 14, 8, 0.55)';
    ctx.strokeRect(0, y + 0.5, size, plank);
    for (let i = 0; i < 13; i++) {
      ctx.strokeStyle = `rgba(${35 + Math.random() * 30}, 22, 12, ${0.08 + Math.random() * 0.15})`;
      ctx.lineWidth = 0.5 + Math.random();
      const yy = y + 4 + Math.random() * (plank - 8);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x < size; x += 26) {
        ctx.lineTo(x, yy + Math.sin(x * 0.05 + y) * 2.1);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(28, 19, 10, 0.6)';
    ctx.beginPath();
    ctx.arc(20 + Math.random() * (size - 40), y + plank * 0.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = toTexture(canvas, { repeat: [1, 1], anisotropy: 8 });
  cache.set('wood', map);
  return map;
}

export function getMetalTexture() {
  if (cache.has('metal')) return cache.get('metal');
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4f5549';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const shade = 35 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${shade}, ${shade + 5}, ${shade - 3}, ${0.04 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 32, y + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = 'rgba(89, 66, 42, 0.08)';
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.random() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = toTexture(canvas, { repeat: [1, 1], anisotropy: 8 });
  cache.set('metal', map);
  return map;
}

function makeGlowCanvas(size = 128) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.86)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export function getGlowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const texture = toTexture(makeGlowCanvas(128), {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  cache.set('glow', texture);
  return texture;
}

export function getSparkTexture() {
  if (cache.has('spark')) return cache.get('spark');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,245,218,0.95)');
  g.addColorStop(0.45, 'rgba(255,170,70,0.35)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255, 248, 221, 0.7)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
    const len = 25 + Math.random() * 30;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  cache.set('spark', texture);
  return texture;
}

export function getSmokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const d = Math.hypot(nx, ny) * 2;
      const noise = fbm(x / size + 3.3, y / size + 9.1, 8, 4);
      const a = Math.max(0, Math.min(1, (1 - d) * 1.4 + (noise - 0.5) * 0.7)) * (0.55 + noise * 0.45);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  cache.set('smoke', texture);
  return texture;
}

export function getGrassTexture() {
  if (cache.has('grass')) return cache.get('grass');
  const canvas = makeCanvas(128);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.lineCap = 'round';
  let seed = 7734;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 34; i++) {
    const x = 20 + random() * 88;
    const height = 28 + random() * 76;
    const bend = (random() - 0.5) * 34;
    const tone = 55 + random() * 70;
    ctx.strokeStyle = `rgba(${Math.round(tone * 1.2)}, ${Math.round(tone * 1.55)}, ${Math.round(tone * 0.64)}, ${0.55 + random() * 0.4})`;
    ctx.lineWidth = 1.2 + random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + bend * 0.3, 128 - height * 0.6, x + bend, 128 - height);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = 'rgba(121, 129, 62, 0.5)';
    ctx.beginPath();
    ctx.ellipse(28 + random() * 72, 100 + random() * 25, 3 + random() * 7, 1.5 + random() * 3, random(), 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 4,
  });
  cache.set('grass', texture);
  return texture;
}

export function getScorchTexture() {
  if (cache.has('scorch')) return cache.get('scorch');
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, size / 2);
  g.addColorStop(0, 'rgba(8, 7, 4, 0.94)');
  g.addColorStop(0.3, 'rgba(18, 14, 9, 0.8)');
  g.addColorStop(0.64, 'rgba(30, 24, 14, 0.4)');
  g.addColorStop(1, 'rgba(20, 17, 10, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 78;
    const r = 3 + Math.random() * 14;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const dist = 25 + Math.random() * 80;
    ctx.strokeStyle = `rgba(10, 8, 5, ${0.12 + Math.random() * 0.28})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * dist * 0.6, cy + Math.sin(a) * dist * 0.6);
    ctx.lineTo(cx + Math.cos(a + 0.2) * dist, cy + Math.sin(a + 0.2) * dist);
    ctx.stroke();
  }
  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  cache.set('scorch', texture);
  return texture;
}

export function getWaterNormalTexture() {
  if (cache.has('waterNormal')) return cache.get('waterNormal');
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const height = (x, y) => {
    const nx = x / size;
    const ny = y / size;
    return (
      fbm(nx + 2.1, ny + 8.4, 4, 4) * 0.7 +
      Math.sin((nx * 18 + ny * 7) * Math.PI) * 0.08 +
      Math.sin((ny * 24 - nx * 5) * Math.PI) * 0.06
    );
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height((x - 1 + size) % size, y);
      const r = height((x + 1) % size, y);
      const t = height(x, (y - 1 + size) % size);
      const b = height(x, (y + 1) % size);
      let nx = (l - r) * 5;
      let ny = (b - t) * 5;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx / len * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = toTexture(canvas, {
    repeat: [2, 2],
    colorSpace: THREE.NoColorSpace,
    anisotropy: 8,
  });
  cache.set('waterNormal', texture);
  return texture;
}

export function makeTextTexture(lines, options = {}) {
  const {
    width = 512,
    height = 256,
    bg = 'rgba(12, 17, 9, 0.9)',
    color = '#ffb454',
    border = 'rgba(255, 180, 84, 0.5)',
    font = 'bold 64px "Arial Narrow", Arial, sans-serif',
    align = 'center',
  } = options;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, width - 6, height - 6);
  }
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = font;
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((line, i) => {
    ctx.fillText(line, width / 2, height / 2 + (i - (list.length - 1) / 2) * height * 0.2);
  });
  const texture = toTexture(canvas, {
    wrap: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  return texture;
}

export function getCamoTexture() {
  if (cache.has('camo')) return cache.get('camo');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4d532f';
  ctx.fillRect(0, 0, size, size);
  const blobs = ['#343b23', '#666a41', '#24291a', '#7a7047'];
  for (let i = 0; i < 34; i++) {
    ctx.fillStyle = blobs[i % blobs.length];
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 4 + Math.random() * 16;
    ctx.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = toTexture(canvas, { repeat: [1, 1], anisotropy: 4 });
  cache.set('camo', texture);
  return texture;
}
