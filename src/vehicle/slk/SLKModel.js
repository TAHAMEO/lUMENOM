// Procedural Mercedes-Benz SLK 200 (R172, 2011–2016) roadster with the roof
// stowed, in AMG Line trim. Everything is generated in code: the body shell is
// meshed from a signed distance field (shape.js), details are parametric parts.
//
// Frames: `root` sits at the centre of gravity on the ground (what the game's
// Car moves around). `chassis` is the sprung body; inside it the design frame
// has its origin at the wheelbase midpoint on the ground, +Z forward, +Y up,
// +X to the car's left.

import * as THREE from 'three';
import { DIM } from './shape.js';
import { buildBody, buildBodyAsync } from './body.js';
import { buildExterior } from './exterior.js';
import { buildInterior, buildScreen } from './cabin.js';
import { dialTexture, grillePinsTexture, honeycombTexture, plateTexture } from './textures.js';
import { wheelParts } from './wheel.js';
import { createPaint, sharedMaterials } from './materials.js';

export const SLK_CG_OFFSET = 0.05; // CG sits 5 cm ahead of the wheelbase midpoint (52:48)
export const SLK_WHEEL_RADIUS = DIM.wheelRadius;

export const SLK_QUALITY = {
  low: { spacing: 0.034, detail: 0.5 },
  medium: { spacing: 0.024, detail: 0.8 },
  high: { spacing: 0.017, detail: 1 },
};

/**
 * Build (and cache) every geometry an SLK needs, yielding between steps so a
 * loading screen can update. Afterwards `new SLKModel()` with the same
 * options is instant.
 */
export async function prepareSLK({ quality = 'high', spacing, drive = 'left', onProgress = () => {} } = {}) {
  const q = SLK_QUALITY[quality] || SLK_QUALITY.high;
  const sp = spacing ?? q.spacing;
  const B = await buildBodyAsync(sp, (label, k) => onProgress(label, 0.08 + k * 0.2));
  const tick = () => new Promise((res) => setTimeout(res, 0));
  onProgress('Grille, lamps and intakes', 0.86);
  await tick();
  if (!B.exterior) B.exterior = buildExterior(B.loops);
  onProgress('Windscreen and cockpit', 0.94);
  await tick();
  if (!B.screen) B.screen = buildScreen();
  const ikey = `interior-${drive}`;
  if (!B[ikey]) B[ikey] = buildInterior({ drive });
  onProgress('Ready', 1);
  return B;
}

