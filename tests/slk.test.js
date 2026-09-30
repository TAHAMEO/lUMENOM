import { describe, expect, it } from 'vitest';
import { bodySDF, DIM, TRIMS } from '../src/vehicle/slk/shape.js';
import { buildBody } from '../src/vehicle/slk/body.js';
import { castOnto } from '../src/vehicle/slk/exterior.js';
import { SLK_CG_OFFSET, SLKModel } from '../src/vehicle/slk/SLKModel.js';
import { BODIES } from '../src/vehicle/bodies.js';
import { CarPhysics } from '../src/vehicle/CarPhysics.js';

// Mercedes-Benz R172 press dimensions (mm → m)
const R172 = { length: 4.134, width: 1.817, wheelbase: 2.43, trackFront: 1.559, trackRear: 1.565 };

const finite = (arr) => arr.every((v) => Number.isFinite(v));

describe('SLK 200 body shape', () => {
  it('matches the R172 length and width', () => {
    const front = castOnto([0, 0.36, 3], [0, 0, -1], 2)[2];
    const rear = castOnto([0, 0.5, -3], [0, 0, 1], 2)[2];
    expect(front - rear).toBeGreaterThan(R172.length - 0.03);
    expect(front - rear).toBeLessThan(R172.length + 0.01);
    const side = castOnto([2, 0.5, DIM.rearAxle], [-1, 0, 0], 2)[0];
    expect(2 * side).toBeGreaterThan(R172.width - 0.02);
    expect(2 * side).toBeLessThan(R172.width + 0.01);
  });

  it('puts the hood, belt line and deck at the measured heights', () => {
    const top = (x, z) => castOnto([x, 2, z], [0, -1, 0], 2)[1];
    expect(top(0, 2.03)).toBeGreaterThan(0.66); // hood leading edge ≈ 0.69 m
    expect(top(0, 2.03)).toBeLessThan(0.72);
    expect(top(0.8, -0.3)).toBeGreaterThan(0.89); // door top ≈ 0.92 m
    expect(top(0.8, -0.3)).toBeLessThan(0.95);
    expect(top(0, -1.5)).toBeGreaterThan(0.93); // rear deck
    expect(top(0, -1.5)).toBeLessThan(1.0);
  });

  it('is solid inside and empty outside', () => {
    expect(bodySDF(0, 0.5, 0)).toBeLessThan(0);
    expect(bodySDF(0, 0.5, 2.3)).toBeGreaterThan(0);
    expect(bodySDF(1.1, 0.5, 0)).toBeGreaterThan(0);
    expect(bodySDF(0, 1.2, 0)).toBeGreaterThan(0);
  });
});

describe('SLK 200 mesh', () => {
  const B = buildBody(0.045);

  it('produces a clean shell within the car’s bounds', () => {
    const p = B.shell.attributes.position.array;
    const n = B.shell.attributes.normal.array;
    expect(finite(Array.from(p))).toBe(true);
    expect(finite(Array.from(n))).toBe(true);
    B.shell.computeBoundingBox();
    const bb = B.shell.boundingBox;
    expect(bb.max.x).toBeLessThan(R172.width / 2 + 0.01);
    expect(bb.min.y).toBeGreaterThan(0.15);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(R172.length - 0.04);
  });

  it('cuts every opening with a boundary to build on', () => {
    for (const t of TRIMS) {
      const chains = B.loops[t.name] || [];
      expect(chains.length, t.name).toBeGreaterThan(0);
      expect(Math.max(...chains.map((c) => c.length)), t.name).toBeGreaterThan(8);
    }
  });
});

describe('SLKModel', () => {
  const model = new SLKModel({ quality: 'low', color: '#c3121c' });

  it('places the wheels on the R172 wheelbase and tracks', () => {
    const [fl, fr, rl, rr] = model.wheels;
    expect(fl.z - rl.z).toBeCloseTo(R172.wheelbase, 3);
    expect(fl.x - fr.x).toBeCloseTo(R172.trackFront, 3);
    expect(rl.x - rr.x).toBeCloseTo(R172.trackRear, 3);
    // CG sits ahead of the wheelbase midpoint
    expect((fl.z + rl.z) / 2).toBeCloseTo(-SLK_CG_OFFSET, 6);
  });

  it('builds without a DOM and exposes the car-model interface', () => {
    let meshes = 0;
    model.root.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        expect(finite(Array.from(o.geometry.attributes.position.array.slice(0, 300))), o.name).toBe(true);
      }
    });
    expect(meshes).toBeGreaterThan(40);
    model.update({ steer: 0.3, wheelSpin: [1, 1, 1, 1], wheelOffset: [0, 0, 0, 0], pitch: 0.01, roll: -0.01, heave: 0 });
    expect(model.wheels[0].pivot.rotation.y).toBeCloseTo(0.3);
    expect(model.wheels[2].pivot.rotation.y).toBe(0);
    model.setLights({ headlights: true, brake: true });
    expect(model.tailMat.emissiveIntensity).toBeGreaterThan(model.headMat.emissiveIntensity - 1);
    model.setPaint('#1f3553');
    expect(model.paint.color.getHexString()).toBe('1f3553');
    model.setGauges(140, 3500);
    expect(model.gauges.length).toBe(2);
  });
});

describe('SLK body in the simulation', () => {
  it('uses the R172 geometry for physics and collisions', () => {
    const b = BODIES.slk;
    expect(b.spec.cgToFront + b.spec.cgToRear).toBeCloseTo(R172.wheelbase, 3);
    expect(b.spec.halfTrack * 2).toBeGreaterThan(R172.trackFront - 0.01);
    expect(b.extents.front + b.extents.rear).toBeGreaterThan(R172.length - 0.05);
  });

  it('drives: accelerates, turns and stays finite', () => {
    const flat = {
      ground(x, z, out) {
        out.h = 0;
        out.surface = 0;
        return out;
      },
    };
    const car = new CarPhysics(BODIES.slk.spec);
    for (let t = 0; t < 6; t += 1 / 120) car.step(1 / 120, { throttle: 1, steer: t > 4 ? 0.3 : 0 }, flat);
    expect(car.speed * 3.6).toBeGreaterThan(80);
    expect(Math.abs(car.yawRate)).toBeGreaterThan(0.05);
    expect(finite([car.x, car.z, car.yaw, car.speed])).toBe(true);
  });
});
