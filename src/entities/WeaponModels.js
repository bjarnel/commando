import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGlowTexture } from '../utils/textures.js';

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

function buildBAR() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(0.14, 0.2, 0.52), steel, { x: 0, y: 0.01, z: 0.04 }));
  parts.push(part(new THREE.BoxGeometry(0.2, 0.17, 0.48), wood, { x: 0, y: -0.06, z: -0.2 }));
  parts.push(part(new THREE.BoxGeometry(0.16, 0.19, 0.28), woodDark, { x: 0, y: -0.04, z: -0.52 }));
  parts.push(part(new THREE.BoxGeometry(0.1, 0.12, 0.48), gunmetal, { x: 0, y: 0.02, z: 0.5 }));
  parts.push(
    part(new THREE.CylinderGeometry(0.03, 0.026, 0.72, 7), darkSteel, {
      x: 0,
      y: 0.02,
      z: 1.02,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 6), 0x33392f, {
      x: 0,
      y: 0.02,
      z: 1.4,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.06, 0.12, 0.1), darkSteel, { x: 0, y: -0.14, z: 0.16 }));
  parts.push(part(new THREE.BoxGeometry(0.09, 0.07, 0.16), 0x2b2f27, { x: 0, y: 0.12, z: 0.12 }));
  parts.push(part(new THREE.BoxGeometry(0.07, 0.06, 0.06), accent, { x: 0, y: 0.14, z: -0.02 }));
  for (const side of [-1, 1]) {
    parts.push(
      part(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 5), darkSteel, {
        x: side * 0.12,
        y: -0.19,
        z: 0.86,
      }, { x: 0, y: 0, z: side * 0.28 })
    );
  }
  return { geometry: merge(parts), muzzleZ: 1.46 };
}

function buildM79() {
  const parts = [];
  parts.push(
    part(new THREE.CylinderGeometry(0.07, 0.075, 0.92, 9), gunmetal, {
      x: 0,
      y: 0.02,
      z: 0.56,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(
    part(new THREE.CylinderGeometry(0.095, 0.085, 0.15, 9), steel, {
      x: 0,
      y: 0.02,
      z: 1.04,
    }, { x: Math.PI / 2, y: 0, z: 0 })
  );
  parts.push(part(new THREE.BoxGeometry(0.16, 0.2, 0.34), wood, { x: 0, y: -0.03, z: -0.14 }));
  parts.push(part(new THREE.BoxGeometry(0.14, 0.22, 0.26), woodDark, { x: 0, y: -0.06, z: -0.43 }));
  parts.push(part(new THREE.BoxGeometry(0.23, 0.14, 0.12), darkSteel, { x: 0, y: 0.02, z: 0.02 }));
  parts.push(part(new THREE.BoxGeometry(0.06, 0.12, 0.12), darkSteel, { x: 0, y: -0.14, z: 0.18 }));
  parts.push(part(new THREE.BoxGeometry(0.07, 0.07, 0.08), steel, { x: 0, y: 0.13, z: 0.22 }));
  parts.push(part(new THREE.BoxGeometry(0.08, 0.05, 0.06), accent, { x: 0, y: 0.13, z: -0.04 }));
  return { geometry: merge(parts), muzzleZ: 1.15 };
}

const BUILDERS = {
  m60: buildM60,
  m16: buildM16,
  m870: buildM870,
  m14: buildM14,
  bar: buildBAR,
  m79: buildM79,
};

const GRIPS = {
  m60: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.36 } },
  m16: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.35 } },
  m870: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.35 } },
  m14: { right: { x: 0, y: -0.02, z: 0.1 }, left: { x: 0, y: -0.02, z: 0.36 } },
  bar: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.34 } },
  m79: { right: { x: 0, y: -0.02, z: 0.11 }, left: { x: 0, y: -0.02, z: 0.3 } },
};

const attachmentMaterial = new THREE.MeshStandardMaterial({
  color: 0x30352c,
  roughness: 0.5,
  metalness: 0.5,
});

const attachmentAccentMaterial = new THREE.MeshStandardMaterial({
  color: 0x7d885d,
  roughness: 0.42,
  metalness: 0.38,
});

const ammoMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a6933,
  roughness: 0.44,
  metalness: 0.55,
});

const shellMaterial = new THREE.MeshStandardMaterial({
  color: 0xa84a32,
  roughness: 0.58,
  metalness: 0.24,
});

