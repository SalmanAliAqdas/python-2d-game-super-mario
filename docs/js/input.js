export const CONTROL_KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
};

// Track sources, not booleans: releasing one finger/key must not release another.
export class Input {
  constructor() { this.sources = new Map(); this.jumpPressed = false; }
  held(name) { return [...this.sources.values()].includes(name); }
  down(source, name) {
    if (name === 'jump' && !this.held('jump')) this.jumpPressed = true;
    this.sources.set(source, name);
  }
  up(source) { this.sources.delete(source); }
  consumeJump() { const pressed = this.jumpPressed; this.jumpPressed = false; return pressed; }
  clear() { this.sources.clear(); this.jumpPressed = false; }
  get move() { return Number(this.held('right')) - Number(this.held('left')); }
}

export function bindPointers(buttons, input, enabled) {
  for (const button of buttons) {
    const refresh = () => button.classList.toggle('active', input.held(button.dataset.control));
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (!enabled()) return;
      button.setPointerCapture(event.pointerId);
      input.down(`pointer:${event.pointerId}`, button.dataset.control);
      refresh();
    });
    const release = event => {
      event.preventDefault();
      input.up(`pointer:${event.pointerId}`);
      refresh();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      button.addEventListener(type, release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  }
}
