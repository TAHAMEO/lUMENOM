// Windscreen, its body-coloured frame (A-pillars + header), mirror, wipers,
// seals, and the cockpit: dashboard, instruments, steering wheel, console,
// seats and roll-over hoops. Built in the design frame (see shape.js).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COCKPIT_OUTLINE } from './shape.js';
import { castOnto } from './exterior.js';
import { gridMesh, merge, roundedRect, spline3, sweep } from './geom.js';
import { starGeometry } from './wheel.js';

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Point on the shell straight below (x, z). */
const onTop = (x, z) => castOnto([x, 1.6, z], [0, -1, 0], 1.4);

// ---------------------------------------------------------------------------
// Windscreen geometry

export const SCREEN = {
  baseHalf: 0.705, // half-width at the cowl
  topHalf: 0.628,
  baseZ: (s) => 0.553 - 0.113 * s * s, // follows the cockpit opening's front edge
  topY: (s) => 1.186 - 0.036 * s * s,
  topZ: (s) => 0.077 - 0.168 * s * s,
};

function screenBase(s) {
  const x = SCREEN.baseHalf * s;
  const p = onTop(x, SCREEN.baseZ(s) + 0.012);
  return [x, p[1] + 0.004, p[2]];
}
function screenTop(s) {
  return [SCREEN.topHalf * s, SCREEN.topY(s), SCREEN.topZ(s)];
}
/** Glass surface point: ruled between base and top with a gentle outward bow. */
export function screenPoint(s, t) {
  const b = screenBase(s);
  const a = screenTop(s);
  const p = lerp3(b, a, t);
  const bow = 0.012 * Math.sin(Math.PI * t) * (1 - 0.35 * s * s);
  // outward normal of the screen plane ≈ (0, 0.89, 0.45)
  return [p[0], p[1] + bow * 0.89, p[2] + bow * 0.45];
}

function glassGeometry() {
  const rows = [];
  const NS = 40;
  const NT = 14;
  for (let i = 0; i <= NT; i++) {
    const row = [];
    for (let j = 0; j <= NS; j++) row.push(screenPoint(-1 + (2 * j) / NS, i / NT));
    rows.push(row);
  }
  return gridMesh(rows);
}

/** Black ceramic frit band around the glass edge (inner side). */
function fritGeometry() {
  const parts = [];
  const band = (a, b) => {
    const rows = [];
    const N = 40;
    for (let i = 0; i <= 1; i++) {
      const row = [];
      for (let j = 0; j <= N; j++) {
        const t = j / N;
        row.push(i === 0 ? a(t) : b(t));
      }
      rows.push(row);
    }
    return gridMesh(rows);
  };
  const lift = (p) => [p[0], p[1] - 0.0015, p[2] - 0.001];
  // bottom band
  parts.push(
    band(
      (t) => lift(screenPoint(-1 + 2 * t, 0.0)),
      (t) => lift(screenPoint(-1 + 2 * t, 0.075)),
    ),
  );
  // top band
  parts.push(
    band(
      (t) => lift(screenPoint(-1 + 2 * t, 0.94)),
      (t) => lift(screenPoint(-1 + 2 * t, 1.0)),
    ),
  );
  // sides
  for (const s of [-1, 1]) {
    parts.push(
      band(
        (t) => lift(screenPoint(s, t)),
        (t) => lift(screenPoint(s * 0.94, t)),
      ),
    );
  }
  return merge(parts);
}

/**
 * Frame path: left pillar base → up → header → down → right pillar base,
 * with rounded top corners. Also returns per-point "out" (away from the
 * glass, in its plane) and "up" (glass normal) directions.
 */
function framePath() {
  const pts = [];
  const N = 16;
  // left pillar (s = +1 is the car's left)
  for (let i = 0; i <= N; i++) pts.push(screenPoint(1, (i / N) * 0.9));
  // corner + header + corner as one spline for continuity
  const head = [];
  for (let j = 0; j <= 30; j++) {
    const s = 1 - (2 * j) / 30;
    head.push(screenPoint(s * 0.93, 1));
  }
  const corner = (s) => [screenPoint(s, 0.97), screenPoint(s * 0.975, 0.995)];
  const all = [...pts, ...corner(1), ...head, ...corner(-1).reverse()];
  for (let i = N; i >= 0; i--) all.push(screenPoint(-1, (i / N) * 0.9));
  return spline3(all, 140);
}

