// Procedural supercar. The body is a lofted parametric surface: superellipse
// cross-sections whose parameters are spline-interpolated along the car, with
// wheel arches carved into the floor line. A separate cabin loft carries the
// glasshouse with diagonal A/C-pillars. Lights, grilles, intakes and skirts are
// "patches" evaluated on the same surface so they sit perfectly flush.
//
// Local frame: +Z forward, +Y up, +X = car's left. Origin = centre of gravity
// at ground level (the wheelbase midpoint sits CG_OFFSET behind it).

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { createCarbonTexture, createGrilleTexture, createPlateTexture } from '../world/textures.js';

export const WHEEL_RADIUS = 0.345;
export const FRONT_AXLE = 1.35;
export const REAR_AXLE = -1.35;
export const TRACK_FRONT = 0.83; // half track
export const TRACK_REAR = 0.845;
export const CG_OFFSET = 0.1;

// ---------------------------------------------------------------------------
// Monotone cubic interpolation (Fritsch–Carlson): smooth, no overshoot.

function monotone(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
}

const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

// ---------------------------------------------------------------------------
// Body definition. Columns: z, floor, fender-top, half-width, shoulder height, hood dip, top exponent

const BODY_KEYS = [
  [-2.33, 0.4, 0.855, 0.84, 0.62, 0.0, 4.4],
  [-2.3, 0.33, 0.915, 0.915, 0.64, 0.01, 4.2],
  [-2.2, 0.27, 0.94, 0.955, 0.67, 0.022, 3.7],
  [-1.85, 0.21, 0.955, 0.985, 0.7, 0.04, 3.2],
  [-1.35, 0.2, 0.975, 1.0, 0.72, 0.055, 3.0],
  [-0.95, 0.17, 0.945, 0.982, 0.64, 0.035, 3.0],
  [-0.55, 0.155, 0.915, 0.952, 0.55, 0.0, 3.0],
  [0.0, 0.15, 0.885, 0.944, 0.53, 0.0, 3.0],
  [0.5, 0.15, 0.86, 0.95, 0.55, 0.02, 3.0],
  [0.95, 0.165, 0.83, 0.965, 0.6, 0.045, 3.3],
  [1.35, 0.17, 0.805, 0.975, 0.62, 0.045, 3.6],
  [1.75, 0.17, 0.7, 0.962, 0.52, 0.04, 3.6],
  [2.02, 0.17, 0.6, 0.935, 0.43, 0.025, 3.5],
  [2.18, 0.175, 0.51, 0.885, 0.36, 0.012, 3.4],
  [2.27, 0.19, 0.44, 0.8, 0.31, 0.0, 3.2],
  [2.31, 0.21, 0.385, 0.7, 0.29, 0.0, 3.0],
];
const Z_MIN = BODY_KEYS[0][0];
const Z_MAX = BODY_KEYS[BODY_KEYS.length - 1][0];

const col = (k) =>
  monotone(
    BODY_KEYS.map((r) => r[0]),
    BODY_KEYS.map((r) => r[k]),
  );
const F = { yb: col(1), yt: col(2), w: col(3), ys: col(4), dip: col(5), nU: col(6) };

function archTop(z, za, R) {
  const d = z - za;
  if (Math.abs(d) >= R) return 0;
  // slightly flattened arch reads more modern than a pure semicircle
  return WHEEL_RADIUS - 0.02 + Math.sqrt(R * R - d * d) * 1.02;
}

/** Cross-section parameters at station z (wheelbase-midpoint frame). */
export function stationAt(z) {
  const yb0 = F.yb(z);
  const yb = Math.max(yb0, archTop(z, FRONT_AXLE, 0.405), archTop(z, REAR_AXLE, 0.415));
  let w = F.w(z);
  // fender flares right at the arches
  const flare = Math.exp(-(((z - FRONT_AXLE) / 0.45) ** 2)) * 0.012 + Math.exp(-(((z - REAR_AXLE) / 0.5) ** 2)) * 0.016;
  w += flare;
  const yt = F.yt(z);
  const ys = Math.min(Math.max(F.ys(z), yb + 0.045), yt - 0.035);
  return { z, yb, yt, w, ys, dip: F.dip(z), nU: F.nU(z), nL: 3.6 };
}

