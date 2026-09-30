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
    this.aimLat = null;
    this.stuckTimer = 0;
    this.prevAngle = 0;
    this.nitroCooldown = 2 + this.rand() * 4;
    this.mistakeTimer = 5 + this.rand() * 10;
    this.mistake = 0;
    this.raceTime = 0;
    // reaction to lights-out: better drivers react faster
    this.launchDelay = 0.12 + this.rand() * 0.25 + (1 - skill) * 1.5;
  }

  update(dt, cars, player, racing) {
    const car = this.car;
    const ph = car.physics;
    const t = this.track;
    const input = car.input;
    if (racing) this.raceTime += dt;
    else this.raceTime = 0;
    if (racing && this.raceTime < this.launchDelay) {
      input.throttle = 0;
      input.brake = 1;
      input.steer = 0;
      return;
    }
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

    // --- traffic. Cars overlapping us are hard lane limits (we leave a car's
    // width of room); a slower car ahead is passed on a side with space,
    // otherwise we follow it. The car on the outside of a corner yields.
    const lapLen = t.length;
    const hw = t.halfWidth;
    const myLat = car.proj.lateral;
    let ahead = null;
    let minLat = -Infinity;
    let maxLat = Infinity;
    let company = false;
    let outsideOf = false;
    const leadK = t.curvature[(i + Math.round((10 + speed * 0.6) / t.ds)) % n];
    for (const o of cars) {
      if (o === car) continue;
      let gap = o.proj.distance - car.proj.distance;
      if (gap < -lapLen / 2) gap += lapLen;
      if (gap > lapLen / 2) gap -= lapLen;
      const oLat = o.proj.lateral;
      const dLat = oLat - myLat;
      if (Math.abs(gap) < 30) company = true;
      // lane limits from cars overlapping us or just ahead on either side
      if (gap > -6.5 && gap < 11 && Math.abs(dLat) > 0.6) {
        if (dLat >= 0) maxLat = Math.min(maxLat, oLat - 2.65);
        else minLat = Math.max(minLat, oLat + 2.65);
      }
      if (Math.abs(gap) < 6.5) {
        if (Math.abs(leadK) > 1 / 160 && Math.sign(leadK) * dLat > 0.5) outsideOf = true;
      }
      if (gap > 0 && gap < 45 && Math.abs(dLat) < 2.4 && (!ahead || gap < ahead.gap)) ahead = { car: o, gap, dLat };
    }
    let passTarget = null;
    let passWeight = 0;
    let brakeForTraffic = 0;
    if (ahead) {
      const closing = speed - ahead.car.physics.speed;
      const oLat = ahead.car.proj.lateral;
      const roomLeft = Math.min(hw - 1.1, maxLat) - oLat;
      const roomRight = oLat - Math.max(-(hw - 1.1), minLat);
      let side = roomLeft > roomRight ? 1 : -1;
      if (Math.abs(roomLeft - roomRight) < 1) side = ahead.dLat > 0 ? -1 : 1; // keep the side we're already on
      const room = side > 0 ? roomLeft : roomRight;
      const launchPhase = ph.distance < 260;
      if (closing > 0.3 && room > 2.6 && !launchPhase) {
        passTarget = oLat + side * 2.8;
        passWeight = 1 - smoothstep(12, 40, ahead.gap);
      }
      if (closing > 0.4) {
        const ttc = (ahead.gap - 5.5) / closing;
        const lateralSep = passTarget == null ? Math.abs(ahead.dLat) : Math.abs(passTarget - myLat);
        if (ttc < 1.8 && (passTarget == null || lateralSep > 1.4)) brakeForTraffic = clamp((1.8 - ttc) * 0.6, 0, 1);
      }
    }
    const squeezed = minLat > maxLat;
    this.passTarget = passTarget;
    this.passWeight = passWeight;
    this.minLat = minLat;
    this.maxLat = maxLat;

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
    let wanted = lineLat + this.mistake;
    wanted = squeezed ? (this.minLat + this.maxLat) / 2 : clamp(wanted, this.minLat, this.maxLat);
    // limit how fast the aim point slides sideways (keeps steering smooth at speed)
    if (this.aimLat == null || Math.abs(this.aimLat - car.proj.lateral) > 7) this.aimLat = clamp(car.proj.lateral, -lim, lim);
    const aimRate = (4 + speed * 0.05) * dt;
    this.aimLat += clamp(wanted - this.aimLat, -aimRate, aimRate);
    const lateral = clamp(this.aimLat, -lim, lim);
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
    // leave margin in company: brake a touch earlier, yield on the outside, lift when squeezed
    if (company && target < speed - 2) target *= ph.distance < 1200 ? 0.93 : 0.97; // extra care into turn 1 on lap one
    if (outsideOf) target *= 0.95;
    if (squeezed) target = Math.min(target, speed * 0.92);
    // pushed off the racing line in a corner → tighter effective radius → slower
    const offLine = Math.abs((this.aimLat ?? 0) - t.lineOffset[lead]);
    if (offLine > 1.2 && Math.abs(leadK) > 1 / 300) target *= 1 - Math.min(0.14, 0.03 * (offLine - 1.2));
    if (ph.surfaceFront >= 2 || ph.surfaceRear >= 2) target = Math.min(target, 30);
    const err = target - speed;
    let throttle = clamp(err * 0.45 + 0.35, 0, 1);
    let brake = err < -1.2 ? clamp(-err * 0.18, 0, 1) : 0;
    if (brake > 0) throttle = 0;
    brake = Math.max(brake, brakeForTraffic);
    if (brakeForTraffic > 0) throttle *= 0.4;
    // traction control and slide recovery: ease off the pedals so the tyres bite again
    if (ph.wheelspin > 0.25) throttle *= 0.6;
    const slide = Math.abs(ph.beta);
    if (slide > 0.12) {
      throttle *= 0.35;
      brake *= 0.4;
    }
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
