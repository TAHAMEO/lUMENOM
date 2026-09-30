// Meshes a closed body described by a signed distance field.
//
// Vertices come from rays cast outward from a horizontal "spine" (the plan
// view's medial axis): along the straight part the rays leave the spine
// sideways, at each end they fan around the nose/tail. Each ray column is laid
// out by curvature-weighted arc length so fillets and creases get more
// vertices. The result is one structured grid per half with a shared seam on
// the centre plane and poles on the hood/deck centreline where the fans close.
//
// Openings are then cut with trim functions (value < 0 inside): vertices close
// to a trim edge are snapped onto it and straddling triangles are split, so
// every opening has a clean boundary that later parts (lips, walls, glass)
// can be built from.

const HALF_PI = Math.PI / 2;

/**
 * @param {object} o
 * @param {(x:number,y:number,z:number)=>number} o.sdf
 * @param {{y:number, z0:number, z1:number}} o.spine
 * @param {number} o.spacing target edge length (m)
 * @param {number} [o.phiMin] lowest ray elevation (rad), below horizontal
 * @param {number} [o.curvatureGain] extra density per unit curvature
 */
export function meshHalfBody(o) {
  const { sdf, spine, spacing } = o;
  const phiMin = o.phiMin ?? -0.62;
  const gain = o.curvatureGain ?? 0.06;
  const ys = spine.y;
  const zA = spine.z0;
  const zB = spine.z1;

  // --- ray casting ----------------------------------------------------------
  const hit = [0, 0, 0];
  function cast(ox, oy, oz, dx, dy, dz) {
    let t = 0;
    let f = sdf(ox, oy, oz);
    if (f >= 0) {
      // origin outside (should not happen for a spine inside the body)
      hit[0] = ox;
      hit[1] = oy;
      hit[2] = oz;
      return 0;
    }
    let tIn = 0;
    let tOut = -1;
    for (let it = 0; it < 200; it++) {
      const step = Math.max(-f * 0.85, 2e-4);
      const tn = t + step;
      const fn = sdf(ox + dx * tn, oy + dy * tn, oz + dz * tn);
      if (fn >= 0) {
        tIn = t;
        tOut = tn;
        break;
      }
      t = tn;
      f = fn;
      if (t > 6) break;
    }
    if (tOut < 0) tOut = t;
    for (let it = 0; it < 26; it++) {
      const tm = (tIn + tOut) * 0.5;
      if (sdf(ox + dx * tm, oy + dy * tm, oz + dz * tm) < 0) tIn = tm;
      else tOut = tm;
    }
    const tt = (tIn + tOut) * 0.5;
    hit[0] = ox + dx * tt;
    hit[1] = oy + dy * tt;
    hit[2] = oz + dz * tt;
    return tt;
  }

  // Column c ∈ [0, 3]: [0,1] tail fan (β: π → π/2), [1,2] side (z: zA → zB), [2,3] nose fan (β: π/2 → 0)
  const colRay = (c, out) => {
    if (c <= 1) {
      const b = Math.PI - c * HALF_PI;
      out.ox = 0;
      out.oz = zA;
      out.hx = Math.sin(b);
      out.hz = Math.cos(b);
    } else if (c <= 2) {
      out.ox = 0;
      out.oz = zA + (c - 1) * (zB - zA);
      out.hx = 1;
      out.hz = 0;
    } else {
      const b = HALF_PI - (c - 2) * HALF_PI;
      out.ox = 0;
      out.oz = zB;
      out.hx = Math.sin(b);
      out.hz = Math.cos(b);
    }
    return out;
  };
  const ray = { ox: 0, oz: 0, hx: 0, hz: 0 };
  const pointAt = (c, phi, out) => {
    colRay(c, ray);
    const cp = Math.cos(phi);
    cast(ray.ox, ys, ray.oz, ray.hx * cp, Math.sin(phi), ray.hz * cp);
    out[0] = hit[0];
    out[1] = hit[1];
    out[2] = hit[2];
    return out;
  };

  // --- columns by arc length around the body (measured at two elevations) --
  const NC = 1500;
  const colArc = new Float64Array(NC + 1);
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  const qa = [0, 0, 0];
  const qb = [0, 0, 0];
  pointAt(0, 0, pa);
  pointAt(0, 0.5, qa);
  for (let k = 1; k <= NC; k++) {
    const c = (3 * k) / NC;
    pointAt(c, 0, pb);
    pointAt(c, 0.5, qb);
    const d0 = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const d1 = Math.hypot(qb[0] - qa[0], qb[1] - qa[1], qb[2] - qa[2]);
    colArc[k] = colArc[k - 1] + Math.max(d0, d1 * 0.9);
    pa[0] = pb[0];
    pa[1] = pb[1];
    pa[2] = pb[2];
    qa[0] = qb[0];
    qa[1] = qb[1];
    qa[2] = qb[2];
  }
  const nCols = Math.max(8, Math.round(colArc[NC] / spacing)) + 1;
  const cols = new Float64Array(nCols);
  {
    let k = 0;
    for (let i = 0; i < nCols; i++) {
      const target = (colArc[NC] * i) / (nCols - 1);
      while (k < NC - 1 && colArc[k + 1] < target) k++;
      const t = (target - colArc[k]) / (colArc[k + 1] - colArc[k] || 1);
      cols[i] = (3 * (k + t)) / NC;
    }
    cols[0] = 0;
    cols[nCols - 1] = 3;
  }

  // --- rows: curvature-weighted arc length per column -----------------------
  const NS = 240;
  const dense = new Float64Array((NS + 1) * 3);
  const w = new Float64Array(NS + 1);
  const cum = new Float64Array(NS + 1);
  const phis = new Float64Array(NS + 1);
  for (let s = 0; s <= NS; s++) {
    // bias samples toward the top (poles) where columns converge
    phis[s] = phiMin + (HALF_PI - phiMin) * (s / NS);
  }
  // first pass: find the longest column to size the row count
  const colData = [];
  let maxLen = 0;
  const p = [0, 0, 0];
  for (let i = 0; i < nCols; i++) {
    for (let s = 0; s <= NS; s++) {
      pointAt(cols[i], phis[s], p);
      dense[s * 3] = p[0];
      dense[s * 3 + 1] = p[1];
      dense[s * 3 + 2] = p[2];
    }
    // segment lengths and turning angles
    cum[0] = 0;
    let len = 0;
    for (let s = 1; s <= NS; s++) {
      const dx = dense[s * 3] - dense[s * 3 - 3];
      const dy = dense[s * 3 + 1] - dense[s * 3 - 2];
      const dz = dense[s * 3 + 2] - dense[s * 3 - 1];
      w[s] = Math.hypot(dx, dy, dz);
      len += w[s];
    }
    // turning angle between consecutive segments → curvature weight
    let wlen = 0;
    for (let s = 1; s <= NS; s++) {
      let turn = 0;
      if (s > 1 && s < NS) {
        const ax = dense[s * 3] - dense[s * 3 - 3];
        const ay = dense[s * 3 + 1] - dense[s * 3 - 2];
        const az = dense[s * 3 + 2] - dense[s * 3 - 1];
        const bx = dense[s * 3 + 3] - dense[s * 3];
        const by = dense[s * 3 + 4] - dense[s * 3 + 1];
        const bz = dense[s * 3 + 5] - dense[s * 3 + 2];
        const la = Math.hypot(ax, ay, az) || 1e-9;
        const lb = Math.hypot(bx, by, bz) || 1e-9;
        const cosT = (ax * bx + ay * by + az * bz) / (la * lb);
        turn = Math.acos(Math.max(-1, Math.min(1, cosT)));
      }
      // weight: plain length plus turning (a 90° fillet adds `gain * π/2 / spacing` rows)
      const seg = w[s] + (gain * turn) / 1;
      wlen += seg;
      cum[s] = wlen;
    }
    colData.push({ total: wlen, cum: Float64Array.from(cum) });
    maxLen = Math.max(maxLen, len + gain * 3);
  }
  const nRows = Math.max(8, Math.round(maxLen / spacing)) + 1;

  // --- final vertices -------------------------------------------------------
  const positions = new Float32Array(nCols * nRows * 3);
  const grid = { nCols, nRows, cols, rowPhi: new Float32Array(nCols * nRows) };
  for (let i = 0; i < nCols; i++) {
    const { total, cum: cc } = colData[i];
    let s = 0;
    for (let j = 0; j < nRows; j++) {
      const target = (total * j) / (nRows - 1);
      while (s < NS - 1 && cc[s + 1] < target) s++;
      const t = (target - cc[s]) / (cc[s + 1] - cc[s] || 1);
      const phi = j === nRows - 1 ? HALF_PI : phis[s] + (phis[s + 1] - phis[s]) * t;
      pointAt(cols[i], phi, p);
      const k = (i * nRows + j) * 3;
      positions[k] = p[0];
      positions[k + 1] = p[1];
      positions[k + 2] = p[2];
      grid.rowPhi[i * nRows + j] = phi;
    }
  }
  // exact seam: centre-plane columns and top rows at x = 0
  for (let j = 0; j < nRows; j++) {
    positions[j * 3] = 0;
    positions[((nCols - 1) * nRows + j) * 3] = 0;
  }
  for (let i = 0; i < nCols; i++) positions[(i * nRows + nRows - 1) * 3] = 0;

  const index = [];
  const V = (i, j) => i * nRows + j;
  for (let i = 0; i < nCols - 1; i++) {
    for (let j = 0; j < nRows - 1; j++) {
      const a = V(i, j);
      const b = V(i + 1, j);
      const d = V(i, j + 1);
      const e = V(i + 1, j + 1);
      pushTri(index, positions, a, d, b);
      pushTri(index, positions, b, d, e);
    }
  }
  return { positions, index, grid };
}