/** Point on the +X half of the section for u ∈ [0,1] (0 bottom centre → 0.5 max width → 1 top centre). */
export function sectionPoint(s, u, out) {
  if (u <= 0.5) {
    const th = -Math.PI / 2 + (u / 0.5) * (Math.PI / 2);
    out.x = s.w * spow(Math.cos(th), 2 / s.nL);
    out.y = s.ys + (s.ys - s.yb) * spow(Math.sin(th), 2 / s.nL);
  } else {
    const th = ((u - 0.5) / 0.5) * (Math.PI / 2);
    out.x = s.w * spow(Math.cos(th), 2 / s.nU);
    out.y = s.ys + (s.yt - s.ys) * spow(Math.sin(th), 2 / s.nU);
    const xr = out.x / s.w;
    out.y -= s.dip * (1 - xr * xr) ** 2;
  }
  return out;
}

/** Height of the body's upper surface at lateral x for section s. */
export function topHeightAt(s, x) {
  const xr = clamp(Math.abs(x) / s.w, 0, 1);
  return s.ys + (s.yt - s.ys) * (1 - xr ** s.nU) ** (1 / s.nU) - s.dip * (1 - xr * xr) ** 2;
}

const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0 };

function bodyPoint(z, u, side, out) {
  sectionPoint(stationAt(z), u, _p);
  out.set(_p.x * side, _p.y, z);
  return out;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

function bodyNormal(z, u, side, out) {
  const e = 0.004;
  bodyPoint(z, Math.min(1, u + e), side, _a);
  bodyPoint(z, Math.max(0, u - e), side, _b);
  bodyPoint(Math.min(Z_MAX, z + e), u, side, _c);
  bodyPoint(Math.max(Z_MIN, z - e), u, side, _d);
  _a.sub(_b); // along u (up the +X side)
  _c.sub(_d); // along z
  out.crossVectors(_a, _c);
  if (side < 0) out.negate();
  return out.normalize();
}

// ---------------------------------------------------------------------------
// Geometry builders

function gridGeometry(rows, cols, fn, flip = false) {
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const t = fn(r, c, v);
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = t ? t[0] : c / (cols - 1);
      uv[k * 2 + 1] = t ? t[1] : r / (rows - 1);
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (flip) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bodyStations() {
  const zs = [];
  const step = 0.04;
  for (let z = Z_MIN; z < Z_MAX - 1e-6; z += step) zs.push(z);
  zs.push(Z_MAX);
  // extra resolution at arch edges for crisp openings
  for (const za of [FRONT_AXLE, REAR_AXLE]) {
    for (const R of [0.405, 0.415]) for (const s of [-1, 1]) for (const o of [-0.006, 0.0, 0.006, 0.015]) zs.push(za + s * (R + o));
  }
  return [...new Set(zs.map((z) => +z.toFixed(4)))].filter((z) => z >= Z_MIN && z <= Z_MAX).sort((a, b) => a - b);
}

function uSamples() {
  const us = [];
  const low = 12;
  const up = 22;
  for (let i = 0; i < low; i++) us.push((i / low) * 0.5);
  for (let i = 0; i <= up; i++) us.push(0.5 + (i / up) * 0.5);
  return us;
}

/** Full body shell (both halves share the centre seam) + flat end caps. */
function buildBodyGeometry() {
  const zs = bodyStations();
  const us = uSamples();
  const half = us.length; // includes u=0 and u=1
  const ringLen = half * 2 - 2; // +X side 0..half-1, then −X side back down (excluding centres)
  const pos = [];
  for (const z of zs) {
    const s = stationAt(z);
    for (let i = 0; i < half; i++) {
      sectionPoint(s, us[i], _p);
      pos.push(_p.x, _p.y, z);
    }
    for (let i = half - 2; i >= 1; i--) {
      sectionPoint(s, us[i], _p);
      pos.push(-_p.x, _p.y, z);
    }
  }
  const idx = [];
  for (let r = 0; r < zs.length - 1; r++) {
    for (let j = 0; j < ringLen; j++) {
      const a = r * ringLen + j;
      const b = r * ringLen + ((j + 1) % ringLen);
      const c = a + ringLen;
      const d = b + ringLen;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // Caps: separate vertices so the rear panel and nose have crisp edges.
  const capGeo = (ringIndex, dir) => {
    const cp = [];
    const ci = [];
    const base = ringIndex * ringLen;
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < ringLen; j++) {
      cx += pos[(base + j) * 3];
      cy += pos[(base + j) * 3 + 1];
    }
    cx /= ringLen;
    cy /= ringLen;
    const z = pos[base * 3 + 2];
    cp.push(cx, cy, z);
    for (let j = 0; j < ringLen; j++) cp.push(pos[(base + j) * 3], pos[(base + j) * 3 + 1], z);
    for (let j = 0; j < ringLen; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % ringLen);
      // front cap: ring runs counter-clockwise seen from ahead; rear cap is the mirror case
      if (dir > 0) ci.push(0, a, b);
      else ci.push(0, b, a);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setIndex(ci);
    cg.computeVertexNormals();
    return cg;
  };
  return { shell: g, rearCap: capGeo(0, -1), frontCap: capGeo(zs.length - 1, 1) };
}

/** Surface patch on the body over z∈[z0,z1] with u-range given per z; offset along the normal. */
function bodyPatch(z0, z1, u0f, u1f, nz, nu, offset, sides = [1, -1]) {
  const geos = [];
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const side of sides) {
    const g = gridGeometry(
      nz,
      nu,
      (r, c, out) => {
        const z = lerp(z0, z1, r / (nz - 1));
        const u = lerp(typeof u0f === 'function' ? u0f(z) : u0f, typeof u1f === 'function' ? u1f(z) : u1f, c / (nu - 1));
        bodyPoint(z, u, side, v);
        bodyNormal(z, u, side, nrm);
        out.copy(v).addScaledVector(nrm, offset);
        return [c / (nu - 1), r / (nz - 1)];
      },
      side < 0,
    );
    geos.push(g);
  }
  return mergeSimple(geos);
}

/** Split an indexed geometry with groups into one non-indexed geometry per group. */
function splitGroups(geo) {
  const flat = geo.toNonIndexed();
  return geo.groups.map((grp) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(flat.attributes)) {
      const size = attr.itemSize;
      g.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(grp.start * size, (grp.start + grp.count) * size), size));
    }
    return g;
  });
}

