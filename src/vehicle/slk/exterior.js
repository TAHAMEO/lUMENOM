// Exterior details of the SLK built around the body's openings: grille with
// star and blade, AMG bumper intakes, number plate, splitter, headlamps and
// the fender vents. Openings come from the body's trim loops so every part
// sits exactly on the shell.

import * as THREE from 'three';
import {
  bodyNormal,
  bodySDF,
  DIFFUSER_OUTLINE,
  GILL_FRAME,
  GILL_OUTLINE,
  LAMP_FRAME,
  LAMP_OUTLINE,
  REAR_PLATE_OUTLINE,
  SIDE_INTAKE_FRAME,
  SIDE_INTAKE_OUTLINE,
  TAIL_AXIS,
  TAIL_OUTLINE,
  tailUV,
  TRIMS,
} from './shape.js';
import { bothSides, capFan, gridMesh, merge, resample, roundedRect, sweep } from './geom.js';
import { starGeometry } from './wheel.js';

const trim = (name) => TRIMS.find((t) => t.name === name);
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _n = [0, 0, 0];

/** Cast from `p` along `d` (unit, pointing into the body) onto the shell. */
export function castOnto(p, d, maxT = 0.8) {
  let t = 0;
  let prev = bodySDF(p[0], p[1], p[2]);
  if (prev < 0) return p.slice();
  for (; t < maxT; t += 0.004) {
    const q = add(p, d, t);
    const f = bodySDF(q[0], q[1], q[2]);
    if (f < 0) {
      let lo = t - 0.004;
      let hi = t;
      for (let i = 0; i < 26; i++) {
        const m = (lo + hi) / 2;
        const r = add(p, d, m);
        if (bodySDF(r[0], r[1], r[2]) < 0) hi = m;
        else lo = m;
      }
      return add(p, d, (lo + hi) / 2);
    }
    prev = f;
  }
  return add(p, d, maxT);
}

/** z of the body's front surface at (x, y). */
export function frontZ(x, y) {
  return castOnto([x, y, 2.4], [0, 0, -1], 1.2)[2];
}

/**
 * Trim frames map shell points to 2D feature coordinates and back.
 * planar: projection along N onto a plane (u, v); cylindrical: unwrapped
 * around a vertical axis (tail lamps). Each frame provides:
 *   to2(p) → [u, v], onShell(u, v, offset) → point pushed `offset` inward,
 *   inward(p) → unit direction into the body, outward(p) → its negation.
 */
function planar({ center, normal, u }) {
  const N = norm3(normal);
  const U = norm3(u);
  const V = cross(N, U);
  const C = center;
  const to3 = (a, b, n = 0) => [C[0] + U[0] * a + V[0] * b + N[0] * n, C[1] + U[1] * a + V[1] * b + N[1] * n, C[2] + U[2] * a + V[2] * b + N[2] * n];
  const minus = [-N[0], -N[1], -N[2]];
  return {
    N,
    U,
    V,
    to3,
    to2: (p) => {
      const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
      return [dot(d, U), dot(d, V)];
    },
    onShell: (a, b, offset = 0) => add(castOnto(to3(a, b, 0.4), minus, 1.2), N, -offset),
    inward: () => minus,
    outward: () => N,
  };
}

const FRONT_FRAME = planar({ center: [0, 0, 2.4], normal: [0, 0, 1], u: [1, 0, 0] });
const REAR_FRAME = planar({ center: [0, 0, -2.4], normal: [0, 0, -1], u: [-1, 0, 0] });
const TAIL_FRAME = (() => {
  const { x: ax, z: az, R0 } = TAIL_AXIS;
  const radial = (p) => norm3([Math.abs(p[0]) - ax, 0, p[2] - az]).map((c, i) => (i === 0 ? c * Math.sign(p[0] || 1) : c));
  return {
    to2: (p) => tailUV(p[0], p[1], p[2]),
    onShell: (u, v, offset = 0) => {
      const th = u / R0;
      const dir = [Math.cos(th), 0, -Math.sin(th)];
      const start = [ax + dir[0] * 0.9, v, az + dir[2] * 0.9];
      const hit = castOnto(start, [-dir[0], 0, -dir[2]], 1.0);
      return add(hit, dir, -offset);
    },
    inward: (p) => radial(p).map((c) => -c),
    outward: radial,
  };
})();

