// Procedural textures generated on 2D canvases at load time, so the game ships
// with zero image assets. Every generator is deterministic (seeded).

import * as THREE from 'three';
import { clamp, mulberry32, smoothstep } from '../core/math.js';

let maxAnisotropy = 8;
export function setMaxAnisotropy(v) {
  maxAnisotropy = v;
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = true, anisotropy = true, mipmaps = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy ? maxAnisotropy : 1;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// -----------------------------------------------------------------------------
// Tileable value noise (fast lattice interpolation with wrap-around).

export function makeTileNoise(seed) {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const lattice = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand() * 2 - 1;
  /** Noise with integer period (in lattice cells) along both axes. */
  return function noise(x, y, period) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    // hash lattice coordinates into the table so different periods stay decorrelated
    const r0 = ((y0 * 31 + 7) & 255) * SIZE;
    const r1 = ((y1 * 31 + 7) & 255) * SIZE;
    const c0 = (x0 * 17 + 3) & 255;
    const c1 = (x1 * 17 + 3) & 255;
    const a = lattice[r0 + c0];
    const b = lattice[r0 + c1];
    const c = lattice[r1 + c0];
    const d = lattice[r1 + c1];
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };
}

/** Tileable fBm over [0,1)² → about [-1, 1]. `base` = lattice cells across the tile. */
export function tileFbm(noise, u, v, base, octaves, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * p, v * p, p);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** Build a tangent-space normal map from a height field (Float32Array, wraps). */
export function heightToNormalCanvas(height, w, h, strength = 2) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      let nx = -dx;
      let ny = dy; // canvas y is down; OpenGL-style normal map expects +y up
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (yc + x) * 4;
      d[k] = (nx * 0.5 + 0.5) * 255;
      d[k + 1] = (ny * 0.5 + 0.5) * 255;
      d[k + 2] = (nz * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function grayCanvas(values, w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(values[i], 0, 1) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// -----------------------------------------------------------------------------
// Asphalt: colour + normal + roughness for a 14 m wide road, tiling every 14 m.
// u runs across the road (0 = right edge, 1 = left edge), v along it.

export function createAsphaltTextures(size = 1024) {
  const noise = makeTileNoise(1337);
  const rand = mulberry32(77);
  const n = size * size;
  const height = new Float32Array(n);
  const lum = new Float32Array(n);
  const rough = new Float32Array(n);
  const paint = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const patches = tileFbm(noise, u, v, 3, 3);
      const mid = tileFbm(noise, u + 0.37, v + 0.11, 24, 3);
      const grain = noise(u * 256, v * 256, 256) * 0.5 + noise(u * 512 + 3.1, v * 512 + 1.7, 512) * 0.5;
      let L = 0.19 + patches * 0.03 + mid * 0.02 + grain * 0.035;
      let hgt = grain * 0.35 + mid * 0.25;
      lum[i] = L;
      height[i] = hgt;
      rough[i] = 0.9 + grain * 0.05 - patches * 0.03;
    }
  }
  // Aggregate stones: tiny bright/dark flecks with raised height.
  const stones = Math.floor(n * 0.009);
  for (let s = 0; s < stones; s++) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    const r = rand() < 0.8 ? 1 : 2;
    const bright = rand() < 0.6;
    const dl = bright ? 0.035 + rand() * 0.06 : -0.05 - rand() * 0.04;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy > r * r + 0.5) continue;
        const px = (cx + ox + size) % size;
        const py = (cy + oy + size) % size;
        const i = py * size + px;
        lum[i] += dl;
        height[i] += bright ? 0.5 : -0.4;
        rough[i] += bright ? -0.12 : 0.04;
      }
    }
  }
  // Tar seams: thin darker, smoother cracks meandering along the road.
  for (let s = 0; s < 3; s++) {
    let x = rand() * size;
    let y = rand() * size;
    let ang = rand() * Math.PI * 2;
    const len = 200 + rand() * 500;
    for (let k = 0; k < len; k++) {
      ang += (rand() - 0.5) * 0.35;
      x = (x + Math.cos(ang) + size) % size;
      y = (y + Math.sin(ang) + size) % size;
      for (let w = -1; w <= 1; w++) {
        const i = Math.floor((y + size) % size) * size + Math.floor((x + w + size) % size);
        lum[i] = lum[i] * 0.6 + 0.03;
        rough[i] = 0.8;
        height[i] -= 0.1;
      }
    }
  }
  // White edge lines, slightly worn by noise.
  const lineIn = 0.016;
  const lineOut = 0.033;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const e = Math.min(u, 1 - u);
      const m = smoothstep(lineIn - 0.002, lineIn + 0.001, e) * (1 - smoothstep(lineOut - 0.001, lineOut + 0.002, e));
      if (m <= 0) continue;
      const i = y * size + x;
      const wear = clamp(0.75 + tileFbm(noise, u + 0.5, v, 40, 2) * 0.9, 0, 1);
      const p = m * wear;
      paint[i] = p;
      lum[i] = lum[i] * (1 - p) + 0.78 * p;
      rough[i] = rough[i] * (1 - p) + 0.62 * p;
      height[i] += p * 0.6;
    }
  }

  const colorCanvas = makeCanvas(size);
  const ctx = colorCanvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n; i++) {
    const L = clamp(lum[i], 0, 1);
    const p = paint[i];
    // asphalt has a faint cool bias; paint is neutral white
    img.data[i * 4] = clamp(L * (0.98 - 0.02 * (1 - p)), 0, 1) * 255;
    img.data[i * 4 + 1] = clamp(L * (1.0 - 0.01 * (1 - p)), 0, 1) * 255;
    img.data[i * 4 + 2] = clamp(L * (1.04 - 0.02 * p), 0, 1) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return {
    map: toTexture(colorCanvas, { srgb: true }),
    normalMap: toTexture(heightToNormalCanvas(height, size, size, 0.9), { srgb: false }),
    roughnessMap: toTexture(grayCanvas(rough, size, size), { srgb: false }),
  };
}