function planarUv(geo, sx, sy, ox = 0, oy = 0) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * sx + ox;
    uv[i * 2 + 1] = pos.getY(i) * sy + oy;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function mergeSimple(geos) {
  const withUv = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of withUv) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of withUv) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}

// ---------------------------------------------------------------------------
// Cabin (glasshouse)

const CABIN_FRONT = 0.93;
const CABIN_REAR = -1.72;
const ROOF_FRONT = 0.16;
const ROOF_REAR = -0.92;
const cabinTop = monotone([-1.72, -1.4, -1.1, -0.8, -0.45, -0.1, 0.2, 0.45, 0.7, 0.93], [0, 0.07, 0.13, 0.19, 0.22, 0.225, 0.2, 0.14, 0.07, 0]);
const cabinRoofY = monotone([-1.72, -1.4, -1.1, -0.8, -0.45, -0.1, 0.2, 0.45, 0.7, 0.93], [0.93, 0.99, 1.05, 1.11, 1.155, 1.16, 1.12, 1.05, 0.95, 0.8]);

function cabinSection(z) {
  const s = stationAt(z);
  const wBase = s.w - 0.165;
  const yBase = topHeightAt(s, wBase) - 0.012;
  const roofY = Math.max(yBase + 0.001, cabinRoofY(z));
  const h = Math.max(0.001, roofY - yBase);
  const wTop = wBase * 0.74;
  return { wBase, yBase, h, wTop, n: 3.2 };
}

/** u ∈ [0,1]: 0 = base on the +X side, 1 = roof centre. */
function cabinPoint(z, u, side, out) {
  const c = cabinSection(z);
  const th = u * (Math.PI / 2);
  const x0 = spow(Math.cos(th), 2 / c.n);
  const y0 = spow(Math.sin(th), 2 / c.n);
  const taper = 1 - (1 - c.wTop / c.wBase) * y0;
  out.set(x0 * c.wBase * taper * side, c.yBase + y0 * c.h, z);
  return out;
}

const PILLAR_U = 0.5;
function pillarU(z) {
  if (z > ROOF_FRONT) return PILLAR_U * clamp((CABIN_FRONT - z) / (CABIN_FRONT - ROOF_FRONT), 0, 1) ** 0.85;
  if (z < ROOF_REAR) return PILLAR_U * clamp((z - CABIN_REAR) / (ROOF_REAR - CABIN_REAR), 0, 1) ** 0.85;
  return PILLAR_U;
}

