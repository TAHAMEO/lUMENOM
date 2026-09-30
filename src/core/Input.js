// Unified input: keyboard, gamepad (standard mapping) and on-screen touch
// controls are merged into one analog driving state plus discrete actions.

const KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight', 'KeyN'],
};
const ACTION_KEYS = {
  KeyC: 'camera',
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyH: 'hud',
  KeyF: 'fps',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.actions = [];
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, analogSteer: false };
    this.touch = { throttle: false, brake: false, left: false, right: false, handbrake: false, nitro: false };
    this.gamepadIndex = null;
    this.prevButtons = [];
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const driving = Object.values(KEYMAP).some((k) => k.includes(e.code));
      if (driving || e.code === 'Space') e.preventDefault();
      if (!e.repeat && ACTION_KEYS[e.code]) this.actions.push(ACTION_KEYS[e.code]);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  key(name) {
    return KEYMAP[name].some((c) => this.down.has(c));
  }

  consume(action) {
    const i = this.actions.indexOf(action);
    if (i >= 0) {
      this.actions.splice(i, 1);
      return true;
    }
    return false;
  }

  clearActions() {
    this.actions.length = 0;
  }

  update() {
    const s = this.state;
    const kbThrottle = this.key('throttle') || this.touch.throttle ? 1 : 0;
    const kbBrake = this.key('brake') || this.touch.brake ? 1 : 0;
    const kbSteer = (this.key('left') || this.touch.left ? 1 : 0) - (this.key('right') || this.touch.right ? 1 : 0);
    let throttle = kbThrottle;
    let brake = kbBrake;
    let steer = kbSteer;
    let handbrake = this.key('handbrake') || this.touch.handbrake;
    let nitro = this.key('nitro') || this.touch.nitro;
    let analog = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : [...pads].find((p) => p);
    if (pad) {
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const pressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const ax = pad.axes[0] || 0;
      const dz = 0.12;
      const stick = Math.abs(ax) < dz ? 0 : (Math.sign(ax) * (Math.abs(ax) - dz)) / (1 - dz);
      const rt = b(7);
      const lt = b(6);
      if (Math.abs(stick) > 0 || rt > 0.05 || lt > 0.05) this.lastDevice = 'gamepad';
      if (this.lastDevice === 'gamepad') {
        steer = kbSteer || -Math.sign(stick) * Math.abs(stick) ** 1.4;
        analog = kbSteer === 0;
        throttle = Math.max(kbThrottle, rt);
        brake = Math.max(kbBrake, lt);
        handbrake = handbrake || pressed(0) || pressed(5);
        nitro = nitro || pressed(2) || pressed(1);
      }
      const edge = (i, action) => {
        const now = pressed(i);
        if (now && !this.prevButtons[i]) this.actions.push(action);
        this.prevButtons[i] = now;
      };
      edge(3, 'camera');
      edge(9, 'pause');
      edge(8, 'reset');
    }
    if (!this.enabled) {
      throttle = 0;
      brake = 0;
      steer = 0;
      handbrake = false;
      nitro = false;
    }
    s.throttle = throttle;
    s.brake = brake;
    s.steer = steer;
    s.handbrake = handbrake;
    s.nitro = nitro;
    s.analogSteer = analog;
    return s;
  }
}
