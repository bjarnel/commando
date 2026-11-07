import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getSparkTexture } from '../utils/textures.js';
import { clamp, clamp01, damp, dampAngle } from '../utils/math.js';

/**
 * Procedural low-poly soldier. Meshes are cached/merged per colour scheme, and
 * the arms are jointed two-bone chains solved toward the weapon grips every
 * frame so the hands visibly hold the gun instead of floating at chest height.
 *
 * The rig faces +Z; callers rotate the root toward their aim vector.
 */

const geometryCache = new Map();

const ARM_UPPER_LENGTH = 0.35;
const ARM_LOWER_LENGTH = 0.38;
const DOWN = new THREE.Vector3(0, -1, 0);
const MELEE_RIGHT_TARGET = new THREE.Vector3(0.14, 1.4, 0.98);
const MELEE_LEFT_TARGET = new THREE.Vector3(-0.16, 1.3, 0.64);

const bodyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.83,
  metalness: 0.03,
});

const gearMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.5,
  metalness: 0.45,
});

let flashMaterial = null;
function getFlashMaterial() {
  if (!flashMaterial) {
    flashMaterial = new THREE.SpriteMaterial({
      map: getSparkTexture(),
      color: 0xffd79b,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
      toneMapped: false,
    });
  }
  return flashMaterial;
}

function transform(geometry, position, rotation, scale) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0)
    ),
    new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function colored(geometry, hex) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function part(geometry, hex, position, rotation, scale) {
  transform(geometry, position, rotation, scale);
  colored(geometry, hex);
  return geometry;
}

function merge(parts) {
  const normalized = parts.map((item) => {
    if (!item.index) return item;
    const flat = item.toNonIndexed();
    item.dispose();
    return flat;
  });
  const result = mergeGeometries(normalized, false);
  normalized.forEach((item) => item.dispose());
  if (!result) {
    console.error('[SoldierRig] Geometry merge failed.');
    return new THREE.BufferGeometry();
  }
  return result;
}