function triArea2(pos, a, b, c) {
  const ax = pos[b * 3] - pos[a * 3];
  const ay = pos[b * 3 + 1] - pos[a * 3 + 1];
  const az = pos[b * 3 + 2] - pos[a * 3 + 2];
  const bx = pos[c * 3] - pos[a * 3];
  const by = pos[c * 3 + 1] - pos[a * 3 + 1];
  const bz = pos[c * 3 + 2] - pos[a * 3 + 2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return cx * cx + cy * cy + cz * cz;
}

function pushTri(index, pos, a, b, c) {
  if (triArea2(pos, a, b, c) < 1e-14) return;
  index.push(a, b, c);
}

// ---------------------------------------------------------------------------
// Cutting

/**
 * Cut openings out of a mesh lying on the SDF surface.
 * @param mesh {positions: Float32Array|number[], index: number[]}
 * @param trims [{name, value(x,y,z)}]
 * @returns {{positions: Float32Array, index: Uint32Array, loops: Record<string, number[][][]>}}
 *   loops[name] = list of polylines (arrays of [x,y,z]) along that opening's edge
 */
export function cutMesh(mesh, trims, { sdf, normal, snap = 0.004 } = {}) {
  let pos = Array.from(mesh.positions);
  let index = Array.from(mesh.index);
  const n = [0, 0, 0];
  const project = (p) => {
    // pull a point back onto the surface along the field gradient
    for (let it = 0; it < 4; it++) {
      const f = sdf(p[0], p[1], p[2]);
      if (Math.abs(f) < 1e-7) break;
      normal(p[0], p[1], p[2], n);
      p[0] -= n[0] * f;
      p[1] -= n[1] * f;
      p[2] -= n[2] * f;
    }
    return p;
  };
  const onEdge = new Map(); // vertex -> set of trim names it sits on
  for (const trim of trims) {
    const T = trim.value;
    const count = pos.length / 3;
    const val = new Float64Array(count);
    for (let v = 0; v < count; v++) val[v] = T(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    // snap vertices that are nearly on the edge (moves along the surface)
    const e = 1e-4;
    for (let v = 0; v < count; v++) {
      if (Math.abs(val[v]) >= snap) continue;
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      for (let it = 0; it < 6; it++) {
        const t0 = T(p[0], p[1], p[2]);
        if (Math.abs(t0) < 2e-6) break;
        const gx = (T(p[0] + e, p[1], p[2]) - T(p[0] - e, p[1], p[2])) / (2 * e);
        const gy = (T(p[0], p[1] + e, p[2]) - T(p[0], p[1] - e, p[2])) / (2 * e);
        const gz = (T(p[0], p[1], p[2] + e) - T(p[0], p[1], p[2] - e)) / (2 * e);
        normal(p[0], p[1], p[2], n);
        // tangential part of the trim gradient
        const gn = gx * n[0] + gy * n[1] + gz * n[2];
        const tx = gx - gn * n[0];
        const ty = gy - gn * n[1];
        const tz = gz - gn * n[2];
        const g2 = tx * tx + ty * ty + tz * tz;
        if (g2 < 1e-12) break;
        const k = t0 / g2;
        p[0] -= tx * k;
        p[1] -= ty * k;
        p[2] -= tz * k;
        project(p);
      }
      // keep the centre seam on the plane
      if (pos[v * 3] === 0) p[0] = 0;
      pos[v * 3] = p[0];
      pos[v * 3 + 1] = p[1];
      pos[v * 3 + 2] = p[2];
      val[v] = 0;
      addEdgeTag(onEdge, v, trim.name);
    }
    const sgn = (v) => (val[v] > 1e-9 ? 1 : val[v] < -1e-9 ? -1 : 0);
    const cache = new Map();
    const crossing = (a, b) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let c = cache.get(key);
      if (c !== undefined) return c;
      // bisection along the chord for T = 0, then onto the surface
      let lo = a;
      let hi = b;
      let ta = 0;
      let tb = 1;
      if (val[a] < 0) {
        lo = b;
        hi = a;
      }
      const P = (t) => [
        pos[lo * 3] + (pos[hi * 3] - pos[lo * 3]) * t,
        pos[lo * 3 + 1] + (pos[hi * 3 + 1] - pos[lo * 3 + 1]) * t,
        pos[lo * 3 + 2] + (pos[hi * 3 + 2] - pos[lo * 3 + 2]) * t,
      ];
      for (let it = 0; it < 30; it++) {
        const tm = (ta + tb) / 2;
        const q = project(P(tm));
        if (T(q[0], q[1], q[2]) > 0) ta = tm;
        else tb = tm;
      }
      const q = project(P((ta + tb) / 2));
      if (pos[lo * 3] === 0 && pos[hi * 3] === 0) q[0] = 0;
      c = pos.length / 3;
      pos.push(q[0], q[1], q[2]);
      addEdgeTag(onEdge, c, trim.name);
      cache.set(key, c);
      return c;
    };
    const out = [];
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t], index[t + 1], index[t + 2]];
      const s = tri.map((v) => (v < count ? sgn(v) : 0));
      if (s[0] >= 0 && s[1] >= 0 && s[2] >= 0) {
        if (s[0] === 0 && s[1] === 0 && s[2] === 0) {
          // all on the edge: keep only if its centroid is outside
          const cx = (pos[tri[0] * 3] + pos[tri[1] * 3] + pos[tri[2] * 3]) / 3;
          const cy = (pos[tri[0] * 3 + 1] + pos[tri[1] * 3 + 1] + pos[tri[2] * 3 + 1]) / 3;
          const cz = (pos[tri[0] * 3 + 2] + pos[tri[1] * 3 + 2] + pos[tri[2] * 3 + 2]) / 3;
          if (T(cx, cy, cz) > 0) out.push(...tri);
        } else out.push(...tri);
        continue;
      }
      if (s[0] <= 0 && s[1] <= 0 && s[2] <= 0) continue;
      // rotate so we walk the polygon and clip to the positive side
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        const sa = s[k];
        const sb = s[(k + 1) % 3];
        if (sa >= 0) poly.push(a);
        if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) poly.push(crossing(a, b));
      }
      for (let k = 1; k + 1 < poly.length; k++) {
        if (triArea2(pos, poly[0], poly[k], poly[k + 1]) > 1e-14) out.push(poly[0], poly[k], poly[k + 1]);
      }
    }
    index = out;
  }

  // compact unused vertices
  const used = new Int32Array(pos.length / 3).fill(-1);
  const newPos = [];
  const newIndex = new Uint32Array(index.length);
  let nv = 0;
  const tags = [];
  for (let t = 0; t < index.length; t++) {
    const v = index[t];
    if (used[v] < 0) {
      used[v] = nv++;
      newPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      tags.push(onEdge.get(v));
    }
    newIndex[t] = used[v];
  }
  const positions = Float32Array.from(newPos);
  const loops = extractLoops(positions, newIndex, tags, trims);
  return { positions, index: newIndex, loops };
}

