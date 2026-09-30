// AI driver: pure-pursuit steering along the track's minimum-curvature racing
// line, a speed profile matched to the car's real grip/braking, overtaking
// offsets around slower cars, traction control, nitro on straights, mild
// rubber-banding and self-recovery when stuck.

import { clamp, lerp, mulberry32, smoothstep } from '../core/math.js';

/** Speed-profile inputs matched to CarPhysics' measured capabilities. */
export const AI_CAPABILITY = {
  grip: (v) => 15.2 + 0.00068 * v * v,
  accel: (v) => Math.max(0.4, Math.min(9.2, 360000 / (1320 * Math.max(v, 5))) - (0.62 * v * v) / 1320),
  brake: (v) => 11.5 + 0.0005 * v * v,
  vMax: 82,
};

export class AIDriver {
  constructor(car, track, { skill = 0.95, seed = 1 } = {}) {
    this.car = car;
    this.track = track;
    this.baseSkill = skill;
    this.skill = skill;
    this.rand = mulberry32(seed);
    this.personalOffset = (this.rand() - 0.5) * 1.2;
    this.avoid = 0;
    this.avoidTarget = 0;
    this.stuckTimer = 0;
    this.prevAngle = 0;
    this.nitroCooldown = 2 + this.rand() * 4;
    this.mistakeTimer = 5 + this.rand() * 10;
    this.mistake = 0;
  }