function buildRigGeometries(style) {
  const {
    uniform,
    uniformDark,
    vest,
    accent,
    skin,
    helmet,
    headgear = 'helmet',
    weapon = 'rifle',
    radio = false,
  } = style;

  /* ------------------------------ torso ------------------------------ */
  const torsoParts = [];
  torsoParts.push(
    part(
      new THREE.CapsuleGeometry(0.25, 0.42, 5, 10),
      uniform,
      { x: 0, y: 1.3, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1.12, y: 1, z: 0.74 }
    )
  );
  // Plate carrier / webbing.
  torsoParts.push(
    part(
      new THREE.CapsuleGeometry(0.255, 0.26, 4, 9),
      vest,
      { x: 0, y: 1.34, z: 0.01 },
      { x: 0, y: 0, z: 0 },
      { x: 1.12, y: 1, z: 0.8 }
    )
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.5, 0.09, 0.38), uniformDark, { x: 0, y: 1.0, z: 0 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.1, 0.16, 0.06), accent, { x: -0.19, y: 1.45, z: 0.205 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.16, 0.14, 0.12), vest, { x: 0.2, y: 1.36, z: 0.17 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.2, 0.2, 0.12), vest, { x: -0.18, y: 1.3, z: 0.16 })
  );
  // Backpack.
  torsoParts.push(
    part(new THREE.BoxGeometry(0.4, 0.48, 0.22), uniformDark, { x: 0, y: 1.32, z: -0.28 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.32, 0.18, 0.1), vest, { x: 0, y: 1.18, z: -0.4 })
  );
  if (radio) {
    torsoParts.push(
      part(new THREE.CylinderGeometry(0.028, 0.028, 0.66, 5), 0x1a1d18, { x: -0.22, y: 1.82, z: -0.29 })
    );
    torsoParts.push(
      part(new THREE.SphereGeometry(0.045, 6, 5), accent, { x: -0.22, y: 2.15, z: -0.29 })
    );
  }
  // Neck + head.
  torsoParts.push(
    part(new THREE.CylinderGeometry(0.085, 0.1, 0.13, 7), skin, { x: 0, y: 1.64, z: 0 })
  );
  torsoParts.push(
    part(new THREE.SphereGeometry(0.17, 10, 8), skin, {
      x: 0,
      y: 1.8,
      z: 0.012,
    }, null, { x: 1, y: 1.06, z: 0.96 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.26, 0.055, 0.06), 0x1b1e18, { x: 0, y: 1.83, z: 0.145 })
  );
  torsoParts.push(
    part(new THREE.BoxGeometry(0.055, 0.055, 0.05), skin, { x: 0, y: 1.765, z: 0.17 })
  );

  if (headgear === 'beret') {
    torsoParts.push(
      part(new THREE.SphereGeometry(0.215, 12, 8), accent, {
        x: -0.02,
        y: 1.94,
        z: -0.015,
      }, { x: 0, y: 0, z: -0.12 }, { x: 1.25, y: 0.52, z: 1.1 })
    );
    torsoParts.push(
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 5), accent, { x: 0.1, y: 2.02, z: 0 })
    );
  } else if (headgear === 'cap') {
    torsoParts.push(
      part(new THREE.SphereGeometry(0.19, 10, 7), helmet, {
        x: 0,
        y: 1.94,
        z: -0.02,
      }, { x: 0, y: 0, z: 0 }, { x: 1.2, y: 0.62, z: 1.1 })
    );
    torsoParts.push(
      part(new THREE.BoxGeometry(0.3, 0.04, 0.2), helmet, { x: 0, y: 1.88, z: 0.19 })
    );
    torsoParts.push(
      part(new THREE.BoxGeometry(0.13, 0.05, 0.03), accent, { x: 0, y: 1.95, z: 0.18 })
    );
  } else {
    torsoParts.push(
      part(new THREE.SphereGeometry(0.205, 11, 8), helmet, {
        x: 0,
        y: 1.92,
        z: -0.005,
      }, { x: 0, y: 0, z: 0 }, { x: 1.05, y: 0.75, z: 1.04 })
    );
    torsoParts.push(
      part(new THREE.CylinderGeometry(0.225, 0.235, 0.045, 10), helmet, { x: 0, y: 1.875, z: 0.015 })
    );
    torsoParts.push(
      part(new THREE.BoxGeometry(0.3, 0.055, 0.06), accent, { x: 0, y: 1.93, z: 0.17 })
    );
  }

  /* ------------------------------- legs ------------------------------- */
  const buildLeg = (side) => {
    const parts = [];
    parts.push(
      part(new THREE.CapsuleGeometry(0.095, 0.25, 4, 7), uniform, { x: 0, y: -0.22, z: 0 })
    );
    parts.push(
      part(new THREE.SphereGeometry(0.102, 7, 5), vest, { x: side * 0.011, y: -0.42, z: 0.02 })
    );
    parts.push(
      part(new THREE.CapsuleGeometry(0.078, 0.26, 4, 7), uniformDark, { x: 0, y: -0.56, z: 0 })
    );
    parts.push(
      part(new THREE.BoxGeometry(0.17, 0.16, 0.32), 0x26251c, { x: 0, y: -0.79, z: 0.06 })
    );
    parts.push(
      part(new THREE.BoxGeometry(0.15, 0.035, 0.3), 0x4d4b36, { x: 0, y: -0.87, z: 0.06 })
    );
    parts.push(
      part(new THREE.BoxGeometry(0.16, 0.11, 0.16), vest, { x: 0, y: -0.5, z: 0.04 })
    );
    return merge(parts);
  };

  /* --------------------------- jointed arms --------------------------- */
  // Upper arm extends from the shoulder to the elbow. A small accent pad reads
  // clearly from the top-down camera.
  const upperArmParts = [];
  upperArmParts.push(
    part(
      new THREE.CapsuleGeometry(0.075, 0.22, 4, 7),
      uniform,
      { x: 0, y: -0.165, z: 0 }
    )
  );
  upperArmParts.push(
    part(new THREE.BoxGeometry(0.145, 0.045, 0.145), accent, { x: 0, y: -0.09, z: 0.012 })
  );
  upperArmParts.push(
    part(new THREE.SphereGeometry(0.078, 7, 5), vest, { x: 0, y: -0.345, z: 0.01 })
  );
  const armUpperGeometry = merge(upperArmParts);

  // Forearm extends from the elbow to the glove; the local origin is the elbow.
  const forearmParts = [];
  forearmParts.push(
    part(
      new THREE.CapsuleGeometry(0.061, 0.22, 4, 7),
      uniformDark,
      { x: 0, y: -0.175, z: 0 }
    )
  );
  forearmParts.push(
    part(new THREE.BoxGeometry(0.15, 0.08, 0.14), vest, { x: 0, y: -0.285, z: 0.01 })
  );
  forearmParts.push(
    part(new THREE.BoxGeometry(0.12, 0.07, 0.12), uniform, { x: 0, y: -0.33, z: 0 })
  );
  forearmParts.push(
    part(new THREE.SphereGeometry(0.09, 8, 6), 0x5a452f, { x: 0, y: -0.38, z: 0.025 }, null, { x: 1.2, y: 0.9, z: 1 })
  );
  forearmParts.push(
    part(new THREE.BoxGeometry(0.04, 0.08, 0.06), 0x3a2e20, { x: 0.075, y: -0.36, z: 0.035 })
  );
  const armForearmGeometry = merge(forearmParts);

  /* ------------------------------ rifle ------------------------------- */
  const rifleParts = [];
  if (weapon !== 'none') {
    const long = weapon === 'rifle';
    rifleParts.push(
      part(new THREE.BoxGeometry(0.095, 0.15, long ? 0.6 : 0.42), 0x252820, { x: 0, y: 0, z: long ? 0.2 : 0.1 })
    );
    rifleParts.push(
      part(new THREE.CylinderGeometry(0.026, 0.026, long ? 0.55 : 0.35, 6), 0x181b16, {
        x: 0,
        y: 0.015,
        z: long ? 0.78 : 0.48,
      }, { x: Math.PI / 2, y: 0, z: 0 })
    );
    rifleParts.push(
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 6), 0x2f332a, {
        x: 0,
        y: 0.03,
        z: long ? 1.02 : 0.66,
      }, { x: Math.PI / 2, y: 0, z: 0 })
    );
    rifleParts.push(
      part(new THREE.BoxGeometry(0.075, 0.22, 0.14), 0x22251e, { x: 0, y: -0.14, z: 0.24 })
    );
    rifleParts.push(
      part(new THREE.BoxGeometry(0.08, 0.12, 0.22), 0x3a3529, { x: 0, y: -0.02, z: -0.15 })
    );
    rifleParts.push(
      part(new THREE.BoxGeometry(0.06, 0.08, 0.24), 0x33352c, { x: 0, y: 0.11, z: 0.18 })
    );
    rifleParts.push(
      part(new THREE.BoxGeometry(0.09, 0.055, 0.05), accent, { x: 0, y: 0.08, z: -0.05 })
    );
  }
  const rifleGeometry = rifleParts.length ? merge(rifleParts) : null;

  return {
    torso: merge(torsoParts),
    legLeft: buildLeg(-1),
    legRight: buildLeg(1),
    armUpper: armUpperGeometry,
    armForearm: armForearmGeometry,
    rifle: rifleGeometry,
    muzzleZ: weapon === 'rifle' ? 1.08 : weapon === 'smg' ? 0.72 : 0.4,
  };
}

