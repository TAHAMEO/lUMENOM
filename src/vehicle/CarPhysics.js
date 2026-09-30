// Vehicle dynamics: a planar "bicycle" model with a Pacejka-style lateral tyre
// curve, friction circle on the driven axle (so throttle can break the rear
// loose), longitudinal weight transfer, aero drag/downforce, a torque-curve
// engine with an automatic 6-speed gearbox, handbrake, nitro, surface grip and
// simple vertical dynamics (crests can make the car go light or airborne).
//
// Frame: world X/Z ground plane, Y up. yaw ψ: forward = (sin ψ, 0, cos ψ);
// positive yaw / steer / lateral = LEFT. No three.js dependency (unit-testable).

import { approach, clamp, lerp, smoothstep } from '../core/math.js';

export const SURFACES = {
  0: { name: 'asphalt', grip: 1.0, rolling: 1.0, bump: 0.0 },
  1: { name: 'curb', grip: 0.94, rolling: 1.4, bump: 0.55 },
  2: { name: 'grass', grip: 0.56, rolling: 6.5, bump: 0.3 },
  3: { name: 'gravel', grip: 0.46, rolling: 11, bump: 0.45 },
};

export const DEFAULT_SPEC = {
  mass: 1320,
  inertia: 2350,
  cgToFront: 1.25,
  cgToRear: 1.45,
  cgHeight: 0.47,
  halfTrack: 0.84,
  wheelRadius: 0.345,
  // tyres: F = μ·Fz·sin(C·atan(B·α))
  mu: 1.58,
  rearGrip: 1.12, // wider rear tyres: a slightly understeering, stable balance
  tireBFront: 11,
  tireBRear: 12.5,
  tireC: 1.4,
  yawDamping: 1.1,
  driftGripLoss: 0.2,
  loadSensitivity: 0.08,
  // aero
  drag: 0.62,
  dragLateral: 3.0,
  downforce: 1.05,
  downforceFront: 0.44,
  rollResist: 16,
  // engine / gearbox
  idleRpm: 1050,
  redline: 8200,
  revLimit: 8450,
  torqueCurve: [
    [1000, 360],
    [2000, 440],
    [3000, 520],
    [4000, 590],
    [5000, 640],
    [6000, 660],
    [7000, 640],
    [8000, 580],
    [8600, 500],
  ],
  gears: [3.2, 2.25, 1.72, 1.38, 1.13, 0.94],
  reverseRatio: 3.1,
  finalDrive: 3.55,
  drivetrainEfficiency: 0.88,
  shiftUpRpm: 7900,
  shiftDownRpm: 3700,
  shiftTime: 0.14,
  engineBraking: 1400,
  // brakes
  brakeForce: 17500,
  brakeBias: 0.68,
  abs: 0.93,
  ebd: 0.55,
  handbrakeForce: 4400,
  handbrakeGrip: 0.48,
  // steering
  maxSteer: 0.6,
  steerLatAccel: 21.5,
  steerSlipAllowance: 0.055,
  steerRate: 3.4,
  steerReturnRate: 6.0,
  countersteer: 0.5,
  // nitro
  nitroForce: 6500,
  nitroBurn: 0.2, // tank fraction per second
  nitroRegen: 0.012,
  // top-speed governor (keeps the sim sane off the charts)
  maxSpeed: 105,
};

