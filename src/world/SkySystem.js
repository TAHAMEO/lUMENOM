// Sky dome (physically based Preetham sky with clouds for day/sunset, a
// procedural star field with a moon for night) and PMREM environment maps
// generated from the same sky so reflections always match the backdrop.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { fogUniforms } from './fogPatch.js';

const HORIZON_GLSL = /* glsl */ `
  uniform vec3 fogColor;
  uniform vec3 fogSunColor;
  uniform float horizonBlend;
`;

function createDaySkyMaterial() {
  const shader = Sky.SkyShader;
  const fragment = shader.fragmentShader
    .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\n' + HORIZON_GLSL)
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      /* glsl */ `
      float hz = 1.0 - smoothstep( -0.03, 0.14, direction.y );
      float sunAmt = pow( max( dot( direction, vSunDirection ), 0.0 ), 8.0 );
      vec3 fogCol = fogColor + fogSunColor * sunAmt;
      texColor = mix( texColor, fogCol, hz * horizonBlend );
      gl_FragColor = vec4( texColor, 1.0 );`,
    );
  const uniforms = THREE.UniformsUtils.clone(shader.uniforms);
  uniforms.fogColor = { value: new THREE.Color() };
  uniforms.fogSunColor = fogUniforms.fogSunColor;
  uniforms.horizonBlend = { value: 0.8 };
  return new THREE.ShaderMaterial({
    name: 'LumenomDaySky',
    uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

function createNightSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'LumenomNightSky',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      moonDir: { value: new THREE.Vector3(0, 1, 0) },
      time: { value: 0 },
      fogColor: { value: new THREE.Color() },
      horizonBlend: { value: 1 },
      starIntensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 moonDir;
      uniform float time;
      uniform vec3 fogColor;
      uniform float horizonBlend;
      uniform float starIntensity;
      varying vec3 vDir;

      float hash13( vec3 p ) {
        p = fract( p * 0.1031 );
        p += dot( p, p.zyx + 31.32 );
        return fract( ( p.x + p.y ) * p.z );
      }
      vec3 hash33( vec3 p ) {
        p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
        p += dot( p, p.yxz + 33.33 );
        return fract( ( p.xxy + p.yxx ) * p.zyx );
      }
      float starLayer( vec3 dir, float scale, float density ) {
        vec3 p = dir * scale;
        vec3 cell = floor( p );
        float h = hash13( cell );
        if ( h > density ) return 0.0;
        vec3 starPos = cell + 0.25 + 0.5 * hash33( cell );
        float d = length( p - starPos );
        float size = 0.06 + 0.1 * hash13( cell + 7.0 );
        float twinkle = 0.75 + 0.25 * sin( time * ( 1.0 + 3.0 * h ) + h * 120.0 );
        return smoothstep( size, 0.0, d ) * twinkle * ( 0.4 + 1.6 * hash13( cell + 3.0 ) );
      }
      // cheap value noise for faint cloud banks
      float n3( vec3 p ) {
        vec3 i = floor( p ), f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        float a = hash13( i ), b = hash13( i + vec3( 1, 0, 0 ) ), c = hash13( i + vec3( 0, 1, 0 ) ), d = hash13( i + vec3( 1, 1, 0 ) );
        float e = hash13( i + vec3( 0, 0, 1 ) ), f1 = hash13( i + vec3( 1, 0, 1 ) ), g = hash13( i + vec3( 0, 1, 1 ) ), h = hash13( i + vec3( 1, 1, 1 ) );
        return mix( mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ), mix( mix( e, f1, f.x ), mix( g, h, f.x ), f.y ), f.z );
      }
      void main() {
        vec3 dir = normalize( vDir );
        float up = max( dir.y, 0.0 );
        vec3 zenith = vec3( 0.0012, 0.0024, 0.0075 );
        vec3 horizon = vec3( 0.012, 0.017, 0.032 );
        vec3 col = mix( horizon, zenith, pow( up, 0.45 ) );
        // city / trackside light pollution glow near the horizon
        col += vec3( 0.055, 0.032, 0.018 ) * pow( 1.0 - up, 10.0 );
        // stars fade toward the horizon
        float stars = starLayer( dir, 180.0, 0.08 ) + starLayer( dir, 420.0, 0.05 ) * 0.7;
        col += vec3( 0.85, 0.9, 1.0 ) * stars * smoothstep( 0.02, 0.35, up ) * 0.6 * starIntensity;
        // milky band
        float band = exp( -pow( dot( dir, normalize( vec3( 0.3, 0.5, -0.8 ) ) ) * 4.0, 2.0 ) );
        col += vec3( 0.012, 0.013, 0.02 ) * band * ( 0.6 + 0.8 * n3( dir * 18.0 ) ) * smoothstep( 0.0, 0.3, up );
        // moon disc + halo
        float md = dot( dir, moonDir );
        col += vec3( 1.6, 1.62, 1.7 ) * smoothstep( 0.99955, 0.99975, md ) * 3.0;
        col += vec3( 0.05, 0.065, 0.1 ) * pow( max( md, 0.0 ), 90.0 );
        col += vec3( 0.012, 0.016, 0.028 ) * pow( max( md, 0.0 ), 6.0 );
        // faint drifting clouds catching moonlight
        float cl = n3( vec3( dir.xz / ( dir.y + 0.12 ) * 2.2 + time * 0.01, 1.0 ) ) * n3( vec3( dir.xz / ( dir.y + 0.12 ) * 5.3, 4.0 ) );
        col = mix( col, vec3( 0.02, 0.024, 0.035 ) + col * 0.3, smoothstep( 0.25, 0.55, cl ) * smoothstep( 0.0, 0.25, up ) * 0.8 );
        float hz = 1.0 - smoothstep( -0.03, 0.12, dir.y );
        col = mix( col, fogColor, hz * horizonBlend );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
}

export class SkySystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.dayMaterial = createDaySkyMaterial();
    this.nightMaterial = createNightSkyMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.dayMesh = new THREE.Mesh(box, this.dayMaterial);
    this.dayMesh.scale.setScalar(20000);
    this.dayMesh.frustumCulled = false;
    this.dayMesh.renderOrder = -10;
    this.nightMesh = new THREE.Mesh(box, this.nightMaterial);
    this.nightMesh.scale.setScalar(20000);
    this.nightMesh.frustumCulled = false;
    this.nightMesh.renderOrder = -10;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.group.add(this.dayMesh, this.nightMesh);
    this.envTarget = null;
    this.preset = null;
  }

  apply(preset, sunDir, fogColor) {
    this.preset = preset;
    const night = !!preset.night;
    this.dayMesh.visible = !night;
    this.nightMesh.visible = night;
    if (!night) {
      const u = this.dayMaterial.uniforms;
      u.sunPosition.value.copy(sunDir);
      for (const [k, v] of Object.entries(preset.sky)) u[k].value = v;
      u.fogColor.value.copy(fogColor);
      u.horizonBlend.value = preset.horizonBlend;
    } else {
      const u = this.nightMaterial.uniforms;
      u.moonDir.value.copy(sunDir);
      u.fogColor.value.copy(fogColor);
      u.horizonBlend.value = preset.horizonBlend;
    }
  }

  update(dt, cameraPosition) {
    this.group.position.copy(cameraPosition);
    this.dayMaterial.uniforms.time.value += dt;
    this.nightMaterial.uniforms.time.value += dt;
  }

  /** Render the current sky (plus a ground disc and horizon silhouettes) into a PMREM env map. */
  buildEnvironment(preset) {
    const scene = new THREE.Scene();
    const sky = new THREE.Mesh(this.dayMesh.geometry, preset.night ? this.nightMaterial : this.dayMaterial);
    sky.scale.setScalar(150);
    scene.add(sky);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(preset.envGround), fog: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);
    // A dark tree-line band on the horizon keeps car flanks from mirroring pure sky.
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(60, 60, 5, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(preset.envGround).multiplyScalar(preset.night ? 1 : 1.4),
        side: THREE.BackSide,
        fog: false,
      }),
    );
    band.position.y = 0.2;
    scene.add(band);
    if (preset.night) {
      // Street-light cards give the car paint something bright to reflect.
      const card = new THREE.PlaneGeometry(3, 1.2);
      const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 4), side: THREE.DoubleSide, fog: false });
      const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 5, 9), side: THREE.DoubleSide, fog: false });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        const m = new THREE.Mesh(card, i % 4 === 0 ? cool : warm);
        m.position.set(Math.cos(a) * 40, 9 + (i % 3) * 3, Math.sin(a) * 40);
        m.lookAt(0, 0, 0);
        m.rotateX(-0.8);
        scene.add(m);
      }
    }
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(scene, 0.02, 0.1, 400);
    if (prev) prev.dispose();
    scene.traverse((o) => {
      if (o.isMesh && o !== sky) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    return this.envTarget.texture;
  }
}
