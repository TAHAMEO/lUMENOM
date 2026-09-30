// Curve helpers for the SLK body: 1D profile splines with derivatives, smooth
// max for fillets, and signed distance to closed 2D outlines (used to cut
// openings such as wheel arches, the cockpit, grille and lamp apertures).

/**
 * Monotone cubic interpolation (Fritsch–Carlson) with a dense lookup table so
 * the body's distance function can evaluate hundreds of thousands of samples
 * quickly. Returns f(x) with f.d(x) the derivative. Outside the knots the
 * curve continues along its end tangent.
 */
export function profile(xs, ys, { table = 1024, extrapolate = 'linear' } = {}) {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new Error('profile needs at least two knots');
  for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) throw new Error('profile knots must increase');
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
  const exact = (x) => {
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
  const x0 = xs[0];
  const x1 = xs[n - 1];
  const N = table;
  const step = (x1 - x0) / (N - 1);
  const lut = new Float64Array(N);
  for (let k = 0; k < N; k++) lut[k] = exact(x0 + k * step);
  const flat = extrapolate === 'clamp';
  const f = (x) => {
    if (x <= x0) return flat ? ys[0] : ys[0] + (x - x0) * m[0];
    if (x >= x1) return flat ? ys[n - 1] : ys[n - 1] + (x - x1) * m[n - 1];
    const u = (x - x0) / step;
    const k = Math.min(N - 2, u | 0);
    const t = u - k;
    return lut[k] + (lut[k + 1] - lut[k]) * t;
  };
  f.d = (x) => {
    if (x <= x0) return flat ? 0 : m[0];
    if (x >= x1) return flat ? 0 : m[n - 1];
    const u = (x - x0) / step;
    const k = Math.min(N - 2, u | 0);
    return (lut[k + 1] - lut[k]) / step;
  };
  f.exact = exact;
  f.x0 = x0;
  f.x1 = x1;
  return f;
}

/** Build a profile from [[x, y], ...] pairs. */
export const profileOf = (pairs, opts) =>
  profile(
    pairs.map((p) => p[0]),
    pairs.map((p) => p[1]),
    opts,
  );

/** Quadratic smooth maximum: max(a, b) with a round of radius ≈ k where they meet. */
export function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Softplus with transition width r: ≈ max(0, t) with a round of radius ≈ r. */
export function softplus(t, r) {
  const u = t / r;
  if (u > 30) return t;
  if (u < -30) return 0;
  return r * Math.log1p(Math.exp(u));
}

export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoothstep = (e0, e1, x) => smooth01((x - e0) / (e1 - e0));
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Sample a closed Catmull-Rom (centripetal-free, uniform) spline through the
 * given 2D control points into a dense polygon.
 */
export function closedSpline(points, samplesPerSpan = 16) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * Rounded polygon: corners given as [x, y, radius]; straight edges between
 * tangent arcs. Returns a dense closed polygon (counter-clockwise if the input is).
 */
export function roundedPolygon(corners, arcSegments = 10) {
  const n = corners.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = corners[(i - 1 + n) % n];
    const [cx, cy, r0] = corners[i];
    const [nx, ny] = corners[(i + 1) % n];
    let ax = px - cx;
    let ay = py - cy;
    let bx = nx - cx;
    let by = ny - cy;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    const cosT = ax * bx + ay * by;
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT))); // interior angle
    const r = r0 || 0;
    if (r <= 0 || theta < 1e-3 || Math.PI - theta < 1e-3) {
      out.push([cx, cy]);
      continue;
    }
    const tanDist = Math.min(r / Math.tan(theta / 2), la * 0.49, lb * 0.49);
    const rr = tanDist * Math.tan(theta / 2);
    const sx = cx + ax * tanDist;
    const sy = cy + ay * tanDist;
    const ex = cx + bx * tanDist;
    const ey = cy + by * tanDist;
    // arc centre along the bisector
    let mx = ax + bx;
    let my = ay + by;
    const ml = Math.hypot(mx, my);
    mx /= ml;
    my /= ml;
    const cd = rr / Math.sin(theta / 2);
    const ox = cx + mx * cd;
    const oy = cy + my * cd;
    let a0 = Math.atan2(sy - oy, sx - ox);
    let a1 = Math.atan2(ey - oy, ex - ox);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let s = 0; s <= arcSegments; s++) {
      const a = a0 + (da * s) / arcSegments;
      out.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr]);
    }
  }
  return out;
}

/**
 * Signed distance to a closed polygon (negative inside). Pre-computes the
 * bounding box so far-away queries return quickly with a lower bound.
 */
export function makeOutline(poly) {
  const n = poly.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    xs[i] = poly[i][0];
    ys[i] = poly[i][1];
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const box = { minX, minY, maxX, maxY };
  /** Exact signed distance; `margin` short-circuits far points with a bound. */
  function sd(px, py, margin = Infinity) {
    const bx = Math.max(minX - px, 0, px - maxX);
    const by = Math.max(minY - py, 0, py - maxY);
    const outside = Math.hypot(bx, by);
    if (outside > margin) return outside;
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = xs[j];
      const ay = ys[j];
      const ex = xs[i] - ax;
      const ey = ys[i] - ay;
      const wx = px - ax;
      const wy = py - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      const dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
      if (straddles(ay, ys[i], py) && px < ax + ((py - ay) * ex) / (ey || 1e-12)) inside = !inside;
    }
    const dist = Math.sqrt(best);
    return inside ? -dist : dist;
  }
  return { sd, box, poly };
}

/** True when the segment's endpoints lie on opposite sides of height y. */
function straddles(a, b, y) {
  return a > y !== b > y;
}