/**
 * Patch covering a 2D outline on (or behind) the shell: rings from the outline
 * to its centroid. `normals: 'field'` uses the shell's normals (for flush glass).
 */
function patch(F, outline2d, { offset = 0, rings = 8, samples = 64, normals = 'field', uvScale = 1 } = {}) {
  const closedPts = outline2d.map((p) => [p[0], p[1], 0]);
  closedPts.push(closedPts[0]);
  const ring = resample(closedPts, samples + 1).slice(0, samples);
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const rows = [];
  const nrows = [];
  const uvs = [];
  for (let k = 0; k <= rings; k++) {
    const t = 1 - k / rings;
    const row = [];
    const nrow = [];
    const uvrow = [];
    for (const p of ring) {
      const u = cx + (p[0] - cx) * t;
      const v = cy + (p[1] - cy) * t;
      const q = F.onShell(u, v, offset);
      row.push(q);
      uvrow.push([u * uvScale, v * uvScale]);
      if (normals === 'field') {
        const o = F.outward(q);
        bodyNormal(q[0] + o[0] * offset, q[1] + o[1] * offset, q[2] + o[2] * offset, _n);
        nrow.push([_n[0], _n[1], _n[2]]);
      } else nrow.push(F.outward(q));
    }
    rows.push(row);
    nrows.push(nrow);
    uvs.push(uvrow);
  }
  return gridMesh(rows, { closedRow: true, normals: nrows, uv: (i, j) => uvs[i][j] });
}

/**
 * Walls of an opening: rolled paint lip at the edge, then a wall straight into
 * the body by `depth`. `chain` is the opening's boundary on the shell; the
 * trim's value function gives the direction into the opening.
 */
function openingWalls(chain, F, trimDef, { depth = 0.05, lip = 0.003, steps = 3, closed = false } = {}) {
  const T3 = trimDef.value;
  const pts = closed ? [...chain, chain[0]] : chain;
  const lipRows = [];
  const lipN = [];
  const wallRows = [];
  const wallN = [];
  const e = 2e-4;
  for (const p of pts) {
    bodyNormal(p[0], p[1], p[2], _n);
    const n = [_n[0], _n[1], _n[2]];
    const g = [
      (T3(p[0] + e, p[1], p[2]) - T3(p[0] - e, p[1], p[2])) / (2 * e),
      (T3(p[0], p[1] + e, p[2]) - T3(p[0], p[1] - e, p[2])) / (2 * e),
      (T3(p[0], p[1], p[2] + e) - T3(p[0], p[1], p[2] - e)) / (2 * e),
    ];
    // into the opening = against the trim gradient, within the tangent plane
    let d = norm3(g.map((c) => -c));
    d = norm3(add(d, n, -dot(d, n)));
    if (!Number.isFinite(d[0])) d = F.inward(p);
    const lr = [];
    const ln = [];
    for (let s = 0; s <= steps; s++) {
      const phi = (s / steps) * (Math.PI / 2);
      lr.push(add(add(p, d, lip * Math.sin(phi)), n, -lip * (1 - Math.cos(phi))));
      ln.push(
        norm3(
          add(
            n.map((c) => c * Math.cos(phi)),
            d,
            Math.sin(phi),
          ),
        ),
      );
    }
    lipRows.push(lr);
    lipN.push(ln);
    const s0 = lr[steps];
    const inw = F.inward(p);
    wallRows.push([s0, add(s0, inw, depth * 0.5), add(s0, inw, depth)]);
    wallN.push([d, d, d]);
  }
  const Tr = (rows) => rows[0].map((_, j) => rows.map((r) => r[j]));
  return {
    lip: gridMesh(Tr(lipRows), { normals: Tr(lipN) }),
    wall: gridMesh(Tr(wallRows), { normals: Tr(wallN) }),
  };
}

