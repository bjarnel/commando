import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const geometryCache = new Map();

const weaponMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.46,
  metalness: 0.5,
});

const sightMaterial = new THREE.MeshBasicMaterial({
  color: 0xa8ffd0,
  toneMapped: false,
});

function transform(geometry, position, rotation, scale) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0)
    ),
    new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function colorize(geometry, hex) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function part(geometry, hex, position, rotation, scale) {
  transform(geometry, position, rotation, scale);
  colorize(geometry, hex);
  return geometry;
}

function merge(parts) {
  const normalized = parts.map((item) => {
    if (!item.index) return item;
    const flat = item.toNonIndexed();
    item.dispose();
    return flat;
  });
  const geometry = mergeGeometries(normalized, false);
  normalized.forEach((item) => item.dispose());
  return geometry || new THREE.BufferGeometry();
}

const steel = 0x272b25;
const darkSteel = 0x171b17;
const gunmetal = 0x394039;
const wood = 0x604527;
const woodDark = 0x412d18;
const brass = 0xb18a4b;
const accent = 0x8ba26a;

function buildM60() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(0.16, 0.2, 0.58), steel, { x: 0, y: 0.01, z: 0.04 }));
  parts.push(part(new THREE.BoxGeometry(0.14, 0.17, 0.34), darkSteel, { x: 0, y: 0.01, z: -0.3 }));
  parts.push(part(new THREE.BoxGeometry(0.12, 0.1, 0.42), gunmetal, { x: 0, y: 0.02, z: 0.38 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 7), darkSteel, {
      x: 0,
      y: 0.02,
      z: 0.81,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.052, 0.052, 0.15, 7), steel, {
      x: 0,
      y: 0.02,
      z: 1.08,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.055, 0.05, 0.24), 0x50574a, { x: 0, y: 0.115, z: 0.1 }));
  parts.push(part(new THREE.BoxGeometry(0.15, 0.24, 0.24), 0x3b3b2a, { x: 0.13, y: -0.13, z: 0.03 }));
  parts.push(part(new THREE.BoxGeometry(0.08, 0.07, 0.08), brass, { x: 0.13, y: -0.02, z: 0.03 }));
  parts.push(part(new THREE.BoxGeometry(0.1, 0.17, 0.11), woodDark, { x: 0, y: -0.08, z: -0.16 }));
  parts.push(part(new THREE.BoxGeometry(0.18, 0.12, 0.08), wood, { x: 0, y: -0.02, z: 0.215 }));
  parts.push(part(new THREE.BoxGeometry(0.1, 0.055, 0.08), accent, { x: 0, y: 0.13, z: 0.02 }));
  for (const side of [-1, 1]) {
    parts.push(
      part(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 5), darkSteel, {
        x: side * 0.13,
        y: -0.18,
        z: 0.66,
      }, { x: 0, y: 0, z: side * 0.28 })
    );
  }
  return { geometry: merge(parts), muzzleZ: 1.16 };
}

function buildM16() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(0.12, 0.17, 0.44), steel, { x: 0, y: 0, z: 0.03 }));
  parts.push(part(new THREE.BoxGeometry(0.13, 0.08, 0.26), darkSteel, { x: 0, y: 0.1, z: 0.04 }));
  parts.push(part(new THREE.BoxGeometry(0.09, 0.13, 0.42), gunmetal, { x: 0, y: 0.005, z: 0.42 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.024, 0.024, 0.46, 6), 0x20251f, {
      x: 0,
      y: 0.01,
      z: 0.84,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.04, 0.04, 0.13, 6), 0x333b31, {
      x: 0,
      y: 0.01,
      z: 1.1,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.075, 0.21, 0.12), darkSteel, { x: 0, y: -0.15, z: 0.15 }, { x: 0, y: 0, z: 0.14 }));
  parts.push(part(new THREE.BoxGeometry(0.14, 0.22, 0.24), 0x2b2f27, { x: 0, y: -0.02, z: -0.27 }));
  parts.push(part(new THREE.BoxGeometry(0.11, 0.15, 0.28), 0x343a31, { x: 0, y: -0.06, z: -0.43 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0.8, z: 1 }));
  parts.push(part(new THREE.BoxGeometry(0.075, 0.045, 0.22), 0x454b3d, { x: 0, y: 0.12, z: 0.08 }));
  parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.06), accent, { x: 0, y: 0.15, z: 0.02 }));
  return { geometry: merge(parts), muzzleZ: 1.17 };
}