function frameGeometry() {
  const path = framePath();
  const centre = screenPoint(0, 0.5);
  const rowsOuter = [];
  const profile = roundedRect(0.07, 0.03, 0.013, 4).map(([a, b]) => [a + 0.023, b + 0.005]);
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[Math.min(path.length - 1, i + 1)];
    const o = path[Math.max(0, i - 1)];
    const T = norm3(sub(q, o));
    const U = norm3([0, 0.89, 0.45]); // glass normal
    let S = norm3(cross(T, U));
    // S should point away from the glass centre
    const toC = sub(centre, p);
    if (S[0] * toC[0] + S[1] * toC[1] + S[2] * toC[2] > 0) S = S.map((c) => -c);
    const Uo = norm3(cross(S, T));
    const up = Uo[1] * 0.89 + Uo[2] * 0.45 < 0 ? Uo.map((c) => -c) : Uo;
    const row = profile.map(([a, b]) => add(add(p, S, a), up, b));
    rowsOuter.push(row);
  }
  const g = gridMesh(rowsOuter, { closedRow: true });
  // make sure normals face outward: compare with offset direction
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const test = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
  const pc = new THREE.Vector3(...path[0]);
  const nn = new THREE.Vector3(nrm.getX(0), nrm.getY(0), nrm.getZ(0));
  if (test.sub(pc).dot(nn) < 0) {
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

function mirrorAssembly() {
  // interior rear-view mirror hanging from the header centre
  const top = screenPoint(0, 0.985);
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.008, 0.01, 0.06, 10);
  stem.translate(0, -0.03, 0);
  stem.rotateX(0.35);
  stem.translate(top[0], top[1] - 0.005, top[2] - 0.03);
  parts.push(stem);
  const housing = new THREE.BoxGeometry(0.24, 0.07, 0.035, 4, 2, 1);
  const hp = housing.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const y = hp.getY(i);
    // rounded ends
    const k = 1 - 0.35 * (Math.abs(x) / 0.12) ** 4;
    hp.setY(i, y * k);
  }
  housing.computeVertexNormals();
  housing.rotateX(0.35);
  housing.translate(top[0], top[1] - 0.07, top[2] - 0.06);
  parts.push(housing);
  return merge(parts);
}

function wipersGeometry() {
  const parts = [];
  for (const [x0, x1] of [
    [0.05, 0.62],
    [-0.62, -0.08],
  ]) {
    const path = [];
    for (let i = 0; i <= 10; i++) {
      const x = x0 + ((x1 - x0) * i) / 10;
      const s = x / SCREEN.baseHalf;
      const p = screenPoint(s, 0.045);
      path.push([p[0], p[1] + 0.012, p[2] + 0.006]);
    }
    parts.push(sweep(path, roundedRect(0.012, 0.02, 0.004, 2), { up: [0, 0.89, 0.45], capStart: true, capEnd: true }));
  }
  return merge(parts);
}

function cowlGeometry() {
  // black cowl panel between the hood's rear edge and the screen
  const rows = [[], []];
  for (let j = 0; j <= 30; j++) {
    const s = -1 + (2 * j) / 30;
    const x = SCREEN.baseHalf * 0.99 * s;
    const z0 = SCREEN.baseZ(s) + 0.012;
    const a = onTop(x, z0);
    const b = onTop(x, z0 + 0.055);
    rows[0].push([a[0], a[1] + 0.0012, a[2]]);
    rows[1].push([b[0], b[1] + 0.0012, b[2]]);
  }
  return gridMesh(rows);
}

// ---------------------------------------------------------------------------

export function buildScreen() {
  return {
    glass: glassGeometry(),
    frit: fritGeometry(),
    frame: frameGeometry(),
    mirror: mirrorAssembly(),
    wipers: wipersGeometry(),
    cowl: cowlGeometry(),
  };
}

// ---------------------------------------------------------------------------
// Cockpit interior

function rbox(w, h, d, r, seg = 3) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
}

