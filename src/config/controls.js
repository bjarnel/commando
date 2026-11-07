/**
 * Input mappings. Keyboard uses KeyboardEvent.code values so layout does not
 * matter. Gamepad uses the standard mapping indices.
 */
export const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  grenade: ['KeyG', 'KeyQ'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  confirm: ['Enter', 'NumpadEnter'],
  restart: ['KeyR'],
  weaponSlots: [
    ['Digit1', 'Numpad1'],
    ['Digit2', 'Numpad2'],
    ['Digit3', 'Numpad3'],
    ['Digit4', 'Numpad4'],
  ],
};

export const GAMEPAD_BINDINGS = {
  moveAxes: [0, 1],
  aimAxes: [2, 3],
  fire: [7], // RT
  grenade: [6], // LT
  pause: [9], // Start
  confirm: [0], // A / Cross
  weaponSlots: [[12], [13], [14], [15]], // D-pad up / down / left / right
  deadzone: 0.18,
  aimDeadzone: 0.22,
};

export const CONTROL_HINTS = {
  keyboard: 'KEYBOARD + MOUSE',
  gamepad: 'GAMEPAD ONLINE',
};