/** Walls for every substantial boundary chain of an opening. */
function walls(chains, F, trimDef, opts) {
  const lips = [];
  const ws = [];
  const maxLen = Math.max(0, ...(chains || []).map((c) => c.length));
  for (const c of chains || []) {
    // ignore slivers where an outline grazes the shell's open lower edge
    if (c.length < 6 || c.length < maxLen * 0.2) continue;
    const w = openingWalls(c, F, trimDef, opts);
    lips.push(w.lip);
    ws.push(w.wall);
  }
  return { lip: lips.length ? merge(lips) : null, wall: ws.length ? merge(ws) : null };
}

const longest = (chains) => (chains || []).reduce((a, c) => (c.length > (a?.length || 0) ? c : a), null);

/** Thin strip lying on the shell along a polyline (panel gaps, seals). */
export function shellStrip(points, width, lift = 0.0006) {
  const rows = [[], []];
  const nrows = [[], []];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(points.length - 1, i + 1)];
    const o = points[Math.max(0, i - 1)];
    const T = norm3(sub(q, o));
    bodyNormal(p[0], p[1], p[2], _n);
    const n = [_n[0], _n[1], _n[2]];
    const S = norm3(cross(T, n));
    const base = add(p, n, lift);
    rows[0].push(add(base, S, -width / 2));
    rows[1].push(add(base, S, width / 2));
    nrows[0].push(n);
    nrows[1].push(n);
  }
  return gridMesh(rows, { normals: nrows });
}

// ---------------------------------------------------------------------------

/**
 * Build every front/side detail. Returns geometries grouped by material key.
 */