// -----------------------------------------------------------------------------
// Ground detail: near-neutral grass variation multiplied over vertex colours.

export function createGrassDetailTexture(size = 512) {
  const noise = makeTileNoise(4242);
  const rand = mulberry32(11);
  const n = size * size;
  const lum = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const a = tileFbm(noise, u, v, 4, 4);
      const b = tileFbm(noise, u + 0.3, v + 0.8, 32, 3);
      const blades = noise(u * 180, v * 60, 60) * 0.5 + noise(u * 300 + 7, v * 110, 110) * 0.5;
      lum[i] = 0.8 + a * 0.12 + b * 0.1 + blades * 0.14;
    }
  }
  for (let s = 0; s < n * 0.01; s++) {
    const i = Math.floor(rand() * n);
    lum[i] *= 0.7;
  }
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n; i++) {
    const L = clamp(lum[i], 0, 1.2);
    img.data[i * 4] = clamp(L * 0.94, 0, 1) * 255;
    img.data[i * 4 + 1] = clamp(L * 1.0, 0, 1) * 255;
    img.data[i * 4 + 2] = clamp(L * 0.86, 0, 1) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { srgb: true });
}

// -----------------------------------------------------------------------------
// Gravel trap: small rounded stones.

export function createGravelTextures(size = 512) {
  const rand = mulberry32(99);
  const noise = makeTileNoise(9);
  const n = size * size;
  const lum = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i % size) / size;
    const y = Math.floor(i / size) / size;
    lum[i] = 0.55 + tileFbm(noise, x, y, 6, 3) * 0.08;
  }
  const stones = Math.floor(n / 18);
  for (let s = 0; s < stones; s++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 1.2 + rand() * 2.6;
    const L = 0.35 + rand() * 0.45;
    for (let oy = -Math.ceil(r); oy <= Math.ceil(r); oy++) {
      for (let ox = -Math.ceil(r); ox <= Math.ceil(r); ox++) {
        const dd = (ox * ox + oy * oy) / (r * r);
        if (dd > 1) continue;
        const px = (Math.floor(cx) + ox + size) % size;
        const py = (Math.floor(cy) + oy + size) % size;
        const i = py * size + px;
        const dome = Math.sqrt(1 - dd);
        if (dome * r > height[i]) {
          height[i] = dome * r;
          lum[i] = L * (0.75 + 0.25 * dome);
        }
      }
    }
  }
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n; i++) {
    const L = clamp(lum[i], 0, 1);
    img.data[i * 4] = L * 255 * 1.0;
    img.data[i * 4 + 1] = L * 255 * 0.9;
    img.data[i * 4 + 2] = L * 255 * 0.74;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: toTexture(canvas),
    normalMap: toTexture(heightToNormalCanvas(height, size, size, 0.6), { srgb: false }),
  };
}

