// Small numeric helpers shared by simulation and rendering code.
// Kept free of three.js so physics and track logic stay unit-testable in Node.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(e0, e1, x) {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach of `current` toward `target`. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rand, lo, hi) {
  return lo + (hi - lo) * rand();
}

/** Critically damped spring for scalars; state is { value, velocity }. */
export function springStep(state, target, omega, dt) {
  const x = state.value - target;
  const exp = Math.exp(-omega * dt);
  const temp = (state.velocity + omega * x) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  state.value = target + (x + temp) * exp;
  return state.value;
}

export function formatTime(ms, withSign = false) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  const body = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
  if (!withSign) return body;
  return (neg ? '-' : '+') + body;
}

export function formatDelta(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const s = (Math.abs(ms) / 1000).toFixed(3);
  return (ms < 0 ? '-' : '+') + s;
}

export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