export function buildExterior(loops) {
  const out = {
    paint: [],
    black: [], // textured black plastic walls
    gloss: [],
    chrome: [],
    satin: [],
    pins: [], // grille insert
    honeycomb: [],
    plate: [],
    plateHolder: [],
    lampHousing: [],
    lampChrome: [],
    lens: [],
    drl: [],
    indicator: [],
    tailBack: [],
    tailLens: [],
    tailLed: [],
    reverse: [],
    exhaust: [],
    soot: [],
    gaps: [],
    mirrorGlass: [],
  };

  const pushWalls = (w, lipKey, wallKey, mirror = true) => {
    if (w.lip) out[lipKey].push(mirror ? bothSides(w.lip) : w.lip);
    if (w.wall) out[wallKey].push(mirror ? bothSides(w.wall) : w.wall);
  };

  // --- grille ---------------------------------------------------------------
  const G = trim('grille');
  const gChain = longest(loops.grille);
  if (gChain) {
    pushWalls(walls(loops.grille, FRONT_FRAME, G, { depth: 0.05 }), 'paint', 'black');
    // chrome surround sitting on the edge
    const path = resample(gChain, 90);
    const up = (i) => {
      bodyNormal(path[i][0], path[i][1], path[i][2], _n);
      return [_n[0], _n[1], _n[2]];
    };
    const surround = sweep(
      path,
      [
        [-0.009, -0.002],
        [-0.008, 0.002],
        [-0.005, 0.0045],
        [0, 0.0055],
        [0.005, 0.0045],
        [0.008, 0.002],
        [0.009, -0.002],
      ],
      { up, closedProfile: false },
    );
    out.chrome.push(bothSides(surround));
    // pin-mesh insert following the nose curvature, 5 cm back
    out.pins.push(patch(FRONT_FRAME, G.outline.poly, { offset: 0.048, rings: 6, samples: 96, normals: 'flat', uvScale: 1 / 0.03 }));
    // horizontal blade through the star
    const bladePath = [];
    for (let i = 0; i <= 24; i++) {
      const x = -0.43 + (0.86 * i) / 24;
      bladePath.push([x, 0.552, frontZ(x, 0.552) - 0.014]);
    }
    const blade = sweep(
      bladePath,
      [
        [-0.013, -0.028],
        [-0.013, 0.0],
        [-0.009, 0.005],
        [0, 0.007],
        [0.009, 0.005],
        [0.013, 0.0],
        [0.013, -0.028],
      ],
      { up: [0, 0, 1], capStart: true, capEnd: true },
    );
    out.chrome.push(blade);
    // big three-pointed star in its ring
    const star = starGeometry(0.086, { depth: 0.012, ringWidth: 0.15, base: 0.19 });
    star.rotateY(-Math.PI / 2);
    star.translate(0, 0.562, frontZ(0, 0.562) - 0.004);
    out.satin.push(star);
    const starBack = new THREE.CircleGeometry(0.084, 48);
    starBack.translate(0, 0.562, frontZ(0, 0.562) - 0.012);
    out.gloss.push(starBack);
  }

  // --- central intake with plate ---------------------------------------------
  const I = trim('intake');
  if (loops.intake?.length) {
    pushWalls(walls(loops.intake, FRONT_FRAME, I, { depth: 0.07 }), 'paint', 'black');
    out.honeycomb.push(patch(FRONT_FRAME, I.outline.poly, { offset: 0.068, rings: 5, samples: 80, normals: 'flat', uvScale: 1 / 0.05 }));
    // plate on a black holder across the intake
    const zp = frontZ(0, 0.366);
    const holder = new THREE.BoxGeometry(0.4, 0.118, 0.03);
    holder.translate(0, 0.366, zp - 0.012);
    out.plateHolder.push(holder);
    const plate = new THREE.PlaneGeometry(0.372, 0.1);
    plate.translate(0, 0.366, zp + 0.0045);
    out.plate.push(plate);
  }

  // --- lateral intakes with chrome fins --------------------------------------
  const SI = trim('sideIntake');
  if (loops.sideIntake?.length) {
    const F = planar(SIDE_INTAKE_FRAME);
    pushWalls(walls(loops.sideIntake, F, SI, { depth: 0.06, closed: true }), 'paint', 'black');
    out.honeycomb.push(bothSides(patch(F, SIDE_INTAKE_OUTLINE, { offset: 0.058, rings: 4, samples: 48, normals: 'flat', uvScale: 1 / 0.05 })));
    const fin = [];
    for (let i = 0; i <= 16; i++) {
      const u = -0.148 + (0.286 * i) / 16;
      fin.push(F.onShell(u, 0.002 + 0.004 * (u / 0.14), 0.012));
    }
    const finProfile = [
      [-0.006, -0.02],
      [-0.006, 0.0],
      [0, 0.004],
      [0.006, 0.0],
      [0.006, -0.02],
    ];
    out.chrome.push(bothSides(sweep(fin, finProfile, { up: F.N, capStart: true, capEnd: true })));
  }

  // --- black splitter under the bumper (tapers out before the wheels) --------
  {
    const path = [];
    for (let i = 0; i <= 40; i++) {
      const x = -0.72 + (1.44 * i) / 40;
      path.push([x, 0.206, frontZ(x, 0.24) - 0.012]);
    }
    const splitter = sweep(
      path,
      [
        [0.028, -0.014],
        [0.03, 0.0],
        [0.022, 0.016],
        [-0.14, 0.02],
        [-0.14, -0.014],
      ],
      { up: [0, 1, 0], capStart: true, capEnd: true, scale: (t) => [1, 1 - (0.55 * Math.max(0, Math.abs(t - 0.5) * 2 - 0.8)) / 0.2] },
    );
    out.gloss.push(splitter);
  }

  // --- headlamps --------------------------------------------------------------
  const L = trim('headlamp');
  if (loops.headlamp?.length) {
    const F = planar(LAMP_FRAME);
    pushWalls(walls(loops.headlamp, F, L, { depth: 0.075, lip: 0.002, closed: true }), 'paint', 'lampHousing');
    // reflector back of the housing, flush clear lens
    out.lampChrome.push(bothSides(patch(F, LAMP_OUTLINE, { offset: 0.074, rings: 6, samples: 72, normals: 'flat' })));
    out.lens.push(bothSides(patch(F, LAMP_OUTLINE, { offset: 0.0008, rings: 10, samples: 96 })));
    // projector modules in dark bowls with chrome rings
    for (const [u, v, r] of [
      [0.162, 0.04, 0.041],
      [0.051, -0.023, 0.034],
    ]) {
      const back = F.onShell(u, v, 0.072);
      const bowl = new THREE.LatheGeometry(
        [
          [r * 1.6, 0.0],
          [r * 1.5, 0.012],
          [r * 1.22, 0.028],
          [r * 1.05, 0.036],
        ].map(([a, b]) => new THREE.Vector2(a, b)),
        32,
      );
      const lens = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.35);
      const ring = new THREE.TorusGeometry(r * 1.02, 0.0035, 8, 32);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, 0.036, 0);
      lens.translate(0, 0.036 - r * Math.cos(Math.PI * 0.35), 0);
      const m = new THREE.Matrix4();
      const Y = new THREE.Vector3(...F.N);
      const X = new THREE.Vector3(...F.U);
      const Z = new THREE.Vector3().crossVectors(X, Y);
      m.makeBasis(X, Y, Z).setPosition(...back);
      for (const g of [bowl, lens, ring]) g.applyMatrix4(m);
      out.lampHousing.push(bothSides(bowl));
      out.lampChrome.push(bothSides(ring));
      out.drl.push(bothSides(lens));
    }
    // chrome eyebrow along the lower edge with the indicator at the inner tip
    const brow = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      brow.push(F.onShell(-0.175 + t * 0.29, -0.128 + 0.07 * t * t + 0.02 * t, 0.03));
    }
    const browProfile = [
      [-0.009, 0],
      [0, 0.004],
      [0.009, 0],
      [0, -0.004],
    ];
    out.lampChrome.push(bothSides(sweep(brow, browProfile, { up: F.N })));
    const tip = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      tip.push(F.onShell(-0.19 + t * 0.07, -0.132 + t * 0.012, 0.02));
    }
    out.indicator.push(
      bothSides(
        sweep(
          tip,
          browProfile.map(([a, b]) => [a * 0.8, b * 1.1]),
          { up: F.N },
        ),
      ),
    );
  }

  // --- fender vents -------------------------------------------------------------
  const V = trim('gill');
  if (loops.gill?.length) {
    const F = planar(GILL_FRAME);
    pushWalls(walls(loops.gill, F, V, { depth: 0.022, lip: 0.002, closed: true }), 'paint', 'black');
    out.gloss.push(bothSides(patch(F, GILL_OUTLINE, { offset: 0.021, rings: 3, samples: 40, normals: 'flat' })));
    const bar = [];
    for (let i = 0; i <= 12; i++) {
      const u = -0.1 + (0.225 * i) / 12;
      bar.push(F.onShell(u, -0.006 + 0.004 * (u / 0.1), 0.004));
    }
    const barProfile = [
      [-0.0045, -0.006],
      [-0.0045, 0.001],
      [0, 0.0035],
      [0.0045, 0.001],
      [0.0045, -0.006],
    ];
    out.chrome.push(bothSides(sweep(bar, barProfile, { up: F.N, capStart: true, capEnd: true })));
  }

  // --- tail lamps (wrap around the rear corners) --------------------------------
  const TL = trim('taillamp');
  if (loops.taillamp?.length) {
    const F = TAIL_FRAME;
    pushWalls(walls(loops.taillamp, F, TL, { depth: 0.05, lip: 0.002, closed: true }), 'paint', 'lampHousing');
    out.tailBack.push(bothSides(patch(F, TAIL_OUTLINE, { offset: 0.048, rings: 5, samples: 80, normals: 'flat' })));
    out.tailLens.push(bothSides(patch(F, TAIL_OUTLINE, { offset: 0.0008, rings: 8, samples: 110 })));
    // two LED light bars following the lamp, and a reversing light at the inner end
    for (const [v0, v1] of [
      [0.815, 0.842],
      [0.775, 0.8],
    ]) {
      const bar = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const u = 0.07 + t * 0.6;
        bar.push(F.onShell(u, v0 + (v1 - v0) * Math.sin(t * Math.PI * 0.5) + 0.02 * t, 0.018));
      }
      out.tailLed.push(bothSides(sweep(bar, roundedRect(0.008, 0.012, 0.003, 2), { up: (i) => F.outward(bar[i]) })));
    }
    const rev = [];
    for (let i = 0; i <= 8; i++) rev.push(F.onShell(0.6 + i * 0.013, 0.768, 0.02));
    out.reverse.push(bothSides(sweep(rev, roundedRect(0.02, 0.012, 0.004, 2), { up: (i) => F.outward(rev[i]) })));
  }

  // --- rear: plate recess, diffuser with tailpipe trims, badge, brake light ------
  const RP = trim('rearPlate');
  if (loops.rearPlate?.length) {
    pushWalls(walls(loops.rearPlate, REAR_FRAME, RP, { depth: 0.018, lip: 0.002 }), 'paint', 'paint');
    out.paint.push(patch(REAR_FRAME, REAR_PLATE_OUTLINE, { offset: 0.017, rings: 3, samples: 40, normals: 'flat' }));
    const zp = castOnto([0, 0.503, -2.4], [0, 0, 1], 0.8)[2] + 0.017;
    const plate = new THREE.PlaneGeometry(0.372, 0.1);
    plate.rotateY(Math.PI);
    plate.translate(0, 0.503, zp - 0.004);
    out.plate.push(plate);
  }
  const DF = trim('diffuser');
  if (loops.diffuser?.length) {
    pushWalls(walls(loops.diffuser, REAR_FRAME, DF, { depth: 0.045, lip: 0.002 }), 'paint', 'black');
    out.gloss.push(patch(REAR_FRAME, DIFFUSER_OUTLINE, { offset: 0.044, rings: 3, samples: 64, normals: 'flat' }));
    for (const x of [-0.24, -0.08, 0.08, 0.24]) {
      const fin = new THREE.BoxGeometry(0.008, 0.066, 0.036);
      const z = castOnto([x, 0.31, -2.4], [0, 0, 1], 0.8)[2];
      fin.translate(x, 0.307, z + 0.026);
      out.gloss.push(fin);
    }
    // twin tailpipe trims at the outer ends of the diffuser
    for (const sx of [-1, 1]) {
      const cx = sx * 0.43;
      const z = castOnto([cx, 0.29, -2.4], [0, 0, 1], 0.8)[2];
      const ring = [];
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        // rounded trapezoid, wider at the bottom
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const w = 0.085 - 0.012 * sn;
        const px = cx + Math.sign(c) * Math.abs(c) ** 0.5 * w;
        const py = 0.29 + Math.sign(sn) * Math.abs(sn) ** 0.6 * 0.034;
        ring.push([px, py, z - 0.004]);
      }
      out.exhaust.push(sweep(ring, roundedRect(0.012, 0.03, 0.005, 2), { up: [0, 0, -1] }));
      const inner = new THREE.CircleGeometry(1, 32);
      inner.scale(0.076, 0.028, 1);
      inner.rotateY(Math.PI);
      inner.translate(cx, 0.29, z + 0.02);
      out.soot.push(inner);
    }
  }
  {
    const z = castOnto([0, 0.82, -2.4], [0, 0, 1], 0.8)[2];
    const star = starGeometry(0.052, { depth: 0.008, ringWidth: 0.15, base: 0.19 });
    star.rotateY(Math.PI / 2);
    star.translate(0, 0.82, z - 0.006);
    out.satin.push(star);
    const brake = [];
    for (let i = 0; i <= 16; i++) {
      const x = -0.16 + (0.32 * i) / 16;
      const p = castOnto([x, 1.4, -1.985], [0, -1, 0], 1);
      brake.push([p[0], p[1] + 0.003, p[2]]);
    }
    out.tailLed.push(sweep(brake, roundedRect(0.012, 0.006, 0.002, 1), { up: [0, 1, 0] }));
    // trunk lid lower edge between the lamps
    const lid = [];
    for (let i = 0; i <= 30; i++) {
      const x = -0.4 + (0.8 * i) / 30;
      lid.push(castOnto([x, 0.614, -2.4], [0, 0, 1], 0.8));
    }
    out.gaps.push(shellStrip(lid, 0.0035));
  }

  // --- doors, hood and deck: shut lines, handles, mirrors ------------------------
  const onSide = (z, y) => castOnto([1.3, y, z], [-1, 0, 0], 0.8);
  const onTopAt = (x, z) => castOnto([x, 1.6, z], [0, -1, 0], 1.4);
  const line = (fn, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
  };
  // door front and rear cut lines, bottom edge
  const front = line((t) => {
    const y = 0.245 + t * 0.672;
    return onSide(0.534 - 0.03 * ((y - 0.58) / 0.34) ** 2 - 0.018 * Math.max(0, (y - 0.8) / 0.12) ** 2, y);
  }, 30);
  const rear = line((t) => {
    const y = 0.232 + t * 0.7;
    return onSide(-0.72 - 0.085 * Math.max(0, (y - 0.62) / 0.3) ** 2.2, y);
  }, 30);
  const bottom = line((t) => {
    const z = 0.512 - t * 1.23;
    return onSide(z, 0.245 - 0.022 * Math.sin(Math.PI * t));
  }, 40);
  out.gaps.push(bothSides(shellStrip(front, 0.0035)), bothSides(shellStrip(rear, 0.0035)), bothSides(shellStrip(bottom, 0.0035)));
  // hood: rear edge, sides along the fender tops, down to the lamp tops
  const hoodSide = line((t) => {
    const z = 0.61 + t * 0.9;
    return onTopAt(0.705 - 0.03 * t * t, z);
  }, 30);
  const hoodRear = line((t) => onTopAt(-0.705 + 1.41 * t, 0.61), 40);
  out.gaps.push(bothSides(shellStrip(hoodSide, 0.0035)), shellStrip(hoodRear, 0.0035));
  // rear deck lid
  const deckFront = line((t) => onTopAt(-0.66 + 1.32 * t, -1.2 - 0.02 * Math.cos(Math.PI * (t - 0.5))), 40);
  const deckSide = line((t) => onTopAt(0.66 - 0.1 * t * t, -1.2 - t * 0.62), 30);
  out.gaps.push(shellStrip(deckFront, 0.0035), bothSides(shellStrip(deckSide, 0.0035)));
  // door handle: dark recess and a body-coloured grip
  {
    const rec = [];
    const N = 28;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      rec.push(onSide(-0.518 + Math.cos(a) * 0.105, 0.774 + Math.sin(a) * 0.024));
    }
    const c = onSide(-0.518, 0.774);
    const pos = [c[0] + 0.0008, c[1], c[2]];
    for (const p of rec) pos.push(p[0] + 0.0008, p[1], p[2]);
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.gloss.push(bothSides(g));
    const grip = [];
    for (let i = 0; i <= 12; i++) {
      const z = -0.424 - (0.19 * i) / 12;
      const p = onSide(z, 0.776);
      grip.push([p[0] + 0.012, p[1], p[2]]);
    }
    out.paint.push(bothSides(sweep(grip, roundedRect(0.022, 0.016, 0.007, 3), { up: [1, 0, 0], capStart: true, capEnd: true })));
  }
  // exterior mirrors: black base on the door top, body-coloured housing
  {
    const base = onTopAt(0.8, 0.3);
    const arm = sweep(
      [
        [base[0] - 0.01, base[1] - 0.005, 0.33],
        [0.84, base[1] + 0.012, 0.25],
        [0.88, 0.95, 0.17],
      ],
      roundedRect(0.034, 0.05, 0.012, 3),
      { up: [0, 1, 0], capStart: true, capEnd: true },
    );
    out.gloss.push(bothSides(arm));
    const sail = new THREE.BufferGeometry();
    const b0 = onTopAt(0.78, 0.45);
    const b1 = onTopAt(0.8, 0.22);
    sail.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...b0, ...b1, 0.83, 0.985, 0.36].map((v, i) => (i % 3 === 1 ? v + 0.004 : v)),
        3,
      ),
    );
    sail.setIndex([0, 1, 2]);
    sail.computeVertexNormals();
    out.gloss.push(bothSides(sail));
    // housing: D-shaped sections lofted outward from the arm, flat glass face at the rear
    const zg = 0.098; // rear (glass) plane
    const secs = [];
    const NX = 14;
    const NP = 20;
    for (let i = 0; i <= NX; i++) {
      const t = i / NX;
      const x = 0.86 + t * 0.2;
      // grows toward the outer end, then rounds off at the tip
      const tip = Math.sqrt(Math.max(0, 1 - Math.max(0, (t - 0.82) / 0.18) ** 2));
      const h = (0.078 + 0.036 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5)) * (0.25 + 0.75 * tip);
      const d = (0.052 + 0.022 * t) * (0.3 + 0.7 * tip);
      const yc = 0.962 + 0.008 * t;
      const row = [];
      for (let j = 0; j < NP; j++) {
        const phi = -Math.PI / 2 + (Math.PI * j) / (NP - 1);
        const c = Math.cos(phi);
        row.push([x, yc + (h / 2) * Math.sin(phi) * (1 - 0.1 * c), zg + d * Math.sign(c) * Math.abs(c) ** 0.75]);
      }
      // flat rear face back to the start
      for (let j = NP - 2; j >= 1; j--) {
        const phi = -Math.PI / 2 + (Math.PI * j) / (NP - 1);
        row.push([x, yc + (h / 2) * Math.sin(phi) * 0.96, zg]);
      }
      secs.push(row);
    }
    const housing = gridMesh(secs, { closedRow: true });
    housing.computeVertexNormals();
    const hMesh = merge([housing, capFan(secs[NX])]);
    // one transform for housing, glass and indicator: toe the mirror in about its own centre
    const pivot = new THREE.Vector3(0.96, 0.965, zg);
    const M = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z + 0.012)
      .multiply(new THREE.Matrix4().makeRotationY(-0.12))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    hMesh.applyMatrix4(M);
    out.paint.push(bothSides(hMesh));
    const glass = new THREE.CircleGeometry(1, 32);
    glass.scale(0.084, 0.042, 1);
    glass.rotateY(Math.PI);
    glass.translate(0.968, 0.967, zg - 0.0015);
    glass.applyMatrix4(M);
    out.mirrorGlass.push(bothSides(glass));
    // indicator strip along the lower front edge of the housing
    const ind = [];
    for (let i = 0; i <= 12; i++) {
      const t = 0.12 + (i / 12) * 0.7;
      const x = 0.86 + t * 0.2;
      const h = 0.078 + 0.036 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5);
      const d = 0.052 + 0.022 * t;
      const phi = -1.0;
      const c = Math.cos(phi);
      ind.push([x, 0.962 + 0.008 * t + (h / 2) * Math.sin(phi) * (1 - 0.1 * c), zg + d * c ** 0.75 + 0.0015]);
    }
    const indGeo = sweep(ind, roundedRect(0.006, 0.005, 0.002, 1), { up: [0, -0.6, 0.8] });
    indGeo.applyMatrix4(M);
    out.indicator.push(bothSides(indGeo));
  }

  const result = {};
  for (const [k, list] of Object.entries(out)) if (list.length) result[k] = merge(list);
  return result;
}
