// World: builds and owns everything static — circuit, terrain, lake,
// vegetation, trackside props, sky and lights — and applies time-of-day and
// quality presets to them.

import * as THREE from 'three';
import { Track } from './Track.js';
import { LUMENOM_RING } from './trackData.js';
import { Terrain, createGroundMaterial } from './Terrain.js';
import { buildTrackMeshes } from './TrackMesh.js';
import { buildVegetation } from './Vegetation.js';
import { buildProps } from './Props.js';
import { SkySystem } from './SkySystem.js';
import { Lighting } from './Lighting.js';
import { TIME_PRESETS, sunDirection } from './timeOfDay.js';
import { fogUniforms, updateFogSun } from './fogPatch.js';
import {
  createAsphaltTextures,
  createCheckerTexture,
  createCurbTexture,
  createGrassDetailTexture,
  createGravelTextures,
  createWaterNormalTexture,
} from './textures.js';

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.time = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.presetKey = 'sunset';
  }

  async build(progress = () => {}) {
    const scene = this.scene;
    progress(0.02, 'Surveying the circuit');
    await nextFrame();
    this.track = new Track(LUMENOM_RING);

    progress(0.1, 'Laying asphalt');
    await nextFrame();
    const asphalt = createAsphaltTextures(1024);
    const grassDetail = createGrassDetailTexture(512);
    const gravel = createGravelTextures(512);
    gravel.map.repeat.set(2.2, 2.2);
    gravel.normalMap.repeat.set(2.2, 2.2);

    progress(0.3, 'Shaping terrain');
    await nextFrame();
    this.terrain = new Terrain(this.track);

    const mats = (this.materials = {
      asphalt: new THREE.MeshStandardMaterial({
        map: asphalt.map,
        normalMap: asphalt.normalMap,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughnessMap: asphalt.roughnessMap,
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      }),
      curb: new THREE.MeshStandardMaterial({ map: createCurbTexture(), roughness: 0.5, metalness: 0 }),
      ground: createGroundMaterial(grassDetail),
      gravel: new THREE.MeshStandardMaterial({
        map: gravel.map,
        normalMap: gravel.normalMap,
        roughness: 1,
        metalness: 0,
      }),
      armco: new THREE.MeshStandardMaterial({ color: 0xa5abb2, metalness: 0.85, roughness: 0.36 }),
      post: new THREE.MeshStandardMaterial({ color: 0x4d5158, metalness: 0.5, roughness: 0.55 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }),
      tyreWall: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }),
      checker: new THREE.MeshStandardMaterial({
        map: createCheckerTexture(28, 3, 32),
        roughness: 0.65,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      paint: new THREE.MeshStandardMaterial({
        color: 0xe9e9e4,
        roughness: 0.6,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    });

    progress(0.45, 'Planting the landscape');
    await nextFrame();
    this.terrainGroup = this.terrain.buildMesh(mats.ground);
    scene.add(this.terrainGroup);

    // Lake
    const waterNormal = createWaterNormalTexture(256);
    waterNormal.repeat.set(40, 40);
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c2630,
      roughness: 0.07,
      metalness: 0.0,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      envMapIntensity: 1.2,
    });
    const lake = this.terrain.lake;
    const water = new THREE.Mesh(new THREE.CircleGeometry(lake.r * 1.7, 64), this.waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(lake.x, lake.level, lake.z);
    water.receiveShadow = true;
    water.name = 'lake';
    scene.add(water);
    this.water = water;

    const trackMeshes = buildTrackMeshes(this.track, this.terrain, mats);
    scene.add(trackMeshes.group);
    this.gridSlots = trackMeshes.slots;

    progress(0.6, 'Building grandstands');
    await nextFrame();
    this.props = buildProps(this.track, this.terrain, mats);
    scene.add(this.props.group);

    progress(0.72, 'Growing forests');
    await nextFrame();
    this.vegetation = buildVegetation(this.track, this.terrain, { exclusions: this.props.exclusions });
    scene.add(this.vegetation.group);

    progress(0.85, 'Painting the sky');
    await nextFrame();
    this.sky = new SkySystem(this.renderer);
    scene.add(this.sky.group);
    this.lighting = new Lighting(scene);
    this.lighting.setLampPositions(this.props.lampHeads);
    scene.fog = new THREE.FogExp2(0xffffff, 0.0005);
    this.setTimeOfDay(this.presetKey);
    progress(0.95, 'Ready');
  }

  get preset() {
    return TIME_PRESETS[this.presetKey];
  }

  setTimeOfDay(key) {
    this.presetKey = TIME_PRESETS[key] ? key : 'sunset';
    const p = this.preset;
    sunDirection(p, this.sunDir);
    this.scene.fog.color.set(p.fogColor);
    this.scene.fog.density = p.fogDensity;
    fogUniforms.fogSunColor.value.set(p.fogSunColor).multiplyScalar(p.fogSunStrength);
    fogUniforms.fogHeight.value.set(p.fogHeight[0], p.fogHeight[1], p.fogHeight[2]);
    this.sky.apply(p, this.sunDir, this.scene.fog.color);
    this.lighting.apply(p, this.sunDir);
    this.renderer.toneMappingExposure = p.exposure;
    const env = this.sky.buildEnvironment(p);
    this.scene.environment = env;
    this.scene.environmentIntensity = p.envIntensity;
    this.props.setNight(!!p.night);
  }

  applyQuality(q) {
    this.lighting.setShadowQuality(q.shadows, q.shadowSize, q.shadowExtent);
    this.vegetation.setDensity(q.trees, q.grass);
    this.vegetation.setShadows(q.shadows && q.treeShadows);
    for (const m of this.terrainGroup.children) m.castShadow = q.shadows && q.terrainShadows;
  }

  update(dt, camera, focus, forward) {
    this.time += dt;
    this.sky.update(dt, camera.position);
    this.lighting.update(focus, forward);
    updateFogSun(camera, this.sunDir);
    this.vegetation.update(this.time);
    this.props.update(dt, this.time);
    const n = this.waterMaterial.normalMap;
    n.offset.x = (this.time * 0.004) % 1;
    n.offset.y = (this.time * 0.0025) % 1;
  }
}
