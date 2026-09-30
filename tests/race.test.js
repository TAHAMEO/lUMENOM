import { describe, expect, it } from 'vitest';
import { Track } from '../src/world/Track.js';
import { LUMENOM_RING } from '../src/world/trackData.js';
import { RaceManager } from '../src/race/RaceManager.js';
import { Car } from '../src/vehicle/Car.js';
import { AIDriver, AI_CAPABILITY } from '../src/ai/AIDriver.js';
import { formatTime, ordinal } from '../src/core/math.js';

const track = new Track(LUMENOM_RING);
track.computeSpeedProfile(AI_CAPABILITY);

/** A stand-in car whose track distance we drive directly. */
function fakeCar(startDistance) {
  const car = new Car({ track, id: 0, headless: true });
  car.proj.distance = startDistance;
  return car;
}

function drive(race, car, from, to, dt = 0.05, speed = 50) {
  let d = from;
  while (d < to) {
    d += speed * dt;
    car.proj.distance = ((d % track.length) + track.length) % track.length;
    race.update(dt);
  }
  return d;
}

describe('RaceManager', () => {
  it('counts a lap only after passing every checkpoint', () => {
    const race = new RaceManager(track);
    const car = fakeCar(track.length - 30);
    race.setup('race', [car], car, { laps: 2 });
    race.startCountdown(true);
    drive(race, car, track.length - 30, track.length + 10); // cross the line: lap 1 starts
    expect(car.lapsCompleted).toBe(0);
    drive(race, car, track.length + 10, 2 * track.length + 10);
    expect(car.lapsCompleted).toBe(1);
    expect(car.lastLap).toBeGreaterThan(60);
    expect(car.lastLap).toBeLessThan(66);
  });

  it('finishes the race after the configured number of laps', () => {
    const race = new RaceManager(track);
    const car = fakeCar(track.length - 30);
    race.setup('race', [car], car, { laps: 2 });
    race.startCountdown(true);
    drive(race, car, track.length - 30, 3 * track.length + 20);
    expect(car.finished).toBe(true);
    expect(race.state).toBe('finished');
    expect(car.lapTimes.length).toBe(2);
  });

  it('runs the five-light countdown before going green', () => {
    const race = new RaceManager(track);
    const car = fakeCar(track.length - 30);
    race.setup('race', [car], car, { laps: 1 });
    race.startCountdown();
    let lights = 0;
    let go = false;
    for (let t = 0; t < 8 && !go; t += 0.05) {
      race.update(0.05);
      for (const e of race.events) {
        if (e.type === 'light') lights = e.count;
        if (e.type === 'go') go = true;
      }
    }
    expect(lights).toBe(5);
    expect(go).toBe(true);
    expect(race.state).toBe('running');
  });
});

describe('AIDriver', () => {
  it('laps the circuit cleanly on its own', () => {
    const car = new Car({ track, id: 1, headless: true });
    car.placeAt(track.gridSlots(1)[0]);
    const ai = new AIDriver(car, track, { skill: 0.95, seed: 3 });
    const DT = 1 / 120;
    let walls = 0;
    let offTrack = 0;
    let prev = car.proj.distance;
    let crossings = 0;
    let lapStart = 0;
    let lapTime = null;
    for (let t = 0; t < 170 && lapTime === null; t += DT) {
      ai.update(DT, [car], null, true);
      car.step(DT);
      walls += car.impacts.filter((i) => i.kind === 'wall').length;
      car.impacts.length = 0;
      if (Math.abs(car.proj.lateral) > track.halfWidth + 1.5) offTrack += DT;
      const d = car.proj.distance;
      if (prev > track.length * 0.8 && d < track.length * 0.2) {
        crossings++;
        if (crossings === 1) lapStart = t;
        else lapTime = t - lapStart;
      }
      prev = d;
    }
    expect(lapTime).not.toBeNull();
    expect(lapTime).toBeLessThan(85);
    expect(walls).toBe(0);
    expect(offTrack).toBeLessThan(1);
  });
});

describe('formatting helpers', () => {
  it('formats lap times and ordinals', () => {
    expect(formatTime(71616)).toBe('01:11.616');
    expect(formatTime(null)).toBe('--:--.---');
    expect(ordinal(1)).toBe('1ST');
    expect(ordinal(2)).toBe('2ND');
    expect(ordinal(3)).toBe('3RD');
    expect(ordinal(11)).toBe('11TH');
  });
});