/** Bend a geometry's vertices: y-dependent z offset (for raked, curved seat backs). */
function bend(g, fn) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = fn(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function seatGeometry() {
  // seat-local: x across, y up, z forward; origin on the floor below the hip point
  const leather = [];
  const dark = [];
  // cushion (front slightly higher) with bolsters
  const cushion = rbox(0.4, 0.1, 0.46, 0.04);
  cushion.rotateX(0.07);
  cushion.translate(0, 0.075, 0.23);
  leather.push(cushion);
  for (const s of [-1, 1]) {
    const b = rbox(0.075, 0.13, 0.44, 0.032);
    b.rotateX(0.07);
    b.rotateZ(s * 0.12);
    b.translate(s * 0.215, 0.095, 0.23);
    leather.push(b);
  }
  // backrest: raked ~19°, slightly concave, with bolsters and integrated head restraint
  const rake = (y) => -0.34 * Math.max(0, y);
  const back = bend(rbox(0.42, 0.6, 0.11, 0.045, 4), (x, y, z) => [x, y + 0.42, z + rake(y + 0.3) - 0.03 * (1 - (x / 0.21) ** 2)]);
  leather.push(back);
  for (const s of [-1, 1]) {
    const b = bend(rbox(0.08, 0.5, 0.15, 0.035), (x, y, z) => [x + s * 0.215, y + 0.38, z + rake(y + 0.25) + 0.035]);
    leather.push(b);
  }
  const head = bend(rbox(0.27, 0.22, 0.1, 0.05), (x, y, z) => [x * (1 - 0.12 * Math.max(0, y / 0.11)), y + 0.8, z + rake(0.8 + y) - 0.012]);
  const neck = bend(rbox(0.3, 0.12, 0.09, 0.04), (x, y, z) => [x, y + 0.7, z + rake(0.7 + y) - 0.015]);
  leather.push(neck);
  leather.push(head);
  // Airscarf outlet below the head restraint
  const vent = rbox(0.12, 0.035, 0.02, 0.012);
  vent.translate(0, 0.705, rake(0.705) + 0.053);
  dark.push(vent);
  return { leather: merge(leather), dark: merge(dark) };
}

function hoopGeometry() {
  // roll-over hoop behind a seat, in seat-local coordinates
  const path = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * (i / 24);
    const x = -Math.cos(a) * 0.17;
    const y = Math.sin(a) ** 0.6 * 0.235;
    path.push([x, y, -0.012 * Math.sin(a)]);
  }
  const body = sweep(path, roundedRect(0.034, 0.05, 0.012, 3), { up: [0, 0, 1] });
  const trimPath = path.map((p) => {
    const l = Math.hypot(p[0], p[1]) || 1;
    return [p[0] + (p[0] / l) * 0.02, p[1] + (p[1] / l) * 0.02, p[2] - 0.004];
  });
  const trim = sweep(trimPath, roundedRect(0.008, 0.042, 0.003, 2), { up: [0, 0, 1] });
  return { body, trim };
}

function steeringWheel() {
  // wheel-local: plane XY, facing +Z (toward the driver)
  const parts = { leather: [], trim: [], hub: [], chrome: [] };
  const rim = new THREE.TorusGeometry(0.183, 0.017, 12, 64);
  parts.leather.push(rim);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const len = a === -Math.PI / 2 ? 0.13 : 0.15;
    const w = a === -Math.PI / 2 ? 0.05 : 0.04;
    const spoke = rbox(len, w, 0.016, 0.007);
    spoke.translate(len / 2 + 0.04, 0, -0.012);
    spoke.rotateZ(a);
    parts.trim.push(spoke);
  }
  const hub = rbox(0.13, 0.1, 0.05, 0.03);
  hub.translate(0, 0.004, -0.018);
  parts.hub.push(hub);
  const star = starGeometry(0.019, { depth: 0.002, ringWidth: 0.13 });
  star.rotateY(-Math.PI / 2);
  star.translate(0, 0.01, 0.008);
  parts.chrome.push(star);
  const out = {};
  for (const [k, v] of Object.entries(parts)) out[k] = merge(v);
  return out;
}

function vent(r) {
  // round air vent: chrome bezel + dark slatted core, facing +Z
  const ring = new THREE.TorusGeometry(r, r * 0.13, 8, 36);
  const core = new THREE.CylinderGeometry(r * 0.93, r * 0.93, 0.02, 28);
  core.rotateX(Math.PI / 2);
  core.translate(0, 0, -0.012);
  const slats = [];
  for (let k = -2; k <= 2; k++) {
    const s = new THREE.BoxGeometry(r * 1.7 * Math.sqrt(Math.max(0.1, 1 - (k * 0.33) ** 2)), 0.004, 0.018);
    s.translate(0, k * r * 0.33, -0.004);
    slats.push(s);
  }
  return { chrome: ring, dark: merge([core, ...slats]) };
}

/**
 * Dashboard, instruments, steering wheel, console, seats and hoops.
 * drive: 'left' (LHD, driver at +X) or 'right'.
 */
