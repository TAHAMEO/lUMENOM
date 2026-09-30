// Decides what each car emits every frame — tyre smoke, dust, skid marks,
// nitro flames, backfires and impact sparks — and owns the particle systems.

import * as THREE from 'three';
import { SpriteParticles, Sparks } from './Particles.js';
import { Skidmarks } from './Skidmarks.js';
import { createRadialTexture, createSmokeTexture } from '../world/textures.js';
import { clamp, smoothstep } from '../core/math.js';

const _p = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new SpriteParticles({ max: 1400, texture: createSmokeTexture(128) });
    this.glow = new SpriteParticles({
      max: 600,
      texture: createRadialTexture(64, [
        [0, 'rgba(255,255,255,1)'],
        [0.25, 'rgba(255,255,255,0.7)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.glow.material.toneMapped = false;
    this.sparks = new Sparks(500);
    this.skids = new Skidmarks(3500);
    scene.add(this.smoke.points, this.glow.points, this.sparks.lines, this.skids.mesh);
    this.density = 1;
    this.acc = new Map();
  }

  setDensity(d) {
    this.density = d;
  }

  clear() {
    this.smoke.clear();
    this.glow.clear();
    this.sparks.clear();
    this.skids.clear();
  }

  /** Accumulate fractional emission counts per key. */
  _count(key, rate, dt) {
    const v = (this.acc.get(key) || 0) + rate * dt * this.density;
    const n = Math.floor(v);
    this.acc.set(key, v - n);
    return n;
  }

  impact(hit) {
    const n = Math.floor(10 + hit.strength * 50);
    const tx = -hit.nz;
    const tz = hit.nx;
    for (let i = 0; i < n; i++) {
      const s = (Math.random() - 0.5) * 16;
      const out = 1 + Math.random() * 5;
      this.sparks.emit(
        hit.x,
        hit.y,
        hit.z,
        tx * s + hit.nx * out + (Math.random() - 0.5) * 3,
        1 + Math.random() * 5,
        tz * s + hit.nz * out + (Math.random() - 0.5) * 3,
        0.25 + Math.random() * 0.5,
      );
    }
    this.glow.emit({ x: hit.x, y: hit.y, z: hit.z, life: 0.12, size: 1.6 * (0.5 + hit.strength), sizeEnd: 0.4, r: 3, g: 1.8, b: 0.8, alpha: 1, drag: 0 });
    if (hit.strength > 0.3) {
      for (let i = 0; i < 6; i++) {
        this.smoke.emit({
          x: hit.x,
          y: hit.y,
          z: hit.z,
          vx: (Math.random() - 0.5) * 2,
          vy: 0.6 + Math.random(),
          vz: (Math.random() - 0.5) * 2,
          life: 1.4,
          size: 1.2,
          sizeEnd: 3.5,
          r: 0.55,
          g: 0.53,
          b: 0.5,
          alpha: 0.35,
          drag: 1.5,
        });
      }
    }
  }

  update(dt, cars, camera, viewportHeight, night) {
    const scale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const car of cars) this._emitCar(car, dt, night);
    this.smoke.update(dt, scale);
    this.glow.update(dt, scale);
    this.sparks.update(dt);
    this.skids.update();
  }

  _emitCar(car, dt, night) {
    const ph = car.physics;
    if (!car.model) return;
    const speed = ph.speed;
    const sn = Math.sin(ph.yaw);
    const cs = Math.cos(ph.yaw);
    const s = ph.spec;
    const fwdX = sn;
    const fwdZ = cs;
    const vDirX = speed > 0.5 ? ph.vx / speed : fwdX;
    const vDirZ = speed > 0.5 ? ph.vz / speed : fwdZ;

    // slip intensities
    const latSlip = clamp((Math.abs(ph.slipRear) - 0.11) / 0.35, 0, 1) * smoothstep(4, 14, speed);
    const latSlipF = clamp((Math.abs(ph.slipFront) - 0.16) / 0.4, 0, 1) * smoothstep(4, 14, speed);
    const rearInt = ph.grounded ? Math.max(latSlip, ph.wheelspin * 0.9, ph.lockup > 0.5 && ph.brake < 0.2 ? ph.lockup * smoothstep(3, 10, speed) : 0) : 0;
    const frontInt = ph.grounded ? Math.max(latSlipF * 0.7, ph.lockup > 0 && ph.brake > 0.5 ? ph.lockup * 0.8 * smoothstep(3, 10, speed) : 0) : 0;

    const wheels = [
      [s.halfTrack, s.cgToFront, frontInt, 0],
      [-s.halfTrack, s.cgToFront, frontInt, 1],
      [s.halfTrack, -s.cgToRear, rearInt, 2],
      [-s.halfTrack, -s.cgToRear, rearInt, 3],
    ];
    for (const [lat, lon, intensity, k] of wheels) {
      const wx = ph.x + sn * lon + cs * lat;
      const wz = ph.z + cs * lon - sn * lat;
      const wy = ph.wheelH[k];
      const surf = ph.wheelSurf[k];
      const paved = surf <= 1;
      // skid marks on tarmac
      this.skids.add(`${car.id}:${k}`, wx, wy + 0.02, wz, vDirX, vDirZ, k < 2 ? 0.24 : 0.29, paved ? intensity : 0);
      if (paved && intensity > 0.15) {
        const n = this._count(`s${car.id}${k}`, 38 * intensity, dt);
        for (let i = 0; i < n; i++) {
          const gray = 0.78 + Math.random() * 0.14;
          this.smoke.emit({
            x: wx + (Math.random() - 0.5) * 0.4,
            y: wy + 0.25,
            z: wz + (Math.random() - 0.5) * 0.4,
            vx: ph.vx * 0.25 + (Math.random() - 0.5) * 1.5,
            vy: 0.5 + Math.random() * 1.2,
            vz: ph.vz * 0.25 + (Math.random() - 0.5) * 1.5,
            life: 1.8 + Math.random() * 1.6,
            size: 0.9,
            sizeEnd: 5.5 + Math.random() * 2,
            r: gray,
            g: gray,
            b: gray * 1.02,
            alpha: 0.32 * Math.min(1, intensity + 0.3),
            drag: 1.4,
            fadeIn: 0.08,
          });
        }
      }
      // dust and gravel off the tarmac
      if (!paved && speed > 3 && ph.grounded) {
        const gravel = surf === 3;
        const n = this._count(`d${car.id}${k}`, (gravel ? 30 : 18) * smoothstep(3, 30, speed), dt);
        for (let i = 0; i < n; i++) {
          this.smoke.emit({
            x: wx,
            y: wy + 0.2,
            z: wz,
            vx: -vDirX * speed * 0.15 + (Math.random() - 0.5) * 2,
            vy: 0.8 + Math.random() * 1.5,
            vz: -vDirZ * speed * 0.15 + (Math.random() - 0.5) * 2,
            life: 1.2 + Math.random() * 1.2,
            size: 0.8,
            sizeEnd: 4.5,
            r: gravel ? 0.62 : 0.45,
            g: gravel ? 0.54 : 0.42,
            b: gravel ? 0.42 : 0.3,
            alpha: gravel ? 0.45 : 0.3,
            drag: 1.8,
            gravity: -0.1,
          });
        }
      }
    }

    // nitro flames / backfire pops at the exhaust tips
    const flames = ph.nitroActive;
    let pop = 0;
    for (const e of car.frameEvents) if (e.type === 'upshift' && ph.throttle > 0.7) pop = 1;
    if (flames || pop) {
      for (const x of [-0.13, 0.13]) {
        car.localToWorld(x, 0.36, -2.52, _p);
        const n = flames ? this._count(`n${car.id}${x}`, 90, dt) + 1 : 5;
        for (let i = 0; i < n; i++) {
          const back = 6 + Math.random() * 6;
          const blue = flames ? 1 : 0;
          this.glow.emit({
            x: _p.x,
            y: _p.y,
            z: _p.z,
            vx: -fwdX * back + ph.vx * 0.85,
            vy: (Math.random() - 0.3) * 0.6,
            vz: -fwdZ * back + ph.vz * 0.85,
            life: 0.06 + Math.random() * 0.08,
            size: 0.45 + Math.random() * 0.25,
            sizeEnd: 0.15,
            r: blue ? 1.4 : 3.2,
            g: blue ? 1.6 : 1.4,
            b: blue ? 4.2 : 0.35,
            alpha: 0.9,
            drag: 2,
            fadeIn: 0.01,
          });
        }
      }
    }

    for (const hit of car.impacts) this.impact(hit);
    if (car.frameEvents.some((e) => e.type === 'land')) {
      for (let i = 0; i < 10; i++) {
        this.smoke.emit({
          x: ph.x + (Math.random() - 0.5) * 3,
          y: ph.y + 0.2,
          z: ph.z + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * 3,
          vy: 0.5,
          vz: (Math.random() - 0.5) * 3,
          life: 1.2,
          size: 1.5,
          sizeEnd: 4,
          r: 0.6,
          g: 0.58,
          b: 0.55,
          alpha: 0.25,
          drag: 2,
        });
      }
    }
  }
}