export class SLKModel {
  constructor({ color = '#c3121c', metallic = false, quality = 'high', spacing, plate = 'SLK 200', drive = 'left' } = {}) {
    const q = SLK_QUALITY[quality] || SLK_QUALITY.high;
    const M = sharedMaterials();
    this.materials = M;
    this.root = new THREE.Group();
    this.root.name = 'mercedes-slk200';
    this.chassis = new THREE.Group();
    this.chassis.name = 'body';
    this.chassis.position.z = -SLK_CG_OFFSET;
    this.root.add(this.chassis);

    this.paint = createPaint(color, metallic);
    this.rimMat = M.rim.clone();
    const B = buildBody(spacing ?? q.spacing);
    this.stats = B.stats;
    const add = (geo, mat, name, { cast = true, receive = true, parent = this.chassis } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.castShadow = cast;
      m.receiveShadow = receive;
      parent.add(m);
      return m;
    };
    this.bodyMesh = add(B.shell, this.paint, 'paint');
    add(B.paintExtra, this.paint, 'paint');
    add(B.liner, M.liner, 'wheel-wells', { cast: false });
    add(B.interiorWalls, M.interior, 'cockpit-trim', { cast: false });
    add(B.floor, M.carpet, 'floor', { cast: false });
    add(B.underbody, M.plastic, 'underbody', { cast: false });

    // Exterior details (cached with the body geometry)
    if (!B.exterior) B.exterior = buildExterior(B.loops);
    const X = B.exterior;
    const detailMats = {
      paint: this.paint,
      black: M.plastic,
      gloss: M.blackGloss,
      chrome: M.chrome,
      satin: M.satin,
      pins: this._texMat('pins', M.grilleMesh, grillePinsTexture()),
      honeycomb: this._texMat('honeycomb', M.grilleMesh, honeycombTexture()),
      plate: new THREE.MeshStandardMaterial({
        map: plateTexture(plate),
        roughness: 0.45,
        metalness: 0,
        color: plateTexture(plate) ? 0xffffff : 0xeeeeee,
        name: 'number-plate',
      }),
      plateHolder: M.plastic,
      lampHousing: M.lampBlack,
      lampChrome: M.lampChrome,
      lens: M.lens,
      drl: (this.headMat = new THREE.MeshStandardMaterial({
        color: 0xdfe6ee,
        emissive: 0xffffff,
        emissiveIntensity: 0.05,
        metalness: 0.2,
        roughness: 0.05,
        name: 'headlamp',
      })),
      indicator: new THREE.MeshStandardMaterial({ color: 0xffa640, emissive: 0xff8a1a, emissiveIntensity: 0.15, roughness: 0.3, name: 'indicator' }),
      gaps: (this.gapMat = new THREE.MeshBasicMaterial({
        color: 0x120405,
        name: 'panel-gap',
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })),
      mirrorGlass: M.chrome,
      tailBack: new THREE.MeshStandardMaterial({ color: 0x3a0306, metalness: 0.5, roughness: 0.3, name: 'tail-reflector' }),
      tailLens: new THREE.MeshPhysicalMaterial({
        color: 0xb0101a,
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.55,
        clearcoat: 1,
        depthWrite: false,
        name: 'tail-lens',
      }),
      tailLed: (this.tailMat = new THREE.MeshStandardMaterial({
        color: 0x5a0508,
        emissive: 0xff1a12,
        emissiveIntensity: 0.6,
        roughness: 0.4,
        name: 'tail-led',
      })),
      reverse: (this.reverseMat = new THREE.MeshStandardMaterial({
        color: 0xd9dde2,
        emissive: 0xffffff,
        emissiveIntensity: 0.0,
        roughness: 0.2,
        metalness: 0.3,
        name: 'reverse-light',
      })),
      exhaust: M.exhaust,
      soot: M.soot,
    };
    for (const [k, geo] of Object.entries(X)) {
      const cast = k === 'paint' || k === 'gloss' || k === 'chrome';
      const mesh = add(geo, detailMats[k] || M.plastic, k === 'paint' ? 'paint' : k, { cast, receive: true });
      if (k === 'lens' || k === 'tailLens') mesh.renderOrder = 2;
    }

    // Windscreen and frame
    if (!B.screen) B.screen = buildScreen();
    const S = B.screen;
    add(S.frame, this.paint, 'paint');
    add(S.frit, M.frit, 'screen-frit', { cast: false });
    add(S.mirror, M.blackTrim, 'rear-view-mirror');
    add(S.wipers, M.blackTrim, 'wipers', { cast: false });
    add(S.cowl, M.plastic, 'cowl', { cast: false });
    const glass = add(S.glass, M.glass, 'windscreen', { cast: false });
    glass.renderOrder = 2;

    // Cockpit
    const ikey = `interior-${drive}`;
    if (!B[ikey]) B[ikey] = buildInterior({ drive });
    const In = B[ikey];
    const IM = {
      dash: M.interior,
      dashTop: M.leather,
      leather: M.leather,
      dark: M.plastic,
      chrome: M.chrome,
      satin: M.satin,
      screen: M.blackGloss,
      dials: this._texMat('dials', M.blackGloss, null),
      gloss: M.blackGloss,
      column: M.plastic,
    };
    for (const [k, mat] of Object.entries(IM)) if (In[k]) add(In[k], mat, `cockpit-${k}`, { cast: k === 'leather' });
    // instrument dials with needles (driven by setGauges)
    this.gauges = [];
    for (const d of In.dialCentres || []) {
      const g = new THREE.Group();
      g.position.set(...d.pos);
      g.rotation.x = d.tilt;
      this.chassis.add(g);
      const map = dialTexture(d.kind);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(d.radius, 40),
        new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : 0x0a0a0a,
          map,
          emissive: 0xffffff,
          emissiveMap: map,
          emissiveIntensity: map ? 0.55 : 0,
          roughness: 0.4,
          name: `dial-${d.kind}`,
        }),
      );
      face.name = `dial-${d.kind}`;
      g.add(face);
      const needlePivot = new THREE.Group();
      needlePivot.position.z = 0.003;
      g.add(needlePivot);
      const needle = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.0028, 0.002),
        this._needleMat || (this._needleMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f, name: 'dial-needle' })),
      );
      needle.position.x = 0.02;
      needlePivot.add(needle);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 16), M.blackGloss);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = 0.004;
      g.add(hub);
      this.gauges.push({ kind: d.kind, pivot: needlePivot, max: d.kind === 'speed' ? 280 : 7000 });
    }
    this.setGauges(0, 0);

    this.steeringWheel = new THREE.Group();
    this.steeringWheel.name = 'steering-wheel';
    this.steeringWheel.position.set(...In.wheelPos);
    this.steeringWheel.rotation.x = -In.wheelTilt;
    this.chassis.add(this.steeringWheel);
    this.steeringSpin = new THREE.Group();
    this.steeringWheel.add(this.steeringSpin);
    const WM = { leather: M.leather, trim: M.satin, hub: M.leather, chrome: M.chrome };
    for (const [k, geo] of Object.entries(In.wheel)) add(geo, WM[k], `wheel-${k}`, { parent: this.steeringSpin, cast: false });

    // Wheels: pivot (steer + suspension travel) → spin group
    const cg = SLK_CG_OFFSET;
    this.wheels = [
      { x: DIM.halfTrackFront, z: DIM.frontAxle - cg, front: true, right: false },
      { x: -DIM.halfTrackFront, z: DIM.frontAxle - cg, front: true, right: true },
      { x: DIM.halfTrackRear, z: DIM.rearAxle - cg, front: false, right: false },
      { x: -DIM.halfTrackRear, z: DIM.rearAxle - cg, front: false, right: true },
    ].map((w) => ({ ...w, steer: 0, spin: 0, offset: 0, pivot: null, spinGroup: null }));
    for (const w of this.wheels) {
      const P = wheelParts(w.front, q.detail);
      const pivot = new THREE.Group();
      pivot.position.set(w.x, SLK_WHEEL_RADIUS, w.z);
      this.root.add(pivot);
      const side = new THREE.Group();
      side.rotation.y = w.right ? Math.PI : 0;
      pivot.add(side);
      const spin = new THREE.Group();
      side.add(spin);
      add(P.tyre, M.tyre, 'tyre', { parent: spin });
      add(P.barrel, M.rimDark, 'rim-barrel', { parent: spin, cast: false });
      add(P.face, this.rimMat, 'rim', { parent: spin });
      add(P.bolts, M.chrome, 'wheel-bolts', { parent: spin, cast: false });
      add(P.cap, M.blackGloss, 'centre-cap', { parent: spin, cast: false });
      add(P.star, M.chrome, 'centre-star', { parent: spin, cast: false });
      add(P.disc, M.disc, 'brake-disc', { parent: spin, cast: false });
      add(P.hat, M.hat, 'disc-hat', { parent: spin, cast: false });
      const cal = add(P.caliper, M.caliper, 'caliper', { parent: side, cast: false });
      // ahead of and above the axle on both sides of the car
      cal.rotation.x = w.right ? 0.96 : 2.18;
      w.pivot = pivot;
      w.spinGroup = spin;
    }
    this.rimColor = this.rimMat.color;
    this.caliperColor = M.caliper.color;
    this.usesSharedWheels = false; // draws its own wheels (not WheelInstances)
    this.brake = null;
    this.reverse = null;
    this.headlightsOn = null;
    this.setLights();
    this.setPaint(color);
  }

  /** Point the instrument needles: speed in km/h, engine speed in rpm. */
  setGauges(kmh, rpm) {
    for (const g of this.gauges) {
      const v = g.kind === 'speed' ? kmh : rpm;
      const t = Math.min(1, Math.max(0, v / g.max));
      // dial sweep runs clockwise from 150° to 390° (texture space, y down)
      g.pivot.rotation.z = -((Math.PI * 5) / 6 + ((Math.PI * 4) / 3) * t);
    }
  }

  /** Soft blob under the car (the game passes its shared shadow texture). */
  attachContactShadow(texture) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8, toneMapped: false });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.7), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.03, -SLK_CG_OFFSET);
    m.renderOrder = 1;
    m.name = 'contact-shadow';
    this.root.add(m);
    this.contactShadow = m;
    this.shadowMat = mat;
  }

  _texMat(key, base, map) {
    if (!map) return base;
    const m = base.clone();
    m.map = map;
    m.color.set(0xffffff);
    m.name = `${base.name}-${key}`;
    return m;
  }

  setPaint(color, metallic) {
    this.paint.color.set(color);
    // shut lines read as a shadowed version of the paint, not as black ink
    this.gapMat?.color.copy(this.paint.color).multiplyScalar(0.22);
    if (metallic != null) {
      this.paint.metalness = metallic ? 0.55 : 0;
      this.paint.roughness = metallic ? 0.36 : 0.3;
    }
  }

  setLights({ brake = false, reverse = false, headlights = false } = {}) {
    if (brake === this.brake && reverse === this.reverse && headlights === this.headlightsOn) return;
    this.brake = brake;
    this.reverse = reverse;
    this.headlightsOn = headlights;
    if (this.headMat) this.headMat.emissiveIntensity = headlights ? 4 : 0.05;
    if (this.tailMat) this.tailMat.emissiveIntensity = brake ? 4.5 : headlights ? 1.8 : 0.6;
    if (this.reverseMat) this.reverseMat.emissiveIntensity = reverse ? 3 : 0;
  }

  /** state: { steer, wheelSpin[4], wheelOffset[4], pitch, roll, heave } — same as CarModel. */
  update(state) {
    this.chassis.rotation.set(state.pitch || 0, 0, state.roll || 0, 'YXZ');
    this.chassis.position.y = state.heave || 0;
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      w.steer = w.front ? state.steer || 0 : 0;
      w.spin = state.wheelSpin ? state.wheelSpin[k] : 0;
      w.offset = state.wheelOffset ? state.wheelOffset[k] : 0;
      w.pivot.rotation.y = w.steer;
      w.pivot.position.y = SLK_WHEEL_RADIUS + w.offset;
      w.spinGroup.rotation.x = w.right ? -w.spin : w.spin;
    }
    if (this.steeringSpin) this.steeringSpin.rotation.z = (state.steer || 0) * 6.5;
  }
}