export function buildInterior({ drive = 'left' } = {}) {
  const dx = drive === 'left' ? 0.37 : -0.37;
  const out = { dash: [], dashTop: [], leather: [], dark: [], chrome: [], satin: [], screen: [], dials: [], gloss: [] };

  // dashboard: a profile swept across the car, its face curving forward toward the doors
  const prof = [
    [0.545, 0.918],
    [0.44, 0.926],
    [0.33, 0.924],
    [0.25, 0.905],
    [0.205, 0.87],
    [0.19, 0.81],
    [0.195, 0.72],
    [0.23, 0.63],
    [0.3, 0.56],
    [0.42, 0.5],
    [0.56, 0.45],
  ];
  const rows = [];
  const NX = 36;
  for (let j = 0; j <= NX; j++) {
    const x = -0.712 + (1.424 * j) / NX;
    const u = x / 0.712;
    const dz = 0.1 * u * u;
    rows.push(prof.map(([z, y]) => [x, y - 0.012 * u * u, Math.min(z + dz, 0.56)]));
  }
  const T = rows[0].map((_, i) => rows.map((r) => r[i]));
  const dash = gridMesh(T);
  out.dash.push(dash);
  // end caps
  for (const s of [-1, 1]) {
    const ring = (s > 0 ? rows[NX] : rows[0]).slice();
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[2], p[1])));
    const cap = new THREE.ShapeGeometry(shape);
    cap.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const px = s * 0.712;
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setX(i, px);
    cap.computeVertexNormals();
    out.dash.push(cap);
  }

  // instrument binnacle and dials in front of the driver
  const binnacle = bend(rbox(0.34, 0.07, 0.16, 0.03), (x, y, z) => [x + dx, y + 0.94 + 0.02 * (1 - (x / 0.17) ** 2), z + 0.255]);
  out.dashTop.push(binnacle);
  const dialCentres = [];
  for (const k of [-1, 1]) {
    const ring = new THREE.TorusGeometry(0.058, 0.005, 8, 36);
    ring.rotateX(-0.32);
    ring.translate(dx + k * 0.068, 0.885, 0.196);
    out.chrome.push(ring);
    // tachometer on the left, speedometer on the right (faces built by the model)
    dialCentres.push({ kind: k < 0 ? 'rpm' : 'speed', pos: [dx + k * 0.068, 0.885, 0.195], tilt: -0.32, radius: 0.056 });
  }

  // centre stack: screen and two round vents; one vent at each end of the dash
  const screen = rbox(0.2, 0.09, 0.02, 0.008);
  screen.rotateX(-0.2);
  screen.translate(0, 0.9, 0.205);
  out.screen.push(screen);
  for (const [x, y, z, r] of [
    [-0.07, 0.79, 0.188, 0.037],
    [0.07, 0.79, 0.188, 0.037],
    [0.6, 0.81, 0.268, 0.039],
    [-0.6, 0.81, 0.268, 0.039],
  ]) {
    const v = vent(r);
    for (const g of [v.chrome, v.dark]) g.translate(x, y, z);
    out.chrome.push(v.chrome);
    out.dark.push(v.dark);
  }

  // centre console with gear selector and armrest
  const console_ = bend(rbox(0.2, 0.22, 0.84, 0.04), (x, y, z) => [x, y + 0.47 + 0.07 * Math.max(0, (z + 0.1) / 0.42), z - 0.2]);
  out.dash.push(console_);
  const arm = rbox(0.18, 0.05, 0.3, 0.02);
  arm.translate(0, 0.605, -0.48);
  out.leather.push(arm);
  const lever = new THREE.CylinderGeometry(0.012, 0.016, 0.1, 12);
  lever.translate(0, 0.63, -0.1);
  out.gloss.push(lever);
  const knob = rbox(0.04, 0.06, 0.06, 0.018);
  knob.translate(0, 0.69, -0.1);
  out.leather.push(knob);
  const surround = rbox(0.12, 0.012, 0.16, 0.005);
  surround.translate(0, 0.585, -0.12);
  out.satin.push(surround);

  // seats and roll-over hoops
  const seat = seatGeometry();
  const hoop = hoopGeometry();
  for (const s of [-1, 1]) {
    const x = s * 0.37;
    const L = seat.leather.clone();
    L.translate(x, 0.36, -0.66);
    out.leather.push(L);
    const D = seat.dark.clone();
    D.translate(x, 0.36, -0.66);
    out.dark.push(D);
    const hb = hoop.body.clone();
    hb.translate(x, 0.935, -0.99);
    out.leather.push(hb);
    const ht = hoop.trim.clone();
    ht.translate(x, 0.935, -0.99);
    out.satin.push(ht);
  }
  // panel behind the seats (tonneau) between the hoops
  const tonneau = new THREE.Shape(COCKPIT_OUTLINE.filter(([, z]) => z < -0.75).map(([x, z]) => new THREE.Vector2(x, -z)));
  const tg = new THREE.ShapeGeometry(tonneau);
  tg.rotateX(-Math.PI / 2);
  tg.translate(0, 0.93, 0);
  out.dark.push(tg);
  // door armrests
  for (const s of [-1, 1]) {
    const a = rbox(0.05, 0.05, 0.5, 0.02);
    a.translate(s * 0.71, 0.64, -0.32);
    out.leather.push(a);
  }

  const wheel = steeringWheel();
  const result = { wheel, wheelPos: [dx, 0.842, 0.045], wheelTilt: 0.5, dialCentres };
  for (const [k, v] of Object.entries(out)) if (v.length) result[k] = merge(v);
  // steering column
  const col = new THREE.CylinderGeometry(0.03, 0.04, 0.25, 12);
  col.rotateX(Math.PI / 2 - 0.5);
  col.translate(dx, 0.8, 0.15);
  result.column = col;
  return result;
}
