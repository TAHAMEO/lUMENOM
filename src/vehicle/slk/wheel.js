// 19-inch AMG 5-spoke wheels on 235/35 (front) and 255/30 (rear) tyres, with
// perforated discs and calipers. Wheel-local frame: +X is the axle pointing
// out of the car's left side; the wheel centre is the origin. Right-hand
// wheels are the same geometry turned 180° about Y.

import * as THREE from 'three';
import { latheX, merge } from './geom.js';

const BEAD = 0.2413; // 19" rim radius (the reference car runs AMG 19s)

/** Tyre lathe for a section width (m) and outer radius (m). */
export function tyreGeometry(width, radius, segments = 72) {
  const hw = width / 2;
  const side = radius - BEAD;
  const grooves = [-0.62, -0.22, 0.22, 0.62]; // groove centres as fraction of half-tread
  const tread = [];
  const tr = hw * 0.84;
  // tread with circumferential grooves (7 mm deep, 9 mm wide)
  const gw = 0.0045;
  const xs = [-tr];
  for (const g of grooves) xs.push(g * tr - gw, g * tr - gw * 0.7, g * tr + gw * 0.7, g * tr + gw);
  xs.push(tr);
  for (let i = 0; i < xs.length; i++) {
    const inGroove = i % 4 === 2 || i % 4 === 3;
    tread.push([inGroove && i > 0 && i < xs.length - 1 ? radius - 0.007 : radius, xs[i]]);
  }
  const prof = [
    [BEAD + 0.004, -hw * 0.78],
    [BEAD + 0.014, -hw * 0.9],
    [BEAD + side * 0.35, -hw * 0.99],
    [BEAD + side * 0.6, -hw],
    [BEAD + side * 0.82, -hw * 0.985],
    [radius - 0.012, -hw * 0.95],
    [radius - 0.003, -hw * 0.89],
    ...tread,
    [radius - 0.003, hw * 0.89],
    [radius - 0.012, hw * 0.95],
    [BEAD + side * 0.82, hw * 0.985],
    [BEAD + side * 0.6, hw],
    [BEAD + side * 0.35, hw * 0.99],
    [BEAD + 0.014, hw * 0.9],
    [BEAD + 0.004, hw * 0.78],
  ];
  // lathe expects increasing "height" along the profile for outward normals
  const g = latheX(prof, segments);
  g.computeVertexNormals();
  return g;
}

/** Rim barrel + outer lip, as a lathe. */
function barrelGeometry(width) {
  const hw = width / 2;
  return latheX(
    [
      [BEAD - 0.012, -hw + 0.004],
      [BEAD + 0.006, -hw + 0.002],
      [BEAD + 0.006, -hw + 0.014],
      [BEAD - 0.014, -hw + 0.03],
      [BEAD - 0.03, -hw + 0.06],
      [BEAD - 0.03, hw - 0.07],
      [BEAD - 0.012, hw - 0.04],
      [BEAD - 0.004, hw - 0.018],
      [BEAD + 0.004, hw - 0.012],
      [BEAD + 0.011, hw - 0.006],
      [BEAD + 0.012, hw - 0.002],
    ],
    72,
  );
}

/**
 * Wheel face: five tapered spokes with a centre ridge, slightly concave toward
 * the hub, plus outer ring, hub disc, lug bolts and centre cap.
 * `faceX` is the axle position of the spoke tops at the rim.
 */