  update(dt, cars, player, racing) {
    const car = this.car;
    const ph = car.physics;
    const t = this.track;
    const input = car.input;
    if (!racing) {
      input.throttle = 0;
      input.brake = 1;
      input.steer = 0;
      input.nitro = false;
      input.handbrake = false;
      return;
    }
    const n = t.n;
    const speed = ph.speed;
    const i = car.proj.index;
    const profile = t.speedProfile;

    // --- traffic: cars alongside push us sideways; a slower car ahead is
    // passed on the side with room, otherwise we follow it.
    const lapLen = t.length;
    const hw = t.halfWidth;
    const myLat = car.proj.lateral;
    let ahead = null;
    let repel = 0;
    for (const o of cars) {
      if (o === car) continue;
      let gap = o.proj.distance - car.proj.distance;
      if (gap < -lapLen / 2) gap += lapLen;
      if (gap > lapLen / 2) gap -= lapLen;
      const dLat = o.proj.lateral - myLat;
      if (Math.abs(gap) < 5.8 && Math.abs(dLat) < 3.1) repel -= Math.sign(dLat || 1) * (3.1 - Math.abs(dLat)) * 1.3;
      if (gap > 0 && gap < 45 && Math.abs(dLat) < 2.5 && (!ahead || gap < ahead.gap)) ahead = { car: o, gap, dLat };
    }
    let passTarget = null;
    let passWeight = 0;
    let brakeForTraffic = 0;
    if (ahead) {
      const closing = speed - ahead.car.physics.speed;
      const oLat = ahead.car.proj.lateral;
      const roomLeft = hw - 1.1 - oLat;
      const roomRight = oLat + hw - 1.1;
      let side = roomLeft > roomRight ? 1 : -1;
      if (Math.abs(roomLeft - roomRight) < 1) side = ahead.dLat > 0 ? -1 : 1; // keep the side we're already on
      const room = side > 0 ? roomLeft : roomRight;
      if (closing > 0.3 && room > 2.6) {
        passTarget = oLat + side * 2.9;
        passWeight = 1 - smoothstep(14, 40, ahead.gap);
      }
      // time-to-contact braking when we can't get alongside in time
      const lateralSep = passTarget == null ? Math.abs(ahead.dLat) : Math.abs(passTarget - myLat);
      if (closing > 0.5) {
        const ttc = (ahead.gap - 5.5) / closing;
        const blocked = passTarget == null || lateralSep > 1.6;
        if (ttc < 1.6 && blocked) brakeForTraffic = clamp((1.6 - ttc) * 0.7, 0, 1);
      }
    }
    const repelTarget = clamp(repel, -3.2, 3.2);
    this.avoid += (repelTarget - this.avoid) * (1 - Math.exp(-dt * 4));
    this.passTarget = passTarget;
    this.passWeight = passWeight;

    // --- mistakes: occasional small wobble for lower-skill drivers
    this.mistakeTimer -= dt;
    if (this.mistakeTimer < 0) {
      this.mistakeTimer = 6 + this.rand() * 14;
      if (this.rand() > this.baseSkill) this.mistake = (this.rand() - 0.5) * 2.2;
    }
    this.mistake *= Math.exp(-dt * 1.5);

    // --- steering: pure pursuit on an offset racing line
    const look = 7 + speed * 0.5;
    const j = (i + Math.round(look / t.ds)) % n;
    const lim = t.halfWidth - 1.2;
    let lineLat = t.lineOffset[j] + this.personalOffset * 0.5;
    // hold the grid lane off the start, merging onto the racing line later
    const launched = ph.distance;
    if (launched < 450 && car.gridLateral != null) lineLat = lerp(car.gridLateral, lineLat, smoothstep(220, 450, launched));
    if (this.passTarget != null) lineLat = lerp(lineLat, this.passTarget, this.passWeight);
    const lateral = clamp(lineLat + this.avoid + this.mistake, -lim, lim);
    const tx = t.px[j] + t.lx[j] * lateral;
    const tz = t.pz[j] + t.lz[j] * lateral;
    const dx = tx - ph.x;
    const dz = tz - ph.z;
    const sn = Math.sin(ph.yaw);
    const cs = Math.cos(ph.yaw);
    const fwd = dx * sn + dz * cs;
    const left = dx * cs - dz * sn;
    const alpha = Math.atan2(left, Math.max(0.1, fwd));
    const Ld = Math.hypot(dx, dz);
    const L = ph.spec.cgToFront + ph.spec.cgToRear;
    const deltaReq = Math.atan((2 * L * Math.sin(alpha)) / Math.max(Ld, 1));
    const vv = Math.max(speed, 1);
    const lock = Math.min(ph.spec.maxSteer, (L * ph.spec.steerLatAccel) / (vv * vv) + ph.spec.steerSlipAllowance);
    const dAlpha = (alpha - this.prevAngle) / Math.max(dt, 1e-3);
    this.prevAngle = alpha;
    input.steer = clamp(deltaReq / lock + dAlpha * 0.04, -1, 1);
    input.analogSteer = true;

    // --- speed: follow the profile a little ahead, scaled by skill
    const lead = (i + Math.round((6 + speed * 0.35) / t.ds)) % n;
    let target = Math.min(profile[lead], profile[(lead + 4) % n]) * this.skill;
    if (ph.surfaceFront >= 2 || ph.surfaceRear >= 2) target = Math.min(target, 30);
    const err = target - speed;
    let throttle = clamp(err * 0.45 + 0.35, 0, 1);
    let brake = err < -1.2 ? clamp(-err * 0.18, 0, 1) : 0;
    if (brake > 0) throttle = 0;
    brake = Math.max(brake, brakeForTraffic);
    if (brakeForTraffic > 0) throttle *= 0.4;
    // traction control
    if (ph.wheelspin > 0.25) throttle *= 0.6;
    if (Math.abs(ph.beta) > 0.25) throttle *= 0.5;
    input.throttle = throttle;
    input.brake = brake;
    input.handbrake = false;

    // --- nitro on long straights when it's safe
    this.nitroCooldown -= dt;
    let straight = true;
    for (let k = 1; k < 60; k += 6) if (profile[(i + k) % n] < 60) straight = false;
    const wantNitro = straight && speed > 35 && ph.nitro > 0.25 && this.nitroCooldown < 0 && throttle > 0.9;
    if (wantNitro && !input.nitro) input.nitro = true;
    if (input.nitro && (!straight || ph.nitro < 0.05)) {
      input.nitro = false;
      this.nitroCooldown = 4 + this.rand() * 6;
    }

    // --- rubber-banding relative to the player
    if (player && player !== car && !player.finished) {
      let gap = car.progress - player.progress;
      const k = smoothstep(80, 400, Math.abs(gap));
      const adj = gap > 0 ? lerp(1, 0.94, k) : lerp(1, 1.045, k);
      this.skill += (this.baseSkill * adj - this.skill) * (1 - Math.exp(-dt * 0.5));
    }

    // --- recovery when stuck or facing the wrong way
    const heading = t.heading[i];
    let dh = Math.abs(((ph.yaw - heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (speed < 2.5 || dh > 1.9) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    if (this.stuckTimer > 3.5) {
      car.resetToTrack();
      this.stuckTimer = 0;
    }
  }
}
