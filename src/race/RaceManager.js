// Race logic: countdown (five red lights, random hold, lights out), lap and
// sector timing with checkpoint validation, running order and gaps, finish
// classification, wrong-way detection, slipstream and drift scoring.

import { clamp } from '../core/math.js';

export const SECTORS = 3;
const CHECKPOINTS = 6; // validation gates per lap (two per sector)
const LOOP = 50; // metres between timing loops used for gaps

export class RaceManager {
  constructor(track) {
    this.track = track;
    this.mode = 'race';
    this.laps = 3;
    this.state = 'idle'; // idle | countdown | running | finished
    this.time = 0; // race clock (s) since lights out
    this.countdown = 0;
    this.lights = 0;
    this.holdTime = 0;
    this.cars = [];
    this.player = null;
    this.order = [];
    this.events = [];
    this.drift = { active: false, score: 0, combo: 0, multiplier: 1, timer: 0, idle: 0, best: 0, total: 0 };
    this.wrongWay = false;
    this._wrongTimer = 0;
    this.bestSplits = null;
    this.bestLap = null;
  }

  setup(mode, cars, player, { laps = 3, bestLap = null, bestSplits = null } = {}) {
    this.mode = mode;
    this.cars = cars;
    this.player = player;
    this.laps = mode === 'race' ? laps : Infinity;
    this.bestLap = bestLap;
    this.bestSplits = bestSplits;
    this.time = 0;
    this.state = 'idle';
    this.events.length = 0;
    this.drift = { active: false, score: 0, combo: 0, multiplier: 1, timer: 0, idle: 0, best: this.drift.best || 0, total: 0 };
    for (const car of cars) {
      car.resetRace();
      car.lineCrossings = -1;
      car.lapsCompleted = 0;
      car.nextCheckpoint = 0;
      car.splits = [];
      car.loopTimes = [];
      car.lastDistance = car.proj.distance;
      car.progress = car.proj.distance - this.track.length;
    }
    this.updateOrder();
  }

  startCountdown(skip = false) {
    if (skip) {
      this.state = 'running';
      this.time = 0;
      this.events.push({ type: 'go' });
      return;
    }
    this.state = 'countdown';
    this.countdown = 0;
    this.lights = 0;
    this.holdTime = 0.5 + Math.random() * 1.1;
  }

  update(dt) {
    this.events.length = 0;
    if (this.state === 'countdown') {
      this.countdown += dt;
      const lit = Math.min(5, Math.floor((this.countdown - 0.6) / 0.85) + 1);
      if (lit > this.lights && this.countdown > 0.6) {
        this.lights = lit;
        this.events.push({ type: 'light', count: lit });
      }
      if (this.lights === 5 && this.countdown > 0.6 + 4 * 0.85 + this.holdTime) {
        this.lights = 0;
        this.state = 'running';
        this.time = 0;
        this.events.push({ type: 'go' });
      }
      return;
    }
    if (this.state !== 'running' && this.state !== 'finished') return;
    this.time += dt;
    for (const car of this.cars) this._updateCar(car, dt);
    this._slipstream(dt);
    this._driftScore(dt);
    this._wrongWay(dt);
    this.updateOrder();
  }

  _updateCar(car, dt) {
    const L = this.track.length;
    const d = car.proj.distance;
    const prev = car.lastDistance;
    car.lastDistance = d;
    if (prev > L * 0.75 && d < L * 0.25) {
      car.lineCrossings++;
      this._onLine(car);
    } else if (prev < L * 0.25 && d > L * 0.75) {
      car.lineCrossings--;
    }
    if (car.nextCheckpoint > 0 && car.nextCheckpoint < CHECKPOINTS) {
      const gate = Math.floor((d / L) * CHECKPOINTS);
      if (gate === car.nextCheckpoint) {
        if (car.nextCheckpoint % 2 === 0) {
          const sector = car.nextCheckpoint / 2 - 1;
          car.splits[sector] = this.time - car.lapStartTime;
          if (car === this.player) this.events.push({ type: 'sector', sector, time: car.splits[sector], best: this.bestSplits?.[sector] });
        }
        car.nextCheckpoint++;
      }
    }
    car.progress = car.lineCrossings * L + d;
    if (!car.finished) {
      const loop = Math.floor(car.progress / LOOP);
      if (loop >= 0 && car.loopTimes[loop] === undefined) car.loopTimes[loop] = this.time;
    }
  }

