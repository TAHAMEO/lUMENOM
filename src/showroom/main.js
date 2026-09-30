// SLK 200 showroom: orbit viewer for the procedural model.
// Test hooks: ?view=photo matches the reference photo's camera, ?mask=1
// renders a paint-only silhouette, ?spacing=0.015 sets mesh density, and
// ?shots=side,front:900x450 renders those views once and exposes data URLs.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { prepareSLK, SLK_CG_OFFSET, SLKModel } from '../vehicle/slk/SLKModel.js';
import { SLK_PAINTS } from '../vehicle/slk/materials.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const shots = params.get('shots');
const mask = params.get('mask') === '1';
const spacing = params.get('spacing') ? Number(params.get('spacing')) : undefined;
// phones and tablets get the lighter mesh
const quality = params.get('q') || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
const harness = !!(shots || params.get('w'));
const inViewer = typeof window.claude !== 'undefined';

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !harness, preserveDrawingBuffer: harness });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
if (harness) scene.background = new THREE.Color(0x9aa3ad);

// --- studio: key light, soft floor that fades into the page, contact shadow ---
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(5.5, 9, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 30 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd4ff, 0.7);
rim.position.set(-6, 4, -7);
scene.add(rim);

function radialTexture(stops, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 96),
  harness
    ? new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.9 })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: radialTexture([
          [0, 'rgba(15,18,25,1)'],
          [0.5, 'rgba(13,17,24,0.9)'],
          [1, 'rgba(12,16,24,0)'],
        ]),
        transparent: true,
        roughness: 0.7,
        metalness: 0.0,
        depthWrite: false,
      }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(2.6, 5.1),
  new THREE.MeshBasicMaterial({
    map: radialTexture([
      [0, 'rgba(0,0,0,0.75)'],
      [0.55, 'rgba(0,0,0,0.35)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
    transparent: true,
    depthWrite: false,
  }),
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.002;
contact.renderOrder = 1;
scene.add(contact);

// --- cameras -----------------------------------------------------------------
const ORTHO = {
  side: [[8, 0.6, 0], [0, 0.6, 0], 4.6],
  front: [[0, 0.6, 8], [0, 0.6, 0], 2.2],
  rear: [[0, 0.6, -8], [0, 0.6, 0], 2.2],
  top: [[0, 8, 0.0001], [0, 0, 0], 4.6],
};
// [position, target, vertical fov]
const PRESETS = {
  f34: [[5.2, 1.5, 5.6], [0, 0.5, 0.1], 30],
  r34: [[-4.6, 1.8, -5.8], [0, 0.55, -0.2], 30],
  side: [[7.6, 0.9, 0.0], [0, 0.55, 0], 30],
  high: [[4.5, 4.2, 4.5], [0, 0.4, 0], 30],
  cockpit: [[2.2, 2.4, 1.6], [0, 0.7, -0.4], 30],
  nose: [[2.4, 0.9, 4.2], [0, 0.5, 1.6], 30],
  tail: [[-2.2, 1.1, -4.4], [0, 0.6, -1.6], 30],
};
// Solved from the reference press photo (738×414): wheel ellipses + horizon.
const PHOTO = { pos: [10.0759, 0.3695, 9.7282], rot: [0.07065, 0.81926, 0.00422], fov: 12.1092 };
{
  const q = new THREE.Euler(PHOTO.rot[0], PHOTO.rot[1], PHOTO.rot[2], 'YXZ');
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(q);
  const target = new THREE.Vector3(...PHOTO.pos).addScaledVector(dir, 13.9);
  PRESETS.photo = [PHOTO.pos, target.toArray(), PHOTO.fov];
}

function makeCamera(name, w, h) {
  if (name === 'photo') {
    const cam = new THREE.PerspectiveCamera(PHOTO.fov, 738 / 414, 0.1, 200);
    cam.position.set(...PHOTO.pos);
    cam.rotation.set(...PHOTO.rot, 'YXZ');
    return cam;
  }
  if (ORTHO[name]) {
    const [p, t, width] = ORTHO[name];
    const half = width / 2;
    const cam = new THREE.OrthographicCamera(-half, half, (half * h) / w, (-half * h) / w, 0.1, 50);
    cam.position.set(...p);
    if (name === 'top') cam.up.set(1, 0, 0);
    cam.lookAt(...t);
    return cam;
  }
  const [p, t, fov] = PRESETS[name] || PRESETS.f34;
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 200);
  cam.position.set(...p);
  cam.lookAt(...t);
  return cam;
}

// --- model -------------------------------------------------------------------
let car = null;
let drive = params.get('drive') === 'right' ? 'right' : 'left';
let paint = SLK_PAINTS[0];

function placeCar(model) {
  model.root.position.z = SLK_CG_OFFSET; // design frame (wheelbase midpoint) at the origin
  if (mask) {
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    model.root.traverse((o) => {
      if (o.isMesh) o.material = o.name === 'paint' ? white : black;
    });
  }
  scene.add(model.root);
}

function swapCar() {
  const next = new SLKModel({ color: paint.color, metallic: !!paint.metallic, spacing, quality, drive });
  if (car) scene.remove(car.root);
  car = next;
  placeCar(car);
  car.setLights({ headlights: $('opt-lamps')?.checked });
}

async function boot() {
  if (harness) {
    await prepareSLK({ spacing, drive });
    car = new SLKModel({ spacing, drive });
    placeCar(car);
    if (mask) {
      scene.background = new THREE.Color(0x000000);
      scene.environment = null;
      floor.visible = contact.visible = false;
      renderer.toneMapping = THREE.NoToneMapping;
    }
    runHarness();
    return;
  }
  setupUI();
  const fill = $('loader-fill');
  const step = $('loader-step');
  await prepareSLK({
    spacing,
    quality,
    drive,
    onProgress: (label, p) => {
      step.textContent = label;
      fill.style.width = `${Math.round(p * 100)}%`;
    },
  });
  swapCar();
  startViewer();
  step.textContent = 'Compiling shaders';
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* optional warm-up */
  }
  $('loader').classList.add('is-done');
  setTimeout(() => ($('loader').hidden = true), 700);
  window.__ready = true;
}

// --- test harness ---------------------------------------------------------------
function runHarness() {
  const W = params.get('w') ? Number(params.get('w')) : null;
  const H = params.get('h') ? Number(params.get('h')) : null;
  for (const el of document.querySelectorAll('.plate, .panel, .specs, .hint, .loader, .backlink')) el.hidden = true;
  renderer.setPixelRatio(1);
  window.__shots = {};
  const list = shots ? shots.split(',') : [`${params.get('view') || 'f34'}:${W || 900}x${H || 450}`];
  for (const item of list) {
    const [vn, size] = item.split(':');
    const [w, h] = size ? size.split('x').map(Number) : [W || 900, H || 450];
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    renderer.render(scene, makeCamera(vn, w, h));
    window.__shots[item] = renderer.domElement.toDataURL('image/png');
  }
  window.__ready = true;
}

// --- interactive viewer --------------------------------------------------------------
let camera;
let controls;
let tween = null;

function startViewer() {
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const [p, t] = PRESETS.f34;
  camera.position.set(...p);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(...t);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.2;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.autoRotate = $('opt-spin').checked;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener('start', () => {
    tween = null;
    markView(null);
  });
  controls.update();
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // wide screens: frame the car right of the configurator panel;
    // portrait screens: widen the view so the whole car fits across
    const shift = w > 820 ? Math.min(0.12, (400 / w) * 0.45) : 0;
    if (shift) camera.setViewOffset(w, h, -w * shift, -h * 0.02, w, h);
    else if (w <= 720) camera.setViewOffset(w, h, 0, h * 0.04, w, h);
    else camera.clearViewOffset();
    camera.zoom = Math.min(1, (camera.aspect / 1.45) ** 0.85);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  const timer = new THREE.Timer();
  const frame = () => {
    timer.update();
    const dt = Math.min(0.05, timer.getDelta());
    if (tween) stepTween(dt);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();
}

function flyTo(name) {
  const [p, t, fov] = PRESETS[name];
  tween = {
    t: 0,
    from: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov },
    to: { pos: new THREE.Vector3(...p), target: new THREE.Vector3(...t), fov },
  };
  if (name === 'photo') {
    controls.autoRotate = false;
    $('opt-spin').checked = false;
  }
}

function stepTween(dt) {
  tween.t = Math.min(1, tween.t + dt / 1.1);
  const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const e = reduce ? 1 : k;
  camera.position.lerpVectors(tween.from.pos, tween.to.pos, e);
  controls.target.lerpVectors(tween.from.target, tween.to.target, e);
  camera.fov = tween.from.fov + (tween.to.fov - tween.from.fov) * e;
  camera.updateProjectionMatrix();
  if (tween.t >= 1 || reduce) tween = null;
}

const VIEWS = [
  ['f34', 'Three-quarter'],
  ['side', 'Side'],
  ['r34', 'Rear'],
  ['cockpit', 'Cockpit'],
  ['photo', 'Press photo'],
];

function markView(id) {
  for (const b of $('views').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === id));
}