export class CarPhysics {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    this.events = [];
    this.reset(0, 0, 0, 0);
  }

  reset(x, y, z, yaw) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = yaw;
    this.yawRate = 0;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this.shiftTimer = 0;
    this.reverse = false;
    this.accelLong = 0;
    this.accelLat = 0;
    this.slipFront = 0;
    this.slipRear = 0;
    this.beta = 0;
    this.wheelspin = 0;
    this.lockup = 0;
    this.nitro = 1;
    this.nitroActive = false;
    this.grounded = true;
    this.airTime = 0;
    this.groundH = y;
    this.groundVy = 0;
    this.groundVyPrev = 0;
    this.loadFactor = 1;
    this.landing = 0;
    this.wheelAngleF = 0;
    this.wheelAngleR = 0;
    this.wheelOmegaR = 0;
    this.surfaceFront = 0;
    this.surfaceRear = 0;
    this.bump = 0;
    this.wheelH = [y, y, y, y];
    this.wheelSurf = [0, 0, 0, 0];
    this.groundPitch = 0;
    this.groundRoll = 0;
    this.normalX = 0;
    this.normalY = 1;
    this.normalZ = 0;
    this.launchRpm = 0;
    this.drift = 0;
    this.dragScale = 1;
    this.events.length = 0;
    this.distance = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  get lateralSpeed() {
    return this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
  }

  torqueAt(rpm) {
    const c = this.spec.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return lerp(c[i - 1][1], c[i][1], t);
      }
    }
    return c[c.length - 1][1];
  }

  /** Wheel contact points in world space (FL, FR, RL, RR). */
  wheelPositions(out) {
    const s = this.spec;
    const sn = Math.sin(this.yaw);
    const cs = Math.cos(this.yaw);
    const defs = [
      [s.halfTrack, s.cgToFront],
      [-s.halfTrack, s.cgToFront],
      [s.halfTrack, -s.cgToRear],
      [-s.halfTrack, -s.cgToRear],
    ];
    for (let k = 0; k < 4; k++) {
      const [lat, lon] = defs[k];
      // forward (sn, cs), left (cs, -sn)
      out[k][0] = this.x + sn * lon + cs * lat;
      out[k][1] = this.z + cs * lon - sn * lat;
    }
    return out;
  }

  /**
   * Advance the simulation.
   * input: { throttle, brake, steer (+left), handbrake, nitro } in [0,1] / [-1,1]
   * env.ground(x, z, out) → fills out.h (height), out.surface (SURFACES key); returns out.
   */
  step(dt, input, env) {
    const s = this.spec;
    const g = 9.81;
    this.events.length = 0;

    // ------------------------------------------------------------------ ground
    const wp = this._wp || (this._wp = [[0, 0], [0, 0], [0, 0], [0, 0]]);
    const gq = this._gq || (this._gq = { h: 0, surface: 0 });
    this.wheelPositions(wp);
    for (let k = 0; k < 4; k++) {
      env.ground(wp[k][0], wp[k][1], gq);
      this.wheelH[k] = gq.h;
      this.wheelSurf[k] = gq.surface;
    }
    const hF = (this.wheelH[0] + this.wheelH[1]) * 0.5;
    const hR = (this.wheelH[2] + this.wheelH[3]) * 0.5;
    const hL = (this.wheelH[0] + this.wheelH[2]) * 0.5;
    const hRt = (this.wheelH[1] + this.wheelH[3]) * 0.5;
    const L = s.cgToFront + s.cgToRear;
    const groundPitch = Math.atan2(hF - hR, L); // + nose up
    const groundRoll = Math.atan2(hL - hRt, 2 * s.halfTrack); // + left side up
    this.groundPitch = groundPitch;
    this.groundRoll = groundRoll;
    const hC = hR + (hF - hR) * (s.cgToRear / L);

    const sn = Math.sin(this.yaw);
    const cs = Math.cos(this.yaw);
    // ground normal from pitch/roll (local → world)
    const tp = Math.tan(groundPitch);
    const tr = Math.tan(groundRoll);
    // dh/dforward = tp, dh/dleft = tr → world gradient
    const gx = tp * sn + tr * cs;
    const gz = tp * cs - tr * sn;
    const inv = 1 / Math.hypot(gx, 1, gz);
    this.normalX = -gx * inv;
    this.normalY = inv;
    this.normalZ = -gz * inv;

    const sf = SURFACES[this.wheelSurf[0]];
    const sf2 = SURFACES[this.wheelSurf[1]];
    const sr = SURFACES[this.wheelSurf[2]];
    const sr2 = SURFACES[this.wheelSurf[3]];
    const gripF = (sf.grip + sf2.grip) * 0.5;
    const gripR = (sr.grip + sr2.grip) * 0.5;
    const rolling = (sf.rolling + sf2.rolling + sr.rolling + sr2.rolling) * 0.25;
    this.bump = Math.max(sf.bump, sf2.bump, sr.bump, sr2.bump);
    this.surfaceFront = Math.max(this.wheelSurf[0], this.wheelSurf[1]);
    this.surfaceRear = Math.max(this.wheelSurf[2], this.wheelSurf[3]);

    // --------------------------------------------------------------- vertical
    const groundVy = (hC - this.groundH) / dt;
    this.groundH = hC;
    const wasGrounded = this.grounded;
    this.vy -= g * dt;
    this.y += this.vy * dt;
    // Snap only on actual penetration: any tolerance here would re-glue the car
    // to a crest that falls away faster than gravity and it could never take off.
    if (this.y <= hC) {
      if (!wasGrounded) {
        const impact = groundVy - this.vy;
        if (impact > 1.2) {
          this.landing = Math.min(1, impact / 8);
          this.events.push({ type: 'land', strength: this.landing });
        }
      }
      this.y = hC;
      this.vy = groundVy;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = this.y - hC < 0.06;
      if (!this.grounded) this.airTime += dt;
    }
    // Load factor from the ground's vertical acceleration (crests unload the tyres).
    const aVert = (groundVy - this.groundVyPrev) / dt;
    this.groundVyPrev = groundVy;
    const lfTarget = this.grounded ? clamp(1 + aVert / g, 0.15, 2.2) : 0;
    this.loadFactor += (lfTarget - this.loadFactor) * (1 - Math.exp(-dt * 18));

    // ------------------------------------------------------------------ inputs
    let vF = this.vx * sn + this.vz * cs;
    let vL = this.vx * cs - this.vz * sn;
    const speed = Math.hypot(this.vx, this.vz);

    const steerTarget = clamp(input.steer || 0, -1, 1);
    if (input.analogSteer) {
      this.steerInput = approach(this.steerInput, steerTarget, 10 * dt);
    } else {
      const growing = Math.abs(steerTarget) > Math.abs(this.steerInput) && Math.sign(steerTarget) === Math.sign(this.steerInput || steerTarget);
      this.steerInput = approach(this.steerInput, steerTarget, (growing ? s.steerRate : s.steerReturnRate) * dt);
    }
    let throttleIn = clamp(input.throttle || 0, 0, 1);
    let brakeIn = clamp(input.brake || 0, 0, 1);
    const handbrake = input.handbrake ? 1 : 0;
    // hold: parked on the grid / in menus — brakes on, clutch out, engine can rev
    const hold = !!input.hold;
    if (hold) {
      this.reverse = false;
      brakeIn = 1;
    }

    // Reverse logic: hold brake at a standstill to reverse; throttle cancels.
    if (!hold && !this.reverse && brakeIn > 0.5 && throttleIn < 0.1 && vF < 0.6) this.reverse = true;
    if (this.reverse && (throttleIn > 0.1 || vF > 1.5)) this.reverse = false;
    let driveIn = throttleIn;
    if (this.reverse) {
      driveIn = brakeIn;
      brakeIn = throttleIn;
    }
    this.throttle = approach(this.throttle, driveIn, 8 * dt);
    this.brake = approach(this.brake, brakeIn, 10 * dt);

    // Steering: lock shrinks with speed so full input ≈ a grip-limited turn
    // (kinematic angle for ~2.2 g plus some tyre slip), plus countersteer assist.
    const vv = Math.max(speed, 1);
    const lock = Math.min(s.maxSteer, (L * s.steerLatAccel) / (vv * vv) + s.steerSlipAllowance);
    const beta = speed > 2 ? Math.atan2(vL, Math.abs(vF)) : 0;
    this.beta = beta;
    const excess = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05);
    const assist = vF > 0 ? clamp(excess * s.countersteer, -0.32, 0.32) * smoothstep(4, 12, speed) : 0;
    this.steerAngle = clamp(this.steerInput * lock + assist, -s.maxSteer, s.maxSteer);
    const delta = this.steerAngle;

    // -------------------------------------------------------------- drivetrain
    const r = s.wheelRadius;
    const rpmPerMs = (60 / (2 * Math.PI * r)) * s.finalDrive;
    let ratio = this.reverse ? s.reverseRatio : s.gears[this.gear - 1];
    const wheelRpm = Math.abs(vF) * rpmPerMs * ratio;
    // clutch slip at launch lets the engine rev above road speed
    const launch = this.gear === 1 || this.reverse ? (1 - smoothstep(4, 12, Math.abs(vF))) : 0;
    const freeRev = s.idleRpm + this.throttle * (5600 - s.idleRpm);
    let rpmTarget = Math.max(s.idleRpm, wheelRpm, launch * freeRev);
    if (!this.grounded) rpmTarget = Math.max(rpmTarget, s.idleRpm + this.throttle * (s.revLimit - s.idleRpm));
    rpmTarget += this.wheelspin * 1400;
    this.rpm += (rpmTarget - this.rpm) * (1 - Math.exp(-dt * 14));
    this.rpm = Math.min(this.rpm, s.revLimit + 50);

    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
    } else if (!this.reverse) {
      if (this.rpm > s.shiftUpRpm && this.gear < s.gears.length && vF > 1 && this.grounded) {
        this.gear++;
        this.shiftTimer = s.shiftTime;
        this.events.push({ type: 'upshift', gear: this.gear });
      } else if (this.gear > 1) {
        const lowerRpm = Math.abs(vF) * rpmPerMs * s.gears[this.gear - 2];
        const want = this.rpm < s.shiftDownRpm || (this.brake > 0.3 && lowerRpm < s.shiftUpRpm - 1400 && this.rpm < 5200);
        if (want && lowerRpm < s.shiftUpRpm - 600) {
          this.gear--;
          this.shiftTimer = s.shiftTime * 0.7;
          this.events.push({ type: 'downshift', gear: this.gear });
        }
      }
    }
    ratio = this.reverse ? s.reverseRatio : s.gears[this.gear - 1];
    const limiter = this.rpm >= s.revLimit ? 0 : 1;
    const cut = this.shiftTimer > 0 ? 0.15 : 1;
    const torque = this.torqueAt(this.rpm) * this.throttle * limiter * cut;
    let drive = (torque * ratio * s.finalDrive * s.drivetrainEfficiency) / r;
    if (hold) drive = 0;
    if (this.reverse) drive = -Math.min(drive, 5200);
    // engine braking when off throttle
    if (!this.reverse && this.throttle < 0.05 && Math.abs(vF) > 1) {
      drive -= Math.sign(vF) * s.engineBraking * (this.rpm / s.redline);
    }
    // nitro
    const wantNitro = !!input.nitro && this.nitro > 0.01 && throttleIn > 0.2 && !this.reverse && !hold;
    if (wantNitro !== this.nitroActive) this.events.push({ type: wantNitro ? 'nitroOn' : 'nitroOff' });
    this.nitroActive = wantNitro;
    if (wantNitro) {
      drive += s.nitroForce;
      this.nitro = Math.max(0, this.nitro - s.nitroBurn * dt);
    } else {
      this.nitro = Math.min(1, this.nitro + s.nitroRegen * dt);
    }

    // ------------------------------------------------------------------ loads
    const down = s.downforce * vF * vF;
    const mg = s.mass * g * this.normalY;
    const transfer = (s.mass * this.accelLong * s.cgHeight) / L;
    let Wf = (mg * (s.cgToRear / L) + down * s.downforceFront - transfer) * this.loadFactor;
    let Wr = (mg * (s.cgToFront / L) + down * (1 - s.downforceFront) + transfer) * this.loadFactor;
    const Wmin = 0.06 * mg * this.loadFactor;
    Wf = Math.max(Wf, Wmin);
    Wr = Math.max(Wr, Wmin);
    if (!this.grounded) {
      Wf = 0;
      Wr = 0;
    }
    // tyre load sensitivity: grip coefficient falls slightly with load
    const muRef = s.mu;
    const muF = muRef * gripF * (1 - s.loadSensitivity * (Wf / (0.5 * s.mass * g) - 1));
    // Drift state: a handbrake flick or a big slide under power keeps the rear
    // slightly looser so throttle and countersteer can hold the angle.
    const absBeta = Math.abs(beta);
    const enter = (handbrake && speed > 11) || (absBeta > 0.26 && this.throttle > 0.45 && speed > 9);
    if (enter) this.drift = Math.min(1, this.drift + dt * 6);
    else if (absBeta < 0.1 || speed < 6 || this.throttle < 0.15) this.drift = Math.max(0, this.drift - dt * 2.2);
    const muR = muRef * s.rearGrip * (1 - s.driftGripLoss * this.drift) * gripR * (1 - s.loadSensitivity * (Wr / (0.5 * s.mass * g) - 1));

    // ------------------------------------------------------------ slip angles
    const vFa = Math.max(Math.abs(vF), 2.5);
    const dirSign = vF >= 0 ? 1 : -1;
    const alphaF = Math.atan2(vL + this.yawRate * s.cgToFront, vFa) - delta * dirSign;
    const alphaR = Math.atan2(vL - this.yawRate * s.cgToRear, vFa);
    this.slipFront = alphaF;
    this.slipRear = alphaR;

    // ------------------------------------------------------------ tyre forces
    const C = s.tireC;
    let FyF = -muF * Wf * Math.sin(C * Math.atan(s.tireBFront * alphaF));
    let FxF = 0;
    const brakeTotal = this.brake * s.brakeForce;
    // ABS keeps the front below lock-up so it can still steer; EBD caps the
    // rear so the unloaded axle keeps most of its lateral grip under braking.
    const absFront = s.abs * muF * Wf;
    const ebdRear = s.ebd * muR * Wr;
    if (Math.abs(vF) > 0.3) FxF = -Math.sign(vF) * Math.min(brakeTotal * s.brakeBias, absFront);
    // friction circle, front
    const maxF = muF * Wf;
    const totF = Math.hypot(FxF, FyF);
    this.lockup = 0;
    if (totF > maxF && totF > 0) {
      const k = maxF / totF;
      if (Math.abs(FxF) > maxF * 0.9) this.lockup = Math.min(1, (Math.abs(FxF) - maxF * 0.9) / maxF + 0.2);
      FxF *= k;
      FyF *= k;
    }

    const muRe = muR * (handbrake ? s.handbrakeGrip : 1);
    let FyR = -muRe * Wr * Math.sin(C * Math.atan(s.tireBRear * alphaR));
    let FxR = drive;
    if (Math.abs(vF) > 0.3) {
      FxR -= Math.sign(vF) * Math.min(brakeTotal * (1 - s.brakeBias), ebdRear);
      if (handbrake) FxR -= Math.sign(vF) * s.handbrakeForce;
    } else if (this.brake > 0.1 && !this.reverse) {
      // holding the brake at rest
      FxR = Math.abs(FxR) < brakeTotal ? 0 : FxR - Math.sign(FxR) * brakeTotal;
    }
    const maxR = muRe * Wr;
    const totR = Math.hypot(FxR, FyR);
    this.wheelspin = 0;
    if (totR > maxR && totR > 0) {
      if (Math.abs(drive) > 0 && Math.sign(FxR) === Math.sign(drive || 1) && this.throttle > 0.2) {
        this.wheelspin = clamp((Math.abs(FxR) - maxR * 0.85) / maxR, 0, 1);
      }
      const k = maxR / totR;
      FxR *= k;
      FyR *= k;
    }
    if (handbrake && Math.abs(vF) > 2) this.lockup = Math.max(this.lockup, 0.6);

    // ----------------------------------------------------- aero & resistances
    const dragF = -s.drag * this.dragScale * vF * Math.abs(vF);
    const dragL = -s.dragLateral * vL * Math.abs(vL);
    const rollF = this.grounded ? -s.rollResist * rolling * vF : 0;
    const rollL = this.grounded ? -s.rollResist * rolling * 0.5 * vL : 0;

    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const Fx = FxR + FxF * cd - FyF * sd + dragF + rollF;
    const Fy = FyR + FyF * cd + FxF * sd + dragL + rollL;
    const Tz = s.cgToFront * (FyF * cd + FxF * sd) - s.cgToRear * FyR;

    const ax = Fx / s.mass;
    const ay = Fy / s.mass;
    let awx = ax * sn + ay * cs;
    let awz = ax * cs - ay * sn;
    if (this.grounded) {
      // gravity along the slope
      awx += g * this.normalY * this.normalX;
      awz += g * this.normalY * this.normalZ;
    }
    this.vx += awx * dt;
    this.vz += awz * dt;
    // mild yaw damping (less when the handbrake is deliberately provoking a slide)
    const damping = s.yawDamping * (handbrake ? 0.3 : 1 - 0.6 * this.drift) * smoothstep(3, 15, speed);
    let yawAcc = Tz / s.inertia - this.yawRate * damping;
    if (!this.grounded) yawAcc = -this.yawRate * 0.8;
    this.yawRate += yawAcc * dt;

    // Low-speed stabilisation: blend toward a kinematic model and bleed slip.
    vF = this.vx * sn + this.vz * cs;
    vL = this.vx * cs - this.vz * sn;
    const low = 1 - smoothstep(1.5, 5, Math.abs(vF));
    if (low > 0 && this.grounded) {
      const kinYaw = (vF * Math.tan(delta)) / L;
      this.yawRate = lerp(this.yawRate, kinYaw, low * Math.min(1, dt * 12));
      vL *= 1 - low * Math.min(1, dt * 10);
      if (Math.abs(vF) < 0.4 && this.throttle < 0.05 && !this.reverse) vF *= Math.max(0, 1 - dt * 6);
      this.vx = vF * sn + vL * cs;
      this.vz = vF * cs - vL * sn;
    }

    // speed governor
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > s.maxSpeed) {
      this.vx *= s.maxSpeed / sp;
      this.vz *= s.maxSpeed / sp;
    }

    this.yaw += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.distance += sp * dt;

    // filtered accelerations for weight transfer and body motion
    const kA = 1 - Math.exp(-dt * 9);
    this.accelLong += (ax - this.accelLong) * kA;
    this.accelLat += (ay - this.accelLat) * kA;

    // wheel rotation (visual): rear includes wheelspin / lock
    const omega = vF / r;
    this.wheelAngleF += (this.lockup > 0.5 && this.brake > 0.5 ? omega * 0.2 : omega) * dt;
    const spinBoost = this.wheelspin * 40 * (this.reverse ? -1 : 1);
    const rearLocked = handbrake && Math.abs(vF) > 2;
    this.wheelOmegaR = rearLocked ? 0 : omega + spinBoost;
    this.wheelAngleR += this.wheelOmegaR * dt;
  }
}
