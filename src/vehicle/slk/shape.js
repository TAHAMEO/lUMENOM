// Shape of the Mercedes-Benz SLK 200 (R172, AMG Line) body as a signed
// distance field. The body is the smooth intersection of five "slabs", each a
// profile function designers would draw on a blueprint:
//
//   side   |x| ≤ Ws(y, z)   plan width with tumblehome, tuck and shoulder crease
//   top     y  ≤ Ht(x, z)   hood (with fender crowns), belt line and rear deck
//   front   z  ≤ Zf(x, y)   nose profile swept back in plan view
//   rear    z  ≥ Zr(x, y)   tail profile
//   bottom  y  ≥ Hb(z)      sills and bumper undersides
//
// Openings (wheel arches, cockpit, grille, intakes, lamp apertures) are not
// part of the field: they are trims cut out of the meshed surface later.
//
// Frame: +Z forward, +Y up, +X = car's left, origin = wheelbase midpoint on the
// ground. Distances in metres. Sources: R172 press dimensions (4134 × 1817 mm,
// 2430 mm wheelbase, 1559/1565 mm track) and measurements taken from a
// calibrated reference photo.

import { closedSpline, lerp, makeOutline, profileOf, roundedPolygon, smax, smoothstep, softplus } from './curves.js';

export const DIM = {
  wheelbase: 2.43,
  frontAxle: 1.215,
  rearAxle: -1.215,
  halfTrackFront: 0.7795,
  halfTrackRear: 0.7825,
  wheelRadius: 0.316,
  front: 2.101,
  rear: -2.031,
  halfWidth: 0.9085,
};

// ---------------------------------------------------------------------------
// Side slab: plan half-width at the widest height, plus section shape.

const W0 = profileOf([
  [-2.2, 0.72],
  [-2.05, 0.8],
  [-1.9, 0.845],
  [-1.75, 0.875],
  [-1.6, 0.896],
  [-1.4, 0.906],
  [-1.215, 0.9085],
  [-0.95, 0.903],
  [-0.6, 0.896],
  [-0.2, 0.894],
  [0.2, 0.894],
  [0.6, 0.896],
  [0.95, 0.901],
  [1.215, 0.905],
  [1.45, 0.902],
  [1.7, 0.889],
  [1.95, 0.862],
  [2.2, 0.82],
]);

// height of maximum width
const YM = profileOf([
  [-2.2, 0.5],
  [-1.2, 0.5],
  [0, 0.5],
  [1.2, 0.5],
  [2.2, 0.45],
]);

// shoulder crease height and the extra inward slope above it
const YC = profileOf([
  [-2.2, 0.82],
  [-1.6, 0.815],
  [-1.2, 0.805],
  [-0.6, 0.792],
  [0.0, 0.786],
  [0.6, 0.782],
  [1.0, 0.8],
  [1.4, 0.83],
  [2.2, 0.86],
]);
const CS = profileOf([
  [-2.2, 0.0],
  [-1.9, 0.2],
  [-1.5, 0.3],
  [0.5, 0.3],
  [1.0, 0.24],
  [1.5, 0.08],
  [1.8, 0.0],
  [2.2, 0.0],
]);

// upper rear quarters tuck inward toward the tail (the lamps sit on this roll)
const RT = profileOf([
  [-2.2, 0.33],
  [-2.0, 0.26],
  [-1.85, 0.19],
  [-1.7, 0.13],
  [-1.55, 0.075],
  [-1.4, 0.03],
  [-1.25, 0.0],
  [2.2, 0.0],
]);

export function sideHalfWidth(y, z) {
  const w0 = W0(z);
  const ym = YM(z);
  let t;
  if (y < ym) {
    const s = (ym - y) / (ym - 0.13);
    t = -0.034 * s * s;
  } else {
    const s = (y - ym) / 0.3;
    t = -0.022 * s * s;
  }
  t -= CS(z) * softplus(y - YC(z), 0.004);
  const rt = RT(z);
  if (rt > 0) t -= rt * smoothstep(0.55, 0.98, y) ** 1.6;
  return w0 + t;
}

// ---------------------------------------------------------------------------
// Top slab: height of the upper surface, built from three profiles:
//   EDGE   height at the shoulder (ax = 0.78): fender crowns, belt line, rear quarters
//   CROWN  how far the rear deck's centre rises above its shoulders
//   VALLEY how far the hood's centre sits below the fender crowns

