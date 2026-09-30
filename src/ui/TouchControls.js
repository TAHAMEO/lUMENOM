// On-screen driving controls for touch devices (multi-touch aware).

export function setupTouchControls(input) {
  const root = document.getElementById('touch');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return { show() {}, hide() {}, enabled: false };
  document.body.classList.add('touch-mode');
  const buttons = [...root.querySelectorAll('button[data-k]')];
  const active = new Map(); // pointerId → key
  const set = (key, on, btn) => {
    input.touch[key] = on;
    btn.classList.toggle('active', on);
  };
  for (const btn of buttons) {
    const key = btn.dataset.k;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      active.set(e.pointerId, key);
      set(key, true, btn);
      input.lastDevice = 'keyboard';
    });
    const release = (e) => {
      if (active.get(e.pointerId) === key) {
        active.delete(e.pointerId);
        set(key, false, btn);
      }
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return {
    enabled: true,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      for (const b of buttons) set(b.dataset.k, false, b);
    },
  };
}