function getRigGeometries(style) {
  const key = [
    style.uniform,
    style.uniformDark,
    style.vest,
    style.accent,
    style.skin,
    style.helmet,
    style.headgear,
    style.weapon,
    style.radio ? 1 : 0,
  ].join('-');
  if (!geometryCache.has(key)) {
    geometryCache.set(key, buildRigGeometries(style));
  }
  return geometryCache.get(key);
}

export class SoldierRig {
  constructor(style) {
    this.style = style;
    this.geometries = getRigGeometries(style);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.torso = new THREE.Mesh(this.geometries.torso, bodyMaterial);
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.body.add(this.torso);

    this.legLeft = new THREE.Mesh(this.geometries.legLeft, bodyMaterial);
    this.legLeft.position.set(-0.14, 0.94, 0);
    this.legLeft.castShadow = true;
    this.body.add(this.legLeft);

    this.legRight = new THREE.Mesh(this.geometries.legRight, bodyMaterial);
    this.legRight.position.set(0.14, 0.94, 0);
    this.legRight.castShadow = true;
    this.body.add(this.legRight);

    const buildArmChain = (side) => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.34, 1.45, 0.02);
      const upperMesh = new THREE.Mesh(this.geometries.armUpper, bodyMaterial);
      upperMesh.castShadow = true;
      upper.add(upperMesh);

