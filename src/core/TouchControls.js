/**
 * Dual-stick touch controls for phones and tablets.
 *
 * The left pad writes a screen-space movement vector, the right pad aims and
 * auto-fires while displaced. Buttons queue the same one-shot actions as the
 * keyboard so gameplay code does not need a separate input path.
 */
export class TouchControls {
  constructor(input, callbacks = {}) {
    this.input = input;
    this.callbacks = callbacks;
    this.capable =
      window.matchMedia?.('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints || 0) > 0 ||
      'ontouchstart' in window;
    this.enabled = this.capable;

    this.root = document.querySelector('#touch-controls');
    this.moveZone = document.querySelector('#touch-move');
    this.moveKnob = document.querySelector('#touch-move .touch-knob');
    this.aimZone = document.querySelector('#touch-aim');
    this.aimKnob = document.querySelector('#touch-aim .touch-knob');

    if (!this.capable || !this.root) return;

    document.body.classList.add('touch-capable');
    this._bindStick(this.moveZone, this.moveKnob, (x, y) => {
      this.input.setTouchMove(x, -y);
    }, () => {
      this.input.setTouchMove(0, 0);
    });
    this._bindStick(this.aimZone, this.aimKnob, (x, y) => {
      this.input.setTouchAim(x, -y);
    }, () => {
      this.input.setTouchAim(0, 0);
    });

    this.root.querySelectorAll('[data-touch-action]').forEach((button) => {
      const action = button.dataset.touchAction;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.classList.add('is-pressed');
        if (action === 'pause') {
          this.callbacks.onPause?.();
        } else if (action === 'cycle') {
          this.input.queueWeaponCycle();
        } else if (action === 'interact') {
          this.input.queueInteract();
        } else {
          this.input.queueAction(action);
        }
      });
      const release = () => button.classList.remove('is-pressed');
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
    });

    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  _bindStick(zone, knob, onMove, onEnd) {
    if (!zone || !knob) return;
    let pointerId = null;

    const update = (event) => {
      const rect = zone.getBoundingClientRect();
      const radius = Math.max(20, Math.min(rect.width, rect.height) * 0.36);
      const dx = event.clientX - (rect.left + rect.width * 0.5);
      const dy = event.clientY - (rect.top + rect.height * 0.5);
      const distance = Math.hypot(dx, dy);
      const clamped = Math.min(distance, radius);
      const nx = distance > 0.001 ? (dx / distance) * (clamped / radius) : 0;
      const ny = distance > 0.001 ? (dy / distance) * (clamped / radius) : 0;
      onMove(nx, ny);
      knob.style.transform = `translate3d(${nx * radius}px, ${ny * radius}px, 0)`;
      zone.classList.add('is-active');
    };

    zone.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && !this.enabled) return;
      event.preventDefault();
      pointerId = event.pointerId;
      zone.setPointerCapture?.(pointerId);
      update(event);
    });
    zone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      update(event);
    });
    const finish = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      pointerId = null;
      zone.classList.remove('is-active');
      knob.style.transform = 'translate3d(0, 0, 0)';
      onEnd();
    };
    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
    zone.addEventListener('lostpointercapture', finish);
    zone.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  reset() {
    if (!this.capable) return;
    this.input.setTouchMove(0, 0);
    this.input.setTouchAim(0, 0);
    this.moveZone?.classList.remove('is-active');
    this.aimZone?.classList.remove('is-active');
    if (this.moveKnob) this.moveKnob.style.transform = 'translate3d(0, 0, 0)';
    if (this.aimKnob) this.aimKnob.style.transform = 'translate3d(0, 0, 0)';
    this.root?.querySelectorAll('.is-pressed').forEach((button) => {
      button.classList.remove('is-pressed');
    });
  }
}
