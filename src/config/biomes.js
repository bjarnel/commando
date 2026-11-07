/**
 * The campaign is a single continuous river corridor that crosses five
 * distinct environments. Start markers are authoritative; overlays blend
 * around the seams for a few dozen metres.
 */
export const BIOMES = [
  {
    id: 'jungle',
    label: 'JUNGLE',
    phase: 'INFILTRATION',
    start: 0,
    end: 400,
    groundKind: 'jungle',
    weather: 'clear',
    entryKicker: 'OPERATION ZONE',
    entryText: 'THE GREEN HELL — MOVE UPRIVER',
    fog: { color: 0x879273, density: 0.0068, background: 0x8b9778 },
    sun: { color: 0xffdfaa, intensity: 2.12 },
    hemi: { sky: 0xb9d0cd, ground: 0x51452c, intensity: 1.22 },
    fill: { color: 0xa9c6cf, intensity: 0.68 },
    atmosphere: { rain: 0, wind: 0.18, snow: 0, dust: 0, lightning: false },
    roadTint: 0xffffff,
    vehicleTint: 0xffffff,
    palette: {
      rifleman: { uniform: 0x7a6340, uniformDark: 0x4a3f29, vest: 0x453b27, accent: 0xb14a31, helmet: 0x51543a, headgear: 'helmet' },
      officer: { uniform: 0x4c5736, uniformDark: 0x2a3021, vest: 0x313823, accent: 0xc13527, helmet: 0x363c29, headgear: 'beret' },
      mortar: { uniform: 0x665d3a, uniformDark: 0x443f2a, vest: 0x403d29, accent: 0x8a7a4c, helmet: 0x505138, headgear: 'helmet' },
      heavy: { uniform: 0x3f4630, uniformDark: 0x272c1f, vest: 0x2c3222, accent: 0x9f4a2e, helmet: 0x3d412d, headgear: 'helmet' },
    },
  },
  {
    id: 'wetlands',
    label: 'RIVER DELTA',
    phase: 'RIVER CROSSING',
    start: 400,
    end: 670,
    groundKind: 'jungle',
    weather: 'rain',
    entryKicker: 'WEATHER FRONT',
    entryText: 'RIVER DELTA — MONSOON RAIN',
    fog: { color: 0x687d72, density: 0.011, background: 0x75877a },
    sun: { color: 0xd4e2d0, intensity: 1.42 },
    hemi: { sky: 0xa8bdb7, ground: 0x3f4835, intensity: 1.05 },
    fill: { color: 0x9fbcbe, intensity: 0.6 },
    atmosphere: { rain: 0.82, wind: 0.55, snow: 0, dust: 0, lightning: true },
    roadTint: 0xd7dfc6,
    vehicleTint: 0xcbd4c1,
    palette: {
      rifleman: { uniform: 0x5a6241, uniformDark: 0x3c432f, vest: 0x343c2d, accent: 0xa45336, helmet: 0x414b38, headgear: 'helmet' },
      officer: { uniform: 0x3c4a3d, uniformDark: 0x252f29, vest: 0x2c3830, accent: 0xbe4b32, helmet: 0x2e3b32, headgear: 'beret' },
      mortar: { uniform: 0x50583d, uniformDark: 0x38402e, vest: 0x343c2c, accent: 0x7f754b, helmet: 0x414735, headgear: 'helmet' },
      heavy: { uniform: 0x374334, uniformDark: 0x202b24, vest: 0x29352b, accent: 0xa45b36, helmet: 0x303b31, headgear: 'helmet' },
    },
  },
  {
    id: 'desert',
    label: 'DESERT LINE',
    phase: 'DESERT CROSSING',
    start: 670,
    end: 950,
    groundKind: 'desert',
    weather: 'sand',
    entryKicker: 'TERRAIN CHANGE',
    entryText: 'DESERT LINE — DUST AND OPEN GROUND',
    fog: { color: 0xb08a5a, density: 0.0105, background: 0xb79a6a },
    sun: { color: 0xffd188, intensity: 2.3 },
    hemi: { sky: 0xd8c8a6, ground: 0x75573a, intensity: 1.08 },
    fill: { color: 0xc5b497, intensity: 0.6 },
    atmosphere: { rain: 0, wind: 0.8, snow: 0, dust: 0.75, lightning: false },
    roadTint: 0xd9c297,
    vehicleTint: 0xd8c39b,
    palette: {
      rifleman: { uniform: 0xb29a67, uniformDark: 0x7c6743, vest: 0x8e764e, accent: 0xa84e32, helmet: 0xa88f60, headgear: 'helmet' },
      officer: { uniform: 0x8e774e, uniformDark: 0x5e4b32, vest: 0x776240, accent: 0xc13b29, helmet: 0xa78b59, headgear: 'beret' },
      mortar: { uniform: 0xa08d5f, uniformDark: 0x6f5d3d, vest: 0x7c6947, accent: 0x8c7444, helmet: 0x958153, headgear: 'helmet' },
      heavy: { uniform: 0x7f6e4a, uniformDark: 0x57492f, vest: 0x68573c, accent: 0xa3492d, helmet: 0x7b6743, headgear: 'helmet' },
    },
  },
  {
    id: 'city',
    label: 'RUINED CITY',
    phase: 'URBAN ASSAULT',
    start: 950,
    end: 1170,
    groundKind: 'city',
    weather: 'storm',
    entryKicker: 'URBAN FRONT',
    entryText: 'RUINED CITY — LIGHTNING AND CONCRETE',
    fog: { color: 0x656f73, density: 0.009, background: 0x6b7679 },
    sun: { color: 0xbccad0, intensity: 1.18 },
    hemi: { sky: 0x9daeb5, ground: 0x3b4140, intensity: 0.96 },
    fill: { color: 0x9bb8c7, intensity: 0.74 },
    atmosphere: { rain: 1, wind: 0.65, snow: 0, dust: 0.08, lightning: true },
    roadTint: 0x969b9b,
    vehicleTint: 0xa8b0af,
    palette: {
      rifleman: { uniform: 0x4f5860, uniformDark: 0x2f353a, vest: 0x3a4248, accent: 0xc84e34, helmet: 0x3f474d, headgear: 'helmet' },
      officer: { uniform: 0x384249, uniformDark: 0x232a2f, vest: 0x2c353b, accent: 0xc84a31, helmet: 0x30393f, headgear: 'cap' },
      mortar: { uniform: 0x475055, uniformDark: 0x2c3336, vest: 0x333b3f, accent: 0x8e6c45, helmet: 0x3b4347, headgear: 'helmet' },
      heavy: { uniform: 0x333d42, uniformDark: 0x1f272b, vest: 0x293337, accent: 0xb45a35, helmet: 0x2d3639, headgear: 'helmet' },
    },
  },
  {
    id: 'snow',
    label: 'FROZEN PASS',
    phase: 'FROZEN PASS',
    start: 1170,
    end: 1500,
    groundKind: 'snow',
    weather: 'snow',
    entryKicker: 'WEATHER FRONT',
    entryText: 'FROZEN PASS — WHITEOUT CONDITIONS',
    fog: { color: 0xc3d0d2, density: 0.0135, background: 0xc8d4d5 },
    sun: { color: 0xdfe9ff, intensity: 1.28 },
    hemi: { sky: 0xd6e1e5, ground: 0x5c6668, intensity: 1.02 },
    fill: { color: 0xbdd6e3, intensity: 0.58 },
    atmosphere: { rain: 0, wind: 0.45, snow: 0.95, dust: 0, lightning: false },
    roadTint: 0xd7e0e1,
    vehicleTint: 0xd2dcdc,
    palette: {
      rifleman: { uniform: 0xb8c2c0, uniformDark: 0x818d8d, vest: 0x98a3a1, accent: 0x9e3c2a, helmet: 0xd4dcda, headgear: 'helmet' },
      officer: { uniform: 0x9eaaa8, uniformDark: 0x6b7778, vest: 0x7f8b89, accent: 0xaa2e23, helmet: 0xc4cfcd, headgear: 'beret' },
      mortar: { uniform: 0xaab4b1, uniformDark: 0x7a8584, vest: 0x8d9794, accent: 0x7d8b87, helmet: 0xcbd4d2, headgear: 'helmet' },
      heavy: { uniform: 0x8f9b9a, uniformDark: 0x606c6d, vest: 0x758181, accent: 0xa0462f, helmet: 0xb7c1c0, headgear: 'helmet' },
    },
  },
];

export const BIOME_STARTS = BIOMES.map((biome) => biome.start);

export function getBiomeAt(z) {
  for (const biome of BIOMES) {
    if (z < biome.end) return biome;
  }
  return BIOMES[BIOMES.length - 1];
}

export function getEnemyStyle(biomeId, role) {
  const biome = BIOMES.find((entry) => entry.id === biomeId) || BIOMES[0];
  const palette = biome.palette[role] || biome.palette.rifleman;
  return {
    ...palette,
    skin: 0xc39a71,
    weapon: role === 'officer' ? 'smg' : 'rifle',
  };
}

export function getBiomeTint(biomeId) {
  const biome = BIOMES.find((entry) => entry.id === biomeId) || BIOMES[0];
  return biome.vehicleTint;
}
