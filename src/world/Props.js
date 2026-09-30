// Trackside props: street lamps (with light pools at night), the start gantry
// and its countdown lights, grandstands with crowds, the pit building, sponsor
// billboards, a bridge over the pit straight, braking boards and chevrons.
// All sponsors are fictional.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, mulberry32 } from '../core/math.js';
import { VERGE_BEYOND_BARRIER, WALL } from './Track.js';
import { makeCanvas, toTexture, createRadialTexture, makeTileNoise, tileFbm } from './textures.js';

const DISPLAY_FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

export const SPONSORS = [
  { name: 'LUMENOM', sub: 'RACING', bg: '#0d1526', fg: '#f4f1e8', accent: '#ffb21a' },
  { name: 'VOLTRA', sub: 'ENERGY', bg: '#ffc629', fg: '#121212', accent: '#121212' },
  { name: 'APEX', sub: 'TYRES', bg: '#101010', fg: '#ffffff', accent: '#e8202a' },
  { name: 'HELIX', sub: 'MOTOR OIL', bg: '#0f6b6b', fg: '#ffffff', accent: '#ffd36b' },
  { name: 'NORTHWIND', sub: 'AIR', bg: '#f2f4f7', fg: '#10264d', accent: '#2f7de1' },
  { name: 'KINETIC', sub: 'PERFORMANCE PARTS', bg: '#c3141e', fg: '#ffffff', accent: '#ffffff' },
  { name: 'SOLSTICE', sub: 'CHRONOGRAPHS', bg: '#141210', fg: '#e3c27a', accent: '#e3c27a' },
  { name: 'ORBITA', sub: 'TELECOM', bg: '#ff6a1a', fg: '#1a0e06', accent: '#1a0e06' },
];

function drawSponsor(ctx, x, y, w, h, s) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = s.accent;
  ctx.fillRect(x, y + h * 0.84, w, h * 0.06);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = s.fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let size = h * 0.5;
  ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
  const maxW = w * 0.62;
  const mw = ctx.measureText(s.name).width;
  if (mw > maxW) {
    size *= maxW / mw;
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
  }
  ctx.fillText(s.name, x + w * 0.4, y + h * 0.44);
  ctx.font = `700 ${h * 0.16}px ${DISPLAY_FONT}`;
  ctx.fillStyle = s.accent === s.bg ? s.fg : s.accent;
  ctx.fillText(s.sub, x + w * 0.82, y + h * 0.46);
  ctx.restore();
}

