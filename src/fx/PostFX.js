// Post-processing chain:
//   Render (MSAA, half-float HDR) → GTAO (ultra) → Bloom → Output (tone map)
//   → Lens (flare, speed blur, chromatic aberration, grade, vignette, grain) → FXAA (no-MSAA tiers)
// The low tier bypasses the composer and renders straight to the canvas.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const LensShader = {
  name: 'LumenomLens',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    vignette: { value: 0.32 },
    aberration: { value: 0.6 },
    grain: { value: 0.025 },
    radialBlur: { value: 0 },
    sunPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunVisible: { value: 0 },
    sunTint: { value: new THREE.Color(1, 0.7, 0.4) },
    saturation: { value: 1.06 },
    contrast: { value: 1.04 },
    toning: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float vignette;
    uniform float aberration;
    uniform float grain;
    uniform float radialBlur;
    uniform vec2 sunPos;
    uniform float sunVisible;
    uniform vec3 sunTint;
    uniform float saturation;
    uniform float contrast;
    uniform float toning;
    varying vec2 vUv;

    float hash( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    vec3 sampleCA( vec2 uv, vec2 dir, float amount ) {
      vec2 o = dir * amount / resolution;
      return vec3(
        texture2D( tDiffuse, uv + o ).r,
        texture2D( tDiffuse, uv ).g,
        texture2D( tDiffuse, uv - o ).b
      );
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float dist = length( dir * vec2( resolution.x / resolution.y, 1.0 ) ) / length( vec2( resolution.x / resolution.y, 1.0 ) * 0.5 );
      float ca = aberration * ( 0.4 + radialBlur * 2.5 ) * dist * dist;
      vec3 col;
      if ( radialBlur > 0.002 ) {
        vec3 acc = vec3( 0.0 );
        float strength = radialBlur * 0.06 * smoothstep( 0.18, 0.95, dist );
        for ( int i = 0; i < 8; i ++ ) {
          float t = float( i ) / 7.0;
          acc += sampleCA( uv - dir * strength * t, dir, ca );
        }
        col = acc / 8.0;
      } else {
        col = sampleCA( uv, dir, ca );
      }

      // lens flare from the sun: soft glow + ghosts mirrored through the centre
      if ( sunVisible > 0.001 ) {
        vec2 aspect = vec2( resolution.x / resolution.y, 1.0 );
        vec2 d = ( uv - sunPos ) * aspect;
        float glow = 0.004 / ( dot( d, d ) + 0.004 ) * 0.14;
        vec3 flare = sunTint * glow;
        vec2 axis = vec2( 0.5 ) - sunPos;
        for ( int k = 0; k < 4; k++ ) {
          float f = 0.4 + float( k ) * 0.45;
          vec2 gp = sunPos + axis * f * 2.0;
          float r = 0.02 + 0.025 * float( k );
          float g = smoothstep( r, r * 0.55, length( ( uv - gp ) * aspect ) );
          vec3 gc = k == 1 ? vec3( 0.35, 0.6, 1.0 ) : k == 2 ? vec3( 0.9, 0.5, 0.25 ) : vec3( 0.7, 0.8, 0.6 );
          flare += gc * g * 0.05;
        }
        // horizontal anamorphic streak
        float streak = exp( -abs( d.y ) * 180.0 ) * exp( -abs( d.x ) * 2.5 ) * 0.25;
        flare += sunTint * streak;
        col += flare * sunVisible;
      }

      // grade: saturation, contrast, split toning (cool shadows, warm highlights)
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( l ), col, saturation );
      col = ( col - 0.5 ) * contrast + 0.5;
      col += ( vec3( -0.012, 0.0, 0.018 ) * ( 1.0 - l ) + vec3( 0.018, 0.008, -0.012 ) * l ) * toning;

      col *= 1.0 - vignette * smoothstep( 0.45, 1.25, dist );
      col += ( hash( uv * resolution + fract( time ) * 100.0 ) - 0.5 ) * grain;
      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this.composer = null;
    this.quality = null;
    this.width = 1;
    this.height = 1;
    this.lens = new ShaderPass(LensShader);
    this.bloomSettings = { strength: 0.3, radius: 0.55, threshold: 2 };
  }

  configure(q) {
    this.quality = q;
    this.enabled = q.post;
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const p of this.composer.passes) if (p !== this.lens && p.dispose) p.dispose();
      this.composer = null;
    }
    if (!q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
      gtao.blendIntensity = 0.85;
      composer.addPass(gtao);
      this.gtao = gtao;
    } else this.gtao = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), this.bloomSettings.strength, this.bloomSettings.radius, this.bloomSettings.threshold);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    composer.addPass(new OutputPass());
    composer.addPass(this.lens);
    if (!q.msaa) {
      this.fxaa = new FXAAPass();
      composer.addPass(this.fxaa);
    } else this.fxaa = null;
    this.composer = composer;
    this.setSize(this.width, this.height);
  }

  setBloom({ strength, radius, threshold }) {
    this.bloomSettings = { strength, radius, threshold };
    if (this.bloom) {
      this.bloom.strength = strength;
      this.bloom.radius = radius;
      this.bloom.threshold = threshold;
    }
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    if (!this.composer) return;
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.lens.uniforms.resolution.value.set(w * pr, h * pr);
  }

  render(dt, fx) {
    if (!this.enabled || !this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const u = this.lens.uniforms;
    u.time.value += dt;
    u.radialBlur.value = fx.radialBlur;
    u.sunVisible.value = fx.sunVisible;
    if (fx.sunPos) u.sunPos.value.copy(fx.sunPos);
    if (fx.sunTint) u.sunTint.value.copy(fx.sunTint);
    u.vignette.value = fx.vignette ?? 0.32;
    u.grain.value = this.quality.grain ? 0.022 : 0;
    this.composer.render(dt);
  }
}