  _onLine(car) {
    if (car.finished) return;
    if (car.nextCheckpoint === 0) {
      car.nextCheckpoint = 1;
      car.lapStartTime = this.mode === 'race' ? 0 : this.time;
      car.splits = [];
      if (car === this.player) this.events.push({ type: 'lapStart', lap: 1 });
      return;
    }
    if (car.nextCheckpoint < CHECKPOINTS) {
      // line crossed without the full lap: restart timing (invalid lap)
      car.nextCheckpoint = 1;
      car.lapStartTime = this.time;
      car.splits = [];
      if (car === this.player) this.events.push({ type: 'invalid' });
      return;
    }
    const lapTime = this.time - car.lapStartTime;
    car.lapTimes.push(lapTime);
    car.lastLap = lapTime;
    const personalBest = car.bestLap == null || lapTime < car.bestLap;
    if (personalBest) car.bestLap = lapTime;
    car.lapsCompleted++;
    car.lap = car.lapsCompleted;
    const splits = [...car.splits, lapTime];
    car.lapStartTime = this.time;
    car.nextCheckpoint = 1;
    car.splits = [];
    if (car === this.player) {
      const record = this.bestLap == null || lapTime < this.bestLap;
      if (record) {
        this.bestLap = lapTime;
        this.bestSplits = splits;
      }
      this.events.push({ type: 'lap', lap: car.lapsCompleted, time: lapTime, personalBest, record, splits });
      if (this.mode === 'race' && car.lapsCompleted === this.laps - 1) this.events.push({ type: 'finalLap' });
    }
    if (this.mode === 'race' && car.lapsCompleted >= this.laps) {
      car.finished = true;
      car.finishTime = this.time;
      const place = this.cars.filter((c) => c.finished).length;
      car.finishPlace = place;
      if (car === this.player) {
        this.state = 'finished';
        this.events.push({ type: 'finish', place, time: this.time });
      }
    }
  }

  updateOrder() {
    const ranked = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    ranked.forEach((c, i) => (c.position = i + 1));
    this.order = ranked;
  }

  /** Time gap (s) from the leader to `car` using the shared timing loops. */
  gapToLeader(car) {
    const leader = this.order[0];
    if (!leader || leader === car) return 0;
    if (car.finished && leader.finished) return car.finishTime - leader.finishTime;
    const loop = Math.floor(car.progress / LOOP);
    const lt = leader.loopTimes[loop];
    const ct = car.loopTimes[loop];
    if (lt === undefined || ct === undefined) return null;
    return ct - lt;
  }

  lapsDown(car) {
    const leader = this.order[0];
    if (!leader || leader === car) return 0;
    return Math.floor((leader.progress - car.progress) / this.track.length);
  }

  /** Cars tucked in behind another car get less drag and some nitro. */
  _slipstream(dt) {
    for (const car of this.cars) {
      let best = 0;
      const ph = car.physics;
      if (ph.speed > 30) {
        for (const o of this.cars) {
          if (o === car) continue;
          let gap = o.proj.distance - car.proj.distance;
          if (gap < -this.track.length / 2) gap += this.track.length;
          if (gap <= 2 || gap > 32) continue;
          if (Math.abs(o.proj.lateral - car.proj.lateral) > 2.2) continue;
          best = Math.max(best, 1 - gap / 32);
        }
      }
      car.slipstream = best;
      ph.dragScale = 1 - 0.35 * best;
      if (best > 0) ph.nitro = Math.min(1, ph.nitro + dt * 0.04 * best);
    }
  }

  _driftScore(dt) {
    const car = this.player;
    if (!car) return;
    const ph = car.physics;
    const d = this.drift;
    const sliding = ph.grounded && ph.speed > 11 && Math.abs(ph.beta) > 0.22 && ph.surfaceRear <= 1;
    if (car.impacts.length && d.active) {
      d.active = false;
      d.combo = 0;
      d.multiplier = 1;
      d.timer = 0;
      this.events.push({ type: 'driftFail' });
    }
    if (sliding) {
      d.active = true;
      d.idle = 0;
      d.timer += dt;
      d.multiplier = clamp(1 + Math.floor(d.timer / 1.6), 1, 5);
      d.combo += dt * Math.abs(ph.beta) * ph.speed * 14 * d.multiplier;
      ph.nitro = Math.min(1, ph.nitro + dt * 0.05);
    } else if (d.active) {
      d.idle += dt;
      if (d.idle > 0.9) {
        const banked = Math.round(d.combo);
        d.total += banked;
        d.score = banked;
        if (banked > d.best) d.best = banked;
        if (banked > 150) this.events.push({ type: 'driftBank', points: banked });
        d.active = false;
        d.combo = 0;
        d.multiplier = 1;
        d.timer = 0;
      }
    }
  }

  _wrongWay(dt) {
    const car = this.player;
    if (!car || this.state !== 'running') {
      this.wrongWay = false;
      return;
    }
    const ph = car.physics;
    const along = ph.vx * car.proj.tx + ph.vz * car.proj.tz;
    this._wrongTimer = along < -3 ? this._wrongTimer + dt : Math.max(0, this._wrongTimer - dt * 3);
    this.wrongWay = this._wrongTimer > 1.2;
  }

  /** Classification rows for the results screen. */
  results() {
    const leader = this.order[0];
    return this.order.map((car) => {
      let gap;
      if (car === leader) gap = car.finished ? car.finishTime : null;
      else if (car.finished) gap = car.finishTime - leader.finishTime;
      else {
        const down = this.lapsDown(car);
        gap = down >= 1 ? `+${down} LAP${down > 1 ? 'S' : ''}` : this.gapToLeader(car);
      }
      return { car, position: car.position, finished: car.finished, gap, bestLap: car.bestLap };
    });
  }
}