      const lower = new THREE.Group();
      lower.position.set(0, -ARM_UPPER_LENGTH, 0);
      const lowerMesh = new THREE.Mesh(this.geometries.armForearm, bodyMaterial);
      lowerMesh.castShadow = true;
      lower.add(lowerMesh);
      upper.add(lower);
      this.body.add(upper);
      return { upper, lower, upperMesh, lowerMesh };
    };

    const leftChain = buildArmChain(-1);
    const rightChain = buildArmChain(1);
    this.leftChain = leftChain;
    this.rightChain = rightChain;
    this.armLeft = leftChain.upper;
    this.forearmLeft = leftChain.lower;
    this.armRight = rightChain.upper;
    this.forearmRight = rightChain.lower;
    this.armLeftMesh = leftChain.upperMesh;
    this.armRightMesh = rightChain.upperMesh;
    this.forearmLeftMesh = leftChain.lowerMesh;
    this.forearmRightMesh = rightChain.lowerMesh;

    this.riflePivot = new THREE.Group();
    this.riflePivot.position.set(0.06, 1.31, 0.24);
    this.body.add(this.riflePivot);

    if (this.geometries.rifle) {
      this.rifle = new THREE.Mesh(this.geometries.rifle, gearMaterial);
      this.rifle.castShadow = true;
      this.riflePivot.add(this.rifle);
    }

    this.muzzlePoint = new THREE.Object3D();
    this.muzzlePoint.position.set(0, 0.02, this.geometries.muzzleZ);
    this.riflePivot.add(this.muzzlePoint);

    this.flash = new THREE.Sprite(getFlashMaterial());
    this.flash.position.copy(this.muzzlePoint.position);
    this.flash.scale.setScalar(0.8);
    this.flash.visible = false;
    this.riflePivot.add(this.flash);

    this.hasWeapon = Boolean(this.geometries.rifle);
    this.customWeapon = null;
    this.gripRight = new THREE.Vector3(0, -0.02, 0.11);
    this.gripLeft = new THREE.Vector3(0, -0.02, 0.35);
    this._weaponBaseOffset = new THREE.Vector3(0.06, 1.31, 0.24);

    this.phase = Math.random() * Math.PI * 2;
    this.time = Math.random() * 20;
    this.flashTimer = 0;
    this.recoil = 0;
    this._muzzleWorld = new THREE.Vector3();

    // Reusable IK math scratch.
    this._ikTarget = new THREE.Vector3();
    this._ikRightTarget = new THREE.Vector3();
    this._ikLeftTarget = new THREE.Vector3();
    this._ikShoulder = new THREE.Vector3();
    this._ikDir = new THREE.Vector3();
    this._ikHint = new THREE.Vector3();
    this._ikPerp = new THREE.Vector3();
    this._ikElbow = new THREE.Vector3();
    this._ikUpperDir = new THREE.Vector3();
    this._ikLowerDir = new THREE.Vector3();
    this._ikQuatUpper = new THREE.Quaternion();
    this._ikQuatLowerWorld = new THREE.Quaternion();
    this._ikQuatLowerLocal = new THREE.Quaternion();
    this._ikQuatInverse = new THREE.Quaternion();

    this._setWeaponGrips();
    this._solveArms(0.016);
  }

  equipWeapon(visual, options = {}) {
    if (this.customWeapon) {
      this.riflePivot.remove(this.customWeapon.mesh);
      this.customWeapon = null;
    }
    if (this.rifle) this.rifle.visible = false;
    if (!visual?.mesh) {
      this.hasWeapon = false;
      return;
    }
    this.customWeapon = visual;
    visual.mesh.castShadow = true;
    this.riflePivot.add(visual.mesh);
    this.hasWeapon = true;
    this._weaponBaseOffset.set(
      visual.pivot?.x ?? 0.06,
      visual.pivot?.y ?? 1.31,
      visual.pivot?.z ?? 0.24
    );
    const grips = visual.grips || {};
    this.gripRight.set(
      grips.right?.x ?? 0,
      grips.right?.y ?? -0.02,
      grips.right?.z ?? 0.11
    );
    this.gripLeft.set(
      grips.left?.x ?? 0,
      grips.left?.y ?? -0.02,
      grips.left?.z ?? 0.35
    );
    this.muzzlePoint.position.set(0, options.muzzleY ?? 0.02, visual.muzzleZ ?? 1.08);
    this.flash.position.copy(this.muzzlePoint.position);
    this._setWeaponGrips();
  }

  _setWeaponGrips() {
    if (this.hasWeapon) {
      this._ikRightTarget.set(
        this._weaponBaseOffset.x + this.gripRight.x,
        this._weaponBaseOffset.y + this.gripRight.y,
        this._weaponBaseOffset.z + this.gripRight.z
      );
      this._ikLeftTarget.set(
        this._weaponBaseOffset.x + this.gripLeft.x,
        this._weaponBaseOffset.y + this.gripLeft.y,
        this._weaponBaseOffset.z + this.gripLeft.z
      );
    } else {
      // No firearm: a low, ready hand pose for mortar crews and spotters.
      this._ikRightTarget.set(0.26, 1.16, 0.25);
      this._ikLeftTarget.set(-0.22, 1.19, 0.3);
    }
  }

  _solveArm(chain, target, bendSide) {
    const upper = chain.upper;
    const lower = chain.lower;
    const shoulder = upper.position;
    const L1 = ARM_UPPER_LENGTH;
    const L2 = ARM_LOWER_LENGTH;
    const dir = this._ikDir.copy(target).sub(shoulder);
    let distance = dir.length();
    if (distance < 0.001) return;
    dir.multiplyScalar(1 / distance);
    distance = clamp(distance, 0.18, L1 + L2 - 0.002);

    const along = (L1 * L1 - L2 * L2 + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, L1 * L1 - along * along));

    // Keep elbows out to the side and a little low — a natural rifle carry.
    const hint = this._ikHint.set(bendSide * 0.9, -0.45, -0.25);
    hint.addScaledVector(dir, -hint.dot(dir));
    if (hint.lengthSq() < 0.0001) hint.set(0, -1, 0);
    hint.normalize();

    const elbow = this._ikElbow
      .copy(shoulder)
      .addScaledVector(dir, along)
      .addScaledVector(hint, height);
    const upperDir = this._ikUpperDir.copy(elbow).sub(shoulder).normalize();
    const lowerDir = this._ikLowerDir.copy(target).sub(elbow).normalize();

    this._ikQuatUpper.setFromUnitVectors(DOWN, upperDir);
    this._ikQuatLowerWorld.setFromUnitVectors(DOWN, lowerDir);
    this._ikQuatInverse.copy(this._ikQuatUpper).invert();
    this._ikQuatLowerLocal
      .copy(this._ikQuatInverse)
      .multiply(this._ikQuatLowerWorld);

    upper.quaternion.copy(this._ikQuatUpper);
    lower.quaternion.copy(this._ikQuatLowerLocal);
  }

  _solveArms(dt, throwPose = 0, meleePose = 0) {
    // The gun and both hands live in body space. Pulling the rifle back on
    // recoil or lifting the throwing hand makes the IK follow automatically.
    if (this.hasWeapon) {
      this._ikRightTarget.set(
        this._weaponBaseOffset.x + this.gripRight.x,
        this._weaponBaseOffset.y + this.gripRight.y,
        this._weaponBaseOffset.z + this.gripRight.z
      );
      this._ikLeftTarget.set(
        this._weaponBaseOffset.x + this.gripLeft.x,
        this._weaponBaseOffset.y + this.gripLeft.y,
        this._weaponBaseOffset.z + this.gripLeft.z
      );
      this._ikRightTarget.z -= this.recoil * 0.07;
      this._ikLeftTarget.z -= this.recoil * 0.07;
      if (throwPose > 0) {
        this._ikRightTarget.lerp(
          new THREE.Vector3(0.3, 1.92, 0.02),
          clamp01(throwPose)
        );
      }
      if (meleePose > 0) {
        const pose = clamp01(meleePose);
        this._ikRightTarget.lerp(MELEE_RIGHT_TARGET, pose);
        this._ikLeftTarget.lerp(MELEE_LEFT_TARGET, pose * 0.85);
      }
    } else {
      this._setWeaponGrips();
    }
    this._solveArm(this.leftChain, this._ikLeftTarget, -1);
    this._solveArm(this.rightChain, this._ikRightTarget, 1);
  }

  setColors() {
    // Colours are baked into cached geometry. Build a new style for a new team.
  }

  triggerMuzzleFlash() {
    this.flashTimer = 0.055;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.recoil = 1;
  }

  getMuzzleWorldPosition(out = this._muzzleWorld) {
    this.muzzlePoint.getWorldPosition(out);
    return out;
  }

  faceAngle(angle, dt = 0.016, speed = 15) {
    this.root.rotation.y = dampAngle(this.root.rotation.y, angle, speed, dt);
  }

  update(dt, options = {}) {
    const { speed = 0, aiming = true, recoil = 0, throwPose = 0, meleePose = 0 } = options;
    this.time += dt;
    this.recoil = Math.max(this.recoil, clamp01(recoil));
    this.recoil = damp(this.recoil, 0, 14, dt);
    const moving = speed > 0.15;
    const stride = clamp(speed / 5.2, 0, 1);
    this.phase += dt * (moving ? 4.2 + speed * 0.8 : 1.2);

    const legSwing = moving ? Math.sin(this.phase) * 0.62 * stride : 0;
    this.legLeft.rotation.x = damp(this.legLeft.rotation.x, legSwing, 12, dt);
    this.legRight.rotation.x = damp(this.legRight.rotation.x, -legSwing, 12, dt);

    const bob = moving
      ? Math.abs(Math.sin(this.phase * 2)) * 0.035 * stride
      : Math.sin(this.time * 1.7) * 0.006;
    this.body.position.y = damp(this.body.position.y, bob, 14, dt);
    this.body.rotation.x = damp(
      this.body.rotation.x,
      (moving ? -0.055 * stride : 0) + this.recoil * 0.025,
      10,
      dt
    );
    this.body.rotation.z = damp(
      this.body.rotation.z,
      moving ? Math.sin(this.phase) * 0.025 * stride : 0,
      9,
      dt
    );

    if (this.hasWeapon) {
      const idleSway = Math.sin(this.time * 1.35) * 0.004;
      this.riflePivot.position.set(
        this._weaponBaseOffset.x,
        this._weaponBaseOffset.y + idleSway,
        this._weaponBaseOffset.z - this.recoil * 0.07
      );
      this.riflePivot.rotation.x = -0.02 + this.recoil * 0.02;
      this.riflePivot.rotation.z = 0;
    }

    this._solveArms(dt, throwPose, meleePose);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const t = clamp01(this.flashTimer / 0.055);
      this.flash.visible = true;
      const scale = (0.6 + (1 - t) * 0.45) * (1 + Math.random() * 0.15);
      this.flash.scale.set(scale, scale, 1);
      if (this.flashTimer <= 0) this.flash.visible = false;
    }
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  dispose() {
    this.root.removeFromParent();
  }
}