function addEdgeTag(map, v, name) {
  let s = map.get(v);
  if (!s) map.set(v, (s = new Set()));
  s.add(name);
}

/** Chain boundary edges whose vertices lie on the same trim into polylines. */
function extractLoops(positions, index, tags, trims) {
  const edgeCount = new Map();
  const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      const b = index[t + ((k + 1) % 3)];
      const kk = key(a, b);
      const e = edgeCount.get(kk);
      if (e) e.n++;
      else edgeCount.set(kk, { n: 1, a, b });
    }
  }
  const loops = {};
  for (const trim of trims) {
    const adj = new Map();
    for (const e of edgeCount.values()) {
      if (e.n !== 1) continue;
      const ta = tags[e.a];
      const tb = tags[e.b];
      if (!ta || !tb || !ta.has(trim.name) || !tb.has(trim.name)) continue;
      // boundary edges run with the kept triangle on their left; store directed
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    const seen = new Set();
    const chains = [];
    const ends = [...adj.keys()].filter((v) => adj.get(v).length === 1);
    const starts = [...ends, ...adj.keys()];
    for (const s of starts) {
      if (seen.has(s)) continue;
      const chain = [s];
      seen.add(s);
      let prev = -1;
      let cur = s;
      for (;;) {
        const next = adj.get(cur).find((v) => v !== prev && !seen.has(v));
        if (next === undefined) break;
        chain.push(next);
        seen.add(next);
        prev = cur;
        cur = next;
      }
      if (chain.length > 1) chains.push(chain.map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]));
    }
    loops[trim.name] = joinChains(chains);
  }
  return loops;
}

