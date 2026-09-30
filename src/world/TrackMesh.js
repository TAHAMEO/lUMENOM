// Geometry for the circuit itself: asphalt, curbs, verges (grass / gravel),
// barriers (armco, concrete walls, tyre walls), start line and grid boxes.
// All strips are generated from the Track's sampled frames, so the physics and
// visuals share exactly the same cross-section heights.

import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math.js';
import { CURB_WIDTH, SURFACE, VERGE_BEYOND_BARRIER, WALL } from './Track.js';

const _c = new THREE.Color();

/** Contiguous runs of samples where pred(i) is true, handling wrap-around. */
export function findRuns(n, pred) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const v = pred(i);
    if (v && start < 0) start = i;
    if (!v && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) {
    if (runs.length && runs[0][0] === 0) runs[0] = [start, runs[0][1] + n];
    else runs.push([start, n - 1]);
  }
  if (runs.length === 1 && runs[0][0] === 0 && runs[0][1] === n - 1) runs[0] = [0, n];
  return runs;
}

/**
 * Build an indexed strip following the track.
 * rows = samples i0..i1 (i1 may exceed n to wrap), cols = profile points per row.
 * vfn(i, row, col, out) fills out.{x,y,z,u,v} and optionally out.{r,g,b}.
 */
function buildStrip(track, i0, i1, cols, vfn, { colors = false, flip = false } = {}) {
  const rows = i1 - i0 + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const col = colors ? new Float32Array(rows * cols * 3) : null;
  const out = { x: 0, y: 0, z: 0, u: 0, v: 0, r: 1, g: 1, b: 1 };
  for (let r = 0; r < rows; r++) {
    const i = (i0 + r) % track.n;
    for (let c = 0; c < cols; c++) {
      vfn(i, i0 + r, c, out);
      const k = r * cols + c;
      pos[k * 3] = out.x;
      pos[k * 3 + 1] = out.y;
      pos[k * 3 + 2] = out.z;
      uv[k * 2] = out.u;
      uv[k * 2 + 1] = out.v;
      if (col) {
        col[k * 3] = out.r;
        col[k * 3 + 1] = out.g;
        col[k * 3 + 2] = out.b;
      }
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (flip) idx.push(a, b, d, b, e, d);
      else idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function mergeInto(list) {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  // Simple merge (same attribute layout).
  let vcount = 0;
  let icount = 0;
  for (const g of list) {
    vcount += g.attributes.position.count;
    icount += g.index.count;
  }
  const merged = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(vcount * size);
    let off = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = new Uint32Array(icount);
  let io = 0;
  let vo = 0;
  for (const g of list) {
    const src = g.index.array;
    for (let k = 0; k < src.length; k++) index[io + k] = src[k] + vo;
    io += src.length;
    vo += g.attributes.position.count;
  }
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  for (const g of list) g.dispose();
  return merged;
}

export function buildTrackMeshes(track, terrain, mats) {
  const group = new THREE.Group();
  group.name = 'track';
  const n = track.n;
  const hw = track.halfWidth;
  const tile = track.length / Math.round(track.length / 14);

  // ---------------------------------------------------------------------------
  // Asphalt with a darker rubbered-in racing line.
  const roadCols = 11;
  const road = buildStrip(
    track,
    0,
    n,
    roadCols,
    (i, row, c, o) => {
      const s = -hw + (2 * hw * c) / (roadCols - 1);
      const p = track.pointAt(i, s);
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.u = (s + hw) / (2 * hw);
      o.v = (row * track.ds) / tile;
      const line = track.lineOffset[i];
      const rubber = Math.exp(-(((s - line) / 1.9) ** 2));
      const edgeDust = smoothstep(hw - 1.4, hw, Math.abs(s));
      const k = 1 - 0.2 * rubber + 0.1 * edgeDust;
      o.r = o.g = o.b = k;
    },
    { colors: true },
  );
  const roadMesh = new THREE.Mesh(road, mats.asphalt);
  roadMesh.receiveShadow = true;
  roadMesh.name = 'road';
  group.add(roadMesh);

  // ---------------------------------------------------------------------------
  // Curbs (sloped kerbs with red/white blocks).
  const curbProfile = [0, 0.1, 0.32, 0.55, 0.8, CURB_WIDTH - 0.32, CURB_WIDTH - 0.1, CURB_WIDTH];
  const curbGeos = [];
  for (const side of [1, -1]) {
    const flags = side > 0 ? track.curbL : track.curbR;
    for (const [a, b] of findRuns(n, (i) => flags[i] === 1)) {
      curbGeos.push(
        buildStrip(
          track,
          a,
          b + 1,
          curbProfile.length,
          (i, row, c, o) => {
            const u = curbProfile[c];
            const s = side * (hw + u);
            const p = track.pointAt(i, s);
            o.x = p.x;
            o.y = p.y + 0.004;
            o.z = p.z;
            o.u = u / CURB_WIDTH;
            o.v = (row * track.ds) / 2.4;
          },
          { flip: side < 0 },
        ),
      );
    }
  }
  const curbs = mergeInto(curbGeos);
  if (curbs) {
    const m = new THREE.Mesh(curbs, mats.curb);
    m.receiveShadow = true;
    m.name = 'curbs';
    group.add(m);
  }

  // ---------------------------------------------------------------------------
  // Verges: grass or gravel from the road/curb edge out past the barrier, then a skirt.
  const vergeCols = 9;
  const vergeGrassIdx = [];
  const vergeGravelIdx = [];
  const vergePos = [];
  const vergeCol = [];
  const vergeUv = [];
  const rowsPerSide = n + 1;
  let vBase = 0;
  for (const side of [1, -1]) {
    const curbFlags = side > 0 ? track.curbL : track.curbR;
    const barrier = side > 0 ? track.barrierL : track.barrierR;
    const verge = side > 0 ? track.vergeL : track.vergeR;
    for (let r = 0; r < rowsPerSide; r++) {
      const i = r % n;
      const inner = hw + (curbFlags[i] ? CURB_WIDTH : 0);
      const outer = barrier[i] + VERGE_BEYOND_BARRIER;
      for (let c = 0; c < vergeCols; c++) {
        let s;
        let dy = 0;
        if (c < vergeCols - 1) {
          const f = c / (vergeCols - 2);
          s = inner + (outer - inner) * f;
        } else {
          s = outer + 0.6;
          dy = -2.6;
        }
        const p = track.pointAt(i, side * s);
        const y = p.y + dy;
        vergePos.push(p.x, y, p.z);
        vergeUv.push(p.x / 9, p.z / 9);
        const nearT = clamp((s - hw) / 30, 0, 1) * 0.3;
        terrain.colorAt(p.x, p.z, y, 0.02, nearT, _c);
        vergeCol.push(_c.r, _c.g, _c.b);
      }
    }
    for (let r = 0; r < rowsPerSide - 1; r++) {
      const i = r % n;
      for (let c = 0; c < vergeCols - 1; c++) {
        const a = vBase + r * vergeCols + c;
        const b = a + 1;
        const d = a + vergeCols;
        const e = d + 1;
        const tri = side > 0 ? [a, d, b, b, d, e] : [a, b, d, b, e, d];
        const outerBand = c >= vergeCols - 3;
        const gravel = verge[i] === SURFACE.GRAVEL && !outerBand;
        (gravel ? vergeGravelIdx : vergeGrassIdx).push(...tri);
      }
    }
    vBase += rowsPerSide * vergeCols;
  }
  const vergeGeo = new THREE.BufferGeometry();
  vergeGeo.setAttribute('position', new THREE.Float32BufferAttribute(vergePos, 3));
  vergeGeo.setAttribute('color', new THREE.Float32BufferAttribute(vergeCol, 3));
  vergeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(vergeUv, 2));
  vergeGeo.setIndex([...vergeGrassIdx, ...vergeGravelIdx]);
  vergeGeo.addGroup(0, vergeGrassIdx.length, 0);
  vergeGeo.addGroup(vergeGrassIdx.length, vergeGravelIdx.length, 1);
  vergeGeo.computeVertexNormals();
  const vergeMesh = new THREE.Mesh(vergeGeo, [mats.ground, mats.gravel]);
  vergeMesh.receiveShadow = true;
  vergeMesh.name = 'verges';
  group.add(vergeMesh);

  // ---------------------------------------------------------------------------
  // Barriers.
  const barrierPoint = (i, side, extra, out) => {
    const b = (side > 0 ? track.barrierL[i] : track.barrierR[i]) + extra;
    return track.pointAt(i, side * b, out);
  };

  // Armco W-beam rail (front face toward the track, thin back face).
  const railProfile = [
    [0.0, 0.46],
    [0.05, 0.5],
    [0.05, 0.56],
    [0.015, 0.6],
    [0.05, 0.64],
    [0.05, 0.7],
    [0.0, 0.74],
    [0.035, 0.74],
    [0.085, 0.7],
    [0.085, 0.5],
    [0.035, 0.46],
    [0.0, 0.46],
  ];
  const armcoGeos = [];
  const postMatrices = [];
  const tmp = { x: 0, y: 0, z: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const side of [1, -1]) {
    const walls = side > 0 ? track.wallL : track.wallR;
    for (const [a, b] of findRuns(n, (i) => walls[i] === WALL.ARMCO)) {
      armcoGeos.push(
        buildStrip(
          track,
          a,
          b + 1,
          railProfile.length,
          (i, row, c, o) => {
            const [off, h] = railProfile[c];
            barrierPoint(i, side, off, tmp);
            o.x = tmp.x;
            o.y = tmp.y + h;
            o.z = tmp.z;
            o.u = c / (railProfile.length - 1);
            o.v = row * 0.5;
          },
          { flip: side < 0 },
        ),
      );
      for (let r = a; r <= b; r += 2) {
        const i = r % n;
        barrierPoint(i, side, 0.14, tmp);
        q.setFromAxisAngle(up, track.heading[i]);
        m4.compose(new THREE.Vector3(tmp.x, tmp.y + 0.36, tmp.z), q, new THREE.Vector3(1, 1, 1));
        postMatrices.push(m4.clone());
      }
    }
  }
  const armco = mergeInto(armcoGeos);
  if (armco) {
    const m = new THREE.Mesh(armco, mats.armco);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'armco';
    group.add(m);
  }
  if (postMatrices.length) {
    const postGeo = new THREE.BoxGeometry(0.12, 0.8, 0.1);
    const posts = new THREE.InstancedMesh(postGeo, mats.post, postMatrices.length);
    postMatrices.forEach((mm, k) => posts.setMatrixAt(k, mm));
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.name = 'armcoPosts';
    group.add(posts);
  }

  // Concrete (jersey) walls around the pit straight, with a painted band.
  const jersey = [
    [0.0, 0.0],
    [0.06, 0.07],
    [0.15, 0.3],
    [0.2, 1.02],
    [0.2, 1.02],
    [0.5, 1.02],
    [0.5, 0.0],
  ];
  const concreteGeos = [];
  for (const side of [1, -1]) {
    const walls = side > 0 ? track.wallL : track.wallR;
    for (const [a, b] of findRuns(n, (i) => walls[i] === WALL.CONCRETE)) {
      concreteGeos.push(
        buildStrip(
          track,
          a,
          b + 1,
          jersey.length,
          (i, row, c, o) => {
            const [off, h] = jersey[c];
            barrierPoint(i, side, off, tmp);
            o.x = tmp.x;
            o.y = tmp.y + h - 0.05;
            o.z = tmp.z;
            // u along the wall (12 m repeat), v up the track-facing side; top/back share the top edge
            o.u = (side * row * track.ds) / 12;
            o.v = c <= 3 ? h / 1.02 : 1;
          },
          { flip: side < 0 },
        ),
      );
    }
  }
  const concrete = mergeInto(concreteGeos);
  if (concrete) {
    const m = new THREE.Mesh(concrete, mats.concrete);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'concreteWalls';
    group.add(m);
  }

  // Tyre walls on the outside of the slowest corners (stacks of 3, two rows).
  const tyreMatrices = [];
  const tyreColors = [];
  for (const side of [1, -1]) {
    const walls = side > 0 ? track.wallL : track.wallR;
    for (const [a, b] of findRuns(n, (i) => walls[i] === WALL.TIRES)) {
      const len = (b - a) * track.ds;
      const count = Math.floor(len / 0.62);
      for (let k = 0; k < count; k++) {
        const f = (k * 0.62) / track.ds;
        const i = (a + Math.floor(f)) % n;
        for (let row = 0; row < 2; row++) {
          barrierPoint(i, side, 0.32 + row * 0.6, tmp);
          for (let h = 0; h < 3; h++) {
            m4.makeTranslation(tmp.x, tmp.y + 0.12 + h * 0.24, tmp.z);
            tyreMatrices.push(m4.clone());
            const painted = (k + row) % 5 === 0 ? (h === 1 ? 2 : 1) : 0;
            tyreColors.push(painted);
          }
        }
      }
    }
  }
  if (tyreMatrices.length) {
    const tyreGeo = new THREE.TorusGeometry(0.24, 0.1, 6, 14);
    tyreGeo.rotateX(Math.PI / 2);
    const tyres = new THREE.InstancedMesh(tyreGeo, mats.tyreWall, tyreMatrices.length);
    tyreMatrices.forEach((mm, k) => {
      tyres.setMatrixAt(k, mm);
      const p = tyreColors[k];
      tyres.setColorAt(k, _c.set(p === 1 ? 0xe8e8e8 : p === 2 ? 0xc8141c : 0x1a1a1a));
    });
    tyres.castShadow = true;
    tyres.receiveShadow = true;
    tyres.name = 'tyreWalls';
    group.add(tyres);
  }

  // ---------------------------------------------------------------------------
  // Start/finish line and grid boxes (decals just above the asphalt).
  const decal = (dStart, len, sFrom, sTo, mat, segs = 1) => {
    const pos = [];
    const uv = [];
    const idx = [];
    const p = {};
    for (let r = 0; r <= segs; r++) {
      const d = dStart + (len * r) / segs;
      for (let c = 0; c < 2; c++) {
        track.pointAtDistance(d, c === 0 ? sFrom : sTo, p);
        pos.push(p.x, p.y + 0.012, p.z);
        uv.push(c, r / segs);
      }
    }
    for (let r = 0; r < segs; r++) {
      const a = r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const startLine = new THREE.Mesh(decal(-0.75, 1.5, -hw, hw, null), mats.checker);
  startLine.receiveShadow = true;
  startLine.name = 'startLine';
  group.add(startLine);
  const slots = track.gridSlots(8);
  const slotGeos = [];
  for (const s of slots) {
    const d = s.index * track.ds + 2.6;
    const a = s.lateral > 0 ? 1.0 : -5.6;
    const b = s.lateral > 0 ? 5.6 : -1.0;
    slotGeos.push(decal(d, 0.22, a, b, null));
    // short side ticks of the grid box
    const outer = s.lateral > 0 ? b : a;
    slotGeos.push(decal(d - 1.6, 1.6, outer - (s.lateral > 0 ? 0.18 : 0), outer + (s.lateral > 0 ? 0 : 0.18), null));
  }
  const slotMesh = new THREE.Mesh(mergeInto(slotGeos), mats.paint);
  slotMesh.receiveShadow = true;
  slotMesh.name = 'gridBoxes';
  group.add(slotMesh);

  return { group, slots };
}
