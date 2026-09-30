// Time-trial ghost: records the player's lap as a compact pose stream and
// replays the best lap as a translucent hologram car. Also provides a live
// delta by comparing lap time at the same track distance.

import * as THREE from 'three';
import { CarModel } from '../vehicle/CarModel.js';
import { SLKModel } from '../vehicle/slk/SLKModel.js';

const RATE = 20; // samples per second
const STRIDE = 7; // t, x, y, z, yaw, pitch, roll

function createGhostMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0.45, 0.8, 1.0) }, opacity: { value: 0.6 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vN = normalize( mat3( modelMatrix ) * normal );
        vV = normalize( cameraPosition - wp.xyz );
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 color;
      uniform float opacity;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float fres = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 2.2 );
        float scan = 0.75 + 0.25 * sin( vY * 60.0 - time * 6.0 );
        float a = ( 0.08 + fres * 0.9 ) * scan * opacity;
        gl_FragColor = vec4( color * ( 0.6 + fres * 1.8 ), a );
      }
    `,
  });
}

export class Ghost {
  constructor(scene) {
    this.scene = scene;
    this.recording = [];
    this.best = null; // Float32Array
    this.bestDistances = null;
    this.material = createGhostMaterial();
    this.bodyId = null;
    this.model = null;
    this.setBody('lumenom');
    this._acc = 0;
    this.distRecording = [];
  }

  /** Show the ghost as the given body ('lumenom' or 'slk'). */
  setBody(id) {
    if (this.bodyId === id) return;
    const model = id === 'slk' ? new SLKModel({ color: '#ffffff', quality: 'medium', plate: 'GHOST' }) : new CarModel({ color: '#ffffff', plate: 'GHOST' });
    model.root.traverse((o) => {
      if (o.isMesh) {
        o.material = this.material;
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    model.root.visible = false;
    if (this.model) {
      model.root.position.copy(this.model.root.position);
      model.root.rotation.copy(this.model.root.rotation);
      model.root.visible = this.model.root.visible;
      this.scene.remove(this.model.root);
    }
    this.scene.add(model.root);
    this.model = model;
    this.bodyId = id;
  }

  load(encoded) {
    if (!encoded) return;
    try {
      const bin = atob(encoded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const all = new Float32Array(bytes.buffer);
      const n = all[0];
      this.best = all.slice(1, 1 + n);
      this.bestDistances = all.slice(1 + n);
    } catch {
      this.best = null;
      this.bestDistances = null;
    }
  }

  encode() {
    if (!this.best) return null;
    const all = new Float32Array(1 + this.best.length + (this.bestDistances?.length || 0));
    all[0] = this.best.length;
    all.set(this.best, 1);
    if (this.bestDistances) all.set(this.bestDistances, 1 + this.best.length);
    const bytes = new Uint8Array(all.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }

  startLap() {
    this.recording = [];
    this.distRecording = [];
    this._acc = 1;
  }

  record(dt, lapTime, car) {
    this._acc += dt * RATE;
    if (this._acc < 1) return;
    this._acc -= 1;
    const ph = car.physics;
    this.recording.push(lapTime, ph.x, ph.y, ph.z, ph.yaw, ph.groundPitch, ph.groundRoll);
    this.distRecording.push(lapTime, car.proj.distance);
  }

  /** Call when a valid lap completes. Returns true if it became the new ghost. */
  finishLap(isBest) {
    if (isBest && this.recording.length > STRIDE * 10) {
      this.best = Float32Array.from(this.recording);
      this.bestDistances = Float32Array.from(this.distRecording);
      return true;
    }
    return false;
  }

  /** Live delta (s) versus the ghost at the car's current distance; null if unavailable. */
  delta(lapTime, distance) {
    const d = this.bestDistances;
    if (!d || d.length < 4) return null;
    // binary search on distance (monotonic within a lap)
    let lo = 0;
    let hi = d.length / 2 - 1;
    if (distance < d[1] || distance > d[hi * 2 + 1]) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid * 2 + 1] <= distance) lo = mid;
      else hi = mid;
    }
    const d0 = d[lo * 2 + 1];
    const d1 = d[hi * 2 + 1];
    const f = d1 > d0 ? (distance - d0) / (d1 - d0) : 0;
    const tRef = d[lo * 2] + (d[hi * 2] - d[lo * 2]) * f;
    return lapTime - tRef;
  }

  update(dt, lapTime, visible) {
    this.material.uniforms.time.value += dt;
    const b = this.best;
    const root = this.model.root;
    if (!visible || !b || lapTime == null) {
      root.visible = false;
      return;
    }
    const n = b.length / STRIDE;
    const last = b[(n - 1) * STRIDE];
    if (lapTime > last) {
      root.visible = false;
      return;
    }
    let i = Math.min(n - 2, Math.max(0, Math.floor(lapTime * RATE)));
    while (i > 0 && b[i * STRIDE] > lapTime) i--;
    while (i < n - 2 && b[(i + 1) * STRIDE] < lapTime) i++;
    const a = i * STRIDE;
    const c = (i + 1) * STRIDE;
    const f = Math.min(1, Math.max(0, (lapTime - b[a]) / Math.max(1e-4, b[c] - b[a])));
    const lerp = (k) => b[a + k] + (b[c + k] - b[a + k]) * f;
    let dyaw = b[c + 4] - b[a + 4];
    dyaw = ((dyaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    root.position.set(lerp(1), lerp(2), lerp(3));
    root.rotation.set(-lerp(5), b[a + 4] + dyaw * f, lerp(6), 'YXZ');
    root.visible = true;
  }
}
