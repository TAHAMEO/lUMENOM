// Body shell and the surfaces that hang off its openings: rolled paint lips,
// wheel-well tunnels, cockpit side walls, floor and underbody.

import * as THREE from 'three';
import { bodyNormal, bodySDF, COCKPIT_OUTLINE, DIM, TRIMS } from './shape.js';
import { cutMesh, fieldNormals, meshHalfBody, mirrorHalf } from './mesher.js';
import { bothSides, gridMesh, merge, resample } from './geom.js';

export const SLK_SPINE = { y: 0.55, z0: -1.13, z1: 1.2 };

const longest = (chains) => (chains || []).reduce((a, c) => (c.length > (a?.length || 0) ? c : a), null);

const n0 = [0, 0, 0];
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Rolled edge + wall along an opening boundary.
 * inward(p) → unit vector pointing into the opening (in the surface plane);
 * wallEnd(p, lipEnd) → end point of the wall for that boundary point.
 */
function lipAndWall(chain, inward, wallEnd, { radius = 0.005, lipSteps = 4, wallSteps = 3 } = {}) {
  const lipRows = [];
  const lipNormals = [];
  const wallRows = [];
  const wallNormals = [];
  for (const p of chain) {
    bodyNormal(p[0], p[1], p[2], n0);
    const n = [n0[0], n0[1], n0[2]];
    const d = inward(p);
    const lip = [];
    const lipN = [];
    for (let s = 0; s <= lipSteps; s++) {
      const phi = (s / lipSteps) * (Math.PI / 2);
      const a = radius * Math.sin(phi);
      const b = radius * (1 - Math.cos(phi));
      lip.push([p[0] + d[0] * a - n[0] * b, p[1] + d[1] * a - n[1] * b, p[2] + d[2] * a - n[2] * b]);
      lipN.push(norm3([n[0] * Math.cos(phi) + d[0] * Math.sin(phi), n[1] * Math.cos(phi) + d[1] * Math.sin(phi), n[2] * Math.cos(phi) + d[2] * Math.sin(phi)]));
    }
    lipRows.push(lip);
    lipNormals.push(lipN);
    const start = lip[lipSteps];
    const end = wallEnd(p, start);
    const wall = [];
    const wallN = [];
    for (let s = 0; s <= wallSteps; s++) {
      const t = s / wallSteps;
      wall.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t]);
      wallN.push(d);
    }
    wallRows.push(wall);
    wallNormals.push(wallN);
  }
  // transpose so rows run along the chain
  const T = (rows) => rows[0].map((_, j) => rows.map((r) => r[j]));
  return {
    lip: gridMesh(T(lipRows), { normals: T(lipNormals) }),
    wall: gridMesh(T(wallRows), { normals: T(wallNormals) }),
  };
}

function archParts(chain, za) {
  const yc = DIM.wheelRadius;
  const xIn = 0.62;
  const inward = (p) => norm3([0, yc - p[1], za - p[2]]);
  const { lip, wall } = lipAndWall(resample(chain, Math.max(24, chain.length)), inward, (p, s) => [xIn, s[1], s[2]]);
  // cap closing the tunnel behind the tyre
  const pts = resample(chain, 64).map((p) => {
    const d = inward(p);
    return [xIn, p[1] + d[1] * 0.005, p[2] + d[2] * 0.005];
  });
  const pos = [xIn, yc, za];
  for (const p of pts) pos.push(...p);
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % pts.length);
    idx.push(0, a, b);
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cap.setIndex(idx);
  cap.computeVertexNormals();
  return { lip, wall: merge([wall, cap]) };
}