/** Classify a cabin face centroid: 0 glass, 1 black trim, 2 paint (roof). */
function cabinClass(z, u) {
  const pu = pillarU(z);
  const band = 0.055;
  if (Math.abs(u - pu) < band) return 1;
  if (u < pu) {
    // side glass; B-pillar and belt moulding are trim
    if (z < -0.5 && z > -0.62) return 1;
    if (u < 0.05) return 1;
    return 0;
  }
  // top region
  if (z > ROOF_FRONT + 0.03) return 0; // windscreen
  if (z < ROOF_REAR - 0.03) return 0; // rear screen / engine cover glass
  if (z > ROOF_FRONT - 0.03 || z < ROOF_REAR + 0.03) return 1; // headers
  return 2;
}

function buildCabinGeometry() {
  const zs = [];
  const nz = 72;
  for (let i = 0; i <= nz; i++) zs.push(lerp(CABIN_REAR, CABIN_FRONT, i / nz));
  const nu = 26;
  const pos = [];
  const v = new THREE.Vector3();
  const params = [];
  for (const z of zs) {
    for (let i = 0; i <= nu; i++) {
      cabinPoint(z, i / nu, 1, v);
      pos.push(v.x, v.y, v.z);
      params.push([z, i / nu]);
    }
    for (let i = nu - 1; i >= 0; i--) {
      cabinPoint(z, i / nu, -1, v);
      pos.push(v.x, v.y, v.z);
      params.push([z, i / nu]);
    }
  }
  const ring = 2 * nu + 1;
  const groups = [[], [], []];
  for (let r = 0; r < zs.length - 1; r++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = r * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = b + ring;
      const pa = params[a];
      const pd = params[d];
      const cls = cabinClass((pa[0] + pd[0]) / 2, (pa[1] + params[b][1]) / 2);
      groups[cls].push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const all = [...groups[0], ...groups[1], ...groups[2]];
  g.setIndex(all);
  g.addGroup(0, groups[0].length, 0);
  g.addGroup(groups[0].length, groups[1].length, 1);
  g.addGroup(groups[0].length + groups[1].length, groups[2].length, 2);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Wheels

function buildTireGeometry(width) {
  const hw = width / 2;
  const R = WHEEL_RADIUS;
  const pts = [
    [0.252, -hw * 0.92],
    [0.285, -hw],
    [0.318, -hw * 0.98],
    [0.336, -hw * 0.9],
    [R - 0.002, -hw * 0.72],
    [R, -hw * 0.45],
    [R, hw * 0.45],
    [R - 0.002, hw * 0.72],
    [0.336, hw * 0.9],
    [0.318, hw * 0.98],
    [0.285, hw],
    [0.252, hw * 0.92],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X
  return g;
}

function buildRimFaceGeometry() {
  const R = 0.238;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  const spokes = 10;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2;
    const gapOuter = 0.26; // radians of opening at the rim
    const gapInner = 0.2;
    const hole = new THREE.Path();
    const r0 = 0.085;
    const r1 = 0.205;
    const steps = 6;
    // twin-spoke pattern: alternate narrow/wide openings
    const wide = k % 2 === 0 ? 1 : 0.55;
    const go = gapOuter * wide;
    const gi = gapInner * wide;
    for (let s = 0; s <= steps; s++) {
      const a = a0 - go / 2 + (go * s) / steps;
      const x = Math.cos(a) * r1;
      const y = Math.sin(a) * r1;
      s ? hole.lineTo(x, y) : hole.moveTo(x, y);
    }
    for (let s = steps; s >= 0; s--) {
      const a = a0 - gi / 2 + (gi * s) / steps;
      hole.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: 28,
  });
  // dish: push the hub outward relative to the rim for a concave face
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    pos.setZ(i, pos.getZ(i) + (1 - smoothstep(0.06, 0.22, r)) * 0.035);
  }
  g.computeVertexNormals();
  g.rotateY(Math.PI / 2); // face normal +Z → +X (outward on the left side)
  return g;
}

function buildCaliperGeometry() {
  const shape = new THREE.Shape();
  const a0 = -0.5;
  const a1 = 0.5;
  const r0 = 0.135;
  const r1 = 0.205;
  shape.absarc(0, 0, r1, a0, a1, false);
  shape.absarc(0, 0, r0, a1, a0, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.0375);
  g.rotateY(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Shared geometry/material cache

let SHARED = null;

function buildShared() {
  const body = buildBodyGeometry();
  const cabin = buildCabinGeometry();
  const S = { body, cabin };

  // Headlights: sweeping slit along the upper front corner
  const headU0 = (z) => lerp(0.615, 0.56, smoothstep(1.7, 2.25, z));
  const headU1 = (z) => lerp(0.73, 0.655, smoothstep(1.7, 2.25, z));
  S.headLens = bodyPatch(1.7, 2.25, headU0, headU1, 18, 6, 0.004);
  S.headDrl = bodyPatch(1.74, 2.24, (z) => headU0(z) + 0.004, (z) => headU0(z) + 0.017, 18, 2, 0.007);
  // Front intakes and splitter lip
  S.grille = bodyPatch(2.0, 2.305, 0.1, 0.4, 10, 8, 0.004);
  // Side intakes behind the doors
  S.sideIntake = bodyPatch(-1.02, -0.66, (z) => lerp(0.38, 0.47, (z + 1.02) / 0.36), (z) => lerp(0.58, 0.53, (z + 1.02) / 0.36), 10, 6, 0.003);
  // Side skirts
  S.skirt = bodyPatch(-0.93, 0.93, 0.07, 0.19, 24, 3, 0.006);
  // Door shut lines
  S.doorLines = mergeSimple([
    bodyPatch(0.6, 0.607, 0.2, 0.74, 2, 12, 0.0015),
    bodyPatch(-0.62, -0.613, 0.22, 0.7, 2, 12, 0.0015),
  ]);
  // Rear light wrap-around ends
  S.tailWrap = bodyPatch(-2.325, -2.2, 0.595, 0.64, 6, 3, 0.004);
  // Engine cover louvres on the rear deck
  const louvres = [];
  for (let k = 0; k < 6; k++) {
    const z0 = -2.1 + k * 0.055;
    louvres.push(bodyPatch(z0, z0 + 0.03, 0.9, 1.0, 2, 6, 0.004));
  }
  S.louvres = mergeSimple(louvres);

  // Rear panel pieces (flat tail at Z_MIN)
  const tailZ = Z_MIN - 0.004;
  const lightBar = new THREE.BoxGeometry(1.5, 0.045, 0.02);
  lightBar.translate(0, 0.74, tailZ);
  S.tailBar = lightBar;
  const plate = new THREE.PlaneGeometry(0.52, 0.13);
  plate.rotateY(Math.PI);
  plate.translate(0, 0.52, tailZ - 0.004);
  S.plate = plate;
  // Diffuser with fins
  const diff = [];
  const dPlate = new THREE.BoxGeometry(1.36, 0.02, 0.5);
  dPlate.rotateX(-0.22);
  dPlate.translate(0, 0.25, Z_MIN + 0.26);
  diff.push(dPlate);
  for (let k = -1; k <= 1; k++) {
    const fin = new THREE.BoxGeometry(0.014, 0.07, 0.4);
    fin.rotateX(-0.22);
    fin.translate(k * 0.24, 0.24, Z_MIN + 0.27);
    diff.push(fin);
  }
  S.diffuser = mergeSimple(diff);
  // Front splitter
  const split = new THREE.BoxGeometry(1.62, 0.02, 0.3);
  split.translate(0, 0.15, Z_MAX - 0.15);
  S.splitter = split;
  // Exhausts (twin centre exit)
  const ex = [];
  const exIn = [];
  for (const x of [-0.13, 0.13]) {
    const tip = new THREE.CylinderGeometry(0.055, 0.058, 0.14, 20, 1, true);
    tip.rotateX(Math.PI / 2);
    tip.translate(x, 0.36, Z_MIN - 0.02);
    ex.push(tip);
    const inner = new THREE.CircleGeometry(0.05, 20);
    inner.rotateY(Math.PI);
    inner.translate(x, 0.36, Z_MIN + 0.02);
    exIn.push(inner);
  }
  S.exhaust = mergeSimple(ex);
  S.exhaustInner = mergeSimple(exIn);
  // Chassis filler (blocks see-through under the raised arch floor)
  const chassis = new THREE.BoxGeometry(1.1, 0.42, 3.65);
  chassis.translate(0, 0.39, -0.075);
  S.chassis = chassis;
  // Wheel-well liners
  const liners = [];
  for (const [za, R] of [
    [FRONT_AXLE, 0.405],
    [REAR_AXLE, 0.415],
  ]) {
    const l = new THREE.CylinderGeometry(R + 0.005, R + 0.005, 1.7, 24, 1, true, -0.05, Math.PI + 0.1);
    l.rotateZ(Math.PI / 2);
    l.translate(0, WHEEL_RADIUS - 0.02, za);
    liners.push(l);
  }
  S.liners = mergeSimple(liners);
  // Mirrors
  const mir = [];
  const stalks = [];
  for (const side of [1, -1]) {
    const m = new THREE.SphereGeometry(1, 12, 8);
    // teardrop housing: blunt glass face backward, tapering forward
    const mp = m.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const z = mp.getZ(i);
      const k = z > 0 ? 1 - z * 0.45 : 1;
      mp.setXYZ(i, mp.getX(i) * k, mp.getY(i) * k, z);
    }
    m.computeVertexNormals();
    m.scale(0.065, 0.044, 0.1);
    m.translate(side * 0.985, 0.925, 0.62);
    mir.push(m);
    const st = new THREE.BoxGeometry(0.2, 0.018, 0.045);
    st.rotateZ(side * 0.2);
    st.translate(side * 0.885, 0.895, 0.63);
    stalks.push(st);
  }
  S.mirrors = mergeSimple(mir);
  S.mirrorStalks = mergeSimple(stalks);
  // Rear wing (optional per car)
  const foil = new THREE.Shape();
  // inverted (downforce) profile: camber faces the road, leading edge forward
  foil.moveTo(0.16, 0);
  foil.bezierCurveTo(0.1, -0.03, -0.08, -0.04, -0.16, -0.012);
  foil.lineTo(-0.16, 0.004);
  foil.bezierCurveTo(-0.05, -0.005, 0.1, 0.012, 0.16, 0);
  const wingGeo = new THREE.ExtrudeGeometry(foil, { depth: 1.72, bevelEnabled: false, curveSegments: 12 });
  wingGeo.translate(0, 0, -0.86);
  wingGeo.rotateY(-Math.PI / 2);
  wingGeo.rotateX(0.1);
  wingGeo.translate(0, 1.14, -2.12);
  const plates = [];
  for (const s of [-1, 1]) {
    const p = new THREE.BoxGeometry(0.012, 0.16, 0.36);
    p.translate(s * 0.865, 1.12, -2.12);
    plates.push(p);
  }
  const struts = [];
  for (const s of [-1, 1]) {
    const st = new THREE.BoxGeometry(0.02, 0.24, 0.12);
    st.translate(s * 0.42, 1.0, -2.08);
    struts.push(st);
  }
  S.wing = mergeSimple([wingGeo, ...plates, ...struts]);

  // Wheels
  S.tireF = buildTireGeometry(0.255);
  S.tireR = buildTireGeometry(0.3);
  S.rimFace = buildRimFaceGeometry();
  const barrel = new THREE.CylinderGeometry(0.24, 0.24, 0.23, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  S.rimBarrel = barrel;
  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.026, 32);
  disc.rotateZ(Math.PI / 2);
  S.disc = disc;
  const hub = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 16);
  hub.rotateZ(Math.PI / 2);
  S.hub = hub;
  const nuts = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6);
    nut.rotateZ(Math.PI / 2);
    nut.translate(0, Math.cos(a) * 0.058, Math.sin(a) * 0.058);
    nuts.push(nut);
  }
  S.nuts = mergeSimple(nuts);
  S.caliper = buildCaliperGeometry();

  // Merge body parts that share a material (one draw call each per car).
  const [cabinGlass, cabinTrim, cabinRoof] = splitGroups(cabin);
  S.paintGeo = mergeSimple([body.shell, body.rearCap, S.mirrors, cabinRoof]);
  S.glassGeo = cabinGlass;
  S.trimGeo = mergeSimple([cabinTrim, S.doorLines, S.louvres, S.mirrorStalks]);
  S.grilleGeo = mergeSimple([planarUv(body.frontCap.toNonIndexed(), 0.7, 2.2, 0.5, -0.4), S.grille, S.sideIntake]);
  S.plasticGeo = mergeSimple([S.diffuser, S.splitter, S.chassis]);
  S.tailGeo = mergeSimple([S.tailWrap, S.tailBar]);

  // Wheel parts with their offsets baked in (wheel-local frame, +X = outward on a left wheel).
  const part = (geo, x) => {
    const g = geo.clone();
    g.translate(x, 0, 0);
    return g;
  };
  const rimFor = (w) => mergeSimple([part(S.rimFace, w / 2 - 0.075), part(S.hub, w / 2 - 0.035)]);
  const discFor = (w) => mergeSimple([part(S.disc, -0.01), part(S.nuts, w / 2 - 0.03)]);
  const caliper = S.caliper.clone();
  caliper.rotateX(0.6); // upper-rear quadrant of the disc
  caliper.translate(0.02, 0, 0);
  S.wheelParts = {
    tireF: S.tireF,
    tireR: S.tireR,
    rimF: rimFor(0.255),
    rimR: rimFor(0.3),
    barrel: part(S.rimBarrel, -0.02),
    discF: discFor(0.255),
    discR: discFor(0.3),
    caliper,
  };

  // Materials shared by every car
  const carbonTex = createCarbonTexture();
  carbonTex.repeat.set(6, 6);
  S.mats = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.3, roughness: 0.22 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.0, roughness: 0.85, envMapIntensity: 0.4 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonTex, color: 0x9a9a9a, metalness: 0.2, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.7 }),
    grille: new THREE.MeshStandardMaterial({ map: (() => { const t = createGrilleTexture(); t.repeat.set(6, 3); return t; })(), roughness: 0.7, metalness: 0.2 }),
    liner: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.88, metalness: 0 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x77797c, roughness: 0.42, metalness: 0.9 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.28, metalness: 1 }),
    exhaustInner: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    plate: null,
  };
  return S;
}

