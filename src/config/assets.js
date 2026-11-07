/**
 * Optional external assets. The entire game ships with procedural meshes,
 * textures and audio, so this manifest is empty by default. Drop GLTF/OBJ
 * models or textures into /public/assets, add an entry here, and AssetLoader
 * will load them before boot. Any failure falls back to procedural content.
 *
 * Example:
 * {
 *   models: [
 *     { name: 'player', url: '/assets/models/soldier.glb', type: 'gltf' }
 *   ],
 *   textures: [
 *     { name: 'ground', url: '/assets/textures/ground.jpg' }
 *   ]
 * }
 */
export const ASSET_MANIFEST = {
  models: [],
  textures: [],
  audio: [],
};

export const LOADING_COPY = [
  'CALIBRATING OPTICS',
  'MAPPING THE RIVER LINE',
  'SEEDING THE BATTLEFIELD',
  'SYNCHRONIZING COMMAND NET',
  'READY TO DEPLOY',
];