function cockpitParts(chain) {
  // inward = horizontal direction toward the opening's middle, perpendicular to the edge
  const pts = resample(chain, Math.max(40, chain.length));
  const inward = (p) => {
    // nearest point on the outline gives the edge tangent; use the outline centre as a tie-breaker
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < COCKPIT_OUTLINE.length; i++) {
      const q = COCKPIT_OUTLINE[i];
      const dd = (q[0] - p[0]) ** 2 + (q[1] - p[2]) ** 2;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    const a = COCKPIT_OUTLINE[(best - 1 + COCKPIT_OUTLINE.length) % COCKPIT_OUTLINE.length];
    const b = COCKPIT_OUTLINE[(best + 1) % COCKPIT_OUTLINE.length];
    let nx = -(b[1] - a[1]);
    let nz = b[0] - a[0];
    const cx = -p[0];
    const cz = -0.28 - p[2];
    if (nx * cx + nz * cz < 0) {
      nx = -nx;
      nz = -nz;
    }
    return norm3([nx, 0, nz]);
  };
  return lipAndWall(pts, inward, (p, s) => [s[0], 0.36, s[2]], { radius: 0.007, wallSteps: 6 });
}

const cache = new Map();

/**
 * Body build as a generator of phases so callers can either run it straight
 * through (buildBody) or yield to the UI between the slow steps (buildBodyAsync).
 */
function* bodyPhases(spacing) {
  yield 'Meshing the body shell';
  const half = meshHalfBody({ sdf: bodySDF, spine: SLK_SPINE, spacing });
  yield 'Cutting arches, cockpit, grille and lamps';
  const cut = cutMesh(half, TRIMS, { sdf: bodySDF, normal: bodyNormal, snap: spacing * 0.3 });
  yield 'Smoothing normals';
  const normals = fieldNormals(cut.positions, bodyNormal);
  const full = mirrorHalf(cut.positions, normals, cut.index);
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.BufferAttribute(full.positions, 3));
  shell.setAttribute('normal', new THREE.BufferAttribute(full.normals, 3));
  shell.setIndex(new THREE.BufferAttribute(full.index, 1));

  yield 'Wheel wells and cockpit tub';
  const paintParts = [];
  const linerParts = [];
  const interiorParts = [];
  for (const [name, za] of [
    ['archFront', DIM.frontAxle],
    ['archRear', DIM.rearAxle],
  ]) {
    const chains = (cut.loops[name] || []).filter((c) => c.length > 6 && c.some((p) => p[1] > 0.45));
    for (const c of chains) {
      const a = archParts(c, za);
      paintParts.push(bothSides(a.lip));
      linerParts.push(bothSides(a.wall));
    }
  }
  const cp = cockpitParts(longest(cut.loops.cockpit));
  paintParts.push(bothSides(cp.lip));
  interiorParts.push(bothSides(cp.wall));

  // cockpit floor (carpet)
  const floorShape = new THREE.Shape(COCKPIT_OUTLINE.map(([x, z]) => new THREE.Vector2(x * 0.99, -z * 0.99 - 0.003)));
  const floor = new THREE.ShapeGeometry(floorShape, 4);
  floor.rotateX(-Math.PI / 2); // shape (x, -z) → floor plane facing up
  floor.translate(0, 0.36, 0);
  // underbody pan
  const pan = new THREE.PlaneGeometry(1.32, 3.9);
  pan.rotateX(Math.PI / 2); // facing down
  pan.translate(0, 0.19, 0.03);

  return {
    shell,
    loops: cut.loops,
    paintExtra: merge(paintParts),
    liner: merge(linerParts),
    interiorWalls: merge(interiorParts),
    floor,
    underbody: pan,
    stats: { vertices: full.positions.length / 3, triangles: full.index.length / 3 },
  };
}

const keyOf = (spacing) => spacing.toFixed(4);

/** All body-derived geometry for a mesh spacing (cached, shared by every SLK). */
export function buildBody(spacing = 0.02) {
  const key = keyOf(spacing);
  if (cache.has(key)) return cache.get(key);
  const gen = bodyPhases(spacing);
  let r = gen.next();
  while (!r.done) r = gen.next();
  cache.set(key, r.value);
  return r.value;
}

/** Same as buildBody, yielding to the event loop between phases. */
export async function buildBodyAsync(spacing = 0.02, onPhase = () => {}) {
  const key = keyOf(spacing);
  if (cache.has(key)) return cache.get(key);
  const gen = bodyPhases(spacing);
  let r = gen.next();
  let k = 0;
  while (!r.done) {
    onPhase(r.value, k++);
    await new Promise((res) => setTimeout(res, 0));
    r = gen.next();
  }
  cache.set(key, r.value);
  return r.value;
}