function sponsorTexture(s, w = 1024, h = 256) {
  const c = makeCanvas(w, h);
  drawSponsor(c.getContext('2d'), 0, 0, w, h, s);
  const t = toTexture(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Concrete wall face: weathered concrete with alternating sponsor panels (12 m repeat). */
function concreteWallTexture() {
  const w = 2048;
  const h = 192;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const noise = makeTileNoise(404);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = tileFbm(noise, x / w, y / h, 12, 4);
      const v = 150 + n * 22;
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 1.02;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // painted sponsor panels on the upper 70% of the face
  const panels = [SPONSORS[0], SPONSORS[2], SPONSORS[1]];
  const pw = w / panels.length;
  panels.forEach((s, k) => drawSponsor(ctx, k * pw + 6, h * 0.08, pw - 12, h * 0.68, s));
  // grime at the base
  const g = ctx.createLinearGradient(0, h, 0, h * 0.7);
  g.addColorStop(0, 'rgba(30,26,22,0.55)');
  g.addColorStop(1, 'rgba(30,26,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  return toTexture(c);
}

function garageTexture() {
  const w = 1024;
  const h = 384;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rand = mulberry32(8);
  ctx.fillStyle = '#c9ccd1';
  ctx.fillRect(0, 0, w, h);
  // two bays per repeat
  for (let b = 0; b < 2; b++) {
    const x0 = b * (w / 2) + 30;
    const bw = w / 2 - 60;
    // interior with ceiling lights
    const g = ctx.createLinearGradient(0, h * 0.28, 0, h);
    g.addColorStop(0, '#2b2f36');
    g.addColorStop(1, '#15171b');
    ctx.fillStyle = g;
    ctx.fillRect(x0, h * 0.28, bw, h * 0.72);
    ctx.fillStyle = '#e8eef5';
    for (let k = 0; k < 3; k++) ctx.fillRect(x0 + 30 + k * (bw / 3), h * 0.31, bw / 3 - 60, 6);
    // tool chests and a car silhouette
    ctx.fillStyle = ['#b3121a', '#1d4fa3', '#e0a100', '#1b7a4a'][Math.floor(rand() * 4)];
    ctx.fillRect(x0 + 16, h * 0.72, 60, h * 0.28);
    ctx.fillRect(x0 + bw - 76, h * 0.72, 60, h * 0.28);
    ctx.fillStyle = '#0c0d0f';
    ctx.beginPath();
    ctx.ellipse(x0 + bw / 2, h * 0.93, bw * 0.3, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // team board
    const s = SPONSORS[Math.floor(rand() * SPONSORS.length)];
    drawSponsor(ctx, x0, h * 0.06, bw, h * 0.16, s);
  }
  return toTexture(c);
}

function startPanelTexture() {
  const w = 1024;
  const h = 160;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0f18';
  ctx.fillRect(0, 0, w, h);
  const sq = h / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#f4f4f4' : '#111';
      ctx.fillRect(x * sq, y * sq, sq, sq);
      ctx.fillRect(w - (x + 1) * sq, y * sq, sq, sq);
    }
  }
  ctx.fillStyle = '#f4f1e8';
  ctx.font = `900 ${h * 0.5}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LUMENOM RING', w / 2, h * 0.47);
  ctx.fillStyle = '#ffb21a';
  ctx.fillRect(w * 0.22, h * 0.82, w * 0.56, h * 0.05);
  return toTexture(c, { repeat: false });
}

function numberBoardTexture(text) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.fillStyle = '#111';
  ctx.font = `900 120px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 134);
  return toTexture(c, { repeat: false });
}

function chevronTexture() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d4161c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(60, 30);
  ctx.lineTo(150, 128);
  ctx.lineTo(60, 226);
  ctx.lineTo(110, 226);
  ctx.lineTo(200, 128);
  ctx.lineTo(110, 30);
  ctx.closePath();
  ctx.fill();
  return toTexture(c, { repeat: false });
}

