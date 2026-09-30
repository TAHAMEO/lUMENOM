// A car in the world: physics + visual model + its relationship to the track
// (projection, lap progress) and collision responses against barriers and
// other cars.

import * as THREE from 'three';
import { CarPhysics } from './CarPhysics.js';
import { CarModel, CG_OFFSET } from './CarModel.js';
import { clamp, damp, springStep } from '../core/math.js';

const FRONT_EXTENT = 2.21;
const REAR_EXTENT = 2.43;
const HALF_WIDTH = 0.99;
const CIRCLES = [
  [1.3, 1.0],
  [0.0, 1.02],
  [-1.45, 1.02],
];

const _v3 = new THREE.Vector3();

export class Car {
  constructor({ track, id, name, code, color, rim, caliper, wing, plate, isPlayer = false, spec = {}, skill = 1, headless = false }) {
    this.track = track;
    this.id = id;
    this.name = name;
    this.code = code;
    this.color = color;
    this.isPlayer = isPlayer;
    this.skill = skill;
    this.physics = new CarPhysics(spec);
    this.model = headless ? null : new CarModel({ color, rim, caliper, wing, plate, ownWheels: false });
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.hint = 0;
    this.proj = {};
    this._gp = {};
    const self = this;
    this.env = {
      ground(x, z, out) {
        const p = track.project(x, z, self.hint, self._gp);
        out.h = track.heightAt(p);
        out.surface = track.surfaceAt(p);
        return out;
      },
    };
    // suspension springs for body motion (visual)
    this.susp = {
      pitch: { value: 0, velocity: 0 },
      roll: { value: 0, velocity: 0 },
      heave: { value: 0, velocity: 0 },
    };
    this.impacts = [];
    this.frameEvents = [];
    this.scrape = 0;
    this.resetRace();
  }

  resetRace() {
    this.lap = 0;
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.lastLap = null;
    this.nextCheckpoint = 1;
    this.progress = 0;
    this.finished = false;
    this.finishTime = null;
    this.position = 1;
    this.wrongWayTimer = 0;
    this.lastDistance = 0;
    this.started = false;
  }

  placeAt(slot) {
    this.hint = slot.index;
    this.gridLateral = slot.lateral;
    this.physics.reset(slot.x, slot.y, slot.z, slot.yaw);
    this.track.project(slot.x, slot.z, slot.index, this.proj);
    this.lastDistance = this.proj.distance;
    for (const s of Object.values(this.susp)) {
      s.value = 0;
      s.velocity = 0;
    }
    this.syncVisual(0);
  }

  /** Put the car back on the racing surface at its current track position. */
  resetToTrack() {
    const t = this.track;
    this.gridLateral = null;
    const i = (this.proj.index + 2) % t.n;
    const lateral = clamp(this.proj.lateral, -t.halfWidth + 2, t.halfWidth - 2);
    const p = t.pointAt(i, lateral);
    this.physics.reset(p.x, p.y + 0.05, p.z, t.heading[i]);
    this.physics.nitro = Math.max(this.physics.nitro, 0.2);
    this.hint = i;
  }

  step(dt) {
    this.physics.step(dt, this.input, this.env);
    const ph = this.physics;
    for (const e of ph.events) this.frameEvents.push(e);
    const p = this.track.project(ph.x, ph.z, this.hint, this.proj);
    this.hint = p.nearest;
    this.collideBarriers();
  }

  collideBarriers() {
    const ph = this.physics;
    const p = this.proj;
    const sn = Math.sin(ph.yaw);
    const cs = Math.cos(ph.yaw);
    let deepL = 0;
    let deepR = 0;
    let rL = null;
    let rR = null;
    const pts = [
      [HALF_WIDTH, FRONT_EXTENT - 0.25],
      [-HALF_WIDTH, FRONT_EXTENT - 0.25],
      [HALF_WIDTH, -REAR_EXTENT + 0.3],
      [-HALF_WIDTH, -REAR_EXTENT + 0.3],
      [0, FRONT_EXTENT],
      [0, -REAR_EXTENT],
      [HALF_WIDTH, 0],
      [-HALF_WIDTH, 0],
    ];
    for (const [lat, lon] of pts) {
      const rx = sn * lon + cs * lat;
      const rz = cs * lon - sn * lat;
      const lateral = p.lateral + rx * p.lx + rz * p.lz;
      const penL = lateral - p.barrierL;
      const penR = -p.barrierR - lateral;
      if (penL > deepL) {
        deepL = penL;
        rL = [rx, rz];
      }
      if (penR > deepR) {
        deepR = penR;
        rR = [rx, rz];
      }
    }
    this.scrape = Math.max(0, this.scrape - 0.1);
    if (rL) this._wallImpulse(rL, -p.lx, -p.lz, deepL);
    if (rR) this._wallImpulse(rR, p.lx, p.lz, deepR);
  }