const EDGE = profileOf([
  [-2.2, 0.82],
  [-2.05, 0.88],
  [-1.95, 0.905],
  [-1.8, 0.928],
  [-1.6, 0.945],
  [-1.4, 0.955],
  [-1.2, 0.962],
  [-1.05, 0.967],
  [-0.9, 0.961],
  [-0.75, 0.947],
  [-0.6, 0.932],
  [-0.45, 0.921],
  [-0.3, 0.918],
  [-0.1, 0.919],
  [0.1, 0.922],
  [0.3, 0.929],
  [0.45, 0.934],
  [0.55, 0.932],
  [0.7, 0.917],
  [0.85, 0.897],
  [1.0, 0.873],
  [1.1, 0.855],
  [1.2, 0.834],
  [1.3, 0.81],
  [1.4, 0.786],
  [1.5, 0.762],
  [1.6, 0.74],
  [1.7, 0.718],
  [1.8, 0.7],
  [1.95, 0.684],
  [2.05, 0.672],
  [2.15, 0.64],
]);

// deck centreline minus EDGE (rear deck is crowned, more so toward the tail)
const CROWN = profileOf([
  [-2.2, 0.04],
  [-1.9, 0.035],
  [-1.6, 0.025],
  [-1.3, 0.012],
  [-1.1, 0.0],
  [0.4, 0.0],
  [0.55, 0.008],
  [0.7, 0.0],
  [2.2, 0.0],
]);

// hood centre below the fender crowns
const VALLEY = profileOf([
  [-2.2, 0.0],
  [0.7, 0.0],
  [1.0, 0.016],
  [1.4, 0.018],
  [1.8, 0.012],
  [2.0, 0.0],
  [2.2, 0.0],
]);

// twin "power domes" running along the hood
const DOME = profileOf([
  [0.55, 0],
  [0.8, 0.006],
  [1.2, 0.011],
  [1.7, 0.012],
  [1.95, 0.006],
  [2.1, 0],
]);

export function topHeight(ax, z) {
  const u = ax / 0.78;
  let h = EDGE(z) + CROWN(z) * (1 - u * u) - VALLEY(z) * (1 - smoothstep(0.12, 0.74, ax));
  if (z > 0.55 && z < 2.1) {
    const d = (ax - 0.215) / 0.075;
    h += DOME(z) * Math.exp(-d * d);
  }
  // beyond the shoulder the surface rolls outward (the fillet does the rest)
  h -= 0.25 * Math.max(0, ax - 0.78) ** 2;
  return h;
}

// ---------------------------------------------------------------------------
// Front slab: centreline nose profile, swept back in plan view.

const ZN = profileOf([
  [0.05, 1.98],
  [0.14, 2.045],
  [0.2, 2.074],
  [0.25, 2.09],
  [0.31, 2.099],
  [0.37, 2.101],
  [0.43, 2.097],
  [0.47, 2.09],
  [0.53, 2.081],
  [0.6, 2.07],
  [0.66, 2.058],
  [0.7, 2.042],
  [0.76, 2.005],
  [0.85, 1.94],
  [1.0, 1.82],
]);

const PC_LOW = profileOf([
  [0, 0],
  [0.3, 0.012],
  [0.5, 0.04],
  [0.65, 0.09],
  [0.75, 0.16],
  [0.82, 0.25],
  [0.87, 0.36],
  [0.9, 0.48],
  [0.95, 0.75],
]);
const PC_MID = profileOf([
  [0, 0],
  [0.25, 0.012],
  [0.3, 0.02],
  [0.4, 0.05],
  [0.5, 0.095],
  [0.6, 0.155],
  [0.7, 0.235],
  [0.78, 0.32],
  [0.85, 0.43],
  [0.9, 0.55],
  [0.95, 0.8],
]);
const PC_HIGH = profileOf([
  [0, 0],
  [0.25, 0.015],
  [0.3, 0.024],
  [0.4, 0.06],
  [0.5, 0.11],
  [0.6, 0.175],
  [0.7, 0.26],
  [0.78, 0.35],
  [0.85, 0.46],
  [0.9, 0.58],
  [0.95, 0.85],
]);

function blend3(lo, mid, hi, y, y0, y1, y2) {
  if (y <= y1) return lerp(lo, mid, smoothstep(y0, y1, y));
  return lerp(mid, hi, smoothstep(y1, y2, y));
}

export function frontZ(ax, y) {
  return ZN(y) - blend3(PC_LOW(ax), PC_MID(ax), PC_HIGH(ax), y, 0.38, 0.6, 0.78);
}
function frontZdx(ax, y) {
  return -blend3(PC_LOW.d(ax), PC_MID.d(ax), PC_HIGH.d(ax), y, 0.38, 0.6, 0.78);
}

