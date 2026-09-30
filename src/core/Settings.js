// Player settings, quality tiers and persistence. Storage can be unavailable
// (private windows, sandboxed frames), so every access is guarded.

const KEY = 'lumenom.racer.v1';

export const QUALITY = {
  low: {
    label: 'Low',
    pixelRatio: 0.75,
    post: false,
    msaa: 0,
    bloom: false,
    ao: false,
    grain: false,
    shadows: false,
    shadowSize: 1024,
    shadowExtent: 45,
    treeShadows: false,
    terrainShadows: false,
    trees: 0.35,
    grass: 0,
    particles: 0.5,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1,
    post: true,
    msaa: 0,
    bloom: true,
    ao: false,
    grain: true,
    shadows: true,
    shadowSize: 2048,
    shadowExtent: 55,
    treeShadows: false,
    terrainShadows: false,
    trees: 0.65,
    grass: 0.35,
    particles: 0.8,
  },
  high: {
    label: 'High',
    pixelRatio: 1.5,
    post: true,
    msaa: 4,
    bloom: true,
    ao: false,
    grain: true,
    shadows: true,
    shadowSize: 2048,
    shadowExtent: 62,
    treeShadows: true,
    terrainShadows: true,
    trees: 1,
    grass: 1,
    particles: 1,
  },
  ultra: {
    label: 'Ultra',
    pixelRatio: 2,
    post: true,
    msaa: 4,
    bloom: true,
    ao: true,
    grain: true,
    shadows: true,
    shadowSize: 4096,
    shadowExtent: 75,
    treeShadows: true,
    terrainShadows: true,
    trees: 1,
    grass: 1,
    particles: 1,
  },
};

function defaultQuality() {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return touch ? 'medium' : 'high';
}

export const DEFAULTS = {
  quality: defaultQuality(),
  timeOfDay: 'sunset',
  laps: 3,
  opponents: 5,
  difficulty: 'medium',
  paint: 'lumen',
  rim: 'silver',
  units: 'kmh',
  volume: 0.8,
  camera: 'chase',
  showFps: false,
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { settings: { ...DEFAULTS }, records: {} };
    const data = JSON.parse(raw);
    return { settings: { ...DEFAULTS, ...(data.settings || {}) }, records: data.records || {} };
  } catch {
    return { settings: { ...DEFAULTS }, records: {} };
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