  _wallImpulse(r, nx, nz, pen) {
    const ph = this.physics;
    const m = ph.spec.mass;
    const I = ph.spec.inertia;
    ph.x += nx * pen;
    ph.z += nz * pen;
    const [rx, rz] = r;
    const vpx = ph.vx + ph.yawRate * rz;
    const vpz = ph.vz - ph.yawRate * rx;
    const vn = vpx * nx + vpz * nz;
    if (vn >= 0) return;
    const e = 0.18;
    const rn = rz * nx - rx * nz;
    const j = (-(1 + e) * vn) / (1 / m + (rn * rn) / I);
    ph.vx += (j * nx) / m;
    ph.vz += (j * nz) / m;
    ph.yawRate += (rn * j) / I;
    // wall friction along the tangent
    const tx = -nz;
    const tz = nx;
    const vt = vpx * tx + vpz * tz;
    const rt = rz * tx - rx * tz;
    const jtMax = Math.abs(vt) / (1 / m + (rt * rt) / I);
    const jt = -Math.sign(vt) * Math.min(jtMax, 0.35 * j);
    ph.vx += (jt * tx) / m;
    ph.vz += (jt * tz) / m;
    ph.yawRate += (rt * jt) / I;
    const speed = -vn;
    this.scrape = Math.min(1, this.scrape + 0.35);
    if (speed > 1.5) {
      this.impacts.push({
        strength: Math.min(1, speed / 18),
        x: ph.x + rx,
        y: ph.y + 0.45,
        z: ph.z + rz,
        nx,
        nz,
        kind: 'wall',
      });
    }
  }