// ---------------------------------------------------------------------------
// Rear slab

const ZRN = profileOf([
  [0.1, -1.86],
  [0.2, -1.925],
  [0.26, -1.976],
  [0.3, -2.004],
  [0.36, -2.021],
  [0.44, -2.03],
  [0.52, -2.031],
  [0.58, -2.027],
  [0.62, -2.012],
  [0.67, -2.007],
  [0.75, -2.013],
  [0.83, -2.019],
  [0.89, -2.023],
  [0.93, -2.02],
  [0.97, -1.99],
  [1.02, -1.93],
]);

const PR_LOW = profileOf([
  [0, 0],
  [0.3, 0.014],
  [0.5, 0.066],
  [0.6, 0.114],
  [0.7, 0.18],
  [0.77, 0.24],
  [0.82, 0.29],
  [0.87, 0.35],
  [0.9, 0.4],
  [0.95, 0.5],
]);
const PR_HIGH = profileOf([
  [0, 0],
  [0.3, 0.047],
  [0.4, 0.089],
  [0.5, 0.145],
  [0.6, 0.215],
  [0.7, 0.3],
  [0.75, 0.346],
  [0.8, 0.4],
  [0.85, 0.46],
  [0.9, 0.53],
  [0.95, 0.62],
]);

export function rearZ(ax, y) {
  return ZRN(y) + lerp(PR_LOW(ax), PR_HIGH(ax), smoothstep(0.5, 0.86, y));
}
function rearZdx(ax, y) {
  return lerp(PR_LOW.d(ax), PR_HIGH.d(ax), smoothstep(0.5, 0.86, y));
}

// ---------------------------------------------------------------------------
// Bottom

const HB = profileOf([
  [-2.2, 0.22],
  [-2.0, 0.225],
  [-1.85, 0.245],
  [-1.72, 0.258],
  [-1.55, 0.225],
  [-1.2, 0.2],
  [-0.9, 0.192],
  [-0.6, 0.18],
  [0.8, 0.178],
  [1.2, 0.19],
  [1.6, 0.225],
  [1.8, 0.228],
  [1.95, 0.226],
  [2.2, 0.226],
]);

// fillet radii
const K_SHOULDER = profileOf([
  [-2.2, 0.06],
  [-1.3, 0.075],
  [-1.0, 0.04],
  [-0.8, 0.028],
  [0.3, 0.028],
  [0.55, 0.045],
  [1.0, 0.07],
  [2.2, 0.06],
]);

/**
 * Signed distance (approximately metric near the surface) to the body shell.
 * Negative inside.
 */
export function bodySDF(x, y, z) {
  const ax = Math.abs(x);
  // side
  const ws = sideHalfWidth(y, z);
  const fSide = ax - ws;
  // top
  const ht = topHeight(ax, z);
  const fTop = y - ht;
  // front, normalised by its plan slope so fillets keep their radius
  const zf = frontZ(ax, y);
  const gf = frontZdx(ax, y);
  const fFront = (z - zf) / Math.sqrt(1 + gf * gf);
  // rear
  const zr = rearZ(ax, y);
  const gr = rearZdx(ax, y);
  const fRear = (zr - z) / Math.sqrt(1 + gr * gr);
  // bottom
  const fBot = HB(z) - y;

  let f = smax(fSide, fTop, K_SHOULDER(z));
  // hood leading edge is tight, the plan-view corners are soft
  const kFront = lerp(0.07, 0.04, smoothstep(0.6, 0.72, y));
  f = smax(f, fFront, kFront);
  const kRear = lerp(0.06, 0.03, smoothstep(0.84, 0.92, y));
  f = smax(f, fRear, kRear);
  f = smax(f, fBot, 0.045);
  return f;
}

/** Central-difference gradient of the body field (outward normal when normalised). */
export function bodyNormal(x, y, z, out, e = 2e-4) {
  const nx = bodySDF(x + e, y, z) - bodySDF(x - e, y, z);
  const ny = bodySDF(x, y + e, z) - bodySDF(x, y - e, z);
  const nz = bodySDF(x, y, z + e) - bodySDF(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l;
  out[1] = ny / l;
  out[2] = nz / l;
  return out;
}

// ---------------------------------------------------------------------------
// Trims: openings cut out of the meshed shell. Each has a 2D outline in a
// projection plane and a zone test; value < 0 means "inside the opening".

function archOutline(za, top, halfLen) {
  const pts = [];
  const cy = DIM.wheelRadius;
  const ay = top - cy;
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * Math.PI;
    // slightly squarer than an ellipse at the shoulders of the arch
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = Math.sign(c) * Math.abs(c) ** 0.92;
    pts.push([za + halfLen * px, cy + ay * s]);
  }
  pts.push([za - halfLen, -0.3], [za + halfLen, -0.3]);
  return makeOutline(pts);
}

