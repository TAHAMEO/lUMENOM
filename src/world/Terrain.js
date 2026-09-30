// Terrain: a chunked heightfield on a variable-resolution grid (4 m cells around
// the circuit, growing to 60 m at the horizon). Heights blend from the track's
// verge edge into rolling hills, a ring of ridged mountains and an infield lake.

import * as THREE from 'three';
import { createNoise2D, fbm, ridged } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { VERGE_BEYOND_BARRIER } from './Track.js';
import { injectFogUniforms } from './fogPatch.js';

const _c = new THREE.Color();

function buildAxis(coreMin, coreMax, extentMin, extentMax, step, growth, maxStep) {
  const core = [];
  const count = Math.round((coreMax - coreMin) / step);
  for (let i = 0; i <= count; i++) core.push(coreMin + (i * (coreMax - coreMin)) / count);
  const right = [];
  let x = coreMax;
  let s = step;
  while (x < extentMax - 1e-6) {
    s = Math.min(maxStep, s * growth);
    x = Math.min(extentMax, x + s);
    right.push(x);
  }
  const left = [];
  x = coreMin;
  s = step;
  while (x > extentMin + 1e-6) {
    s = Math.min(maxStep, s * growth);
    x = Math.max(extentMin, x - s);
    left.push(x);
  }
  return Float64Array.from([...left.reverse(), ...core, ...right]);
}

