import { describe, expect, it } from 'vitest';
import { Track, SURFACE, CURB_WIDTH } from '../src/world/Track.js';
import { LUMENOM_RING } from '../src/world/trackData.js';
import { AI_CAPABILITY } from '../src/ai/AIDriver.js';

const track = new Track(LUMENOM_RING);
track.computeSpeedProfile(AI_CAPABILITY);

describe('Track', () => {
  it('samples a closed circuit of the expected length', () => {
    expect(track.length).toBeGreaterThan(3000);
    expect(track.length).toBeLessThan(3300);
    expect(track.ds).toBeCloseTo(2, 1);
    const i = track.n - 1;
    const gap = Math.hypot(track.px[0] - track.px[i], track.pz[0] - track.pz[i]);
    expect(gap).toBeLessThan(track.ds * 1.5);
  });

  it('puts sample 0 on the configured start line', () => {
    const [sx, sz] = LUMENOM_RING.start;
    expect(Math.hypot(track.px[0] - sx, track.pz[0] - sz)).toBeLessThan(track.ds * 2);
  });

  it('projects points back onto the centreline frame', () => {
    for (const i of [0, 120, 400, 777, 1200]) {
      const lateral = 4.2;
      const p = track.pointAt(i, lateral);
      const proj = track.project(p.x, p.z, -1, {});
      expect(Math.abs(proj.lateral - lateral)).toBeLessThan(0.05);
      let dd = Math.abs(proj.distance - i * track.ds);
      dd = Math.min(dd, track.length - dd); // lap distance wraps at the line
      expect(dd).toBeLessThan(track.ds);
      expect(Math.abs(track.heightAt(proj) - p.y)).toBeLessThan(0.02);
    }
  });

  it('classifies surfaces across the cross-section', () => {
    const i = track.curbL.findIndex((v) => v === 1);
    expect(i).toBeGreaterThanOrEqual(0);
    const c = track.pointAt(i, 0);
    const on = track.project(c.x, c.z, i, {});
    expect(track.surfaceAt(on)).toBe(SURFACE.ASPHALT);
    const curb = track.pointAt(i, track.halfWidth + CURB_WIDTH / 2);
    const pc = track.project(curb.x, curb.z, i, {});
    expect(track.surfaceAt(pc)).toBe(SURFACE.CURB);
    expect(track.heightAt(pc)).toBeGreaterThan(track.pointAt(i, track.halfWidth).y);
  });

  it('keeps barriers outside the road and clear of other track sections', () => {
    for (let i = 0; i < track.n; i++) {
      expect(track.barrierL[i]).toBeGreaterThan(track.halfWidth + 1);
      expect(track.barrierR[i]).toBeGreaterThan(track.halfWidth + 1);
      expect(track.barrierL[i]).toBeLessThan(30);
      expect(track.barrierR[i]).toBeLessThan(30);
    }
  });

  it('keeps the racing line on the asphalt', () => {
    for (let i = 0; i < track.n; i++) expect(Math.abs(track.lineOffset[i])).toBeLessThanOrEqual(track.halfWidth - 1.5);
  });

  it('builds a plausible AI speed profile', () => {
    const v = track.speedProfile;
    const min = Math.min(...v);
    const max = Math.max(...v);
    expect(min).toBeGreaterThan(18); // slowest hairpin > 65 km/h
    expect(max).toBeLessThanOrEqual(AI_CAPABILITY.vMax);
    let lap = 0;
    for (const s of v) lap += track.ds / s;
    expect(lap).toBeGreaterThan(55);
    expect(lap).toBeLessThan(85);
  });

  it('places grid slots behind the line, two abreast', () => {
    const slots = track.gridSlots(6);
    slots.forEach((s, k) => {
      const d = track.project(s.x, s.z, s.index, {}).distance;
      expect(d).toBeGreaterThan(track.length - 80);
      expect(Math.sign(s.lateral)).toBe(k % 2 === 0 ? 1 : -1);
    });
  });
});