const FRONT_ARCH = archOutline(DIM.frontAxle, 0.672, 0.362);
const REAR_ARCH = archOutline(DIM.rearAxle, 0.66, 0.39);

// cockpit opening in plan view (x, z); full symmetric outline
export const COCKPIT_OUTLINE = roundedPolygon(
  [
    [0.738, 0.44, 0.05],
    [0.3, 0.535, 0.4],
    [0, 0.553, 0],
    [-0.3, 0.535, 0.4],
    [-0.738, 0.44, 0.05],
    [-0.738, -1.07, 0.12],
    [-0.3, -1.115, 0.4],
    [0, -1.12, 0],
    [0.3, -1.115, 0.4],
    [0.738, -1.07, 0.12],
  ],
  12,
);
const COCKPIT = makeOutline(COCKPIT_OUTLINE);

/**
 * Planar trim: an outline drawn in a local frame (centre, normal N, axes U/V).
 * Surface points are projected onto the frame; `depth` limits the zone to the
 * near side of the body. Symmetric trims use |x|.
 */
function planarTrim(name, { center, normal, u, outline, depth = 0.12, symmetric = true, when = null }) {
  const N = normalise(normal);
  const U = normalise(u);
  const V = cross(N, U);
  const O = makeOutline(outline);
  const value = (x, y, z) => {
    const px = symmetric ? Math.abs(x) : x;
    if (when && !when(px, y, z)) return 1;
    const dx = px - center[0];
    const dy = y - center[1];
    const dz = z - center[2];
    const dn = dx * N[0] + dy * N[1] + dz * N[2];
    if (dn < -depth || dn > depth) return 1;
    return O.sd(dx * U[0] + dy * U[1] + dz * U[2], dx * V[0] + dy * V[1] + dz * V[2], 0.05);
  };
  return { name, value, center, N, U, V, outline: O, symmetric };
}

function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Feature outlines below were measured by casting the reference photo's
// feature edges onto this body (see README: "How the model was built").

// Upright grille between the headlamps (front view, x/y)
export const GRILLE = { y0: 0.446, y1: 0.67, halfWidth: 0.458 };
const grilleOutline = roundedPolygon(
  [
    [GRILLE.halfWidth, GRILLE.y1, 0.05],
    [-GRILLE.halfWidth, GRILLE.y1, 0.05],
    [-GRILLE.halfWidth, GRILLE.y0, 0.075],
    [GRILLE.halfWidth, GRILLE.y0, 0.075],
  ],
  10,
);
// Wide lower intake behind the number plate
export const INTAKE = { y0: 0.262, y1: 0.419, halfTop: 0.525, halfBottom: 0.505 };
const intakeOutline = roundedPolygon(
  [
    [INTAKE.halfTop, INTAKE.y1, 0.03],
    [-INTAKE.halfTop, INTAKE.y1, 0.03],
    [-INTAKE.halfBottom, INTAKE.y0, 0.05],
    [INTAKE.halfBottom, INTAKE.y0, 0.05],
  ],
  8,
);

export const LAMP_FRAME = {
  center: [0.659, 0.652, 1.754],
  normal: [0.462, 0.661, 0.592],
  u: [0.789, 0, -0.615],
};
export const LAMP_OUTLINE = closedSpline(
  [
    [-0.08, -0.008],
    [-0.147, -0.05],
    [-0.188, -0.1],
    [-0.203, -0.14],
    [-0.16, -0.148],
    [-0.09, -0.141],
    [-0.014, -0.13],
    [0.059, -0.101],
    [0.13, -0.059],
    [0.184, 0.0],
    [0.222, 0.06],
    [0.21, 0.15],
    [0.16, 0.228],
    [0.105, 0.244],
    [0.062, 0.222],
    [0.02, 0.172],
    [-0.025, 0.108],
    [-0.058, 0.052],
  ],
  10,
);

export const SIDE_INTAKE_FRAME = {
  center: [0.688, 0.352, 1.97],
  normal: [0.57, 0.082, 0.818],
  u: [0.82, 0, -0.572],
};
export const SIDE_INTAKE_OUTLINE = roundedPolygon(
  [
    [-0.162, 0.045, 0.012],
    [0.136, 0.064, 0.02],
    [0.143, -0.066, 0.018],
    [-0.095, -0.064, 0.03],
    [-0.14, -0.02, 0.015],
  ],
  8,
);

