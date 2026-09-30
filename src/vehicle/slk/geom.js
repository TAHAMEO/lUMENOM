// Small geometry toolkit for the SLK parts: strips between point rows, sweeps
// of 2D profiles along 3D paths, lathes, and merging with consistent attributes.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Grid mesh from rows of points: rows[i][j] = [x, y, z]. Rows run across the
 * strip, columns along it. `closed` wraps the columns. Normals are computed
 * from the grid unless `normals` rows are given.
 */
export function gridMesh(rows, { closedRow = false, normals = null, uv = null, flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos = new Float32Array(nr * nc * 3);
  const uvs = new Float32Array(nr * nc * 2);
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const p = rows[i][j];
      const k = i * nc + j;
      pos[k * 3] = p[0];
      pos[k * 3 + 1] = p[1];
      pos[k * 3 + 2] = p[2];
      const t = uv ? uv(i, j) : [j / (nc - 1), i / (nr - 1)];
      uvs[k * 2] = t[0];
      uvs[k * 2 + 1] = t[1];
    }
  }
  const idx = [];
  const cols = closedRow ? nc : nc - 1;
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % nc;
      const a = i * nc + j;
      const b = i * nc + j1;
      const c = (i + 1) * nc + j;
      const d = (i + 1) * nc + j1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (normals) {
    const nrm = new Float32Array(nr * nc * 3);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) nrm.set(normals[i][j], (i * nc + j) * 3);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  } else g.computeVertexNormals();
  return g;
}

/**
 * Sweep a closed or open 2D profile along a 3D polyline. The profile is in the
 * plane (side, up) of each path frame; `up` is a hint vector (default +Y) or a
 * function of the path index returning a vector. Optional per-point scale.
 */
export function sweep(path, profile, { up = [0, 1, 0], closedProfile = true, scale = null, capStart = false, capEnd = false } = {}) {
  const n = path.length;
  const rows = [];
  const T = new THREE.Vector3();
  const U = new THREE.Vector3();
  const S = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p0 = path[Math.max(0, i - 1)];
    const p1 = path[Math.min(n - 1, i + 1)];
    T.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const u = typeof up === 'function' ? up(i) : up;
    U.set(u[0], u[1], u[2]);
    S.crossVectors(T, U).normalize();
    U.crossVectors(S, T).normalize();
    const k = scale ? (typeof scale === 'function' ? scale(i / (n - 1)) : scale) : 1;
    const kx = Array.isArray(k) ? k[0] : k;
    const ky = Array.isArray(k) ? k[1] : k;
    const row = [];
    for (const [px, py] of profile) {
      row.push([path[i][0] + S.x * px * kx + U.x * py * ky, path[i][1] + S.y * px * kx + U.y * py * ky, path[i][2] + S.z * px * kx + U.z * py * ky]);
    }
    rows.push(row);
  }
  const g = gridMesh(rows, { closedRow: closedProfile, flip: true });
  const parts = [g];
  if (capStart) parts.push(capFan(rows[0], true));
  if (capEnd) parts.push(capFan(rows[n - 1], false));
  return parts.length > 1 ? merge(parts) : g;
}

/** Flat fan cap over a closed ring of points. */
export function capFan(ring, reverse = false) {
  const c = [0, 0, 0];
  for (const p of ring) {
    c[0] += p[0] / ring.length;
    c[1] += p[1] / ring.length;
    c[2] += p[2] / ring.length;
  }
  const pos = [c[0], c[1], c[2]];
  for (const p of ring) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let i = 0; i < ring.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % ring.length);
    if (reverse) idx.push(0, b, a);
    else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ring.length + 1) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lathe around the X axis (wheel axis). profile: [[radius, x], ...]. */
export function latheX(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X
  return g;
}

/** Merge geometries after normalising attributes to non-indexed position/normal/uv. */
export function merge(geos) {
  const list = geos.filter(Boolean).map((g) => {
    const h = g.index ? g.toNonIndexed() : g.clone();
    if (!h.attributes.normal) h.computeVertexNormals();
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    for (const name of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(name)) h.deleteAttribute(name);
    return h;
  });
  // weld identical vertices back into an indexed mesh (≈4× smaller)
  return mergeVertices(mergeGeometries(list, false), 1e-6);
}

/** Rounded rectangle profile (closed) centred at the origin. */
export function roundedRect(w, h, r, seg = 4) {
  const pts = [];
  const hw = w / 2;
  const hh = h / 2;
  r = Math.min(r, hw, hh);
  const corners = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= seg; s++) {
      const a = a0 + (s / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/** Resample a polyline to n points evenly spaced by arc length. */
export function resample(poly, n) {
  const d = [0];
  for (let i = 1; i < poly.length; i++) {
    _a.fromArray(poly[i]);
    _b.fromArray(poly[i - 1]);
    d.push(d[i - 1] + _a.distanceTo(_b));
  }
  const total = d[d.length - 1];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = (total * i) / (n - 1);
    while (k < poly.length - 2 && d[k + 1] < t) k++;
    const f = (t - d[k]) / (d[k + 1] - d[k] || 1);
    _a.fromArray(poly[k]);
    _b.fromArray(poly[k + 1]);
    _c.copy(_a).lerp(_b, f);
    out.push([_c.x, _c.y, _c.z]);
  }
  return out;
}

/** Catmull-Rom through 3D points, sampled to n points. */
export function spline3(points, n, closed = false) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
    'centripetal',
  );
  return curve.getSpacedPoints(n - 1).map((v) => [v.x, v.y, v.z]);
}

/** Mirror a geometry across x = 0 (flips winding so faces stay outward). */
export function mirrorX(geo) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  // flip winding
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      const s = attr.itemSize;
      const arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < s; c++) {
          const t = arr[(i + 1) * s + c];
          arr[(i + 1) * s + c] = arr[(i + 2) * s + c];
          arr[(i + 2) * s + c] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

/** Geometry plus its mirror. */
export function bothSides(geo) {
  return merge([geo, mirrorX(geo)]);
}
