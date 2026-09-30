// Draws every car's wheels with a handful of instanced meshes (tyres, rims,
// barrels, discs, calipers) instead of ~20 draw calls per car. Right-hand
// wheels are turned 180° about Y (never mirrored) so instance matrices keep a
// positive determinant and face culling stays correct.

import * as THREE from 'three';
import { getCarShared, WHEEL_RADIUS } from './CarModel.js';

const _steer = new THREE.Matrix4();
const _spin = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();
const _rx = new THREE.Matrix4();
const _calRight = new THREE.Matrix4().makeRotationX(Math.PI - 1.2);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class WheelInstances {
  constructor(scene, maxCars = 10) {
    const S = getCarShared();
    const M = S.mats;
    const P = S.wheelParts;
    this.models = [];
    this.max = maxCars;
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.26 });
    this.caliperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.4 });
    const make = (geo, mat, count, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) m.setMatrixAt(i, ZERO);
      scene.add(m);
      return m;
    };
    this.tireF = make(P.tireF, M.tire, maxCars * 2, true);
    this.tireR = make(P.tireR, M.tire, maxCars * 2, true);
    this.rimF = make(P.rimF, this.rimMat, maxCars * 2, true);
    this.rimR = make(P.rimR, this.rimMat, maxCars * 2, true);
    this.barrel = make(P.barrel, M.barrel, maxCars * 4, false);
    this.discF = make(P.discF, M.disc, maxCars * 2, false);
    this.discR = make(P.discR, M.disc, maxCars * 2, false);
    this.caliper = make(P.caliper, this.caliperMat, maxCars * 4, false);
    this.all = [this.tireF, this.tireR, this.rimF, this.rimR, this.barrel, this.discF, this.discR, this.caliper];
    // seed colour buffers so instanceColor exists before the first frame
    const white = new THREE.Color(1, 1, 1);
    for (const m of [this.rimF, this.rimR, this.caliper]) for (let i = 0; i < m.count; i++) m.setColorAt(i, white);
  }

  register(model) {
    if (this.models.length >= this.max) throw new Error('WheelInstances capacity exceeded');
    this.models.push(model);
  }

  update() {
    for (let c = 0; c < this.models.length; c++) {
      const model = this.models[c];
      const visible = model.root.visible && model.root.parent;
      if (visible) model.root.updateMatrixWorld();
      for (let k = 0; k < 4; k++) {
        const w = model.wheels[k];
        const pair = c * 2 + (k & 1); // slot within the front- or rear-specific meshes
        const quad = c * 4 + k;
        const tire = w.front ? this.tireF : this.tireR;
        const rim = w.front ? this.rimF : this.rimR;
        const disc = w.front ? this.discF : this.discR;
        if (!visible) {
          tire.setMatrixAt(pair, ZERO);
          rim.setMatrixAt(pair, ZERO);
          disc.setMatrixAt(pair, ZERO);
          this.barrel.setMatrixAt(quad, ZERO);
          this.caliper.setMatrixAt(quad, ZERO);
          continue;
        }
        _steer.makeRotationY(w.steer + (w.right ? Math.PI : 0));
        _steer.setPosition(w.x, WHEEL_RADIUS + w.offset, w.z);
        _steer.premultiply(model.root.matrixWorld);
        _rx.makeRotationX(w.right ? -w.spin : w.spin);
        _spin.multiplyMatrices(_steer, _rx);
        tire.setMatrixAt(pair, _spin);
        rim.setMatrixAt(pair, _spin);
        disc.setMatrixAt(pair, _spin);
        this.barrel.setMatrixAt(quad, _spin);
        if (w.right) this.caliper.setMatrixAt(quad, _tmp.multiplyMatrices(_steer, _calRight));
        else this.caliper.setMatrixAt(quad, _steer);
        rim.setColorAt(pair, model.rimColor);
        this.caliper.setColorAt(quad, model.caliperColor);
      }
    }
    for (const m of this.all) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
