// Instanced vegetation: conifers, broadleaf trees, rocks and grass tufts.
// Instances are bucketed into spatial clusters so three.js can frustum-cull
// each bucket for the main camera and the shadow camera independently.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm } from '../core/noise.js';
import { clamp, mulberry32, smoothstep } from '../core/math.js';
import { VERGE_BEYOND_BARRIER } from './Track.js';
import { makeCanvas, toTexture } from './textures.js';
import { injectFogUniforms } from './fogPatch.js';

const _c = new THREE.Color();

function colorize(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function jitter(geo, rand, amount, keepBottom = -Infinity) {
  const pos = geo.attributes.position;
  // Weld-aware jitter: identical positions get identical offsets so no cracks open.
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let off = map.get(key);
    if (!off) {
      off = [(rand() - 0.5) * amount, (rand() - 0.5) * amount * 0.6, (rand() - 0.5) * amount];
      map.set(key, off);
    }
    if (pos.getY(i) <= keepBottom) continue;
    pos.setXYZ(i, pos.getX(i) + off[0], pos.getY(i) + off[1], pos.getZ(i) + off[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function stripUv(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

export function createPineGeometry(seed = 3) {
  const rand = mulberry32(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.2, 2.6, 6, 1, true);
  trunk.translate(0, 1.3, 0);
  colorize(trunk, (x, y, z, c) => c.setRGB(0.22, 0.15, 0.1, THREE.SRGBColorSpace));
  parts.push(stripUv(trunk));
  const layers = [
    [2.3, 3.4, 3.0],
    [1.9, 3.0, 4.5],
    [1.45, 2.6, 5.8],
    [0.95, 2.2, 7.0],
    [0.5, 1.6, 8.0],
  ];
  layers.forEach(([r, h, y], li) => {
    const cone = new THREE.ConeGeometry(r, h, 9, 2, true);
    cone.translate(0, y, 0);
    // droop the skirt a little and jitter for an organic silhouette
    const pos = cone.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i);
      if (yy < y - h * 0.45) {
        pos.setY(i, yy - 0.25);
      }
    }
    jitter(cone, rand, 0.28);
    const base = y - h / 2;
    colorize(cone, (x, yy, z, c) => {
      const t = clamp((yy - base) / h, 0, 1);
      const lift = li / layers.length;
      c.setRGB(0.08 + 0.07 * t + 0.03 * lift, 0.2 + 0.12 * t + 0.05 * lift, 0.09 + 0.05 * t, THREE.SRGBColorSpace);
    });
    parts.push(stripUv(cone));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

export function createBroadleafGeometry(seed = 5) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.4, 6, 1, true);
  trunk.translate(0, 1.7, 0);
  colorize(trunk, (x, y, z, c) => c.setRGB(0.25, 0.19, 0.13, THREE.SRGBColorSpace));
  parts.push(stripUv(trunk));
  const blobs = [
    [0, 4.6, 0, 2.3],
    [0.9, 5.4, 0.5, 1.8],
    [-0.8, 5.1, -0.6, 1.9],
    [0.1, 6.3, -0.1, 1.5],
  ];
  for (const [bx, by, bz, r] of blobs) {
    // welded so the crown gets soft, rounded shading instead of facets
    let ico = new THREE.IcosahedronGeometry(r, 1);
    ico.deleteAttribute('uv');
    ico.deleteAttribute('normal');
    ico = mergeVertices(ico);
    const pos = ico.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = 1 + 0.22 * noise(x * 0.9 + bx * 3, z * 0.9 + y * 0.7 + by);
      pos.setXYZ(i, x * n, y * n * 0.85, z * n);
    }
    ico.translate(bx, by, bz);
    jitter(ico, rand, 0.12);
    colorize(ico, (x, y, z, c) => {
      const t = clamp((y - (by - r)) / (2 * r), 0, 1);
      const v = 0.85 + 0.3 * rand();
      c.setRGB((0.11 + 0.12 * t) * v, (0.23 + 0.16 * t) * v, (0.08 + 0.04 * t) * v, THREE.SRGBColorSpace);
    });
    const flat = ico.toNonIndexed();
    parts.push(flat);
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

/** Far-distance stand-ins: same silhouette and colouring, a fraction of the triangles. */
function createPineGeometryLow() {
  const parts = [];
  const layers = [
    [2.3, 4.4, 3.4],
    [1.6, 3.6, 5.4],
    [0.85, 2.8, 7.3],
  ];
  layers.forEach(([r, h, y], li) => {
    const cone = new THREE.ConeGeometry(r, h, 6, 1, true);
    cone.translate(0, y, 0);
    const base = y - h / 2;
    colorize(cone, (x, yy, z, c) => {
      const t = clamp((yy - base) / h, 0, 1);
      const lift = li / layers.length;
      c.setRGB(0.08 + 0.07 * t + 0.03 * lift, 0.2 + 0.12 * t + 0.05 * lift, 0.09 + 0.05 * t, THREE.SRGBColorSpace);
    });
    parts.push(stripUv(cone));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

function createBroadleafGeometryLow() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.4, 4, 1, true);
  trunk.translate(0, 1.7, 0);
  colorize(trunk, (x, y, z, c) => c.setRGB(0.25, 0.19, 0.13, THREE.SRGBColorSpace));
  parts.push(stripUv(trunk));
  for (const [bx, by, bz, r] of [
    [0, 4.8, 0, 2.5],
    [0.3, 6.0, -0.2, 1.8],
  ]) {
    const ico = new THREE.IcosahedronGeometry(r, 0);
    ico.scale(1, 0.85, 1);
    ico.translate(bx, by, bz);
    colorize(ico, (x, y, z, c) => {
      const t = clamp((y - (by - r)) / (2 * r), 0, 1);
      c.setRGB(0.12 + 0.12 * t, 0.24 + 0.16 * t, 0.08 + 0.04 * t, THREE.SRGBColorSpace);
    });
    parts.push(stripUv(ico));
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function createRockGeometry(seed = 9) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(seed);
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + 0.3 * noise(x * 1.7 + 3, z * 1.7 + y * 1.3);
    pos.setXYZ(i, x * n * 1.2, y * n * 0.7, z * n);
  }
  jitter(ico, rand, 0.15);
  colorize(ico, (x, y, z, c) => {
    const t = clamp(y * 0.5 + 0.5, 0, 1);
    c.setRGB(0.3 + 0.12 * t, 0.29 + 0.11 * t, 0.27 + 0.1 * t, THREE.SRGBColorSpace);
  });
  const g = stripUv(ico);
  g.computeVertexNormals();
  return g;
}

function createGrassTexture() {
  const w = 256;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(21);
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x0 = 10 + rand() * (w - 20);
    const hh = h * (0.45 + rand() * 0.55);
    const bend = (rand() - 0.5) * 60;
    const width = 3 + rand() * 4;
    const g = 90 + rand() * 70;
    const r = 55 + rand() * 50;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${(30 + rand() * 25) | 0})`;
    ctx.beginPath();
    ctx.moveTo(x0 - width / 2, h);
    ctx.quadraticCurveTo(x0 + bend * 0.3, h - hh * 0.5, x0 + bend, h - hh);
    ctx.quadraticCurveTo(x0 + bend * 0.3 + width * 0.2, h - hh * 0.5, x0 + width / 2, h);
    ctx.closePath();
    ctx.fill();
  }
  const t = toTexture(canvas, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function createGrassGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const p = new THREE.PlaneGeometry(1.1, 0.7, 1, 2);
    p.translate(0, 0.35, 0);
    p.rotateY((k * Math.PI) / 3);
    parts.push(p);
  }
  const g = mergeGeometries(parts);
  // bake a colour gradient: darker roots
  colorize(g, (x, y, z, c) => {
    const t = clamp(y / 0.7, 0, 1);
    c.setRGB(0.55 + 0.45 * t, 0.55 + 0.45 * t, 0.55 + 0.45 * t);
  });
  return g;
}

/**
 * Scatter vegetation over the terrain. Returns { group, update(time), setDensity(f) }.
 */
export function buildVegetation(track, terrain, opts = {}) {
  const rand = mulberry32(opts.seed ?? 1234);
  const noise = createNoise2D(opts.seed ?? 99);
  const group = new THREE.Group();
  group.name = 'vegetation';

  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });

  const pineGeo = createPineGeometry();
  const leafGeo = createBroadleafGeometry();
  const rockGeo = createRockGeometry();

  const xMin = track.minX - 650;
  const xMax = track.maxX + 650;
  const zMin = track.minZ - 600;
  const zMax = track.maxZ + 600;
  const CELL = 300;
  const cols = Math.ceil((xMax - xMin) / CELL);
  const buckets = new Map();
  const bucket = (x, z, kind) => {
    const key = `${kind}:${Math.floor((x - xMin) / CELL)}:${Math.floor((z - zMin) / CELL)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { kind, list: [] };
      buckets.set(key, b);
    }
    return b.list;
  };

  const clearOf = (x, z, margin) => {
    const q = track.nearestGlobal(x, z, 60);
    if (!q) return true;
    const i = q.index;
    const lateral = (x - track.px[i]) * track.lx[i] + (z - track.pz[i]) * track.lz[i];
    const barrier = lateral > 0 ? track.barrierL[i] : track.barrierR[i];
    return q.dist > barrier + VERGE_BEYOND_BARRIER + margin;
  };
  const exclusions = opts.exclusions ?? [];
  const excluded = (x, z) => exclusions.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r);
  const lakeLevel = terrain.lake.level;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();

  // Trees: forest density from low-frequency noise, thinned near the circuit.
  const attempts = opts.treeAttempts ?? 60000;
  let placed = 0;
  for (let a = 0; a < attempts; a++) {
    const x = xMin + rand() * (xMax - xMin);
    const z = zMin + rand() * (zMax - zMin);
    const forest = smoothstep(-0.05, 0.35, fbm(noise, x / 320, z / 320, 3));
    const d = terrain.distanceAt(x, z);
    const nearBoost = smoothstep(18, 60, d) * (1 - smoothstep(380, 700, d) * 0.6);
    if (rand() > forest * nearBoost * 0.9 + 0.02) continue;
    if (excluded(x, z)) continue;
    if (d < 60 && !clearOf(x, z, 4 + rand() * 6)) continue;
    const y = terrain.heightAt(x, z);
    if (y < lakeLevel + 0.8) continue;
    terrain.normalAt(x, z, nrm);
    if (nrm.y < 0.82) continue;
    const pine = fbm(noise, x / 500 + 40, z / 500, 2) + (y - 8) * 0.01 > -0.12 ? rand() < 0.78 : rand() < 0.25;
    const scale = (pine ? 0.8 : 0.85) + rand() * 0.65;
    p.set(x, y - 0.25, z);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(scale * (0.9 + rand() * 0.2), scale * (0.85 + rand() * 0.35), scale * (0.9 + rand() * 0.2));
    m4.compose(p, q, s);
    const tint = 0.78 + rand() * 0.4;
    bucket(x, z, pine ? 'pine' : 'leaf').push({
      m: m4.clone(),
      c: new THREE.Color(tint * (pine ? 0.95 : 1.05), tint, tint * (pine ? 1.0 : 0.9)),
    });
    placed++;
  }

  // Rocks near slopes, lake shores and in the runoff beyond barriers.
  for (let a = 0; a < 5000; a++) {
    const x = xMin + rand() * (xMax - xMin);
    const z = zMin + rand() * (zMax - zMin);
    const d = terrain.distanceAt(x, z);
    if (d < 40 && !clearOf(x, z, 2)) continue;
    const y = terrain.heightAt(x, z);
    terrain.normalAt(x, z, nrm);
    const slope = 1 - nrm.y;
    const shore = Math.abs(y - lakeLevel) < 1.5;
    if (rand() > slope * 3 + (shore ? 0.4 : 0) + 0.015) continue;
    const scale = 0.4 + rand() ** 3 * 2.5;
    p.set(x, y - scale * 0.25, z);
    q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
    s.set(scale, scale * (0.7 + rand() * 0.5), scale);
    m4.compose(p, q, s);
    const tint = 0.8 + rand() * 0.35;
    bucket(x, z, 'rock').push({ m: m4.clone(), c: new THREE.Color(tint, tint * 0.98, tint * 0.95) });
  }

  const meshes = { pine: [], leaf: [], rock: [], grass: [] };
  const geos = { pine: pineGeo, leaf: leafGeo, rock: rockGeo };
  const lowGeos = { pine: createPineGeometryLow(), leaf: createBroadleafGeometryLow() };
  const matsBy = { pine: treeMat, leaf: treeMat, rock: rockMat };
  const lodPairs = [];
  const makeInstanced = (geo, mat, list) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => {
      mesh.setMatrixAt(k, it.m);
      mesh.setColorAt(k, it.c);
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.full = list.length;
    group.add(mesh);
    return mesh;
  };
  for (const b of buckets.values()) {
    const mesh = makeInstanced(geos[b.kind], matsBy[b.kind], b.list);
    mesh.castShadow = true;
    meshes[b.kind].push(mesh);
    if (lowGeos[b.kind]) {
      const low = makeInstanced(lowGeos[b.kind], matsBy[b.kind], b.list);
      low.castShadow = false;
      low.visible = false;
      low.userData.isLow = true;
      meshes[b.kind].push(low);
      lodPairs.push({ hi: mesh, lo: low });
    }
  }
  const LOD_DIST = 230;
  let lodTimer = 0;
  let shadowsOn = true;

  // Grass tufts beyond the barriers, swaying in the wind.
  const grassTex = createGrassTexture();
  const grassUniforms = { time: { value: 0 }, fadeDist: { value: 110 } };
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  grassMat.onBeforeCompile = (shader) => {
    injectFogUniforms(shader);
    shader.uniforms.time = grassUniforms.time;
    shader.uniforms.fadeDist = grassUniforms.fadeDist;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nuniform float fadeDist;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
          float sway = sin( time * 1.7 + iPos.x * 0.21 + iPos.z * 0.17 ) + 0.5 * sin( time * 2.9 + iPos.x * 0.5 );
          transformed.x += sway * 0.07 * position.y * position.y * 2.0;
          transformed.z += sway * 0.04 * position.y * position.y * 2.0;
          float camD = distance( cameraPosition.xz, iPos.xz );
          transformed *= 1.0 - smoothstep( fadeDist * 0.7, fadeDist, camD );
        #endif
        `,
      );
    // Grass normals point up for soft, even lighting (and are not flipped on back faces).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    );
  };
  grassMat.customProgramCacheKey = () => 'grass-v1';
  const grassGeo = createGrassGeometry();
  const grassBuckets = new Map();
  const grassCount = opts.grassCount ?? 26000;
  let g = 0;
  for (let a = 0; a < grassCount * 6 && g < grassCount; a++) {
    // sample around random track points for density near the circuit
    const i = Math.floor(rand() * track.n);
    const side = rand() < 0.5 ? 1 : -1;
    const barrier = side > 0 ? track.barrierL[i] : track.barrierR[i];
    const lat = barrier + VERGE_BEYOND_BARRIER + 0.8 + rand() ** 1.6 * 45;
    const x = track.px[i] + track.lx[i] * lat * side + (rand() - 0.5) * 4;
    const z = track.pz[i] + track.lz[i] * lat * side + (rand() - 0.5) * 4;
    if (!clearOf(x, z, 0.6)) continue;
    if (excluded(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < lakeLevel + 0.5) continue;
    const scale = 0.6 + rand() * 0.9;
    p.set(x, y - 0.03, z);
    q.setFromAxisAngle(up, rand() * Math.PI);
    s.set(scale, scale * (0.7 + rand() * 0.6), scale);
    m4.compose(p, q, s);
    terrain.colorAt(x, z, y, 0.05, 0.4, _c);
    const key = `${Math.floor((x - xMin) / 200)}:${Math.floor((z - zMin) / 200)}`;
    let list = grassBuckets.get(key);
    if (!list) grassBuckets.set(key, (list = []));
    list.push({ m: m4.clone(), c: new THREE.Color(_c.r * 1.25, _c.g * 1.45, _c.b * 1.2) });
    g++;
  }
  for (const list of grassBuckets.values()) {
    const mesh = new THREE.InstancedMesh(grassGeo, grassMat, list.length);
    list.forEach((it, k) => {
      mesh.setMatrixAt(k, it.m);
      mesh.setColorAt(k, it.c);
    });
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.userData.full = list.length;
    group.add(mesh);
    meshes.grass.push(mesh);
  }

  return {
    group,
    meshes,
    treeCount: placed,
    grassMaterial: grassMat,
    update(time, camera) {
      grassUniforms.time.value = time;
      if (!camera) return;
      lodTimer -= 1;
      if (lodTimer > 0) return;
      lodTimer = 10;
      const cp = camera.position;
      for (const { hi, lo } of lodPairs) {
        const bs = hi.boundingSphere;
        const d = Math.max(0, cp.distanceTo(bs.center) - bs.radius);
        const near = d < LOD_DIST;
        hi.visible = near;
        lo.visible = !near;
        hi.castShadow = shadowsOn && near;
      }
    },
    /** Scale instance counts for quality presets (0..1). */
    setDensity(trees, grass) {
      for (const k of ['pine', 'leaf']) for (const m of meshes[k]) m.count = Math.floor(m.userData.full * trees);
      for (const m of meshes.grass) {
        m.count = Math.floor(m.userData.full * grass);
        m.visible = grass > 0;
      }
    },
    setShadows(enabled) {
      shadowsOn = enabled;
      for (const k of ['pine', 'leaf', 'rock']) for (const m of meshes[k]) m.castShadow = enabled && !m.userData.isLow;
      lodTimer = 0;
    },
  };
}