/** Join polylines whose ends touch (within 3 mm) into longer ones. */
function joinChains(chains, tol = 0.003) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const list = chains.map((c) => c.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i];
        const b = list[j];
        if (d(a[a.length - 1], b[0]) < tol) list[i] = a.concat(b.slice(1));
        else if (d(a[a.length - 1], b[b.length - 1]) < tol) list[i] = a.concat(b.slice(0, -1).reverse());
        else if (d(a[0], b[b.length - 1]) < tol) list[i] = b.concat(a.slice(1));
        else if (d(a[0], b[0]) < tol) list[i] = b.slice().reverse().concat(a.slice(1));
        else continue;
        list.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return list;
}

/** Per-vertex normals from the field gradient. */
export function fieldNormals(positions, normal) {
  const out = new Float32Array(positions.length);
  const n = [0, 0, 0];
  for (let v = 0; v < positions.length; v += 3) {
    normal(positions[v], positions[v + 1], positions[v + 2], n);
    out[v] = n[0];
    out[v + 1] = n[1];
    out[v + 2] = n[2];
  }
  return out;
}

/** Mirror a left-half mesh (x ≥ 0) into a full one; seam vertices are duplicated. */
export function mirrorHalf(positions, normals, index) {
  const nv = positions.length / 3;
  const P = new Float32Array(positions.length * 2);
  const N = new Float32Array(normals.length * 2);
  P.set(positions);
  N.set(normals);
  for (let v = 0; v < nv; v++) {
    P[(nv + v) * 3] = -positions[v * 3];
    P[(nv + v) * 3 + 1] = positions[v * 3 + 1];
    P[(nv + v) * 3 + 2] = positions[v * 3 + 2];
    N[(nv + v) * 3] = -normals[v * 3];
    N[(nv + v) * 3 + 1] = normals[v * 3 + 1];
    N[(nv + v) * 3 + 2] = normals[v * 3 + 2];
  }
  const I = new Uint32Array(index.length * 2);
  I.set(index);
  for (let t = 0; t < index.length; t += 3) {
    I[index.length + t] = index[t] + nv;
    I[index.length + t + 1] = index[t + 2] + nv;
    I[index.length + t + 2] = index[t + 1] + nv;
  }
  return { positions: P, normals: N, index: I };
}