function setupUI() {
  if (inViewer) {
    $('backlink').hidden = true;
    $('download').hidden = true;
  }
  const sw = $('swatches');
  sw.innerHTML = SLK_PAINTS.map(
    (p) =>
      `<button type="button" class="swatch" role="radio" id="paint-${p.id}" data-id="${p.id}" style="--c:${p.color}" aria-label="${p.name}" title="${p.name}"></button>`,
  ).join('');
  const markPaint = () => {
    for (const b of sw.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.id === paint.id));
    $('paint-name').textContent = paint.name;
  };
  markPaint();
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    paint = SLK_PAINTS.find((p) => p.id === b.dataset.id) || paint;
    car?.setPaint(paint.color, !!paint.metallic);
    markPaint();
  });

  const views = $('views');
  views.innerHTML = VIEWS.map(([id, name]) => `<button type="button" class="chip" role="radio" id="view-${id}" data-v="${id}">${name}</button>`).join('');
  markView('f34');
  views.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !camera) return;
    flyTo(b.dataset.v);
    markView(b.dataset.v);
  });

  const markDrive = () => {
    for (const b of $('drive').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === drive));
  };
  markDrive();
  $('drive').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === drive) return;
    drive = b.dataset.v;
    markDrive();
    await prepareSLK({ spacing, quality, drive });
    swapCar();
  });

  $('opt-lamps').addEventListener('change', (e) => car?.setLights({ headlights: e.target.checked }));
  $('opt-spin').addEventListener('change', (e) => {
    if (controls) controls.autoRotate = e.target.checked;
  });

  $('download').addEventListener('click', async () => {
    if (!car) return;
    const btn = $('download');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const blob = await exportGLB(car);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mercedes-slk200-r172.glb';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      btn.textContent = `Downloaded · ${(blob.size / 1048576).toFixed(1)} MB`;
    } catch (err) {
      console.error(err);
      btn.textContent = 'Export failed, try again';
    } finally {
      btn.disabled = false;
    }
  });
}

/** Binary glTF of the car (design frame at the origin). */
export async function exportGLB(model) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const root = model.root.clone(true);
  root.position.set(0, 0, SLK_CG_OFFSET);
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
  return new Blob([glb], { type: 'model/gltf-binary' });
}

window.__slk = {
  get car() {
    return car;
  },
  scene,
  renderer,
  exportGLB,
};
boot();
