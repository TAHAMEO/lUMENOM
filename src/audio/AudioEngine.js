// All sound is synthesised with the Web Audio API — no samples.
// Engine: looping buffers of damped exhaust pulses (uneven V8 firing), two RPM
// layers cross-faded and pitched by playbackRate, shaped by load-dependent
// filtering plus an induction-noise layer. Nearby AI cars get positional,
// doppler-shifted engine voices. SFX: tyre squeal, wind, surface rumble, curb
// buzz, impacts, scraping, nitro, backfires, countdown beeps, crowd.

import { clamp, smoothstep } from '../core/math.js';

function makeEngineBuffer(ctx, baseRpm, { f1, f2, tau, noise, seed }) {
  const sr = ctx.sampleRate;
  const cycle = 120 / baseRpm; // two revolutions (4-stroke)
  const cycles = 8;
  const len = Math.floor(sr * cycle * cycles);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const intervals = [1.0, 0.86, 1.14, 1.0, 0.9, 1.1, 1.04, 0.96];
  const pulses = [];
  let t = 0;
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < 8; k++) {
      pulses.push({ t, a: 0.8 + rnd() * 0.25, ph: rnd() * Math.PI * 2 });
      t += (intervals[k] * cycle) / 8;
    }
  }
  const scale = (cycle * cycles) / t;
  for (const p of pulses) {
    const start = Math.floor(p.t * scale * sr);
    const n = Math.floor(sr * tau * 7);
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % len;
      const tt = i / sr;
      const env = Math.exp(-tt / tau);
      const thump = Math.sin(Math.min(Math.PI, (tt / (tau * 2.5)) * Math.PI)) * 0.9;
      const ring = Math.sin(2 * Math.PI * f1 * tt + p.ph) + 0.55 * Math.sin(2 * Math.PI * f2 * tt + p.ph * 1.7);
      d[idx] += p.a * env * (thump + ring * 0.6 + (rnd() * 2 - 1) * noise);
    }
  }
  // normalise and remove DC
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    d[i] -= mean;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  for (let i = 0; i < len; i++) d[i] /= peak;
  return buf;
}

function makeNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeShaper(ctx, amount) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