export const GILL_FRAME = { center: [0.892, 0.656, 0.744], normal: [0.997, 0.076, -0.014], u: [0, 0, -1] };
export const GILL_OUTLINE = roundedPolygon(
  [
    [0.104, 0.021, 0.019],
    [-0.106, 0.021, 0.019],
    [-0.106, -0.021, 0.019],
    [0.104, -0.021, 0.019],
  ],
  8,
);

/**
 * Cylindrical trim for wrap-around features: points are unwrapped around a
 * vertical axis at (ax, az); u = angle × R0 (0 at the car's side, growing
 * toward the tail), v = height.
 */
export const TAIL_AXIS = { x: 0.42, z: -1.5, R0: 0.45 };
export function tailUV(x, y, z) {
  const dx = Math.abs(x) - TAIL_AXIS.x;
  const dz = z - TAIL_AXIS.z;
  return [Math.atan2(-dz, dx) * TAIL_AXIS.R0, y, Math.hypot(dx, dz)];
}
export const TAIL_OUTLINE = roundedPolygon(
  [
    [0.035, 0.786, 0.02],
    [0.3, 0.852, 0.25],
    [0.735, 0.874, 0.03],
    [0.755, 0.758, 0.035],
    [0.3, 0.722, 0.25],
    [0.055, 0.744, 0.02],
  ],
  8,
);
const TAIL_O = makeOutline(TAIL_OUTLINE);

// rear bumper: number-plate recess and diffuser (rear view, u = -x, v = y)
export const REAR_PLATE_OUTLINE = roundedPolygon(
  [
    [0.205, 0.568, 0.02],
    [-0.205, 0.568, 0.02],
    [-0.205, 0.438, 0.02],
    [0.205, 0.438, 0.02],
  ],
  6,
);
export const DIFFUSER_OUTLINE = roundedPolygon(
  [
    [0.62, 0.345, 0.05],
    [-0.62, 0.345, 0.05],
    [-0.6, 0.23, 0.04],
    [0.6, 0.23, 0.04],
  ],
  8,
);
const REAR_PLATE_O = makeOutline(REAR_PLATE_OUTLINE);
const DIFFUSER_O = makeOutline(DIFFUSER_OUTLINE);

const GRILLE_O = makeOutline(grilleOutline);
const INTAKE_O = makeOutline(intakeOutline);

export const TRIMS = [
  {
    name: 'archFront',
    value: (x, y, z) => (Math.abs(x) < 0.5 ? 1 : FRONT_ARCH.sd(z, y, 0.05)),
  },
  {
    name: 'archRear',
    value: (x, y, z) => (Math.abs(x) < 0.5 ? 1 : REAR_ARCH.sd(z, y, 0.05)),
  },
  {
    name: 'cockpit',
    value: (x, y, z) => (y < 0.8 ? 1 : COCKPIT.sd(x, z, 0.05)),
  },
  { name: 'grille', value: (x, y, z) => (z < 1.8 || y < 0.36 || y > 0.76 ? 1 : GRILLE_O.sd(x, y, 0.05)), axis: [0, 0, 1], outline: GRILLE_O },
  { name: 'intake', value: (x, y, z) => (z < 1.8 || y > 0.44 ? 1 : INTAKE_O.sd(x, y, 0.05)), axis: [0, 0, 1], outline: INTAKE_O },
  planarTrim('sideIntake', { ...SIDE_INTAKE_FRAME, outline: SIDE_INTAKE_OUTLINE, depth: 0.1, when: (x) => x > 0.45 }),
  planarTrim('headlamp', { ...LAMP_FRAME, outline: LAMP_OUTLINE, depth: 0.14, when: (x) => x > 0.35 }),
  planarTrim('gill', { ...GILL_FRAME, outline: GILL_OUTLINE, depth: 0.08, when: (x) => x > 0.7 }),
  {
    name: 'taillamp',
    value: (x, y, z) => {
      if (y < 0.66 || y > 0.95 || z > -1.3) return 1;
      const [u, v, r] = tailUV(x, y, z);
      if (r < 0.28) return 1;
      return TAIL_O.sd(u, v, 0.05);
    },
    outline: TAIL_O,
  },
  { name: 'rearPlate', value: (x, y, z) => (z > -1.8 || y > 0.62 ? 1 : REAR_PLATE_O.sd(-x, y, 0.05)), outline: REAR_PLATE_O },
  { name: 'diffuser', value: (x, y, z) => (z > -1.6 || y > 0.4 ? 1 : DIFFUSER_O.sd(-x, y, 0.05)), outline: DIFFUSER_O },
];
