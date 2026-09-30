// Materials for the SLK. Paint is per car; everything else is shared.

import * as THREE from 'three';

export const SLK_PAINTS = [
  { id: 'mars', name: 'Mars Red', color: '#c3121c' },
  { id: 'fireopal', name: 'Fire Opal', color: '#9e1a14', metallic: true },
  { id: 'polar', name: 'Polar White', color: '#eceef0' },
  { id: 'iridium', name: 'Iridium Silver', color: '#9aa0a6', metallic: true },
  { id: 'obsidian', name: 'Obsidian Black', color: '#15171a', metallic: true },
  { id: 'lunar', name: 'Lunar Blue', color: '#1f3553', metallic: true },
  { id: 'kallait', name: 'Kallait Green', color: '#2e4b45', metallic: true },
  { id: 'citrine', name: 'Citrine Brown', color: '#5a3a26', metallic: true },
];

let shared = null;

export function sharedMaterials() {
  if (shared) return shared;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  shared = {
    chrome: std({ color: 0xf2f4f6, metalness: 1, roughness: 0.07, name: 'chrome' }),
    satin: std({ color: 0xc6c9cd, metalness: 1, roughness: 0.3, name: 'satin-aluminium' }),
    blackGloss: phys({ color: 0x050607, metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, name: 'piano-black' }),
    blackTrim: std({ color: 0x0b0c0e, metalness: 0.2, roughness: 0.45, name: 'black-trim' }),
    plastic: std({ color: 0x101113, metalness: 0, roughness: 0.78, name: 'textured-plastic' }),
    grilleMesh: std({ color: 0x0c0d0f, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, name: 'grille-mesh' }),
    rubber: std({ color: 0x0a0a0b, metalness: 0, roughness: 0.92, name: 'rubber' }),
    liner: std({ color: 0x08090a, metalness: 0, roughness: 0.95, side: THREE.DoubleSide, name: 'wheel-liner' }),
    glass: phys({
      color: 0x0d1418,
      metalness: 0,
      roughness: 0.02,
      transparent: true,
      opacity: 0.28,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      name: 'glass',
    }),
    frit: std({ color: 0x050505, metalness: 0, roughness: 0.4, name: 'glass-frit' }),
    lens: phys({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.0,
      transparent: true,
      opacity: 0.12,
      envMapIntensity: 2.2,
      clearcoat: 1,
      depthWrite: false,
      name: 'lamp-lens',
    }),
    lampChrome: std({ color: 0xb9bec4, metalness: 1, roughness: 0.16, name: 'lamp-reflector' }),
    lampBlack: std({ color: 0x0c0d10, metalness: 0.4, roughness: 0.35, name: 'lamp-housing' }),
    leather: std({ color: 0x131315, metalness: 0, roughness: 0.62, name: 'leather' }),
    interior: std({ color: 0x17181a, metalness: 0, roughness: 0.72, side: THREE.DoubleSide, name: 'interior-trim' }),
    carpet: std({ color: 0x0e0e0f, metalness: 0, roughness: 1, name: 'carpet' }),
    rim: std({ color: 0xc7cacf, metalness: 0.85, roughness: 0.28, name: 'rim-silver' }),
    rimDark: std({ color: 0x3a3d42, metalness: 0.7, roughness: 0.45, name: 'rim-barrel' }),
    tyre: std({ color: 0x151516, metalness: 0, roughness: 0.86, name: 'tyre' }),
    disc: std({ color: 0x80848a, metalness: 0.9, roughness: 0.42, name: 'brake-disc' }),
    hat: std({ color: 0x2a2c30, metalness: 0.6, roughness: 0.6, name: 'disc-hat' }),
    caliper: std({ color: 0xaeb2b7, metalness: 0.55, roughness: 0.4, name: 'caliper' }),
    exhaust: std({ color: 0xd8dadd, metalness: 1, roughness: 0.14, name: 'exhaust' }),
    soot: new THREE.MeshBasicMaterial({ color: 0x030303, name: 'soot' }),
  };
  return shared;
}

export function createPaint(color = '#c3121c', metallic = false) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: metallic ? 0.55 : 0.0,
    roughness: metallic ? 0.36 : 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.2,
    name: 'paint',
  });
}