class EngineVoice {
  constructor(audio, dest, positional) {
    const ctx = audio.ctx;
    this.ctx = ctx;
    this.low = ctx.createBufferSource();
    this.low.buffer = audio.engineLow;
    this.low.loop = true;
    this.high = ctx.createBufferSource();
    this.high.buffer = audio.engineHigh;
    this.high.loop = true;
    this.gLow = ctx.createGain();
    this.gHigh = ctx.createGain();
    this.shaper = makeShaper(ctx, 1.8);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.8;
    this.eq = ctx.createBiquadFilter();
    this.eq.type = 'peaking';
    this.eq.frequency.value = 180;
    this.eq.gain.value = 5;
    this.eq.Q.value = 0.9;
    // induction roar
    this.intake = ctx.createBufferSource();
    this.intake.buffer = audio.noise;
    this.intake.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 2.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.low.connect(this.gLow).connect(this.shaper);
    this.high.connect(this.gHigh).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.eq).connect(this.out);
    this.intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.out);
    if (positional) {
      this.panner = ctx.createPanner();
      this.panner.panningModel = 'equalpower';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 6;
      this.panner.rolloffFactor = 1.3;
      this.panner.maxDistance = 400;
      this.out.connect(this.panner).connect(dest);
    } else this.out.connect(dest);
    const t = ctx.currentTime;
    this.low.start(t, Math.random() * 0.3);
    this.high.start(t, Math.random() * 0.1);
    this.intake.start(t, Math.random());
    this.lowBase = audio.lowBase;
    this.highBase = audio.highBase;
  }

  set(rpm, load, volume, doppler = 1) {
    const t = this.ctx.currentTime;
    const tc = 0.03;
    this.low.playbackRate.setTargetAtTime((rpm / this.lowBase) * doppler, t, tc);
    this.high.playbackRate.setTargetAtTime((rpm / this.highBase) * doppler, t, tc);
    const hi = smoothstep(2600, 4700, rpm);
    this.gLow.gain.setTargetAtTime((1 - hi) * 0.9, t, tc);
    this.gHigh.gain.setTargetAtTime(hi * 0.8, t, tc);
    this.filter.frequency.setTargetAtTime(500 + load * 4200 + rpm * 0.35, t, 0.05);
    this.intakeFilter.frequency.setTargetAtTime(((rpm / 60) * 4 * 2.2 + 200) * doppler, t, tc);
    this.intakeGain.gain.setTargetAtTime(load * smoothstep(2500, 8000, rpm) * 0.35, t, 0.05);
    this.out.gain.setTargetAtTime(volume * (0.42 + load * 0.58), t, 0.05);
  }

  setPosition(x, y, z) {
    if (!this.panner) return;
    const t = this.ctx.currentTime;
    this.panner.positionX.setTargetAtTime(x, t, 0.02);
    this.panner.positionY.setTargetAtTime(y, t, 0.02);
    this.panner.positionZ.setTargetAtTime(z, t, 0.02);
  }

  stop() {
    try {
      this.low.stop();
      this.high.stop();
      this.intake.stop();
    } catch {
      /* already stopped */
    }
    this.out.disconnect();
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.muted = false;
    this.aiVoices = [];
    this.backfireCooldown = 0;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

    this.lowBase = 1800;
    this.highBase = 5200;
    this.engineLow = makeEngineBuffer(ctx, this.lowBase, { f1: 105, f2: 245, tau: 0.0085, noise: 0.18, seed: 12345 });
    this.engineHigh = makeEngineBuffer(ctx, this.highBase, { f1: 175, f2: 410, tau: 0.004, noise: 0.25, seed: 777 });
    this.noise = makeNoiseBuffer(ctx, 2);

    this.player = new EngineVoice(this, this.engineBus, false);

    // looping noise beds
    const bed = (type, freq, q, dest = this.sfxBus) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(dest);
      src.start(ctx.currentTime, Math.random() * 1.5);
      return { src, f, g };
    };
    this.wind = bed('lowpass', 500, 0.5);
    this.rumble = bed('lowpass', 180, 0.7);
    this.gravel = bed('bandpass', 1700, 0.9);
    this.scrapeBed = bed('bandpass', 2600, 2.5);
    this.nitroBed = bed('bandpass', 900, 1.2);
    this.crowd = bed('bandpass', 1100, 0.4, this.ambBus);
    // tyre squeal: detuned triangles with vibrato + a little hiss
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const sqFilter = ctx.createBiquadFilter();
    sqFilter.type = 'bandpass';
    sqFilter.frequency.value = 1150;
    sqFilter.Q.value = 3;
    this.squealOsc = [ctx.createOscillator(), ctx.createOscillator()];
    this.squealOsc[0].type = 'triangle';
    this.squealOsc[1].type = 'triangle';
    this.squealOsc[0].frequency.value = 980;
    this.squealOsc[1].frequency.value = 1330;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 28;
    lfo.connect(lfoGain);
    for (const o of this.squealOsc) {
      lfoGain.connect(o.frequency);
      o.connect(sqFilter);
      o.start();
    }
    lfo.start();
    sqFilter.connect(this.squealGain).connect(this.sfxBus);
    this.squealFilter = sqFilter;
    // curb buzz: noise gated by a square LFO
    this.curb = bed('lowpass', 260, 0.8);
    this.curbLfo = ctx.createOscillator();
    this.curbLfo.type = 'square';
    this.curbLfo.frequency.value = 20;
    const curbDepth = ctx.createGain();
    curbDepth.gain.value = 0.5;
    this.curbLfo.connect(curbDepth).connect(this.curb.g.gain);
    this.curbLfo.start();
    this.curbLevel = 0;

    this.ready = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _burst({ duration = 0.25, freq = 1200, type = 'lowpass', gain = 0.5, q = 0.8, decay = 0.08, dest }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(f).connect(g).connect(dest || this.sfxBus);
    src.start(t, Math.random() * 1.5, duration + 0.05);
    return { f, g, t };
  }

  _tone(freq, duration, gain, type = 'sine', dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    o.connect(g).connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + duration + 0.05);
    return o;
  }

  impact(strength) {
    if (!this.ready) return;
    this._burst({ duration: 0.18 + strength * 0.35, freq: 900 + strength * 1600, gain: 0.25 + strength * 0.6 });
    const o = this._tone(55 + Math.random() * 20, 0.25 + strength * 0.2, 0.3 + strength * 0.5);
    o.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.3);
    if (strength > 0.35) this._burst({ duration: 0.5, freq: 4200, type: 'bandpass', q: 3, gain: 0.12 * strength });
  }

  backfire() {
    if (!this.ready || this.backfireCooldown > 0) return;
    this.backfireCooldown = 0.12;
    const b = this._burst({ duration: 0.09, freq: 420, type: 'bandpass', q: 1.2, gain: 0.55 });
    b.f.frequency.exponentialRampToValueAtTime(160, b.t + 0.08);
    this._tone(70, 0.08, 0.35, 'square');
  }

  beep(high = false) {
    if (!this.ready) return;
    this._tone(high ? 990 : 660, high ? 0.6 : 0.18, 0.28, 'sine');
    this._tone(high ? 1980 : 1320, high ? 0.4 : 0.12, 0.05, 'sine');
  }

  ui() {
    if (!this.ready) return;
    this._tone(1500, 0.04, 0.06, 'triangle');
  }

  nitroOn() {
    if (!this.ready) return;
    const b = this._burst({ duration: 0.7, freq: 500, type: 'bandpass', q: 1.5, gain: 0.35 });
    b.f.frequency.exponentialRampToValueAtTime(2600, b.t + 0.6);
  }

  update(dt, { player, cars, camera, crowdPoint, active }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.backfireCooldown -= dt;
    const L = ctx.listener;
    if (camera) {
      const p = camera.position;
      const fwd = camera.getWorldDirection(this._fwd || (this._fwd = camera.position.clone()));
      if (L.positionX) {
        L.positionX.setTargetAtTime(p.x, t, 0.02);
        L.positionY.setTargetAtTime(p.y, t, 0.02);
        L.positionZ.setTargetAtTime(p.z, t, 0.02);
        L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
        L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
        L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
        L.upX.value = 0;
        L.upY.value = 1;
        L.upZ.value = 0;
      }
    }
    const ph = player.physics;
    const speed = ph.speed;
    const vol = active ? 1 : 0.55;
    this.player.set(ph.rpm, ph.throttle, 0.55 * vol);

    // backfire crackle on lift-off at high rpm and on upshifts
    for (const e of player.frameEvents) {
      if (e.type === 'upshift' && ph.throttle > 0.6) this.backfire();
      if (e.type === 'nitroOn') this.nitroOn();
      if (e.type === 'land') this.impact(0.25 + e.strength * 0.5);
    }
    if (ph.throttle < 0.1 && ph.rpm > 5200 && Math.random() < dt * 5) this.backfire();

    // tyres
    const slip = clamp((Math.abs(ph.slipRear) - 0.1) / 0.3, 0, 1);
    const slipF = clamp((Math.abs(ph.slipFront) - 0.14) / 0.35, 0, 1);
    const paved = ph.surfaceRear <= 1 && ph.surfaceFront <= 1;
    const squeal = paved && ph.grounded ? Math.max(slip, slipF * 0.8, ph.wheelspin * 0.8, ph.lockup * 0.7) * smoothstep(3, 12, speed) : 0;
    this.squealGain.gain.setTargetAtTime(squeal * 0.16 * vol, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(1000 + squeal * 500, t, 0.1);
    // wind, rumble, off-road
    const v = speed / 80;
    this.wind.g.gain.setTargetAtTime(v * v * 0.32 * vol, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + speed * 22, t, 0.1);
    const offroad = !paved ? 1 : 0;
    this.rumble.g.gain.setTargetAtTime(Math.min(1, speed / 30) * (0.06 + offroad * 0.3) * vol, t, 0.1);
    this.gravel.g.gain.setTargetAtTime((ph.surfaceRear === 3 || ph.surfaceFront === 3 ? 1 : ph.surfaceFront === 2 ? 0.35 : 0) * Math.min(1, speed / 20) * 0.3 * vol, t, 0.05);
    const onCurb = ph.surfaceFront === 1 || ph.surfaceRear === 1;
    this.curbLevel += ((onCurb ? 1 : 0) * Math.min(1, speed / 15) - this.curbLevel) * Math.min(1, dt * 20);
    this.curb.g.gain.setTargetAtTime(this.curbLevel * 0.5 * vol, t, 0.02);
    this.curbLfo.frequency.setTargetAtTime(Math.max(4, speed / 1.2), t, 0.05);
    this.scrapeBed.g.gain.setTargetAtTime(player.scrape * 0.35 * vol * (0.6 + Math.random() * 0.4), t, 0.02);
    this.nitroBed.g.gain.setTargetAtTime(ph.nitroActive ? 0.2 * vol : 0, t, 0.08);
    this.nitroBed.f.frequency.setTargetAtTime(ph.nitroActive ? 1400 : 700, t, 0.3);
    for (const hit of player.impacts) this.impact(hit.strength);

    // crowd swells near the grandstands
    if (crowdPoint && camera && Number.isFinite(crowdPoint.x)) {
      const d = Math.hypot(camera.position.x - crowdPoint.x, camera.position.z - crowdPoint.z);
      const near = 1 - smoothstep(40, 260, d);
      this.crowd.g.gain.setTargetAtTime(near * (0.05 + 0.08 * smoothstep(20, 70, speed)), t, 0.4);
    }

    // AI engines: nearest three get positional voices
    if (camera) {
      const others = cars.filter((c) => c !== player);
      const cp = camera.position;
      others.sort((a, b) => (a.physics.x - cp.x) ** 2 + (a.physics.z - cp.z) ** 2 - ((b.physics.x - cp.x) ** 2 + (b.physics.z - cp.z) ** 2));
      const want = others.slice(0, 3);
      while (this.aiVoices.length < want.length) this.aiVoices.push(new EngineVoice(this, this.engineBus, true));
      for (let k = 0; k < this.aiVoices.length; k++) {
        const voice = this.aiVoices[k];
        const car = want[k];
        if (!car) {
          voice.set(1000, 0, 0);
          continue;
        }
        const p = car.physics;
        const dx = cp.x - p.x;
        const dz = cp.z - p.z;
        const dist = Math.hypot(dx, dz) || 1;
        // doppler from the source's velocity toward the listener
        const vr = (p.vx * dx + p.vz * dz) / dist - ((ph.vx * dx + ph.vz * dz) / dist) * 0.5;
        const doppler = clamp(343 / (343 - vr), 0.75, 1.3);
        voice.setPosition(p.x, p.y + 0.5, p.z);
        voice.set(p.rpm, p.throttle, 0.6 * vol, doppler);
      }
    }
  }
}
