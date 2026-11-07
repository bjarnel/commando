import * as THREE from 'three';
import { KEY_BINDINGS, GAMEPAD_BINDINGS } from '../config/controls.js';
import { clamp } from '../utils/math.js';

const GAME_KEYS = new Set([
  ...KEY_BINDINGS.forward,
  ...KEY_BINDINGS.backward,
  ...KEY_BINDINGS.left,
  ...KEY_BINDINGS.right,
  ...KEY_BINDINGS.grenade,
  ...KEY_BINDINGS.melee,
  ...KEY_BINDINGS.pause,
  ...KEY_BINDINGS.mute,
  ...KEY_BINDINGS.confirm,
  ...KEY_BINDINGS.weaponSlots.flat(),
]);

/**
 * Normalises keyboard, mouse and standard-mapping gamepad input into a small
 * polling API. Aim can come from either the mouse or the right stick; whichever
 * was used most recently wins.
 */
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = {
      grenade: false,
      melee: false,
      pause: false,
      mute: false,
      confirm: false,
      weaponSlot: 0,
    };

    this.mouseNDC = new THREE.Vector2(0, -0.2);
    this.pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45, inside: true };
    this.mouseMoved = false;
    this.aimMode = 'mouse';

    this.move = { x: 0, z: 0, magnitude: 0 };
    this.aimStick = { x: 0, z: 1, magnitude: 0 };
    this.lastAimStick = { x: 0, z: 1 };
    this.firing = false;
    this.altFiring = false;
    this.enabled = true;

    this.pad = {
      connected: false,
      id: '',
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      previousButtons: [],
      fire: false,
      grenade: false,
    };

    // Input vectors are screen-space: +x is screen-right, +z is up-field.
    // The chase camera looks down +Z, which means world +X appears screen-left;
    // Player and combat code convert screen-space x to world space.

    this.callbacks = {
      onGamepadChange: null,
    };

    this._bind();
    this._pollGamepad();
  }

  _bind() {
    window.addEventListener('keydown', (event) => this._onKeyDown(event), { passive: false });
    window.addEventListener('keyup', (event) => this._onKeyUp(event));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });

    this.canvas.addEventListener('pointermove', (event) => this._onPointerMove(event));
    window.addEventListener('pointermove', (event) => {
      if (!this.pointer.inside) this._onPointerMove(event);
    });
    this.canvas.addEventListener('pointerdown', (event) => this._onPointerDown(event));
    window.addEventListener('pointerup', (event) => this._onPointerUp(event));
    this.canvas.addEventListener('pointerenter', () => {
      this.pointer.inside = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    window.addEventListener('gamepadconnected', (event) => {
      this.pad.connected = true;
      this.pad.id = event.gamepad.id;
      this.callbacks.onGamepadChange?.(true, event.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.pad.connected = false;
      this.pad.id = '';
      this.callbacks.onGamepadChange?.(false, '');
    });
  }

  _onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    if (!this.enabled) return;

    const isRepeat = event.repeat;
    this.keys.add(event.code);

    if (!isRepeat) {
      if (KEY_BINDINGS.grenade.includes(event.code)) this.pressed.grenade = true;
      if (KEY_BINDINGS.melee.includes(event.code)) this.pressed.melee = true;
      if (KEY_BINDINGS.pause.includes(event.code)) this.pressed.pause = true;
      if (KEY_BINDINGS.mute.includes(event.code)) this.pressed.mute = true;
      if (KEY_BINDINGS.confirm.includes(event.code)) this.pressed.confirm = true;
      for (let i = 0; i < KEY_BINDINGS.weaponSlots.length; i++) {
        if (KEY_BINDINGS.weaponSlots[i].includes(event.code)) {
          this.pressed.weaponSlot = i + 1;
        }
      }
    }
  }

  _onKeyUp(event) {
    this.keys.delete(event.code);
  }

  _onPointerMove(event) {
    if (event.pointerType === 'touch') return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    if (this.aimMode !== 'mouse') this.aimMode = 'mouse';
    this.mouseMoved = true;
  }

  _onPointerDown(event) {
    if (!this.enabled) return;
    if (event.button === 0) {
      this.firing = true;
      this.mouseMoved = true;
    } else if (event.button === 2) {
      this.altFiring = true;
      this.pressed.grenade = true;
      event.preventDefault();
    }
  }

  _onPointerUp(event) {
    if (event.button === 0) this.firing = false;
    else if (event.button === 2) this.altFiring = false;
  }

  _readStick(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < deadzone) return { x: 0, y: 0, magnitude: 0 };
    const scaled = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1);
    return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled, magnitude: scaled };
  }

  _pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }

    if (!pad) {
      if (this.pad.connected) {
        this.pad.connected = false;
        this.callbacks.onGamepadChange?.(false, '');
      }
      return;
    }

    if (!this.pad.connected) {
      this.pad.connected = true;
      this.pad.id = pad.id;
      this.callbacks.onGamepadChange?.(true, pad.id);
    }

    const [mx, my] = GAMEPAD_BINDINGS.moveAxes;
    const [ax, ay] = GAMEPAD_BINDINGS.aimAxes;
    const move = this._readStick(pad.axes[mx] || 0, pad.axes[my] || 0, GAMEPAD_BINDINGS.deadzone);
    const aim = this._readStick(pad.axes[ax] || 0, pad.axes[ay] || 0, GAMEPAD_BINDINGS.aimDeadzone);

    this.pad.moveX = move.x;
    this.pad.moveY = -move.y;

    if (aim.magnitude > 0) {
      const aimX = aim.x;
      const aimZ = -aim.y;
      const len = Math.hypot(aimX, aimZ) || 1;
      this.lastAimStick.x = aimX / len;
      this.lastAimStick.z = aimZ / len;
      this.aimStick.x = this.lastAimStick.x;
      this.aimStick.z = this.lastAimStick.z;
      this.aimStick.magnitude = aim.magnitude;
      if (this.aimMode !== 'stick') this.aimMode = 'stick';
    } else {
      this.aimStick.magnitude = 0;
    }

    const fireDown = GAMEPAD_BINDINGS.fire.some((i) => pad.buttons[i]?.pressed);
    this.pad.fire = fireDown;
    const grenadeDown = GAMEPAD_BINDINGS.grenade.some((i) => pad.buttons[i]?.pressed);
    this.pad.grenade = grenadeDown;

    const pressedNow = (index) => Boolean(pad.buttons[index]?.pressed);
    const wasPressed = (index) => Boolean(this.pad.previousButtons[index]);
    if (this.enabled) {
      if (GAMEPAD_BINDINGS.grenade.some((i) => pressedNow(i) && !wasPressed(i))) {
        this.pressed.grenade = true;
      }
      if (GAMEPAD_BINDINGS.melee.some((i) => pressedNow(i) && !wasPressed(i))) {
        this.pressed.melee = true;
      }
      if (GAMEPAD_BINDINGS.pause.some((i) => pressedNow(i) && !wasPressed(i))) {
        this.pressed.pause = true;
      }
      if (GAMEPAD_BINDINGS.confirm.some((i) => pressedNow(i) && !wasPressed(i))) {
        this.pressed.confirm = true;
      }
      for (let i = 0; i < GAMEPAD_BINDINGS.weaponSlots.length; i++) {
        if (
          GAMEPAD_BINDINGS.weaponSlots[i].some(
            (button) => pressedNow(button) && !wasPressed(button)
          )
        ) {
          this.pressed.weaponSlot = i + 1;
        }
      }
    }

    this.pad.previousButtons = pad.buttons.map((button) => button.pressed);
  }

  update() {
    this._pollGamepad();

    let x = 0;
    let z = 0;
    if (KEY_BINDINGS.left.some((key) => this.keys.has(key))) x -= 1;
    if (KEY_BINDINGS.right.some((key) => this.keys.has(key))) x += 1;
    if (KEY_BINDINGS.forward.some((key) => this.keys.has(key))) z += 1;
    if (KEY_BINDINGS.backward.some((key) => this.keys.has(key))) z -= 1;

    let magnitude = Math.hypot(x, z);
    if (magnitude > 1) {
      x /= magnitude;
      z /= magnitude;
      magnitude = 1;
    }

    if (magnitude < 0.01 && this.pad.connected) {
      x = this.pad.moveX;
      z = this.pad.moveY;
      magnitude = clamp(Math.hypot(x, z), 0, 1);
    }

    this.move.x = x;
    this.move.z = z;
    this.move.magnitude = magnitude;
  }

  consume(action) {
    const value = this.pressed[action];
    if (value === undefined || value === false || value === 0) return false;
    this.pressed[action] = false;
    return value;
  }

  isFiring() {
    if (!this.enabled) return false;
    return this.firing || this.pad.fire;
  }

  isAltFiring() {
    if (!this.enabled) return false;
    return this.altFiring || this.pad.grenade;
  }

  clear() {
    this.keys.clear();
    this.firing = false;
    this.altFiring = false;
    this.move.x = 0;
    this.move.z = 0;
    this.move.magnitude = 0;
    this.pressed.grenade = false;
    this.pressed.melee = false;
    this.pressed.pause = false;
    this.pressed.confirm = false;
    this.pressed.mute = false;
    this.pressed.weaponSlot = 0;
    if (this.pad) {
      this.pad.previousButtons = [];
      this.pad.fire = false;
      this.pad.grenade = false;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  getGamepadActive() {
    return this.pad.connected;
  }
}