function faceGeometry(faceX) {
  const parts = [];
  const rHub = 0.077;
  const rRing = 0.219;
  const nSpoke = 5;
  const Nr = 22;
  const Ns = 10;
  const depth = 0.03; // spoke thickness along the axle
  const dish = (r) => faceX - 0.016 * (1 - Math.min(1, Math.max(0, (r - rHub) / (rRing - rHub)))) ** 1.4; // hub sits deeper
  const halfWidth = (r) => {
    // arc half-width (m): slim waist, flaring into the ring with a fillet
    const t = (r - rHub) / (rRing - rHub);
    const base = 0.03 - 0.005 * Math.sin(t * Math.PI * 0.9) + 0.014 * t;
    const flare = 0.055 * Math.max(0, (t - 0.8) / 0.2) ** 2.2;
    const hub = 0.012 * Math.max(0, (0.12 - t) / 0.12) ** 2;
    return base + flare + hub;
  };
  for (let k = 0; k < nSpoke; k++) {
    const a0 = (k / nSpoke) * Math.PI * 2 + Math.PI / 2;
    const top = [];
    const left = [];
    const right = [];
    for (let i = 0; i <= Nr; i++) {
      const t = i / Nr;
      const r = rHub - 0.006 + (rRing + 0.01 - rHub + 0.006) * t;
      const hwA = halfWidth(Math.min(rRing, Math.max(rHub, r))) / r;
      const twist = 0.05 * Math.sin(t * Math.PI); // gentle sweep
      const row = [];
      for (let j = 0; j <= Ns; j++) {
        const s = -1 + (2 * j) / Ns;
        const a = a0 + s * hwA + twist;
        const ridge = 0.006 * (1 - Math.abs(s) ** 1.3) * (0.4 + 0.6 * Math.sin(Math.min(1, t * 1.2) * Math.PI));
        const x = dish(r) + ridge - 0.002 * s * s;
        row.push([x, r * Math.cos(a), r * Math.sin(a)]);
      }
      top.push(row);
      left.push([row[0], [row[0][0] - depth, row[0][1], row[0][2]]]);
      right.push([row[Ns], [row[Ns][0] - depth, row[Ns][1], row[Ns][2]]]);
    }
    parts.push(gridFromRows(top, false));
    // side walls of the spoke (visible through the windows)
    parts.push(
      gridFromRows(
        left.map((p) => p),
        true,
      ),
    );
    parts.push(
      gridFromRows(
        right.map((p) => p),
        false,
      ),
    );
  }
  // outer ring: face ring the spokes merge into, stepping out to the lip
  parts.push(
    latheX(
      [
        [rRing - 0.004, faceX - 0.03],
        [rRing - 0.004, faceX - 0.002],
        [rRing + 0.006, faceX + 0.001],
        [BEAD - 0.004, faceX + 0.004],
        [BEAD + 0.004, faceX + 0.006],
        [BEAD + 0.011, faceX + 0.004],
      ],
      96,
    ),
  );
  // hub disc and centre bore surround
  const hubX = dish(rHub) + 0.002;
  parts.push(
    latheX(
      [
        [0.001, hubX + 0.004],
        [0.03, hubX + 0.004],
        [0.034, hubX + 0.001],
        [0.066, hubX],
        [rHub + 0.004, hubX - 0.004],
        [rHub + 0.004, hubX - 0.03],
      ].reverse(),
      48,
    ),
  );
  return { face: merge(parts), hubX };
}

function gridFromRows(rows, flip) {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos = [];
  for (const row of rows) for (const p of row) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Five hex lug bolts on a 112 mm PCD. */
function boltsGeometry(hubX) {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2 + Math.PI / 5;
    const b = new THREE.CylinderGeometry(0.0095, 0.0095, 0.016, 6);
    b.rotateZ(-Math.PI / 2);
    b.translate(hubX + 0.004, Math.cos(a) * 0.056, Math.sin(a) * 0.056);
    parts.push(b);
    const w = new THREE.CylinderGeometry(0.012, 0.012, 0.003, 16);
    w.rotateZ(-Math.PI / 2);
    w.translate(hubX - 0.002, Math.cos(a) * 0.056, Math.sin(a) * 0.056);
    parts.push(w);
  }
  return merge(parts);
}

