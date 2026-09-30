// Track: turns a list of control points into an evenly sampled circuit with
// everything the game needs to know about it — centreline frames, elevation,
// banking, curbs, runoff surfaces, barrier offsets, a spatial index for fast
// projection queries and a minimum-curvature racing line for the AI.
// Pure math (three.js is used only for the spline) so it runs in Node tests.

import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/math.js';

export const SURFACE = { ASPHALT: 0, CURB: 1, GRASS: 2, GRAVEL: 3 };
export const WALL = { ARMCO: 0, CONCRETE: 1, TIRES: 2 };

export const CURB_WIDTH = 1.3;
export const CURB_HEIGHT = 0.075;
export const VERGE_SLOPE = 0.03;
/** How far the verge (grass/gravel strip that belongs to the track mesh) extends past the barrier. */
export const VERGE_BEYOND_BARRIER = 3.5;

/** Box-filter a ring buffer `passes` times (≈ gaussian for passes >= 3). */
export function smoothRing(src, radius, passes = 1) {
  const n = src.length;
  let a = Float64Array.from(src);
  let b = new Float64Array(n);
  const w = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += a[((k % n) + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = sum / w;
      sum += a[(i + radius + 1) % n] - a[(((i - radius) % n) + n) % n];
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

function minFilterRing(src, radius) {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = -radius; k <= radius; k++) m = Math.min(m, src[(((i + k) % n) + n) % n]);
    out[i] = m;
  }
  return out;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.halfWidth = def.halfWidth;
    this._build();
    this._buildGrid();
    this._computeZones();
    this._computeBarriers();
    this.computeRacingLine();
  }

  // ---------------------------------------------------------------------------
  // Construction

  _build() {
    const def = this.def;
    const pts = def.points.map((p) => new Vector3(p[0], p[1], p[2]));
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 12000;
    const total = curve.getLength();
    const n = Math.round(total / def.spacing);
    const raw = [];
    for (let i = 0; i < n; i++) raw.push(curve.getPointAt(i / n));

    // Re-index so sample 0 sits on the start/finish line.
    const [sx, sz] = def.start;
    let startIdx = 0;
    let bestD = Infinity;
    raw.forEach((p, i) => {
      const d = (p.x - sx) ** 2 + (p.z - sz) ** 2;
      if (d < bestD) {
        bestD = d;
        startIdx = i;
      }
    });
    const P = raw.slice(startIdx).concat(raw.slice(0, startIdx));

    this.n = n;
    this.length = total;
    this.ds = total / n;

    const px = (this.px = new Float64Array(n));
    const pz = (this.pz = new Float64Array(n));
    const yRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = P[i].x;
      pz[i] = P[i].z;
      yRaw[i] = P[i].y;
    }

    // Horizontal tangent / left vectors via central differences.
    const tx = (this.tx = new Float64Array(n));
    const tz = (this.tz = new Float64Array(n));
    const lx = (this.lx = new Float64Array(n));
    const lz = (this.lz = new Float64Array(n));
    const heading = (this.heading = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let dx = px[b] - px[a];
      let dz = pz[b] - pz[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      tx[i] = dx;
      tz[i] = dz;
      // Forward (sin ψ, cos ψ) → left (cos ψ, −sin ψ) = (tz, −tx)
      lx[i] = dz;
      lz[i] = -dx;
      heading[i] = Math.atan2(dx, dz);
    }

    // Signed curvature (+ = left-hander), lightly smoothed.
    const kRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      kRaw[i] = wrapAngle(heading[b] - heading[a]) / (2 * this.ds);
    }
    this.curvature = smoothRing(kRaw, 3, 2);

    // Elevation: gaussian-smoothed to keep vertical curvature gentle.
    this.py = smoothRing(yRaw, 10, 3);
    for (const b of def.bumps ?? []) {
      for (let i = 0; i < n; i++) {
        let d = i * this.ds - b.at;
        d -= Math.round(d / total) * total;
        if (Math.abs(d) < b.width) this.py[i] += b.height * Math.cos((Math.PI * d) / (2 * b.width)) ** 2;
      }
    }
    const grade = (this.grade = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      grade[i] = (this.py[(i + 1) % n] - this.py[(i - 1 + n) % n]) / (2 * this.ds);
    }

    // Banking into corners (positive tilts the left side down for left-handers).
    const bankRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) bankRaw[i] = clamp(this.curvature[i] * 4.5, -0.055, 0.055);
    this.bank = smoothRing(bankRaw, 12, 3);

    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      this.minX = Math.min(this.minX, px[i]);
      this.maxX = Math.max(this.maxX, px[i]);
      this.minZ = Math.min(this.minZ, pz[i]);
      this.maxZ = Math.max(this.maxZ, pz[i]);
    }
    this.centerX = (this.minX + this.maxX) / 2;
    this.centerZ = (this.minZ + this.maxZ) / 2;
  }

  _buildGrid() {
    const cell = (this.gridCell = 16);
    const pad = 400;
    this.gridMinX = this.minX - pad;
    this.gridMinZ = this.minZ - pad;
    this.gridCols = Math.ceil((this.maxX - this.minX + 2 * pad) / cell);
    this.gridRows = Math.ceil((this.maxZ - this.minZ + 2 * pad) / cell);
    const cells = this.gridCols * this.gridRows;
    const counts = new Uint32Array(cells + 1);
    const cellOf = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const c = this._cellIndex(this.px[i], this.pz[i]);
      cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    const items = new Uint32Array(this.n);
    const fill = counts.slice(0, cells);
    for (let i = 0; i < this.n; i++) items[fill[cellOf[i]]++] = i;
    this.gridStart = counts;
    this.gridItems = items;
  }

  _cellIndex(x, z) {
    const cx = clamp(Math.floor((x - this.gridMinX) / this.gridCell), 0, this.gridCols - 1);
    const cz = clamp(Math.floor((z - this.gridMinZ) / this.gridCell), 0, this.gridRows - 1);
    return cz * this.gridCols + cx;
  }

  /** Circular index distance. */
  indexGap(a, b) {
    const d = Math.abs(a - b) % this.n;
    return Math.min(d, this.n - d);
  }

  /**
   * Nearest centreline sample to (x, z) using the spatial grid.
   * `excludeNear`/`excludeRadius` skip samples close (in index) to a given sample.
   * Returns { index, dist } or null when nothing lies within `maxDist`.
   */
  nearestGlobal(x, z, maxDist = Infinity, excludeNear = -1, excludeRadius = 0) {
    const cell = this.gridCell;
    const cx0 = Math.floor((x - this.gridMinX) / cell);
    const cz0 = Math.floor((z - this.gridMinZ) / cell);
    const maxR = Math.min(Math.max(this.gridCols, this.gridRows), Math.ceil(maxDist / cell) + 1);
    let best = -1;
    let bestD2 = maxDist * maxDist;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const cz = cz0 + dz;
        if (cz < 0 || cz >= this.gridRows) continue;
        const edge = Math.abs(dz) === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
          const cx = cx0 + dx;
          if (cx < 0 || cx >= this.gridCols) continue;
          const c = cz * this.gridCols + cx;
          for (let k = this.gridStart[c]; k < this.gridStart[c + 1]; k++) {
            const i = this.gridItems[k];
            if (excludeRadius > 0 && this.indexGap(i, excludeNear) < excludeRadius) continue;
            const ddx = this.px[i] - x;
            const ddz = this.pz[i] - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = i;
            }
          }
          if (r === 0) break;
        }
      }
      if (best >= 0 && Math.sqrt(bestD2) < r * cell) break;
    }
    return best >= 0 ? { index: best, dist: Math.sqrt(bestD2) } : null;
  }

  /** C1-smooth centreline height between samples i0 and i0+1 (Catmull-Rom). */
  centerHeight(i0, t) {
    const n = this.n;
    const p0 = this.py[(i0 - 1 + n) % n];
    const p1 = this.py[i0];
    const p2 = this.py[(i0 + 1) % n];
    const p3 = this.py[(i0 + 2) % n];
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  /** Hill-climb from a hint index to the locally nearest sample. */
  nearestLocal(x, z, hint) {
    const { px, pz, n } = this;
    let i = hint;
    let d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
    for (let guard = 0; guard < n; guard++) {
      const j = (i + 1) % n;
      const dj = (px[j] - x) ** 2 + (pz[j] - z) ** 2;
      if (dj < d) {
        i = j;
        d = dj;
      } else break;
    }
    for (let guard = 0; guard < n; guard++) {
      const j = (i - 1 + n) % n;
      const dj = (px[j] - x) ** 2 + (pz[j] - z) ** 2;
      if (dj < d) {
        i = j;
        d = dj;
      } else break;
    }
    return i;
  }

  /**
   * Project a world point onto the track. Fills `out` with
   * index/t (segment + fraction), lateral (+left), distance along the lap,
   * centreline height, bank and interpolated barrier offsets.
   */
  project(x, z, hint = -1, out = {}) {
    const { px, pz, lx, lz, tx, tz, n } = this;
    let i;
    if (hint >= 0) {
      i = this.nearestLocal(x, z, hint);
      const d = Math.hypot(px[i] - x, pz[i] - z);
      if (d > 40) i = this.nearestGlobal(x, z).index;
    } else {
      i = this.nearestGlobal(x, z).index;
    }
    const along = (x - px[i]) * tx[i] + (z - pz[i]) * tz[i];
    const i0 = along < 0 ? (i - 1 + n) % n : i;
    const i1 = (i0 + 1) % n;
    const sx = px[i1] - px[i0];
    const sz = pz[i1] - pz[i0];
    const t = clamp(((x - px[i0]) * sx + (z - pz[i0]) * sz) / (sx * sx + sz * sz), 0, 1);
    let lxi = lerp(lx[i0], lx[i1], t);
    let lzi = lerp(lz[i0], lz[i1], t);
    const ll = Math.hypot(lxi, lzi) || 1;
    lxi /= ll;
    lzi /= ll;
    const cx = px[i0] + sx * t;
    const cz = pz[i0] + sz * t;
    out.index = i0;
    out.nearest = t < 0.5 ? i0 : i1;
    out.t = t;
    out.lateral = (x - cx) * lxi + (z - cz) * lzi;
    out.distance = (i0 + t) * this.ds;
    out.centerY = this.centerHeight(i0, t);
    out.bank = lerp(this.bank[i0], this.bank[i1], t);
    out.barrierL = lerp(this.barrierL[i0], this.barrierL[i1], t);
    out.barrierR = lerp(this.barrierR[i0], this.barrierR[i1], t);
    out.tx = lerp(tx[i0], tx[i1], t);
    out.tz = lerp(tz[i0], tz[i1], t);
    out.lx = lxi;
    out.lz = lzi;
    return out;
  }

  /** Cross-section height profile relative to the road edge, for |lateral| beyond halfWidth. */
  edgeProfile(u, hasCurb) {
    if (hasCurb) {
      if (u <= CURB_WIDTH) {
        return CURB_HEIGHT * smoothstep(0, 0.32, u) * (1 - smoothstep(CURB_WIDTH - 0.32, CURB_WIDTH, u));
      }
      return -(u - CURB_WIDTH) * VERGE_SLOPE;
    }
    return -u * VERGE_SLOPE;
  }

  /** Surface height at an arbitrary lateral offset for sample-space position (index,t). */
  heightAtLateral(index, t, lateral) {
    const i1 = (index + 1) % this.n;
    const cy = this.centerHeight(index, t);
    const bank = lerp(this.bank[index], this.bank[i1], t);
    return this._height(cy, bank, lateral, t < 0.5 ? index : i1);
  }

  _height(cy, bank, s, nearest) {
    const hw = this.halfWidth;
    const tb = Math.tan(bank);
    const a = Math.abs(s);
    if (a <= hw) return cy - s * tb;
    const edge = cy - Math.sign(s) * hw * tb;
    const hasCurb = s > 0 ? this.curbL[nearest] : this.curbR[nearest];
    return edge + this.edgeProfile(a - hw, hasCurb);
  }

  /** Height of the drivable surface under a projection result. */
  heightAt(proj) {
    return this._height(proj.centerY, proj.bank, proj.lateral, proj.nearest);
  }

  surfaceAt(proj) {
    const a = Math.abs(proj.lateral);
    const hw = this.halfWidth;
    if (a <= hw) return SURFACE.ASPHALT;
    const left = proj.lateral > 0;
    const hasCurb = left ? this.curbL[proj.nearest] : this.curbR[proj.nearest];
    if (hasCurb && a <= hw + CURB_WIDTH) return SURFACE.CURB;
    const verge = left ? this.vergeL[proj.nearest] : this.vergeR[proj.nearest];
    return verge;
  }

  /** World position of a point at lateral offset from sample i. */
  pointAt(i, lateral, out = {}) {
    i = ((i % this.n) + this.n) % this.n;
    out.x = this.px[i] + this.lx[i] * lateral;
    out.z = this.pz[i] + this.lz[i] * lateral;
    out.y = this._height(this.py[i], this.bank[i], lateral, i);
    return out;
  }

  /** World position at an arbitrary lap distance and lateral offset (interpolated between samples). */
  pointAtDistance(d, lateral, out = {}) {
    const f = (((d / this.ds) % this.n) + this.n) % this.n;
    const i0 = Math.floor(f) % this.n;
    const i1 = (i0 + 1) % this.n;
    const t = f - Math.floor(f);
    let lxi = lerp(this.lx[i0], this.lx[i1], t);
    let lzi = lerp(this.lz[i0], this.lz[i1], t);
    const ll = Math.hypot(lxi, lzi) || 1;
    lxi /= ll;
    lzi /= ll;
    out.x = lerp(this.px[i0], this.px[i1], t) + lxi * lateral;
    out.z = lerp(this.pz[i0], this.pz[i1], t) + lzi * lateral;
    out.y = this._height(this.centerHeight(i0, t), lerp(this.bank[i0], this.bank[i1], t), lateral, t < 0.5 ? i0 : i1);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Zones: curbs, runoff surfaces, wall types

  _computeZones() {
    const n = this.n;
    const k = this.curvature;
    const curbL = new Uint8Array(n);
    const curbR = new Uint8Array(n);
    const vergeL = new Uint8Array(n).fill(SURFACE.GRASS);
    const vergeR = new Uint8Array(n).fill(SURFACE.GRASS);
    const wallL = new Uint8Array(n).fill(WALL.ARMCO);
    const wallR = new Uint8Array(n).fill(WALL.ARMCO);

    const insideThresh = 1 / 190;
    const outsideThresh = 1 / 120;
    for (let i = 0; i < n; i++) {
      const c = k[i];
      if (c > insideThresh) curbL[i] = 1; // left-hander: inside is left
      if (c < -insideThresh) curbR[i] = 1;
      if (c > outsideThresh) curbR[i] = 1;
      if (c < -outsideThresh) curbL[i] = 1;
      if (c > 1 / 85) vergeR[i] = SURFACE.GRAVEL;
      if (c < -1 / 85) vergeL[i] = SURFACE.GRAVEL;
      if (c > 1 / 45) wallR[i] = WALL.TIRES;
      if (c < -1 / 45) wallL[i] = WALL.TIRES;
    }
    const dilate = (arr, r, value) => {
      const src = Uint8Array.from(arr);
      for (let i = 0; i < n; i++) {
        if (src[i] !== value) continue;
        for (let d = -r; d <= r; d++) arr[(((i + d) % n) + n) % n] = value;
      }
    };
    const removeShort = (arr, minLen, value, fallback) => {
      // find runs of `value` shorter than minLen and clear them
      let i = 0;
      // start scanning at a sample that is not `value`
      let startScan = arr.findIndex((v) => v !== value);
      if (startScan < 0) return;
      for (let c = 0; c < n; c++) {
        i = (startScan + c) % n;
        if (arr[i] === value && arr[(i - 1 + n) % n] !== value) {
          let len = 0;
          while (arr[(i + len) % n] === value && len < n) len++;
          if (len < minLen) for (let d = 0; d < len; d++) arr[(i + d) % n] = fallback;
        }
      }
    };
    for (const arr of [curbL, curbR]) {
      dilate(arr, 6, 1);
      removeShort(arr, 14, 1, 0);
    }
    for (const arr of [vergeL, vergeR]) {
      dilate(arr, 8, SURFACE.GRAVEL);
      removeShort(arr, 20, SURFACE.GRAVEL, SURFACE.GRASS);
    }
    for (const arr of [wallL, wallR]) {
      dilate(arr, 10, WALL.TIRES);
      removeShort(arr, 16, WALL.TIRES, WALL.ARMCO);
    }
    // Concrete walls line the pit straight around the start/finish line.
    const pitStart = Math.round(-230 / this.ds);
    const pitEnd = Math.round(260 / this.ds);
    for (let d = pitStart; d <= pitEnd; d++) {
      const i = ((d % n) + n) % n;
      wallL[i] = WALL.CONCRETE;
      wallR[i] = WALL.CONCRETE;
      curbL[i] = 0;
      curbR[i] = 0;
    }
    this.curbL = curbL;
    this.curbR = curbR;
    this.vergeL = vergeL;
    this.vergeR = vergeR;
    this.wallL = wallL;
    this.wallR = wallR;
  }

  _computeBarriers() {
    const n = this.n;
    const hw = this.halfWidth;
    const k = this.curvature;
    const desiredL = new Float64Array(n);
    const desiredR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = k[i];
      const outside = 4.5 + clamp(Math.abs(c) * 650, 0, 9);
      const inside = 3.2;
      let l = c < 0 ? outside : inside; // right-hander: outside is left
      let r = c > 0 ? outside : inside;
      if (this.curbL[i]) l += CURB_WIDTH * 0.6;
      if (this.curbR[i]) r += CURB_WIDTH * 0.6;
      if (this.wallL[i] === WALL.CONCRETE) l = 3.4;
      if (this.wallR[i] === WALL.CONCRETE) r = 3.4;
      desiredL[i] = hw + l;
      desiredR[i] = hw + r;
      // Keep the inside barrier well clear of the offset curve's cusp.
      if (Math.abs(c) > 1e-4) {
        const cap = 0.75 / Math.abs(c);
        if (c > 0) desiredL[i] = Math.min(desiredL[i], cap);
        else desiredR[i] = Math.min(desiredR[i], cap);
      }
    }
    desiredL.set(smoothRing(desiredL, 8, 3));
    desiredR.set(smoothRing(desiredR, 8, 3));

    // Clearance: never let a barrier (plus its verge) reach into another part of the circuit.
    const limit = (i, side, desired) => {
      const step = 0.5;
      const reach = desired + VERGE_BEYOND_BARRIER + 2;
      for (let s = hw; s <= reach; s += step) {
        const x = this.px[i] + this.lx[i] * s * side;
        const z = this.pz[i] + this.lz[i] * s * side;
        const other = this.nearestGlobal(x, z, s + 2, i, 40);
        if (other && other.dist < s + 1) {
          return Math.max(hw + 1.5, Math.min(desired, (s - VERGE_BEYOND_BARRIER - 2) ));
        }
      }
      return desired;
    };
    const bl = new Float64Array(n);
    const br = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      bl[i] = limit(i, 1, desiredL[i]);
      br[i] = limit(i, -1, desiredR[i]);
    }
    this.barrierL = smoothRing(minFilterRing(bl, 6), 6, 2);
    this.barrierR = smoothRing(minFilterRing(br, 6), 6, 2);
  }

  // ---------------------------------------------------------------------------
  // Racing line

  computeRacingLine(margin = 1.7, iterations = 700) {
    const { n, px, pz, lx, lz } = this;
    const lim = this.halfWidth - margin;
    const off = new Float64Array(n);
    for (let it = 0; it < iterations; it++) {
      const stencil = it < iterations * 0.6 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const a = (i - stencil + n) % n;
        const b = (i + stencil) % n;
        const mx = (px[a] + lx[a] * off[a] + px[b] + lx[b] * off[b]) * 0.5;
        const mz = (pz[a] + lz[a] * off[a] + pz[b] + lz[b] * off[b]) * 0.5;
        const target = (mx - px[i]) * lx[i] + (mz - pz[i]) * lz[i];
        off[i] = clamp(off[i] + (target - off[i]) * 0.7, -lim, lim);
      }
    }
    const smooth = smoothRing(off, 2, 2);
    this.lineOffset = smooth;
    const rx = (this.lineX = new Float64Array(n));
    const rz = (this.lineZ = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      rx[i] = px[i] + lx[i] * smooth[i];
      rz[i] = pz[i] + lz[i] * smooth[i];
    }
    // Curvature of the racing line via circumradius of neighbouring points.
    const lk = new Float64Array(n);
    const span = 4;
    for (let i = 0; i < n; i++) {
      const a = (i - span + n) % n;
      const b = (i + span) % n;
      const ax = rx[a], az = rz[a];
      const bx = rx[i], bz = rz[i];
      const cx = rx[b], cz = rz[b];
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const ab = Math.hypot(bx - ax, bz - az);
      const bc = Math.hypot(cx - bx, cz - bz);
      const ca = Math.hypot(ax - cx, az - cz);
      // Sign: our frame has +yaw = left; cross > 0 here means a right-hander in x/z.
      lk[i] = (-2 * cross) / (ab * bc * ca || 1);
    }
    this.lineCurvature = smoothRing(lk, 2, 2);
  }

  /**
   * Speed profile along the racing line.
   * `grip(v)` → max lateral accel at speed v, `accel(v)` → max forward accel, `brake(v)` → max decel.
   */
  computeSpeedProfile({ grip, accel, brake, vMax }) {
    const n = this.n;
    const ds = this.ds;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const kk = Math.abs(this.lineCurvature[i]);
      if (kk < 1e-5) {
        v[i] = vMax;
        continue;
      }
      // Solve v² κ = grip(v) iteratively (grip rises with downforce).
      let s = 20;
      for (let it = 0; it < 8; it++) s = Math.sqrt(grip(s) / kk);
      v[i] = Math.min(vMax, s);
    }
    // Longitudinal grip left over after cornering (friction circle).
    const left = (i, vel) => {
      const lat = (vel * vel * Math.abs(this.lineCurvature[i])) / grip(vel);
      return Math.sqrt(Math.max(0.12, 1 - lat * lat));
    };
    // Two laps of backward (braking) and forward (traction) passes to settle wraparound.
    for (let lap = 0; lap < 2; lap++) {
      for (let c = n - 1; c >= 0; c--) {
        const i = c;
        const j = (i + 1) % n;
        const lim = Math.sqrt(v[j] * v[j] + 2 * brake(v[j]) * left(j, v[j]) * ds);
        if (v[i] > lim) v[i] = lim;
      }
      for (let c = 0; c < n; c++) {
        const i = c;
        const j = (i + 1) % n;
        const lim = Math.sqrt(v[i] * v[i] + 2 * accel(v[i]) * left(i, v[i]) * ds);
        if (v[j] > lim) v[j] = lim;
      }
    }
    this.speedProfile = v;
    return v;
  }

  /** Signed curvature radius at sample i (Infinity on straights). */
  radiusAt(i) {
    const c = this.curvature[((i % this.n) + this.n) % this.n];
    return Math.abs(c) < 1e-6 ? Infinity : 1 / Math.abs(c);
  }

  /** Grid slot positions behind the start line: returns [{x,y,z,yaw,index,lateral}]. */
  gridSlots(count) {
    const slots = [];
    for (let s = 0; s < count; s++) {
      const back = 14 + s * 9;
      const idx = ((Math.round(-back / this.ds) % this.n) + this.n) % this.n;
      const lateral = s % 2 === 0 ? 3.3 : -3.3;
      const p = this.pointAt(idx, lateral);
      slots.push({ ...p, yaw: this.heading[idx], index: idx, lateral });
    }
    return slots;
  }
}