export function buildProps(track, terrain, mats) {
  const group = new THREE.Group();
  group.name = 'props';
  const rand = mulberry32(4711);
  const n = track.n;
  const exclusions = [];
  const nightMaterials = []; // { mat, day, night } emissive intensities
  const tmp = {};

  const frame = (i) => {
    i = ((i % n) + n) % n;
    return {
      i,
      x: track.px[i],
      z: track.pz[i],
      y: track.py[i],
      tx: track.tx[i],
      tz: track.tz[i],
      lx: track.lx[i],
      lz: track.lz[i],
      yaw: track.heading[i],
    };
  };
  const barrierOf = (i, side) => {
    i = ((i % n) + n) % n;
    return side > 0 ? track.barrierL[i] : track.barrierR[i];
  };

  mats.concrete.map = concreteWallTexture();
  mats.concrete.needsUpdate = true;

  // ---------------------------------------------------------------------------
  // Street lamps every ~64 m, alternating sides, arm reaching over the track edge.
  const lampHeads = [];
  const poleMatrices = [];
  const headMatrices = [];
  const poolGeos = [];
  const poleGeo = (() => {
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 9.2, 8);
    pole.translate(0, 4.6, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.06, 3.6, 6);
    arm.rotateX(Math.PI / 2);
    arm.translate(0, 9.0, 1.7);
    const base = new THREE.CylinderGeometry(0.25, 0.3, 0.5, 8);
    base.translate(0, 0.25, 0);
    return mergeGeometries([pole, arm, base]);
  })();
  const headGeo = new THREE.BoxGeometry(0.45, 0.16, 1.0);
  headGeo.translate(0, 8.92, 3.35);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  let side = 1;
  for (let i = 8; i < n; i += 32) {
    side = -side;
    const w = side > 0 ? track.wallL[i] : track.wallR[i];
    if (w === WALL.TIRES) continue;
    const f = frame(i);
    const lat = barrierOf(i, side) + 1.3;
    const bx = f.x + f.lx * lat * side;
    const bz = f.z + f.lz * lat * side;
    const by = track.pointAt(i, side * lat, tmp).y - 0.1;
    // local +Z of the lamp points back toward the track
    const yaw = Math.atan2(-f.lx * side, -f.lz * side);
    q.setFromAxisAngle(up, yaw);
    m4.compose(new THREE.Vector3(bx, by, bz), q, one);
    poleMatrices.push(m4.clone());
    headMatrices.push(m4.clone());
    const hx = bx + Math.sin(yaw) * 3.35;
    const hz = bz + Math.cos(yaw) * 3.35;
    lampHeads.push(new THREE.Vector3(hx, by + 8.85, hz));
    // light pool conforming to the ground under the head
    const R = 9;
    const res = 6;
    const pos = [];
    const uv = [];
    const idx = [];
    const proj = {};
    for (let a = 0; a <= res; a++) {
      for (let b = 0; b <= res; b++) {
        const ox = (a / res - 0.5) * 2 * R;
        const oz = (b / res - 0.5) * 2 * R;
        const px = hx + ox;
        const pz = hz + oz;
        track.project(px, pz, i, proj);
        const edge = (proj.lateral > 0 ? proj.barrierL : proj.barrierR) + VERGE_BEYOND_BARRIER;
        const py = Math.abs(proj.lateral) < edge ? track.heightAt(proj) : terrain.heightAt(px, pz);
        pos.push(px, py + 0.03, pz);
        uv.push(a / res, b / res);
      }
    }
    for (let a = 0; a < res; a++) {
      for (let b = 0; b < res; b++) {
        const k = a * (res + 1) + b;
        idx.push(k, k + 1, k + res + 1, k + 1, k + res + 2, k + res + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    poolGeos.push(g);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, metalness: 0.7, roughness: 0.42 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, poleMatrices.length);
  poleMatrices.forEach((mm, k) => poles.setMatrixAt(k, mm));
  poles.castShadow = true;
  poles.receiveShadow = true;
  poles.computeBoundingSphere();
  group.add(poles);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30,
    emissive: new THREE.Color(1.0, 0.82, 0.6),
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0.3,
  });
  nightMaterials.push({ mat: headMat, day: 0, night: 14 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, headMatrices.length);
  headMatrices.forEach((mm, k) => heads.setMatrixAt(k, mm));
  heads.computeBoundingSphere();
  group.add(heads);
  const poolMat = new THREE.MeshBasicMaterial({
    map: createRadialTexture(128, [
      [0, 'rgba(255,214,160,0.55)'],
      [0.35, 'rgba(255,196,130,0.26)'],
      [0.7, 'rgba(255,180,110,0.07)'],
      [1, 'rgba(255,170,100,0)'],
    ]),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const pools = new THREE.Mesh(mergeGeometries(poolGeos), poolMat);
  pools.visible = false;
  pools.renderOrder = 2;
  group.add(pools);

  // ---------------------------------------------------------------------------
  // Start gantry with five columns of red lights.
  const gantry = new THREE.Group();
  const f0 = frame(0);
  const span = track.halfWidth + 2.2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.75, roughness: 0.4 });
  const pillarGeo = new THREE.BoxGeometry(0.7, 8.6, 0.7);
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, steel);
    p.position.set(sgn * span, 4.3, 0);
    p.castShadow = true;
    gantry.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 1.2, 0.9), steel);
  beam.position.set(0, 8.0, 0);
  beam.castShadow = true;
  gantry.add(beam);
  const panelTex = startPanelTexture();
  const panelMat = new THREE.MeshStandardMaterial({
    map: panelTex,
    emissive: 0xffffff,
    emissiveMap: panelTex,
    emissiveIntensity: 0.15,
    roughness: 0.5,
  });
  nightMaterials.push({ mat: panelMat, day: 0.15, night: 1.6 });
  const panelW = span * 1.3;
  for (const face of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelW * (160 / 1024) * 1.35), panelMat);
    panel.position.set(0, 9.35, face * 0.46);
    panel.rotation.y = face > 0 ? 0 : Math.PI;
    gantry.add(panel);
  }
  const panelBox = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.3, panelW * (160 / 1024) * 1.35 + 0.3, 0.9), steel);
  panelBox.position.set(0, 9.35, 0);
  gantry.add(panelBox);
  // lights face +Z (toward the grid, which is behind the line)
  const lightHousingGeo = new THREE.BoxGeometry(0.62, 1.1, 0.35);
  const lampGeo = new THREE.CircleGeometry(0.19, 20);
  const startLightMats = [];
  for (let c = 0; c < 5; c++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x220505,
      emissive: new THREE.Color(1, 0.05, 0.03),
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    startLightMats.push(mat);
    const x = (c - 2) * 0.95;
    const housing = new THREE.Mesh(lightHousingGeo, steel);
    housing.position.set(x, 7.25, 0.5);
    gantry.add(housing);
    for (let r = 0; r < 2; r++) {
      const lamp = new THREE.Mesh(lampGeo, mat);
      lamp.position.set(x, 7.5 - r * 0.5, 0.68);
      gantry.add(lamp);
    }
  }
  // Orient: local +Z faces back down the straight (toward approaching cars).
  gantry.position.set(f0.x, f0.y, f0.z);
  gantry.rotation.y = Math.atan2(-f0.tx, -f0.tz);
  gantry.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true;
  });
  group.add(gantry);

  // ---------------------------------------------------------------------------
  // Grandstands on the outside (left) of the pit straight, pit building on the inside.
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.75, metalness: 0.1 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e3c6e, roughness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.5, metalness: 0.4 });
  const crowdGeo = new THREE.BoxGeometry(0.42, 0.62, 0.32);
  crowdGeo.translate(0, 0.31, 0);
  const crowdMatrices = [];
  const crowdColors = [];
  const shirt = ['#e53935', '#fdd835', '#1e88e5', '#ffffff', '#43a047', '#fb8c00', '#212121', '#8e24aa', '#00acc1', '#f4511e'];
  const buildStand = (centerIdx, length, rows) => {
    const f = frame(centerIdx);
    const lat = barrierOf(centerIdx, 1) + VERGE_BEYOND_BARRIER + 3.5;
    const gx = f.x + f.lx * lat;
    const gz = f.z + f.lz * lat;
    // lowest ground over the footprint
    let gy = Infinity;
    for (let a = -1; a <= 1; a++) {
      for (let b = 0; b <= 1; b++) {
        const px = gx + f.tx * (length / 2) * a + f.lx * b * rows * 0.85;
        const pz = gz + f.tz * (length / 2) * a + f.lz * b * rows * 0.85;
        gy = Math.min(gy, terrain.heightAt(px, pz));
      }
    }
    const stand = new THREE.Group();
    const depth = rows * 0.85;
    const rise = 0.45;
    const parts = [];
    for (let r = 0; r < rows; r++) {
      const step = new THREE.BoxGeometry(length, 0.3 + r * rise, 0.85);
      step.translate(0, (0.3 + r * rise) / 2 + 1.2, 0.85 * r + 0.425);
      parts.push(step);
    }
    const plinth = new THREE.BoxGeometry(length, 1.6, depth);
    plinth.translate(0, 0.4, depth / 2);
    parts.push(plinth);
    const back = new THREE.BoxGeometry(length, rows * rise + 5, 0.3);
    back.translate(0, (rows * rise + 5) / 2, depth + 0.15);
    parts.push(back);
    for (const sx of [-1, 1]) {
      const wall = new THREE.BoxGeometry(0.3, rows * rise + 3, depth);
      wall.translate((sx * length) / 2, (rows * rise + 3) / 2, depth / 2);
      parts.push(wall);
    }
    const body = new THREE.Mesh(mergeGeometries(parts), standMat);
    body.castShadow = true;
    body.receiveShadow = true;
    stand.add(body);
    // seats as a thin coloured strip per row
    const seats = [];
    for (let r = 0; r < rows; r++) {
      const s = new THREE.BoxGeometry(length - 0.6, 0.12, 0.3);
      s.translate(0, 1.2 + 0.3 + r * rise + 0.06, 0.85 * r + 0.62);
      seats.push(s);
    }
    const seatMesh = new THREE.Mesh(mergeGeometries(seats), seatMat);
    seatMesh.receiveShadow = true;
    stand.add(seatMesh);
    // roof on columns
    const roofH = rows * rise + 5.2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.25, depth + 3), roofMat);
    roof.position.set(0, roofH, depth / 2 - 1.2);
    roof.rotation.x = -0.06;
    roof.castShadow = true;
    stand.add(roof);
    const colGeo = new THREE.CylinderGeometry(0.15, 0.15, roofH, 8);
    for (let k = -2; k <= 2; k++) {
      const col = new THREE.Mesh(colGeo, steel);
      col.position.set((k * length) / 4.4, roofH / 2, depth + 0.05);
      col.castShadow = true;
      stand.add(col);
    }
    // sponsor fascia on the roof edge
    const fascia = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 1.1),
      new THREE.MeshStandardMaterial({ map: sponsorTexture(SPONSORS[Math.floor(rand() * SPONSORS.length)], 2048, 128), roughness: 0.6 }),
    );
    fascia.position.set(0, roofH - 0.55, -2.72);
    fascia.rotation.y = Math.PI;
    stand.add(fascia);
    // Orient: local +Z points away from the track (rows climb outward).
    stand.position.set(gx, gy, gz);
    stand.rotation.y = Math.atan2(f.lx, f.lz);
    group.add(stand);
    stand.updateMatrixWorld(true);
    // crowd
    const local = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      for (let x = -length / 2 + 0.6; x < length / 2 - 0.6; x += 0.55) {
        if (rand() < 0.22) continue;
        local.set(x + (rand() - 0.5) * 0.12, 1.2 + 0.3 + r * rise, 0.85 * r + 0.55);
        stand.localToWorld(local);
        q.setFromAxisAngle(up, stand.rotation.y + Math.PI + (rand() - 0.5) * 0.5);
        const sc = 0.9 + rand() * 0.2;
        m4.compose(local.clone(), q, new THREE.Vector3(sc, sc * (0.9 + rand() * 0.25), sc));
        crowdMatrices.push(m4.clone());
        crowdColors.push(new THREE.Color(shirt[Math.floor(rand() * shirt.length)]));
      }
    }
    exclusions.push({ x: gx + f.lx * depth * 0.5, z: gz + f.lz * depth * 0.5, r: length * 0.6 + 8 });
  };
  buildStand(-30, 64, 12);
  buildStand(12, 56, 12);
  buildStand(52, 64, 10);
  if (crowdMatrices.length) {
    const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowdMatrices.length);
    crowdMatrices.forEach((mm, k) => {
      crowd.setMatrixAt(k, mm);
      crowd.setColorAt(k, crowdColors[k]);
    });
    crowd.castShadow = false;
    crowd.receiveShadow = true;
    crowd.computeBoundingSphere();
    group.add(crowd);
  }

  // Pit lane + garages on the inside (right side) of the straight.
  {
    const i0 = ((Math.round(-150 / track.ds) % n) + n) % n;
    const count = Math.round(260 / track.ds);
    const pitPos = [];
    const pitUv = [];
    const pitIdx = [];
    const cols = 4;
    for (let r = 0; r <= count; r++) {
      const i = (i0 + r) % n;
      const b = barrierOf(i, -1);
      const edgeY = track.pointAt(i, -(b + VERGE_BEYOND_BARRIER), tmp).y;
      for (let c = 0; c < cols; c++) {
        const lat = c < 3 ? b + 0.8 + c * 6 : b + 12.8;
        const y = c < 3 ? edgeY + 0.03 : edgeY - 2.2;
        pitPos.push(track.px[i] - track.lx[i] * lat, y, track.pz[i] - track.lz[i] * lat);
        pitUv.push(c * 0.4, (r * track.ds) / 14);
      }
    }
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        pitIdx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    const pitGeo = new THREE.BufferGeometry();
    pitGeo.setAttribute('position', new THREE.Float32BufferAttribute(pitPos, 3));
    pitGeo.setAttribute('uv', new THREE.Float32BufferAttribute(pitUv, 2));
    pitGeo.setIndex(pitIdx);
    pitGeo.computeVertexNormals();
    const pitMat = new THREE.MeshStandardMaterial({
      map: mats.asphalt.map,
      normalMap: mats.asphalt.normalMap,
      roughnessMap: mats.asphalt.roughnessMap,
      color: 0x9a9a9a,
      roughness: 1,
    });
    const pit = new THREE.Mesh(pitGeo, pitMat);
    pit.receiveShadow = true;
    group.add(pit);

    // Garage block
    const mid = (i0 + Math.round(count / 2)) % n;
    const f = frame(mid);
    const length = count * track.ds - 20;
    const lat = barrierOf(mid, -1) + 19;
    const gx = f.x - f.lx * lat;
    const gz = f.z - f.lz * lat;
    const gy = track.pointAt(mid, -(barrierOf(mid, -1) + VERGE_BEYOND_BARRIER), tmp).y - 0.2;
    const building = new THREE.Group();
    const facadeTex = garageTexture();
    facadeTex.repeat.set(length / 16, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, 7, 12), wallMat);
    body.position.set(0, 3.5, 6);
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);
    const facade = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 6.6),
      new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: facadeTex, emissiveIntensity: 0 }),
    );
    nightMaterials.push({ mat: facade.material, day: 0, night: 0.55 });
    facade.position.set(0, 3.3, -0.01);
    facade.rotation.y = Math.PI;
    building.add(facade);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.3, 4.5), roofMat);
    canopy.position.set(0, 7.1, -1.6);
    canopy.castShadow = true;
    building.add(canopy);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(length * 0.6, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.2, metalness: 0.6 }));
    upper.position.set(0, 8.8, 5);
    upper.castShadow = true;
    building.add(upper);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(length * 0.45, 2.2),
      new THREE.MeshStandardMaterial({ map: sponsorTexture(SPONSORS[0], 2048, 256), emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.4 }),
    );
    sign.material.emissiveMap = sign.material.map;
    nightMaterials.push({ mat: sign.material, day: 0.05, night: 1.2 });
    sign.position.set(0, 9.0, 0.95);
    sign.rotation.y = Math.PI;
    building.add(sign);
    building.position.set(gx, gy, gz);
    // local -Z faces the track
    building.rotation.y = Math.atan2(-f.lx, -f.lz);
    group.add(building);
    exclusions.push({ x: gx - f.lx * 6, z: gz - f.lz * 6, r: length * 0.55 + 10 });
  }

  // ---------------------------------------------------------------------------
  // Sponsor billboards on the outside of corners, angled toward approaching cars.
  const boardGeo = new THREE.PlaneGeometry(12, 3);
  const legGeo = new THREE.BoxGeometry(0.25, 3.2, 0.25);
  legGeo.translate(0, 1.6, 0);
  const sponsorMats = SPONSORS.map((s) => {
    const t = sponsorTexture(s);
    const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.02, roughness: 0.55 });
    nightMaterials.push({ mat: m, day: 0.02, night: 0.9 });
    return m;
  });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.7 });
  // back panel + two legs as a single mesh per board
  const boardFrameGeo = (() => {
    const back = boardGeo.clone();
    back.rotateY(Math.PI);
    back.translate(0, 4.4, -0.06);
    const legs = [-4.5, 4.5].map((lx) => {
      const g = legGeo.clone();
      g.translate(lx, 0, -0.1);
      return g;
    });
    return mergeGeometries([back, ...legs].map((g) => (g.index ? g.toNonIndexed() : g)));
  })();
  let bi = 0;
  let lastBoard = -1000;
  let maxK = 0;
  for (let i = 0; i < n; i++) maxK = Math.max(maxK, Math.abs(track.curvature[i]));
  for (let i = 30; i < n; i += 11) {
    const k = track.curvature[i];
    if (Math.abs(k) < 1 / 220 || Math.abs(k) > maxK * 0.9) continue;
    if (i - lastBoard < 70) continue;
    lastBoard = i;
    const s = k > 0 ? -1 : 1; // outside of the corner
    const w = s > 0 ? track.wallL[i] : track.wallR[i];
    if (w === WALL.CONCRETE) continue;
    const f = frame(i);
    const lat = barrierOf(i, s) + VERGE_BEYOND_BARRIER + 2.5;
    const x = f.x + f.lx * lat * s;
    const z = f.z + f.lz * lat * s;
    const y = terrain.heightAt(x, z);
    const board = new THREE.Group();
    const face = new THREE.Mesh(boardGeo, sponsorMats[bi % sponsorMats.length]);
    face.position.y = 4.4;
    board.add(face);
    board.add(new THREE.Mesh(boardFrameGeo, backMat));
    board.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    board.position.set(x, y - 0.2, z);
    // face back toward approaching traffic and slightly into the corner
    const faceYaw = Math.atan2(-f.tx - f.lx * s * 0.7, -f.tz - f.lz * s * 0.7);
    board.rotation.y = faceYaw;
    group.add(board);
    exclusions.push({ x, z, r: 9 });
    bi++;
  }

  // ---------------------------------------------------------------------------
  // Footbridge over the pit straight.
  {
    const i = Math.round(330 / track.ds);
    const f = frame(i);
    const bl = barrierOf(i, 1) + 2.5;
    const br = barrierOf(i, -1) + 2.5;
    const bridge = new THREE.Group();
    const deckLen = bl + br;
    const deckY = 7.2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.5, 3.2), steel);
    deck.position.set((bl - br) / 2, deckY, 0);
    bridge.add(deck);
    for (const sgn of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 1.3, 0.12), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.6, roughness: 0.35 }));
      rail.position.set((bl - br) / 2, deckY + 0.9, sgn * 1.55);
      bridge.add(rail);
    }
    const bannerMat = new THREE.MeshStandardMaterial({ map: sponsorTexture(SPONSORS[0], 2048, 256), emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5 });
    bannerMat.emissiveMap = bannerMat.map;
    nightMaterials.push({ mat: bannerMat, day: 0.05, night: 1.1 });
    for (const sgn of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(deckLen * 0.8, 1.8), bannerMat);
      banner.position.set((bl - br) / 2, deckY - 0.9, sgn * 1.62);
      banner.rotation.y = sgn > 0 ? 0 : Math.PI;
      bridge.add(banner);
    }
    for (const [lat, sgn] of [[bl, 1], [br, -1]]) {
      const towerH = deckY + 5;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, towerH, 2.6), steel);
      tower.position.set(sgn * lat + sgn * 0.9, deckY + 1 - towerH / 2, 0);
      bridge.add(tower);
      // glazed stairwell face toward the track
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, deckY - 1),
        new THREE.MeshStandardMaterial({ color: 0x1b2533, roughness: 0.15, metalness: 0.6 }),
      );
      glass.position.set(sgn * lat + sgn * 0.9 - sgn * 1.11, (deckY - 1) / 2 + 0.6, 0);
      glass.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
      bridge.add(glass);
      const g = terrain.heightAt(f.x + f.lx * (lat + 1.2) * sgn, f.z + f.lz * (lat + 1.2) * sgn);
      exclusions.push({ x: f.x + f.lx * (lat + 1.2) * sgn, z: f.z + f.lz * (lat + 1.2) * sgn, r: 6, g });
    }
    bridge.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    bridge.position.set(f.x, f.y, f.z);
    // local +X points to the track's left
    bridge.rotation.y = Math.atan2(f.lx, f.lz) - Math.PI / 2;
    group.add(bridge);
  }

  // ---------------------------------------------------------------------------
  // Braking boards (150/100/50) before heavy stops, chevrons around the slowest corners.
  const boardTex = { 150: numberBoardTexture('150'), 100: numberBoardTexture('100'), 50: numberBoardTexture('50') };
  const boardMats = Object.fromEntries(Object.entries(boardTex).map(([k, t]) => [k, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })]));
  const signGeo = new THREE.PlaneGeometry(1.3, 1.3);
  const signPost = new THREE.BoxGeometry(0.1, 1.5, 0.1);
  signPost.translate(0, 0.75, 0);
  let lastEntry = -1000;
  for (let i = 0; i < n; i++) {
    const k0 = Math.abs(track.curvature[(i - 1 + n) % n]);
    const k1 = Math.abs(track.curvature[i]);
    if (!(k0 < 1 / 70 && k1 >= 1 / 70)) continue;
    // need a long straight-ish run before the corner
    let straight = 0;
    for (let d = 1; d < 120; d++) if (Math.abs(track.curvature[(i - d + n) % n]) < 1 / 250) straight++;
    if (straight < 60 || i - lastEntry < 150) continue;
    lastEntry = i;
    const cornerSide = track.curvature[i] > 0 ? -1 : 1; // boards on the outside
    for (const dist of [150, 100, 50]) {
      const j = ((i - Math.round((dist + 40) / track.ds)) % n + n) % n;
      const f = frame(j);
      const lat = barrierOf(j, cornerSide) - 0.8;
      const p = track.pointAt(j, cornerSide * lat, tmp);
      const g = new THREE.Group();
      const face = new THREE.Mesh(signGeo, boardMats[dist]);
      face.position.y = 1.9;
      g.add(face);
      const post = new THREE.Mesh(signPost, poleMat);
      g.add(post);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = Math.atan2(-f.tx, -f.tz);
      g.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      group.add(g);
    }
  }
  const chevronMat = new THREE.MeshStandardMaterial({ map: chevronTexture(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 });
  chevronMat.emissiveMap = chevronMat.map;
  nightMaterials.push({ mat: chevronMat, day: 0, night: 0.35 });
  const chevGeo = new THREE.PlaneGeometry(1.6, 1.6);
  const chevParts = [];
  const chevObj = new THREE.Object3D();
  for (const sd of [1, -1]) {
    const walls = sd > 0 ? track.wallL : track.wallR;
    for (let i = 0; i < n; i += 6) {
      if (walls[i] !== WALL.TIRES) continue;
      const f = frame(i);
      const lat = barrierOf(i, sd) + 1.7;
      const p = track.pointAt(i, sd * lat, tmp);
      chevObj.position.set(p.x, p.y + 1.6, p.z);
      // face the track, arrow pointing in the direction of travel
      chevObj.rotation.set(0, Math.atan2(-f.lx * sd, -f.lz * sd), 0);
      chevObj.updateMatrix();
      const g = chevGeo.clone();
      if (sd < 0) {
        // mirror the arrow by flipping U instead of using a negative scale
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
      }
      g.applyMatrix4(chevObj.matrix);
      chevParts.push(g);
    }
  }
  if (chevParts.length) group.add(new THREE.Mesh(mergeGeometries(chevParts), chevronMat));

  return {
    group,
    exclusions,
    lampHeads,
    startLights: {
      set(count) {
        startLightMats.forEach((m, k) => {
          m.emissiveIntensity = k < count ? 22 : 0;
          m.color.setHex(k < count ? 0x661010 : 0x220505);
        });
      },
    },
    setNight(night) {
      pools.visible = night;
      for (const e of nightMaterials) e.mat.emissiveIntensity = night ? e.night : e.day;
    },
    update() {},
  };
}
