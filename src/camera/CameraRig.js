// Camera modes: chase (with drift-aware framing, speed FOV and shake), far
// chase, hood, bumper, a slow showroom orbit for menus and trackside TV
// cameras for replays / post-race.

import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/math.js';
import { createNoise2D } from '../core/noise.js';

const DRIVE_MODES = ['chase', 'far', 'hood', 'bumper'];
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.mode = 'orbit';
    this.driveMode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this.camYaw = 0;
    this.fov = 60;
    this.shakeAmount = 0;
    this.noise = createNoise2D(77);
    this.time = 0;
    this.orbitAngle = 0.6;
    this.transition = 1;
    this.fromPos = new THREE.Vector3();
    this.fromLook = new THREE.Vector3();
    this.groundHeight = null; // (x, z) → ground height, set by the game
    this.tvCams = this._buildTvCams();
    this.tvIndex = -1;
    this.tvTimer = 0;
  }

  _buildTvCams() {
    const t = this.track;
    const cams = [];
    for (let i = 20; i < t.n; i += 70) {
      const side = (cams.length % 2 === 0 ? 1 : -1) * (t.curvature[i] > 0 ? -1 : 1);
      const b = side > 0 ? t.barrierL[i] : t.barrierR[i];
      const p = t.pointAt(i, side * (b + 7));
      cams.push({ i, x: p.x, y: p.y + 4.5 + (cams.length % 3) * 1.5, z: p.z });
    }
    return cams;
  }

  setMode(mode, instant = false) {
    if (mode === this.mode && !instant) return;
    if (DRIVE_MODES.includes(mode)) this.driveMode = mode;
    this.mode = mode;
    if (instant) {
      this.transition = 1;
      this.snapNext = true;
    }
    else {
      this.transition = 0;
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(this.look);
    }
  }

  cycleDriveMode() {
    const i = DRIVE_MODES.indexOf(this.driveMode);
    this.setMode(DRIVE_MODES[(i + 1) % DRIVE_MODES.length], true);
    return this.driveMode;
  }

  shake(amount) {
    this.shakeAmount = Math.min(1.5, this.shakeAmount + amount);
  }

  update(dt, car) {
    this.time += dt;
    if (this.snapNext) {
      // jump straight to the target pose on the first update after an instant switch
      this.snapNext = false;
      this.camYaw = car.physics.yaw;
      this.update(10, car);
      return;
    }
    const cam = this.camera;
    const ph = car.physics;
    const speed = ph.speed;
    let fovTarget = 60;
    const desired = _v;
    const look = _look;

    switch (this.mode) {
      case 'chase':
      case 'far': {
        const far = this.mode === 'far';
        const velYaw = speed > 3 ? Math.atan2(ph.vx, ph.vz) : ph.yaw;
        const driftMix = 0.5 * smoothstep(0.05, 0.45, Math.abs(ph.beta)) * smoothstep(3, 10, speed);
        const targetYaw = ph.yaw + wrapAngle(velYaw - ph.yaw) * driftMix;
        const diff = wrapAngle(targetYaw - this.camYaw);
        this.camYaw += diff * (1 - Math.exp(-dt * (far ? 4 : 5.5)));
        const dist = (far ? 9.2 : 6.1) + speed * (far ? 0.02 : 0.016);
        const height = (far ? 3.1 : 1.85) + speed * 0.003;
        desired.set(ph.x - Math.sin(this.camYaw) * dist, ph.y + height, ph.z - Math.cos(this.camYaw) * dist);
        look.set(ph.x + Math.sin(ph.yaw) * 2.8, ph.y + (far ? 1.0 : 1.05), ph.z + Math.cos(ph.yaw) * 2.8);
        fovTarget = 58 + 18 * smoothstep(8, 85, speed) + (ph.nitroActive ? 9 : 0);
        // position smoothing: tight horizontally, softer vertically for bumps/crests
        const k = 1 - Math.exp(-dt * 14);
        this.pos.x += (desired.x - this.pos.x) * k;
        this.pos.z += (desired.z - this.pos.z) * k;
        this.pos.y += (desired.y - this.pos.y) * (1 - Math.exp(-dt * 7));
        if (this.groundHeight) {
          const gh = this.groundHeight(this.pos.x, this.pos.z) + 0.6;
          if (this.pos.y < gh) this.pos.y = gh;
        }
        this.look.lerp(look, 1 - Math.exp(-dt * 20));
        break;
      }
      case 'hood':
      case 'bumper': {
        const hood = this.mode === 'hood';
        const cams = car.body?.cams;
        const at = cams ? (hood ? cams.hood : cams.bumper) : hood ? [0, 1.12, 0.25] : [0, 0.5, 2.3];
        const to = cams ? (hood ? cams.hoodLook : cams.bumperLook) : hood ? [0, 1.0, 30] : [0, 0.45, 30];
        car.localToWorld(at[0], at[1], at[2], this.pos);
        car.localToWorld(to[0], to[1], to[2], this.look);
        fovTarget = (hood ? 68 : 72) + 12 * smoothstep(10, 85, speed) + (ph.nitroActive ? 8 : 0);
        break;
      }
      case 'orbit': {
        this.orbitAngle += dt * 0.12;
        const r = 7.4;
        desired.set(
          ph.x + Math.sin(ph.yaw + this.orbitAngle) * r,
          ph.y + 1.35 + Math.sin(this.time * 0.21) * 0.35,
          ph.z + Math.cos(ph.yaw + this.orbitAngle) * r,
        );
        look.set(ph.x, ph.y + 0.62, ph.z);
        this.pos.lerp(desired, 1 - Math.exp(-dt * 3));
        this.look.lerp(look, 1 - Math.exp(-dt * 5));
        fovTarget = 36;
        break;
      }
      case 'tv': {
        this.tvTimer -= dt;
        // choose the camera the car is approaching (or just passed)
        let best = -1;
        let bestD = Infinity;
        for (let k = 0; k < this.tvCams.length; k++) {
          const c = this.tvCams[k];
          const d = Math.hypot(c.x - ph.x, c.z - ph.z);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (best !== this.tvIndex && (this.tvTimer <= 0 || this.tvIndex < 0)) {
          this.tvIndex = best;
          this.tvTimer = 2.5;
          const c = this.tvCams[best];
          this.pos.set(c.x, c.y, c.z);
          this.transition = 1;
        }
        look.set(ph.x + ph.vx * 0.15, ph.y + 0.7, ph.z + ph.vz * 0.15);
        this.look.lerp(look, 1 - Math.exp(-dt * 12));
        const d = this.pos.distanceTo(this.look);
        fovTarget = clamp((2 * Math.atan(5.5 / d) * 180) / Math.PI, 7, 55);
        break;
      }
      default:
        break;
    }

    // blend from the previous camera when switching modes
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt / 1.4);
      const e = smoothstep(0, 1, this.transition);
      cam.position.lerpVectors(this.fromPos, this.pos, e);
      _look.lerpVectors(this.fromLook, this.look, e);
    } else {
      cam.position.copy(this.pos);
      _look.copy(this.look);
    }

    // shake: impacts + speed + rough surfaces
    this.shakeAmount = damp(this.shakeAmount, 0, 5, dt);
    const inCar = this.mode === 'hood' || this.mode === 'bumper';
    const rumble = (ph.bump * smoothstep(3, 20, speed)) * (inCar ? 0.04 : 0.025);
    const wind = smoothstep(40, 85, speed) * (inCar ? 0.012 : 0.006) + (ph.nitroActive ? 0.01 : 0);
    const amp = this.shakeAmount * 0.12 + rumble + wind;
    if (amp > 0.0001 && this.mode !== 'orbit' && this.mode !== 'tv') {
      const t = this.time * 22;
      cam.position.x += this.noise(t, 1.3) * amp;
      cam.position.y += this.noise(t, 7.1) * amp * 0.8;
      cam.position.z += this.noise(t, 13.7) * amp;
    }
    cam.lookAt(_look);
    this.fov = damp(this.fov, fovTarget, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Snap the chase camera behind the car (after resets/restarts). */
  snapBehind(car) {
    const ph = car.physics;
    this.camYaw = ph.yaw;
    this.pos.set(ph.x - Math.sin(ph.yaw) * 6.1, ph.y + 1.85, ph.z - Math.cos(ph.yaw) * 6.1);
    this.look.set(ph.x, ph.y + 1, ph.z);
    this.transition = 1;
  }
}