export function getCarShared() {
  if (!SHARED) SHARED = buildShared();
  return SHARED;
}

// ---------------------------------------------------------------------------

export const PAINTS = [
  { id: 'lumen', name: 'Lumen Amber', color: '#ff9a1f' },
  { id: 'redline', name: 'Redline', color: '#c8101e' },
  { id: 'glacier', name: 'Glacier', color: '#e9eef2' },
  { id: 'midnight', name: 'Midnight', color: '#16233f' },
  { id: 'verdant', name: 'Verdant', color: '#1d6b4c' },
  { id: 'volt', name: 'Volt', color: '#c9e22b' },
  { id: 'graphite', name: 'Graphite', color: '#3b3f45' },
  { id: 'azure', name: 'Azure', color: '#1f6fd6' },
];

export class CarModel {
  constructor({ color = '#ff9a1f', rim = 'silver', caliper = '#d11a1a', wing = false, plate = 'LMN 01', ownWheels = true } = {}) {
    const S = getCarShared();
    this.shared = S;
    this.root = new THREE.Group(); // placed at the CG on the ground by the Car
    this.root.name = 'car';
    this.chassis = new THREE.Group(); // sprung mass: pitch/roll/heave
    this.chassis.position.z = -CG_OFFSET;
    this.root.add(this.chassis);

    this.paint = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      metalness: 0.62,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      envMapIntensity: 1.25,
    });
    this.headMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1d22,
      metalness: 0.4,
      roughness: 0.08,
      clearcoat: 1,
      emissive: new THREE.Color(0.85, 0.9, 1.0),
      emissiveIntensity: 0.25,
    });
    this.drlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.4, 7) });
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x300406,
      emissive: new THREE.Color(1, 0.04, 0.03),
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    const rimColors = { silver: 0xc9ccd0, black: 0x1b1c1f, bronze: 0x9c7a44, gunmetal: 0x4a4e55 };
    this.rimMat = new THREE.MeshStandardMaterial({ color: rimColors[rim] ?? rimColors.silver, metalness: 1, roughness: 0.26 });
    this.caliperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(caliper), metalness: 0.3, roughness: 0.4 });
    if (!S.mats.plateCache) S.mats.plateCache = new Map();
    let plateMat = S.mats.plateCache.get(plate);
    if (!plateMat) {
      plateMat = new THREE.MeshStandardMaterial({ map: createPlateTexture(plate), roughness: 0.5 });
      S.mats.plateCache.set(plate, plateMat);
    }

    const M = S.mats;
    const add = (geo, mat, { cast = true, receive = true, parent = this.chassis } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      parent.add(m);
      return m;
    };
    this.bodyMesh = add(S.paintGeo, this.paint);
    add(S.glassGeo, M.glass);
    add(S.trimGeo, M.trim, { cast: false });
    add(S.grilleGeo, M.grille, { cast: false });
    add(S.skirt, M.carbon, { cast: false });
    add(S.plasticGeo, M.plastic);
    add(S.headLens, this.headMat, { cast: false });
    add(S.headDrl, this.drlMat, { cast: false, receive: false });
    add(S.tailGeo, this.tailMat, { cast: false });
    add(S.plate, plateMat, { cast: false });
    add(S.exhaust, M.exhaust);
    add(S.exhaustInner, M.exhaustInner, { cast: false });
    add(S.liners, M.liner, { cast: false });
    if (wing) add(S.wing, M.carbon);

    // Wheel state (left side at +X). Rendering is either shared instancing
    // (WheelInstances, used in-game) or per-car meshes (ownWheels).
    this.rimColor = this.rimMat.color;
    this.caliperColor = this.caliperMat.color;
    this.wheels = [
      { x: TRACK_FRONT, z: FRONT_AXLE - CG_OFFSET, front: true, right: false },
      { x: -TRACK_FRONT, z: FRONT_AXLE - CG_OFFSET, front: true, right: true },
      { x: TRACK_REAR, z: REAR_AXLE - CG_OFFSET, front: false, right: false },
      { x: -TRACK_REAR, z: REAR_AXLE - CG_OFFSET, front: false, right: true },
    ].map((w) => ({ ...w, steer: 0, spin: 0, offset: 0, pivot: null, spinGroup: null }));
    if (ownWheels) {
      const P = S.wheelParts;
      for (const w of this.wheels) {
        const pivot = new THREE.Group();
        pivot.position.set(w.x, WHEEL_RADIUS, w.z);
        this.root.add(pivot);
        const side = new THREE.Group();
        side.rotation.y = w.right ? Math.PI : 0;
        pivot.add(side);
        const spinGroup = new THREE.Group();
        side.add(spinGroup);
        const meshes = [
          [w.front ? P.tireF : P.tireR, M.tire, true],
          [w.front ? P.rimF : P.rimR, this.rimMat, true],
          [P.barrel, M.barrel, false],
          [w.front ? P.discF : P.discR, M.disc, false],
        ];
        for (const [g, m, cast] of meshes) {
          const mesh = new THREE.Mesh(g, m);
          mesh.castShadow = cast;
          mesh.receiveShadow = true;
          spinGroup.add(mesh);
        }
        const cal = new THREE.Mesh(P.caliper, this.caliperMat);
        if (w.right) cal.rotation.x = Math.PI - 1.2;
        side.add(cal);
        w.pivot = pivot;
        w.spinGroup = spinGroup;
      }
    }

    // Soft contact shadow
    this.shadowMat = null;
    this.brake = false;
    this.reverse = false;
    this.headlightsOn = false;
  }

  attachContactShadow(texture) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8, toneMapped: false });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 5.3), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.03, -CG_OFFSET);
    m.renderOrder = 1;
    this.root.add(m);
    this.contactShadow = m;
    this.shadowMat = mat;
  }

  setPaint(color) {
    this.paint.color.set(color);
  }

  setLights({ brake = false, reverse = false, headlights = false } = {}) {
    this.tailMat.emissiveIntensity = brake ? 6 : headlights ? 2.6 : 2.2;
    this.headMat.emissiveIntensity = headlights ? 6 : 0.25;
  }

  /**
   * state: { steer (rad, +left), wheelSpin [4] (rad), suspension [4] (m, + = compressed),
   *          pitch, roll, heave }
   */
  update(state) {
    this.chassis.rotation.set(state.pitch, 0, state.roll, 'YXZ');
    this.chassis.position.y = state.heave;
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      w.steer = w.front ? state.steer : 0;
      w.spin = state.wheelSpin[k];
      w.offset = state.wheelOffset ? state.wheelOffset[k] : 0;
      if (w.pivot) {
        w.pivot.rotation.y = w.steer;
        w.pivot.position.y = WHEEL_RADIUS + w.offset;
        w.spinGroup.rotation.x = w.right ? -w.spin : w.spin;
      }
    }
  }
}
