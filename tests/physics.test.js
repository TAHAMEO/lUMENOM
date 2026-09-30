import { describe, expect, it } from 'vitest';
import { CarPhysics } from '../src/vehicle/CarPhysics.js';

const flat = {
  ground(x, z, out) {
    out.h = 0;
    out.surface = 0;
    return out;
  },
};
const DT = 1 / 120;
const run = (car, seconds, input) => {
  for (let t = 0; t < seconds; t += DT) car.step(DT, input, flat);
};

describe('CarPhysics', () => {
  it('accelerates like a supercar and tops out near 290 km/h', () => {
    const car = new CarPhysics();
    let t = 0;
    let t100 = null;
    while (t < 40) {
      car.step(DT, { throttle: 1 }, flat);
      t += DT;
      if (t100 === null && car.speed * 3.6 >= 100) t100 = t;
    }
    expect(t100).toBeLessThan(4);
    expect(car.speed * 3.6).toBeGreaterThan(265);
    expect(car.speed * 3.6).toBeLessThan(305);
    expect(car.gear).toBe(6);
  });

  it('stops from 100 km/h in under 40 m', () => {
    const car = new CarPhysics();
    car.vz = 100 / 3.6;
    let d = 0;
    for (let t = 0; t < 10 && car.speed > 0.3; t += DT) {
      const z0 = car.z;
      car.step(DT, { brake: 1 }, flat);
      d += car.z - z0;
    }
    expect(d).toBeLessThan(40);
    expect(Number.isFinite(car.x) && Number.isFinite(car.yaw)).toBe(true);
  });

  it('stays composed through a full-lock step at 200 km/h', () => {
    const car = new CarPhysics();
    car.vz = 200 / 3.6;
    car.gear = 5;
    let maxBeta = 0;
    for (let t = 0; t < 3; t += DT) {
      car.step(DT, { throttle: 0.6, steer: 1 }, flat);
      maxBeta = Math.max(maxBeta, Math.abs(car.beta));
    }
    expect((maxBeta * 180) / Math.PI).toBeLessThan(12);
    run(car, 3, { throttle: 0.5, steer: 0 });
    expect(Math.abs(car.yawRate)).toBeLessThan(0.02);
  });

  it('turns left for positive steer', () => {
    const car = new CarPhysics();
    car.vz = 20;
    run(car, 1, { throttle: 0.4, steer: 1 });
    expect(car.yawRate).toBeGreaterThan(0);
    expect(car.x).toBeGreaterThan(0); // heading +Z, left is +X
  });

  it('holds a handbrake-initiated drift with countersteer and throttle', () => {
    const car = new CarPhysics();
    car.vz = 90 / 3.6;
    car.gear = 3;
    let t = 0;
    let slideTime = 0;
    while (t < 4) {
      const steer = t < 0.5 ? 1 : -0.25;
      car.step(DT, { throttle: t > 0.35 ? 0.8 : 0, steer, handbrake: t < 0.35 }, flat);
      if (Math.abs(car.beta) > 0.3) slideTime += DT;
      t += DT;
    }
    expect(slideTime).toBeGreaterThan(1);
    expect(car.speed).toBeGreaterThan(10);
  });

  it('reverses when the brake is held at a standstill', () => {
    const car = new CarPhysics();
    run(car, 2, { brake: 1 });
    expect(car.reverse).toBe(true);
    expect(car.forwardSpeed).toBeLessThan(-1);
  });

  it('stays parked while held on the grid, even when revving', () => {
    const car = new CarPhysics();
    run(car, 10, { hold: true, brake: 1, throttle: 1 });
    expect(car.speed).toBeLessThan(0.01);
    expect(car.reverse).toBe(false);
    expect(car.rpm).toBeGreaterThan(4000);
    run(car, 2, { throttle: 1 });
    expect(car.forwardSpeed).toBeGreaterThan(15);
  });

  it('ignores zero-length steps instead of producing NaN', () => {
    const car = new CarPhysics();
    car.vz = 30;
    car.step(0, { throttle: 1 }, flat);
    car.step(DT, { throttle: 1 }, flat);
    expect(Number.isFinite(car.y) && Number.isFinite(car.vy) && Number.isFinite(car.z)).toBe(true);
  });

  it('burns nitro for extra speed and regenerates it slowly', () => {
    const a = new CarPhysics();
    const b = new CarPhysics();
    run(a, 6, { throttle: 1 });
    run(b, 6, { throttle: 1, nitro: true });
    expect(b.speed).toBeGreaterThan(a.speed + 2);
    expect(b.nitro).toBeLessThan(0.5);
    const before = b.nitro;
    run(b, 2, { throttle: 1 });
    expect(b.nitro).toBeGreaterThan(before);
  });

  it('leaves the ground over a sharp crest', () => {
    const car = new CarPhysics();
    car.vz = 70;
    car.gear = 6;
    // ground drops away with 150 m vertical radius after z = 20
    const crest = {
      ground(x, z, out) {
        const d = Math.max(0, z - 20);
        out.h = -(d * d) / 300;
        out.surface = 0;
        return out;
      },
    };
    let airborne = false;
    for (let t = 0; t < 1.2; t += DT) {
      car.step(DT, { throttle: 1 }, crest);
      if (!car.grounded) airborne = true;
    }
    expect(airborne).toBe(true);
  });
});
