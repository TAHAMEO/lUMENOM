// Tyre marks as a ring buffer of quads laid on the road surface. Each wheel
// keeps its last point; while it slides, new quads connect to it.

import * as THREE from 'three';

export class Skidmarks {
  constructor(max = 3000) {
    this.max = max;
    this.next = 0;
    const pos = new Float32Array(max * 4 * 3);
    const col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.trails = new Map(); // key → { x, y, z, lx, lz, a }
    this.dirty = false;
    this.minQ = Infinity;
    this.maxQ = -1;
  }

  /** Add a trail point for `key`; intensity 0..1 (0 breaks the trail). */
  add(key, x, y, z, dirX, dirZ, width, intensity) {
    const prev = this.trails.get(key);
    if (intensity <= 0.02) {
      if (prev) this.trails.delete(key);
      return;
    }
    // lateral vector perpendicular to travel
    const len = Math.hypot(dirX, dirZ) || 1;
    const lx = -dirZ / len;
    const lz = dirX / len;
    if (!prev) {
      this.trails.set(key, { x, y, z, lx, lz, a: intensity });
      return;
    }
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d < 0.35) return;
    if (d > 4) {
      this.trails.set(key, { x, y, z, lx, lz, a: intensity });
      return;
    }
    const q = this.next;
    this.next = (this.next + 1) % this.max;
    const P = this.aPos.array;
    const C = this.aCol.array;
    const hw = width / 2;
    const v = q * 4;
    const set = (k, px, py, pz, a) => {
      P[(v + k) * 3] = px;
      P[(v + k) * 3 + 1] = py;
      P[(v + k) * 3 + 2] = pz;
      C[(v + k) * 4] = 0.03;
      C[(v + k) * 4 + 1] = 0.03;
      C[(v + k) * 4 + 2] = 0.03;
      C[(v + k) * 4 + 3] = a;
    };
    const a0 = Math.min(0.85, prev.a * 0.8);
    const a1 = Math.min(0.85, intensity * 0.8);
    set(0, prev.x + prev.lx * hw, prev.y, prev.z + prev.lz * hw, a0);
    set(1, prev.x - prev.lx * hw, prev.y, prev.z - prev.lz * hw, a0);
    set(2, x + lx * hw, y, z + lz * hw, a1);
    set(3, x - lx * hw, y, z - lz * hw, a1);
    this.minQ = Math.min(this.minQ, q);
    this.maxQ = Math.max(this.maxQ, q);
    this.dirty = true;
    prev.x = x;
    prev.y = y;
    prev.z = z;
    prev.lx = lx;
    prev.lz = lz;
    prev.a = intensity;
  }

  update() {
    if (!this.dirty) return;
    this.aPos.clearUpdateRanges();
    this.aCol.clearUpdateRanges();
    this.aPos.addUpdateRange(this.minQ * 12, (this.maxQ - this.minQ + 1) * 12);
    this.aCol.addUpdateRange(this.minQ * 16, (this.maxQ - this.minQ + 1) * 16);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.dirty = false;
    this.minQ = Infinity;
    this.maxQ = -1;
  }

  clear() {
    this.aCol.array.fill(0);
    this.aCol.clearUpdateRanges();
    this.aCol.needsUpdate = true;
    this.trails.clear();
  }
}