  /** Circle-based car-vs-car collision; resolves the deepest contact. */
  static collide(a, b) {
    const pa = a.physics;
    const pb = b.physics;
    const dx0 = pb.x - pa.x;
    const dz0 = pb.z - pa.z;
    if (dx0 * dx0 + dz0 * dz0 > 36) return;
    const sa = Math.sin(pa.yaw);
    const ca = Math.cos(pa.yaw);
    const sb = Math.sin(pb.yaw);
    const cb = Math.cos(pb.yaw);
    let best = null;
    for (const [la, ra] of CIRCLES) {
      const ax = pa.x + sa * la;
      const az = pa.z + ca * la;
      for (const [lb, rb] of CIRCLES) {
        const bx = pb.x + sb * lb;
        const bz = pb.z + cb * lb;
        const dx = bx - ax;
        const dz = bz - az;
        const d = Math.hypot(dx, dz);
        const pen = ra + rb - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), nz: dz / (d || 1), cx: (ax + bx) / 2, cz: (az + bz) / 2 };
      }
    }
    if (!best) return;
    const { pen, nx, nz, cx, cz } = best;
    const ma = pa.spec.mass;
    const mb = pb.spec.mass;
    const Ia = pa.spec.inertia;
    const Ib = pb.spec.inertia;
    const wa = mb / (ma + mb);
    pa.x -= nx * pen * wa;
    pa.z -= nz * pen * wa;
    pb.x += nx * pen * (1 - wa);
    pb.z += nz * pen * (1 - wa);
    const rax = cx - pa.x;
    const raz = cz - pa.z;
    const rbx = cx - pb.x;
    const rbz = cz - pb.z;
    const vax = pa.vx + pa.yawRate * raz;
    const vaz = pa.vz - pa.yawRate * rax;
    const vbx = pb.vx + pb.yawRate * rbz;
    const vbz = pb.vz - pb.yawRate * rbx;
    const vn = (vbx - vax) * nx + (vbz - vaz) * nz;
    if (vn >= 0) return;
    const e = 0.2;
    const ran = raz * nx - rax * nz;
    const rbn = rbz * nx - rbx * nz;
    const j = (-(1 + e) * vn) / (1 / ma + 1 / mb + (ran * ran) / Ia + (rbn * rbn) / Ib);
    // Only part of the yaw impulse is applied: side-by-side rubbing should
    // nudge cars apart rather than spin them (arcade-friendly contact).
    const spin = 0.45;
    pa.vx -= (j * nx) / ma;
    pa.vz -= (j * nz) / ma;
    pa.yawRate -= ((ran * j) / Ia) * spin;
    pb.vx += (j * nx) / mb;
    pb.vz += (j * nz) / mb;
    pb.yawRate += ((rbn * j) / Ib) * spin;
    const strength = Math.min(1, -vn / 14);
    if (-vn > 1) {
      const hit = { strength, x: cx, y: (pa.y + pb.y) / 2 + 0.5, z: cz, nx, nz, kind: 'car' };
      a.impacts.push(hit);
      b.impacts.push({ ...hit, nx: -nx, nz: -nz });
    }
  }

  /** Update the visual model from physics (called once per rendered frame). */
  syncVisual(dt) {
    if (!this.model) return;
    const ph = this.physics;
    const root = this.model.root;
    root.position.set(ph.x, ph.y, ph.z);
    root.rotation.set(-ph.groundPitch, ph.yaw, ph.groundRoll, 'YXZ');

    // Body motion from accelerations (springy), plus bumps from curbs/grass.
    const bump = ph.bump * Math.min(1, ph.speed / 15);
    const t = performance.now() * 0.001;
    const noise = bump * 0.012 * (Math.sin(t * 37 + this.id) + Math.sin(t * 23.3 + this.id * 2)) * 0.5;
    const targetPitch = clamp(-ph.accelLong * 0.0042, -0.07, 0.07);
    const targetRoll = clamp(ph.accelLat * 0.0048, -0.075, 0.075);
    const targetHeave = -Math.min(0.06, Math.abs(ph.accelLat) * 0.0012) + noise - ph.landing * 0.08;
    if (dt > 0) {
      springStep(this.susp.pitch, targetPitch, 9, dt);
      springStep(this.susp.roll, targetRoll, 9, dt);
      springStep(this.susp.heave, targetHeave, 12, dt);
      ph.landing = damp(ph.landing, 0, 6, dt);
    }
    const r = ph.spec.wheelRadius;
    const spin = [ph.wheelAngleF, ph.wheelAngleF, ph.wheelAngleR, ph.wheelAngleR];
    // per-wheel offsets relative to the ground plane (curbs lift individual wheels)
    const hC = ph.groundH;
    const pitch = ph.groundPitch;
    const roll = ph.groundRoll;
    const offs = this._offs || (this._offs = [0, 0, 0, 0]);
    const s = ph.spec;
    const lon = [s.cgToFront, s.cgToFront, -s.cgToRear, -s.cgToRear];
    const lat = [s.halfTrack, -s.halfTrack, s.halfTrack, -s.halfTrack];
    for (let k = 0; k < 4; k++) {
      const plane = hC + Math.tan(pitch) * lon[k] + Math.tan(roll) * lat[k];
      offs[k] = clamp(ph.wheelH[k] - plane, -0.06, 0.08) + (ph.grounded ? 0 : -0.05);
    }
    this.model.update({
      steer: ph.steerAngle,
      wheelSpin: spin,
      wheelOffset: offs,
      pitch: this.susp.pitch.value,
      roll: this.susp.roll.value,
      heave: this.susp.heave.value + (ph.grounded ? 0 : 0.03),
    });
    this.model.setLights({ brake: ph.brake > 0.1 && !ph.reverse, reverse: ph.reverse, headlights: this.headlights });
  }

  /** World position of a local point (x left, y up, z forward from the CG). */
  localToWorld(x, y, z, out = _v3) {
    out.set(x, y, z);
    return this.model.root.localToWorld(out);
  }
}