/** Three-pointed star in a ring, lying in the local YZ plane facing +X. */
export function starGeometry(R, { ring = true, depth = 0.004, ringWidth = 0.09, base = 0.13 } = {}) {
  const parts = [];
  const rb = R * base;
  const ridge = depth * 1.6;
  const pos = [];
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
    const tip = [0, Math.cos(a) * R * 0.96, Math.sin(a) * R * 0.96];
    const c1 = [0, Math.cos(a + Math.PI / 3) * rb, Math.sin(a + Math.PI / 3) * rb];
    const c2 = [0, Math.cos(a - Math.PI / 3) * rb, Math.sin(a - Math.PI / 3) * rb];
    const mid = [ridge, 0, 0];
    const tipT = [depth * 0.6, tip[1], tip[2]];
    // two raised facets meeting on the ridge line from the centre to the tip
    pos.push(...tipT, ...mid, ...c1.map((v, i) => (i === 0 ? depth * 0.2 : v)));
    pos.push(...tipT, ...c2.map((v, i) => (i === 0 ? depth * 0.2 : v)), ...mid);
    // sides down to the base plane
    for (const c of [c1, c2]) {
      const cTop = [depth * 0.2, c[1], c[2]];
      const cBot = [0, c[1], c[2]];
      const tBot = [0, tip[1], tip[2]];
      const q = c === c1 ? [tipT, cTop, cBot, tBot] : [cTop, tipT, tBot, cBot];
      pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    }
  }
  // orient every triangle away from its arm's spine (just behind the star plane)
  for (let t = 0; t < pos.length; t += 9) {
    const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3;
    const cy = (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3;
    const cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
    const k = Math.floor(t / 9 / 6); // six triangles per arm
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
    const along = Math.max(0, cy * Math.cos(a) + cz * Math.sin(a));
    const ref = [-depth, Math.cos(a) * along, Math.sin(a) * along];
    const ux = pos[t + 3] - pos[t];
    const uy = pos[t + 4] - pos[t + 1];
    const uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t];
    const vy = pos[t + 7] - pos[t + 1];
    const vz = pos[t + 8] - pos[t + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * (cx - ref[0]) + ny * (cy - ref[1]) + nz * (cz - ref[2]) < 0) {
      for (let c = 0; c < 3; c++) {
        const tmp = pos[t + 3 + c];
        pos[t + 3 + c] = pos[t + 6 + c];
        pos[t + 6 + c] = tmp;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  parts.push(g);
  if (ring) {
    const t = R * ringWidth;
    parts.push(
      latheX(
        [
          [R + t * 0.5, 0],
          [R + t * 0.5, depth * 0.8],
          [R, depth * 1.4],
          [R - t * 0.5, depth * 0.8],
          [R - t * 0.5, 0],
        ].reverse(),
        64,
      ),
    );
  }
  return merge(parts);
}

/** Brake disc (hat + ring) facing +X. */
function discGeometry(radius, thickness) {
  const inner = radius * 0.58;
  return latheX(
    [
      [inner, -thickness / 2],
      [radius, -thickness / 2],
      [radius, thickness / 2],
      [inner, thickness / 2],
    ].reverse(),
    64,
  );
}

function discHatGeometry(radius) {
  return latheX(
    [
      [0.001, 0.034],
      [0.06, 0.034],
      [radius * 0.58, 0.012],
      [radius * 0.58, -0.004],
    ].reverse(),
    40,
  );
}

/** Caliper wrapped around the top-front of the disc. */
function caliperGeometry(discR, thickness) {
  const r0 = discR - 0.052;
  const r1 = discR + 0.014;
  const a0 = -0.62;
  const a1 = 0.62;
  const shape = new THREE.Shape();
  const seg = 16;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const p = [Math.cos(a) * r1, Math.sin(a) * r1];
    i ? shape.lineTo(...p) : shape.moveTo(...p);
  }
  for (let i = seg; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / seg;
    shape.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  const w = thickness + 0.05;
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2); // extrusion along +X (across the disc)
  return g;
}

const cache = new Map();

/**
 * Shared wheel geometry for a tyre width. Returns parts with materials keys.
 * front: 235/35 R19, rear: 255/30 R19.
 */
export function wheelParts(front, detail = 1) {
  const key = `${front}-${detail}`;
  if (cache.has(key)) return cache.get(key);
  const width = front ? 0.235 : 0.255;
  const radius = front ? 0.3236 : 0.3178;
  const rimWidth = front ? 0.203 : 0.229; // 8" / 9"
  const faceX = rimWidth / 2 - 0.028;
  const { face, hubX } = faceGeometry(faceX);
  const cap = latheX(
    [
      [0.0005, hubX + 0.012],
      [0.022, hubX + 0.011],
      [0.029, hubX + 0.006],
      [0.03, hubX + 0.001],
    ].reverse(),
    40,
  );
  const star = starGeometry(0.019, { depth: 0.0018, ringWidth: 0.14 });
  star.translate(hubX + 0.0118, 0, 0);
  const discR = front ? 0.1475 : 0.15;
  const disc = discGeometry(discR, 0.028);
  disc.translate(-0.012, 0, 0);
  const hat = discHatGeometry(discR);
  hat.translate(-0.012, 0, 0);
  // points along local -Z; the model turns it to sit ahead of and above the axle
  const caliper = caliperGeometry(discR, 0.028);
  caliper.translate(-0.012, 0, 0);
  const out = {
    radius,
    width,
    tyre: tyreGeometry(width, radius, detail > 0.6 ? 80 : 48),
    barrel: barrelGeometry(rimWidth),
    face,
    bolts: boltsGeometry(hubX),
    cap,
    star,
    disc,
    hat,
    caliper,
  };
  cache.set(key, out);
  return out;
}