// -----------------------------------------------------------------------------
// Curb: one red and one white block per texture repeat along v.

export function createCurbTexture() {
  const w = 64;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(5);
  ctx.fillStyle = '#c4161c';
  ctx.fillRect(0, 0, w, h / 2);
  ctx.fillStyle = '#ecebe6';
  ctx.fillRect(0, h / 2, w, h / 2);
  // rubber marks and grime
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(20,18,16,${rand() * 0.12})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 6);
  }
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.3, 'rgba(0,0,0,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return toTexture(canvas);
}

// -----------------------------------------------------------------------------
// Water normals for the lake.

export function createWaterNormalTexture(size = 256) {
  const noise = makeTileNoise(2024);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[y * size + x] = tileFbm(noise, x / size, y / size, 8, 4, 0.55);
    }
  }
  return toTexture(heightToNormalCanvas(height, size, size, 6), { srgb: false });
}

// -----------------------------------------------------------------------------
// Soft radial sprites (smoke, glow, light pools).

export function createRadialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { repeat: false, anisotropy: false });
}

export function createSmokeTexture(size = 128) {
  const noise = makeTileNoise(31);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const n = tileFbm(noise, x / size, y / size, 4, 4) * 0.5 + 0.5;
      const a = clamp((1 - r) * 1.6, 0, 1) ** 1.5 * (0.45 + 0.75 * n);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { repeat: false, anisotropy: false });
}

/** Contact shadow blob placed under each car. */
export function createShadowBlobTexture(size = 256) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size - 0.5) * 2;
      const dy = ((y + 0.5) / size - 0.5) * 2;
      // rounded-rectangle falloff
      const qx = Math.max(Math.abs(dx) - 0.35, 0);
      const qy = Math.max(Math.abs(dy) - 0.55, 0);
      const d = Math.hypot(qx / 0.65, qy / 0.45);
      const a = clamp(1 - d, 0, 1) ** 2;
      const i = (y * size + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { repeat: false, anisotropy: false });
}

/** Checkerboard strip for the start/finish line and flags. */
export function createCheckerTexture(cols = 8, rows = 2, px = 32) {
  const canvas = makeCanvas(cols * px, rows * px);
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  const t = toTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  return t;
}

// -----------------------------------------------------------------------------
// Car materials: 2x2 twill carbon weave and a hexagonal grille mesh.

export function createCarbonTexture(size = 256) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const cells = 16;
  const c = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const horizontal = Math.floor((x + y) / 2) % 2 === 0;
      const g = horizontal ? ctx.createLinearGradient(x * c, 0, x * c + c, 0) : ctx.createLinearGradient(0, y * c, 0, y * c + c);
      g.addColorStop(0, '#0d0e10');
      g.addColorStop(0.5, horizontal ? '#2a2d33' : '#1c1e22');
      g.addColorStop(1, '#0d0e10');
      ctx.fillStyle = g;
      ctx.fillRect(x * c, y * c, c, c);
    }
  }
  return toTexture(canvas);
}

export function createGrilleTexture(size = 256) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16181b';
  ctx.fillRect(0, 0, size, size);
  const r = size / 16;
  const h = Math.sqrt(3) * r;
  ctx.fillStyle = '#020203';
  for (let row = -1; row < size / h + 1; row++) {
    for (let col = -1; col < size / (r * 3) + 1; col++) {
      const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0);
      const cy = row * h * 0.5;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * r * 0.78;
        const py = cy + Math.sin(a) * r * 0.78;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  return toTexture(canvas);
}

export function createPlateTexture(text) {
  const canvas = makeCanvas(256, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '700 40px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  return toTexture(canvas, { repeat: false });
}