const scopeLensMaterial = new THREE.MeshBasicMaterial({
  color: 0xa9ddff,
  toneMapped: false,
});

const laserDiodeMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3b27,
  toneMapped: false,
});

const laserBeamMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3220,
  transparent: true,
  opacity: 0.28,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

let laserDotMaterial = null;
function getLaserDotMaterial() {
  if (!laserDotMaterial) {
    laserDotMaterial = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: 0xff4a2e,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }
  return laserDotMaterial;
}

const attachmentGeometries = {
  rail: new THREE.BoxGeometry(0.055, 0.03, 0.28),
  grip: new THREE.BoxGeometry(0.055, 0.16, 0.075),
  mag: new THREE.BoxGeometry(0.085, 0.19, 0.115),
  scopeTube: new THREE.CylinderGeometry(0.036, 0.036, 0.28, 8),
  scopeLens: new THREE.CylinderGeometry(0.042, 0.042, 0.022, 8),
  laserBox: new THREE.BoxGeometry(0.065, 0.055, 0.13),
  laserLens: new THREE.CylinderGeometry(0.019, 0.019, 0.022, 8),
  laserBeam: new THREE.CylinderGeometry(0.006, 0.0045, 40, 5, 1, true),
  drum: new THREE.CylinderGeometry(0.09, 0.09, 0.075, 10),
  sideBox: new THREE.BoxGeometry(0.11, 0.13, 0.18),
  shroud: new THREE.CylinderGeometry(0.057, 0.05, 0.2, 8),
  bipodLeg: new THREE.CylinderGeometry(0.009, 0.008, 0.2, 4),
  shell: new THREE.CylinderGeometry(0.012, 0.012, 0.09, 5),
  accentPlate: new THREE.BoxGeometry(0.12, 0.045, 0.08),
};

const attachmentAnchors = {
  m60: {
    rail: [0, 0.165, 0.1],
    grip: [0, -0.12, 0.58],
    mag: [0.15, -0.11, 0.03],
    scope: [0, 0.235, 0.08],
    laser: [0, 0.15, 0.46],
    drum: [0.16, -0.08, 0.07],
    barrel: [0, 0.02, 0.95],
  },
  m16: {
    rail: [0, 0.145, 0.08],
    grip: [0, -0.12, 0.55],
    mag: [0, -0.18, 0.14],
    scope: [0, 0.215, 0.06],
    laser: [0, 0.13, 0.42],
    drum: [0.14, -0.09, 0.02],
    barrel: [0, 0.01, 0.95],
  },
  m870: {
    rail: [0, 0.15, 0.1],
    grip: [0, -0.12, 0.5],
    mag: [0.14, -0.04, -0.03],
    scope: [0, 0.22, 0.08],
    laser: [0, 0.14, 0.44],
    drum: [0.15, -0.07, 0.0],
    barrel: [0, 0.055, 0.88],
  },
  m14: {
    rail: [0, 0.165, 0.1],
    grip: [0, -0.12, 0.6],
    mag: [0, -0.17, 0.04],
    scope: [0, 0.235, 0.08],
    laser: [0, 0.19, 0.46],
    drum: [0.15, -0.08, 0.02],
    barrel: [0, 0.02, 1.16],
  },
  bar: {
    rail: [0, 0.165, 0.08],
    grip: [0, -0.12, 0.6],
    mag: [0.15, -0.12, 0.02],
    scope: [0, 0.235, 0.06],
    laser: [0, 0.15, 0.46],
    drum: [0.16, -0.08, 0.05],
    barrel: [0, 0.02, 1.2],
  },
  m79: {
    rail: [0, 0.15, 0.18],
    grip: [0, -0.12, 0.42],
    mag: [0.15, -0.04, -0.08],
    scope: [0, 0.22, 0.2],
    laser: [0, 0.18, 0.5],
    drum: [0.16, -0.06, 0.05],
    barrel: [0, 0.02, 0.88],
  },
};

const attachmentProfiles = {
  m60: { foregrip: true, drum: true },
  m16: { foregrip: true, extendedMag: true },
  m870: { foregrip: true, shellCarrier: true },
  m14: { scope: true, bipod: true },
  bar: { foregrip: true, drum: true, bipod: true },
  m79: { scope: true, shellCarrier: true },
};