function buildM870() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(0.13, 0.19, 0.5), 0x343a30, { x: 0, y: 0, z: 0.05 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.045, 0.045, 0.76, 7), darkSteel, {
      x: 0,
      y: 0.055,
      z: 0.73,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.025, 0.025, 0.64, 6), 0x2b2e27, {
      x: 0,
      y: -0.055,
      z: 0.68,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.18, 0.17, 0.34), wood, { x: 0, y: -0.08, z: 0.38 }));
  parts.push(part(new THREE.BoxGeometry(0.2, 0.18, 0.4), woodDark, { x: 0, y: -0.02, z: -0.3 }));
  parts.push(part(new THREE.BoxGeometry(0.14, 0.14, 0.15), 0x3a3a2a, { x: 0, y: 0.03, z: -0.12 }));
  parts.push(part(new THREE.BoxGeometry(0.06, 0.1, 0.1), accent, { x: 0, y: 0.13, z: 0.04 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 7), 0x41453a, {
      x: 0,
      y: 0.055,
      z: 1.01,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  return { geometry: merge(parts), muzzleZ: 1.08 };
}

function buildM14() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(0.12, 0.18, 0.56), steel, { x: 0, y: 0, z: 0.04 }));
  parts.push(part(new THREE.BoxGeometry(0.2, 0.18, 0.72), wood, { x: 0, y: -0.07, z: -0.18 }));
  parts.push(part(new THREE.BoxGeometry(0.16, 0.18, 0.3), woodDark, { x: 0, y: -0.02, z: -0.5 }));
  parts.push(part(new THREE.BoxGeometry(0.11, 0.13, 0.4), gunmetal, { x: 0, y: 0.015, z: 0.48 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.026, 0.022, 0.62, 7), darkSteel, {
      x: 0,
      y: 0.02,
      z: 0.99,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), 0x33392f, {
      x: 0,
      y: 0.02,
      z: 1.32,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), 0x1f241d, {
      x: 0,
      y: 0.18,
      z: 0.15,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.06, 0.08, 0.16), 0x3a4034, { x: 0, y: 0.02, z: 0.15 }));
  parts.push(part(new THREE.BoxGeometry(0.06, 0.13, 0.1), accent, { x: 0, y: 0.13, z: -0.02 }));
  parts.push(part(new THREE.BoxGeometry(0.12, 0.18, 0.16), 0x35372c, { x: 0, y: -0.15, z: 0.03 }));
  return { geometry: merge(parts), muzzleZ: 1.4 };
}

const BUILDERS = {
  m60: buildM60,
  m16: buildM16,
  m870: buildM870,
  m14: buildM14,
};

const GRIPS = {
  m60: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.36 } },
  m16: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.35 } },
  m870: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.35 } },
  m14: { right: { x: 0, y: -0.02, z: 0.1 }, left: { x: 0, y: -0.02, z: 0.36 } },
};

export function getWeaponVisual(id) {
  const builder = BUILDERS[id] || BUILDERS.m60;
  if (!geometryCache.has(id)) geometryCache.set(id, builder());
  const { geometry, muzzleZ } = geometryCache.get(id);

  const mesh = new THREE.Group();
  const weaponMesh = new THREE.Mesh(geometry, weaponMaterial);
  weaponMesh.castShadow = true;
  mesh.add(weaponMesh);

  const sight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), sightMaterial);
  sight.position.set(0, 0.15, id === 'm14' ? 0.22 : 0.05);
  mesh.add(sight);

  return {
    id,
    mesh,
    muzzleZ,
    grips: GRIPS[id] || GRIPS.m60,
    pivot: { x: 0.06, y: 1.31, z: 0.24 },
  };
}
