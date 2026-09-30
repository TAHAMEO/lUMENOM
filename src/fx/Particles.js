// Pooled particle systems. Soft sprites are THREE.Points with a custom shader
// (per-particle size, colour, alpha and rotation, fogged like the scene);
// sparks are additive line segments stretched along their velocity.

import * as THREE from 'three';
import { injectFogUniforms } from '../world/fogPatch.js';

const SPRITE_VERT = /* glsl */ `
  attribute float size;
  attribute vec4 pcolor;
  attribute float rotation;
  uniform float scale;
  varying vec4 vColor;
  varying float vRot;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = size * scale / max( 0.1, -mvPosition.z );
    vColor = pcolor;
    vRot = rotation;
    #include <fog_vertex>
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec4 vColor;
  varying float vRot;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos( vRot ), s = sin( vRot );
    uv = vec2( c * uv.x - s * uv.y, s * uv.x + c * uv.y ) + 0.5;
    vec4 tex = texture2D( map, uv );
    gl_FragColor = vec4( vColor.rgb * tex.rgb, vColor.a * tex.a );
    if ( gl_FragColor.a < 0.004 ) discard;
    #include <fog_fragment>
  }
`;

export class SpriteParticles {
  constructor({ max = 1000, texture, blending = THREE.NormalBlending, fog = true }) {
    this.max = max;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.fadeIn = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('rotation', this.aRot);
    geo.setDrawRange(0, 0);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, scale: { value: 500 } }]);
    uniforms.map.value = texture;
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      fog,
    });
    this.material.onBeforeCompile = injectFogUniforms;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(o) {
    let i = this.count;
    if (i >= this.max) {
      // recycle the oldest-ish particle
      i = Math.floor(Math.random() * this.max);
    } else this.count++;
    this.p[i * 3] = o.x;
    this.p[i * 3 + 1] = o.y;
    this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0;
    this.v[i * 3 + 1] = o.vy || 0;
    this.v[i * 3 + 2] = o.vz || 0;
    this.life[i] = 0;
    this.maxLife[i] = o.life || 1;
    this.size0[i] = o.size || 1;
    this.size1[i] = o.sizeEnd ?? o.size ?? 1;
    this.col[i * 3] = o.r ?? 1;
    this.col[i * 3 + 1] = o.g ?? 1;
    this.col[i * 3 + 2] = o.b ?? 1;
    this.alpha[i] = o.alpha ?? 1;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 1.5;
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.1;
  }

  update(dt, scale) {
    this.material.uniforms.scale.value = scale;
    let n = this.count;
    const P = this.aPos.array;
    const S = this.aSize.array;
    const C = this.aCol.array;
    const R = this.aRot.array;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        this._copy(n, i);
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt;
      this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      P[i * 3] = this.p[i * 3];
      P[i * 3 + 1] = this.p[i * 3 + 1];
      P[i * 3 + 2] = this.p[i * 3 + 2];
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const fade = Math.min(1, t / this.fadeIn[i]) * (1 - t) * (1 - t * 0.3);
      C[i * 4] = this.col[i * 3];
      C[i * 4 + 1] = this.col[i * 3 + 1];
      C[i * 4 + 2] = this.col[i * 3 + 2];
      C[i * 4 + 3] = this.alpha[i] * fade;
      R[i] = this.rot[i];
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aRot.needsUpdate = true;
  }

  _copy(from, to) {
    if (from === to) return;
    for (let c = 0; c < 3; c++) {
      this.p[to * 3 + c] = this.p[from * 3 + c];
      this.v[to * 3 + c] = this.v[from * 3 + c];
      this.col[to * 3 + c] = this.col[from * 3 + c];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.alpha[to] = this.alpha[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.fadeIn[to] = this.fadeIn[from];
  }

  clear() {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

/** Additive spark streaks (line segments from head back along velocity). */
export class Sparks {
  constructor(max = 400) {
    this.max = max;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
  }

  emit(x, y, z, vx, vy, vz, life) {
    let i = this.count < this.max ? this.count++ : Math.floor(Math.random() * this.max);
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        n--;
        for (let c = 0; c < 3; c++) {
          this.p[i * 3 + c] = this.p[n * 3 + c];
          this.v[i * 3 + c] = this.v[n * 3 + c];
        }
        this.life[i] = this.life[n];
        this.maxLife[i] = this.maxLife[n];
        i--;
        continue;
      }
      this.v[i * 3 + 1] -= 9.81 * dt;
      const k = Math.exp(-1.2 * dt);
      this.v[i * 3] *= k;
      this.v[i * 3 + 2] *= k;
      for (let c = 0; c < 3; c++) this.p[i * 3 + c] += this.v[i * 3 + c] * dt;
    }
    this.count = n;
    const P = this.aPos.array;
    const C = this.aCol.array;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      const heat = 1 - t;
      const tail = 0.022;
      for (let c = 0; c < 3; c++) {
        P[i * 6 + c] = this.p[i * 3 + c];
        P[i * 6 + 3 + c] = this.p[i * 3 + c] - this.v[i * 3 + c] * tail;
      }
      const r = 4 * heat + 0.3;
      const g = 2.2 * heat * heat + 0.1;
      const b = 0.6 * heat * heat * heat;
      C[i * 6] = r;
      C[i * 6 + 1] = g;
      C[i * 6 + 2] = b;
      C[i * 6 + 3] = r * 0.2;
      C[i * 6 + 4] = g * 0.1;
      C[i * 6 + 5] = 0;
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.lines.geometry.setDrawRange(0, 0);
  }
}
