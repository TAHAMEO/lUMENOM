// Canvas textures for the SLK details. All return null outside a browser so
// the geometry can be built (and tested) in Node.

import * as THREE from 'three';

const hasDOM = () => typeof document !== 'undefined';
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function cached(key, make) {
  if (!hasDOM()) return null;
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Grille insert: rows of small chrome pins on black (one tile = 2 × 2 pins). */
export const grillePinsTexture = () =>
  cached('pins', () => {
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#050506';
    g.fillRect(0, 0, S, S);
    const pin = (x, y) => {
      const r = S * 0.12;
      const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.08, x, y, r);
      grad.addColorStop(0, '#f4f6f8');
      grad.addColorStop(0.35, '#8c9197');
      grad.addColorStop(0.75, '#2a2d31');
      grad.addColorStop(1, 'rgba(5,5,6,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r, y);
      g.closePath();
      g.fill();
    };
    for (const [x, y] of [
      [0.25, 0.25],
      [0.75, 0.75],
      [0.75, 0.25],
      [0.25, 0.75],
    ])
      pin(x * S, y * S);
    return texture(c);
  });

/** Honeycomb mesh for the bumper intakes. */
export const honeycombTexture = () =>
  cached('honeycomb', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#1b1d20';
    g.fillRect(0, 0, S, S);
    const r = S / 8;
    const h = Math.sqrt(3) * r;
    g.fillStyle = '#020203';
    for (let row = -1; row < S / (h / 2) + 1; row++) {
      for (let col = -1; col < S / (r * 3) + 1; col++) {
        const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0);
        const cy = row * h * 0.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const px = cx + Math.cos(a) * r * 0.8;
          const py = cy + Math.sin(a) * r * 0.8;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }
    return texture(c);
  });

/** Number plate. */
export const plateTexture = (text = 'SLK 200') =>
  cached(`plate:${text}`, () => {
    const c = canvas(512, 138);
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 512, 138);
    g.strokeStyle = '#141414';
    g.lineWidth = 7;
    g.strokeRect(6, 6, 500, 126);
    g.fillStyle = '#141414';
    g.font = '700 92px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 74);
    return texture(c, { repeat: false });
  });

/** Cross-drilled brake disc face (radial UV: u = angle, v = radius). */
export const discTexture = () =>
  cached('disc', () => {
    const W = 512;
    const H = 64;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#8a8e93';
    g.fillRect(0, 0, W, H);
    // machining rings
    for (let y = 0; y < H; y += 2) {
      g.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * Math.random()})`;
      g.fillRect(0, y, W, 1);
    }
    g.fillStyle = '#26282b';
    const holes = 48;
    for (let k = 0; k < holes; k++) {
      for (let ring = 0; ring < 3; ring++) {
        const x = ((k + ring / 3) / holes) * W;
        const y = H * (0.25 + ring * 0.25);
        g.beginPath();
        g.arc(x, y, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    return texture(c);
  });

/** Caliper lettering. */
export const caliperTexture = () =>
  cached('caliper', () => {
    const c = canvas(512, 128);
    const g = c.getContext('2d');
    g.fillStyle = '#b3b7bc';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#1a1b1e';
    g.font = 'italic 700 56px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Mercedes-Benz', 256, 66);
    return texture(c, { repeat: false });
  });

/** Instrument dial face: ticks over a 240° sweep, numerals, backlit white on black. */
export const dialTexture = (kind = 'speed') =>
  cached(`dial:${kind}`, () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const cx = S / 2;
    const cy = S / 2;
    g.fillStyle = '#060708';
    g.fillRect(0, 0, S, S);
    const max = kind === 'speed' ? 280 : 7;
    const major = kind === 'speed' ? 20 : 1;
    const minorPer = kind === 'speed' ? 2 : 5;
    const a0 = (Math.PI * 5) / 6; // 150° (lower left)
    const sweep = (Math.PI * 4) / 3; // 240°
    g.strokeStyle = '#f2f4f6';
    g.fillStyle = '#f2f4f6';
    g.lineCap = 'butt';
    const steps = (max / major) * minorPer;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      const isMajor = i % minorPer === 0;
      const r0 = S * (isMajor ? 0.36 : 0.4);
      g.lineWidth = isMajor ? 4 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * S * 0.45, cy + Math.sin(a) * S * 0.45);
      g.stroke();
      if (isMajor) {
        const v = (i / minorPer) * major;
        if (kind === 'speed' && v % 40 !== 0) continue;
        g.font = `600 ${kind === 'speed' ? 22 : 26}px Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(v), cx + Math.cos(a) * S * 0.27, cy + Math.sin(a) * S * 0.27);
      }
    }
    if (kind === 'rpm') {
      // red zone from 6.25 to 7
      g.strokeStyle = '#e0242c';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, S * 0.43, a0 + sweep * (6.25 / 7), a0 + sweep);
      g.stroke();
    }
    g.fillStyle = '#9aa0a8';
    g.font = '600 16px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(kind === 'speed' ? 'km/h' : '1/min x1000', cx, cy + S * 0.2);
    const t = texture(c, { repeat: false });
    return t;
  });
