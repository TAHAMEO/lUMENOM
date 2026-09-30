// Sun/moon directional light with a shadow frustum that follows the action
// (snapped to shadow-map texels to avoid shimmering), sky/ground hemisphere
// fill, and a small pool of point lights that hop between the nearest street
// lamps at night so passing cars are actually lit by them.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0, 1, 0);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    this.shadowExtent = 60;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 900;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a4030, 0.8);
    scene.add(this.hemi);

    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 34, 1.6);
      l.visible = false;
      scene.add(l);
      this.lampLights.push(l);
    }
    this.lampPositions = [];
    this.lampsOn = false;
    this.lampIntensity = 90;
  }

  setShadowQuality(enabled, size, extent) {
    this.sun.castShadow = enabled;
    this.shadowExtent = extent;
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  apply(preset, sunDir) {
    this.sunDir.copy(sunDir);
    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemi.color.set(preset.hemiSky);
    this.hemi.groundColor.set(preset.hemiGround);
    this.hemi.intensity = preset.hemiIntensity;
    this.lampsOn = !!preset.lamps;
    for (const l of this.lampLights) {
      l.visible = this.lampsOn;
      l.intensity = this.lampsOn ? this.lampIntensity : 0;
    }
  }

  setLampPositions(list) {
    this.lampPositions = list;
  }

  /** Keep the shadow frustum centred slightly ahead of the focus point. */
  update(focus, forward) {
    const ext = this.shadowExtent;
    const center = _v.copy(focus).addScaledVector(forward, ext * 0.45);
    // Texel snapping in light space.
    const d = this.sunDir;
    _up.set(0, 1, 0);
    if (Math.abs(d.y) > 0.99) _up.set(0, 0, 1);
    _right.crossVectors(_up, d).normalize();
    _up.crossVectors(d, _right).normalize();
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const r = Math.round(center.dot(_right) / texel) * texel;
    const u = Math.round(center.dot(_up) / texel) * texel;
    const f = center.dot(d);
    center.copy(_right).multiplyScalar(r).addScaledVector(_up, u).addScaledVector(d, f);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(d, 400);
    this.sun.target.updateMatrixWorld();

    if (this.lampsOn && this.lampPositions.length) {
      // Assign the pool to the lamps nearest to the focus point.
      const best = [];
      for (let i = 0; i < this.lampPositions.length; i++) {
        const p = this.lampPositions[i];
        const dd = (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2;
        if (best.length < this.lampLights.length) {
          best.push([dd, i]);
          best.sort((a, b) => a[0] - b[0]);
        } else if (dd < best[best.length - 1][0]) {
          best[best.length - 1] = [dd, i];
          best.sort((a, b) => a[0] - b[0]);
        }
      }
      for (let k = 0; k < this.lampLights.length; k++) {
        const l = this.lampLights[k];
        if (k < best.length) {
          const p = this.lampPositions[best[k][1]];
          l.position.set(p.x, p.y - 0.4, p.z);
          const dist = Math.sqrt(best[k][0]);
          l.intensity = this.lampIntensity * Math.min(1, Math.max(0, (120 - dist) / 40));
        } else l.intensity = 0;
      }
    }
  }
}