function addAttachment(
  parent,
  geometry,
  material,
  position,
  rotation = null,
  scale = null,
  castShadow = true
) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

function buildAttachments(weaponId, tier) {
  const group = new THREE.Group();
  group.name = 'weapon-attachments';
  if (tier < 1) return group;

  const anchors = attachmentAnchors[weaponId] || attachmentAnchors.m60;
  const profile = attachmentProfiles[weaponId] || {};
  const g = attachmentGeometries;

  // Tier 1: top rail plus a weapon-specific support/feed/sight package.
  addAttachment(group, g.rail, attachmentMaterial, anchors.rail);
  if (profile.foregrip) {
    addAttachment(group, g.grip, attachmentMaterial, anchors.grip);
  }
  if (profile.extendedMag) {
    addAttachment(group, g.mag, attachmentMaterial, anchors.mag);
  }
  if (profile.scope) {
    addAttachment(
      group,
      g.scopeTube,
      attachmentMaterial,
      anchors.scope,
      [Math.PI / 2, 0, 0]
    );
    addAttachment(
      group,
      g.scopeLens,
      scopeLensMaterial,
      [anchors.scope[0], anchors.scope[1], anchors.scope[2] + 0.15],
      [Math.PI / 2, 0, 0],
      null,
      false
    );
    addAttachment(
      group,
      g.accentPlate,
      attachmentAccentMaterial,
      [anchors.scope[0], anchors.scope[1] - 0.06, anchors.scope[2] - 0.02]
    );
  }
  if (profile.shellCarrier) {
    addAttachment(group, g.sideBox, attachmentMaterial, anchors.mag);
    for (let i = 0; i < 3; i++) {
      addAttachment(
        group,
        g.shell,
        shellMaterial,
        [anchors.mag[0] + 0.06, anchors.mag[1] + 0.02, anchors.mag[2] - 0.06 + i * 0.06]
      );
    }
  }
  if (profile.bipod) {
    for (const side of [-1, 1]) {
      addAttachment(
        group,
        g.bipodLeg,
        attachmentMaterial,
        [side * 0.045, anchors.grip[1] - 0.02, anchors.grip[2] - 0.04],
        [0, 0, side * 0.24]
      );
    }
  }

  // Tier 2: laser module, visible red beam and a distant dot.
  if (tier >= 2) {
    const laser = anchors.laser;
    addAttachment(group, g.laserBox, attachmentMaterial, laser);
    addAttachment(
      group,
      g.laserLens,
      laserDiodeMaterial,
      [laser[0], laser[1], laser[2] + 0.08],
      [Math.PI / 2, 0, 0],
      null,
      false
    );
    const beamStart = laser[2] + 0.1;
    const beam = addAttachment(
      group,
      g.laserBeam,
      laserBeamMaterial,
      [laser[0], laser[1], beamStart + 20],
      [Math.PI / 2, 0, 0],
      null,
      false
    );
    beam.renderOrder = 4;
    const dot = new THREE.Sprite(getLaserDotMaterial());
    dot.position.set(laser[0], laser[1], beamStart + 40);
    dot.scale.set(0.22, 0.22, 1);
    group.add(dot);
  }

  // Tier 3: bulky feed hardware and a reinforced barrel shroud.
  if (tier >= 3) {
    if (profile.drum) {
      addAttachment(
        group,
        g.drum,
        ammoMaterial,
        anchors.drum,
        [0, 0, Math.PI / 2]
      );
    } else {
      addAttachment(group, g.sideBox, ammoMaterial, anchors.drum);
    }
    addAttachment(
      group,
      g.shroud,
      attachmentMaterial,
      anchors.barrel,
      [Math.PI / 2, 0, 0]
    );
    addAttachment(
      group,
      g.accentPlate,
      attachmentAccentMaterial,
      [anchors.barrel[0], anchors.barrel[1] + 0.055, anchors.barrel[2] - 0.12]
    );
  }

  return group;
}

export function getWeaponVisual(id, options = {}) {
  const tier = Math.max(0, Math.min(3, Math.floor(options.tier || 0)));
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

  mesh.add(buildAttachments(id, tier));

  return {
    id,
    mesh,
    muzzleZ,
    grips: GRIPS[id] || GRIPS.m60,
    pivot: { x: 0.06, y: 1.31, z: 0.24 },
    tier,
  };
}
