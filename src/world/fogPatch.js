// Replaces three.js' fog chunks with an atmospheric version:
//  • in-scattering toward the sun (fog glows warm when looking into a sunset)
//  • height fog that pools in valleys
// The extra uniforms are shared objects injected into every material, so one
// update per frame reaches all of them. Unpatched programs fall back to plain fog.

import * as THREE from 'three';

export const fogUniforms = {
  fogSunColor: { value: new THREE.Color(0, 0, 0) },
  fogSunDirView: { value: new THREE.Vector3(0, 0, -1) },
  // x: base height, y: falloff scale (m), z: density boost at/below base
  fogHeight: { value: new THREE.Vector3(0, 30, 0) },
};

export function injectFogUniforms(shader) {
  shader.uniforms.fogSunColor = fogUniforms.fogSunColor;
  shader.uniforms.fogSunDirView = fogUniforms.fogSunDirView;
  shader.uniforms.fogHeight = fogUniforms.fogHeight;
}

let installed = false;

export function installFogPatch() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogViewDir;
  varying float vFogWorldY;
#endif
`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogViewDir = mvPosition.xyz;
  // world = Rᵀ·view + cameraPosition, so world.y = dot(column 1 of R, view) + camera.y
  vFogWorldY = cameraPosition.y + dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunColor;
  uniform vec3 fogSunDirView;
  uniform vec3 fogHeight;
  varying float vFogDepth;
  varying vec3 vFogViewDir;
  varying float vFogWorldY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogH = 1.0 + fogHeight.z * exp( - max( vFogWorldY - fogHeight.x, 0.0 ) / max( fogHeight.y, 1.0 ) );
    float fogD = fogDensity * fogH * vFogDepth;
    float fogFactor = 1.0 - exp( - fogD * fogD );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogSun = pow( max( dot( normalize( vFogViewDir ), fogSunDirView ), 0.0 ), 8.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunColor * fogSun, fogFactor );
#endif
`;
  // Every material gets the shared uniforms unless it overrides onBeforeCompile
  // (our custom ones call injectFogUniforms themselves).
  THREE.Material.prototype.onBeforeCompile = function (shader) {
    injectFogUniforms(shader);
  };
}

/** Per-frame: express the sun direction in view space for the fog shader. */
export function updateFogSun(camera, sunDirWorld) {
  const v = fogUniforms.fogSunDirView.value;
  v.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
}