function upperIndex(axis, v) {
  // largest i with axis[i] <= v, clamped to [0, len-2]
  let lo = 0;
  let hi = axis.length - 1;
  if (v <= axis[0]) return 0;
  if (v >= axis[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

export class Terrain {
  constructor(track, { seed = 7 } = {}) {
    this.track = track;
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 11);
    this.noise3 = createNoise2D(seed + 23);
    this.lake = { x: 40, z: 0, r: 165, level: -2.4 };
    this._prepareTrackPoints();
    this._buildAxes();
    this._computeHeights();
  }

  _prepareTrackPoints() {
    const t = this.track;
    const pts = [];
    this.tpStride = 8;
    for (let i = 0; i < t.n; i += this.tpStride) pts.push(t.px[i], t.pz[i], t.py[i]);
    this.tp = Float64Array.from(pts);
  }

  _buildAxes() {
    const t = this.track;
    const pad = 170;
    this.xs = buildAxis(t.minX - pad, t.maxX + pad, t.centerX - 2800, t.centerX + 2800, 4, 1.07, 64);
    this.zs = buildAxis(t.minZ - pad, t.maxZ + pad, t.centerZ - 2800, t.centerZ + 2800, 4, 1.07, 64);
  }

  /** IDW average of track heights plus approximate distance to the circuit. */
  _baseAndDistance(x, z) {
    const tp = this.tp;
    let wsum = 0;
    let hsum = 0;
    let dmin = Infinity;
    let kmin = 0;
    for (let k = 0; k < tp.length; k += 3) {
      const dx = tp[k] - x;
      const dz = tp[k + 1] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < dmin) {
        dmin = d2;
        kmin = k;
      }
      const q = d2 + 1600;
      const w = 1 / (q * q);
      wsum += w;
      hsum += w * tp[k + 2];
    }
    this._dist = Math.sqrt(dmin);
    this._nearIdx = (kmin / 3) * this.tpStride;
    return hsum / wsum;
  }

  /** Natural (track-agnostic) terrain height. */
  natural(x, z, base, dTrack) {
    const n = this.noise;
    const hills = fbm(n, x / 480, z / 480, 5);
    const detail = fbm(this.noise2, x / 95, z / 95, 3);
    const amp = 1.5 + 26 * smoothstep(50, 480, dTrack);
    let h = base + hills * amp + detail * (0.4 + 3 * smoothstep(25, 260, dTrack));
    // Mountain ring framing the horizon.
    const t = this.track;
    const rc = Math.hypot((x - t.centerX) / 1.15, z - t.centerZ);
    const m = smoothstep(820, 2100, rc);
    if (m > 0) {
      // Domain-warped ridges give continuous ranges instead of isolated spikes.
      const wx = x + 380 * this.noise2(x / 1700 + 3.1, z / 1700 - 1.7);
      const wz = z + 380 * this.noise2(x / 1700 - 7.3, z / 1700 + 4.9);
      const ridge = ridged(this.noise3, wx / 1500, wz / 1500, 4, 2.0, 0.42);
      const massif = fbm(n, x / 800 + 17, z / 800 - 5, 4) * 0.5 + 0.5;
      h += m * (40 + 330 * Math.pow(ridge, 1.35) + 110 * massif);
    }
    // Infield lake basin with an irregular shoreline.
    const L = this.lake;
    const wobble = 1 + 0.2 * n(x / 90, z / 90) + 0.08 * this.noise2(x / 30, z / 30);
    const dl = Math.hypot(x - L.x, (z - L.z) * 1.25) / (L.r * wobble);
    if (dl < 1.6) h = lerp(h, L.level - 5, 1 - smoothstep(0.55, 1.3, dl));
    return h;
  }

  _computeHeights() {
    const { xs, zs, track: t } = this;
    const nx = xs.length;
    const nz = zs.length;
    const H = new Float32Array(nx * nz);
    const near = new Float32Array(nx * nz); // 0 = hugging the verge, 1 = far away
    const dist = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = zs[j];
      for (let i = 0; i < nx; i++) {
        const x = xs[i];
        const k = j * nx + i;
        const base = this._baseAndDistance(x, z);
        const dApprox = this._dist;
        dist[k] = dApprox;
        const nat = this.natural(x, z, base, dApprox);
        if (dApprox > 110) {
          H[k] = nat;
          near[k] = 1;
          continue;
        }
        const idx = t.nearestLocal(x, z, this._nearIdx);
        const q = { dist: Math.hypot(x - t.px[idx], z - t.pz[idx]) };
        const lateral = (x - t.px[idx]) * t.lx[idx] + (z - t.pz[idx]) * t.lz[idx];
        const side = lateral >= 0 ? 1 : -1;
        const barrier = side > 0 ? t.barrierL[idx] : t.barrierR[idx];
        const edge = barrier + VERGE_BEYOND_BARRIER;
        const a = Math.max(Math.abs(lateral), q.dist * 0.98);
        dist[k] = a;
        if (a < edge - 0.25) {
          H[k] = t._height(t.py[idx], t.bank[idx], clamp(lateral, -edge, edge), idx) - 0.8;
          near[k] = 0;
          continue;
        }
        const hv = t._height(t.py[idx], t.bank[idx], side * edge, idx) - 0.5;
        const b = smoothstep(edge - 0.25, edge + 55, a);
        H[k] = lerp(hv, nat, b);
        near[k] = b;
      }
    }
    this.H = H;
    this.nearMask = near;
    this.dist = dist;
    this.nx = nx;
    this.nz = nz;
  }

  heightAt(x, z) {
    const { xs, zs, H, nx } = this;
    const i = upperIndex(xs, x);
    const j = upperIndex(zs, z);
    const fx = clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1);
    const fz = clamp((z - zs[j]) / (zs[j + 1] - zs[j]), 0, 1);
    const a = H[j * nx + i];
    const b = H[j * nx + i + 1];
    const c = H[(j + 1) * nx + i];
    const d = H[(j + 1) * nx + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Approximate distance from (x, z) to the circuit centreline, from the grid. */
  distanceAt(x, z) {
    const i = upperIndex(this.xs, x);
    const j = upperIndex(this.zs, z);
    return this.dist[j * this.nx + i];
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Ground colour used by both the terrain and the track's grass verges (sRGB → linear). */
  colorAt(x, z, h, slope, nearTrack, out = _c) {
    const n = this.noise;
    const n1 = fbm(n, x / 300 + 11, z / 300 - 7, 3) * 0.5 + 0.5;
    const n2 = this.noise2(x / 38, z / 38) * 0.5 + 0.5;
    const n3 = this.noise3(x / 11, z / 11) * 0.5 + 0.5;
    // lush ↔ dry grass
    let r = lerp(0.24, 0.43, n1 * 0.8);
    let g = lerp(0.36, 0.44, n1 * 0.8);
    let b = lerp(0.14, 0.2, n1 * 0.8);
    const patch = 0.82 + 0.2 * n2 + 0.06 * n3;
    r *= patch;
    g *= patch;
    b *= patch;
    // mowed circuit grass is greener and more even
    const mow = 1 - smoothstep(0.15, 0.6, nearTrack);
    r = lerp(r, 0.26, mow * 0.6);
    g = lerp(g, 0.42, mow * 0.6);
    b = lerp(b, 0.15, mow * 0.6);
    // dirt and rock on slopes
    const dirt = smoothstep(0.18, 0.34, slope + (n3 - 0.5) * 0.1);
    r = lerp(r, 0.42, dirt * 0.8);
    g = lerp(g, 0.35, dirt * 0.8);
    b = lerp(b, 0.26, dirt * 0.8);
    const rock = smoothstep(0.34, 0.55, slope + (n2 - 0.5) * 0.12);
    r = lerp(r, 0.46, rock);
    g = lerp(g, 0.44, rock);
    b = lerp(b, 0.41, rock);
    // alpine: darker scrub then snow caps
    const alp = smoothstep(90, 220, h + n2 * 30);
    r = lerp(r, 0.33, alp * 0.7);
    g = lerp(g, 0.33, alp * 0.7);
    b = lerp(b, 0.3, alp * 0.7);
    const snow = smoothstep(300, 380, h + n1 * 60) * (1 - rock * 0.7);
    r = lerp(r, 0.93, snow);
    g = lerp(g, 0.94, snow);
    b = lerp(b, 0.96, snow);
    // lake shore: mud and sand
    const shore = 1 - smoothstep(this.lake.level + 0.3, this.lake.level + 2.2, h);
    r = lerp(r, 0.45, shore * 0.85);
    g = lerp(g, 0.39, shore * 0.85);
    b = lerp(b, 0.29, shore * 0.85);
    return out.setRGB(r, g, b, THREE.SRGBColorSpace);
  }

  /** Build chunked meshes. Returns a Group. */
  buildMesh(material) {
    const { xs, zs, H, nx, nz } = this;
    // Normals from the global grid so chunk borders stay seamless.
    const N = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(nz - 1, j + 1);
      for (let i = 0; i < nx; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(nx - 1, i + 1);
        const dhdx = (H[j * nx + i1] - H[j * nx + i0]) / (xs[i1] - xs[i0]);
        const dhdz = (H[j1 * nx + i] - H[j0 * nx + i]) / (zs[j1] - zs[j0]);
        const len = Math.hypot(dhdx, 1, dhdz);
        const k = (j * nx + i) * 3;
        N[k] = -dhdx / len;
        N[k + 1] = 1 / len;
        N[k + 2] = -dhdz / len;
      }
    }
    const C = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        this.colorAt(xs[i], zs[j], H[k], 1 - N[k * 3 + 1], this.nearMask[k], _c);
        C[k * 3] = _c.r;
        C[k * 3 + 1] = _c.g;
        C[k * 3 + 2] = _c.b;
      }
    }
    this.normals = N;

    const group = new THREE.Group();
    group.name = 'terrain';
    const CH = 40;
    for (let cj = 0; cj < nz - 1; cj += CH) {
      for (let ci = 0; ci < nx - 1; ci += CH) {
        const ie = Math.min(nx - 1, ci + CH);
        const je = Math.min(nz - 1, cj + CH);
        const w = ie - ci + 1;
        const h = je - cj + 1;
        const pos = new Float32Array(w * h * 3);
        const nor = new Float32Array(w * h * 3);
        const col = new Float32Array(w * h * 3);
        const uv = new Float32Array(w * h * 2);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const gi = ci + i;
            const gj = cj + j;
            const k = gj * nx + gi;
            const v = j * w + i;
            pos[v * 3] = xs[gi];
            pos[v * 3 + 1] = H[k];
            pos[v * 3 + 2] = zs[gj];
            nor.set(N.subarray(k * 3, k * 3 + 3), v * 3);
            col.set(C.subarray(k * 3, k * 3 + 3), v * 3);
            uv[v * 2] = xs[gi] / 9;
            uv[v * 2 + 1] = zs[gj] / 9;
          }
        }
        const idx = new Uint32Array((w - 1) * (h - 1) * 6);
        let p = 0;
        for (let j = 0; j < h - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i;
            const b = a + 1;
            const c = a + w;
            const d = c + 1;
            idx[p++] = a;
            idx[p++] = c;
            idx[p++] = b;
            idx[p++] = b;
            idx[p++] = c;
            idx[p++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
      }
    }
    return group;
  }
}

/**
 * Ground material shared by the terrain and the track verges: vertex colours
 * times a detail texture sampled at two scales to hide tiling.
 */
export function createGroundMaterial(detailMap) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailMap,
    roughness: 0.96,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    injectFogUniforms(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #ifdef USE_MAP
        vec4 d1 = texture2D( map, vMapUv );
        vec4 d2 = texture2D( map, vMapUv * 0.137 + vec2(0.31, 0.77) );
        vec4 d3 = texture2D( map, vMapUv * 0.021 + vec2(0.53, 0.12) );
        vec3 detail = d1.rgb * mix(vec3(0.85), d2.rgb * 1.15, 0.6) * mix(vec3(0.9), d3.rgb * 1.2, 0.5);
        diffuseColor.rgb *= detail * 1.35;
      #endif
      `,
    );
  };
  mat.customProgramCacheKey = () => 'ground-v1';
  return mat;
}
