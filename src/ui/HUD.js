// Heads-up display: tachometer and minimap on canvases, timing tower, lap and
// sector panel (F1-style purple/green/yellow sectors), start lights, banners,
// drift scoring and warnings.

import { clamp, formatDelta, formatTime } from '../core/math.js';

const $ = (id) => document.getElementById(id);

function setupCanvas(canvas, cssSize) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform((canvas.width / cssSize), 0, 0, canvas.height / cssSize, 0, 0);
  return ctx;
}

export class HUD {
  constructor(track) {
    this.track = track;
    this.root = $('hud');
    this.el = {
      pos: $('hud-pos'),
      posOf: $('hud-pos-of'),
      posBlock: $('hud-pos-block'),
      lap: $('hud-lap'),
      race: $('hud-race'),
      tower: $('hud-tower'),
      lapTime: $('hud-lap-time'),
      last: $('hud-last'),
      best: $('hud-best'),
      sectors: [...$('hud-sectors').children],
      delta: $('hud-delta'),
      banner: $('hud-banner'),
      lights: $('hud-lights'),
      lightDots: [...$('hud-lights').children],
      big: $('hud-bigtext'),
      drift: $('hud-drift'),
      driftPts: $('hud-drift-pts'),
      driftMult: $('hud-drift-mult'),
      driftTotal: $('hud-drift-total'),
      driftSum: $('hud-drift-sum'),
      wrong: $('hud-wrong'),
      fps: $('hud-fps'),
    };
    this.tachCanvas = $('hud-tach');
    this.mapCanvas = $('hud-map');
    this.resize();
    this._buildMapPath();
    this.bannerTimer = 0;
    this.bigTimer = 0;
    this.towerTimer = 0;
    this.units = 'kmh';
    this.fontsReady = false;
    document.fonts?.ready.then(() => (this.fontsReady = true));
    this._last = {};
  }

  resize() {
    const tachSize = this.tachCanvas.clientWidth || 280;
    const mapSize = this.mapCanvas.clientWidth || 200;
    this.tachSize = tachSize;
    this.mapSize = mapSize;
    this.tach = setupCanvas(this.tachCanvas, tachSize);
    this.map = setupCanvas(this.mapCanvas, mapSize);
    if (this.track) this._buildMapPath();
  }

  _buildMapPath() {
    const t = this.track;
    const pad = 18;
    const size = this.mapSize || 200;
    const w = t.maxX - t.minX;
    const h = t.maxZ - t.minZ;
    const s = (size - pad * 2) / Math.max(w, h);
    const ox = (size - w * s) / 2;
    const oz = (size - h * s) / 2;
    this.mapTransform = (x, z) => [ox + (x - t.minX) * s, oz + (z - t.minZ) * s];
    const path = new Path2D();
    for (let i = 0; i <= t.n; i += 3) {
      const k = i % t.n;
      const [x, y] = this.mapTransform(t.px[k], t.pz[k]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    this.mapPath = path;
  }

  show(mode) {
    this.mode = mode;
    this.root.hidden = false;
    const race = mode === 'race';
    this.el.posBlock.style.display = race ? '' : 'none';
    this.el.tower.style.display = race ? '' : 'none';
    this.el.driftTotal.hidden = mode !== 'free';
    this.el.delta.hidden = true;
    this.el.sectors.forEach((s) => (s.className = ''));
    this.el.wrong.hidden = true;
    this.el.drift.hidden = true;
  }

  hide() {
    this.root.hidden = true;
    this.setLights(-1);
  }

  toggleVisible() {
    this.root.classList.toggle('hidden-hud');
  }

  banner(text, style = '', duration = 2.2) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = `banner show ${style}`;
    this.bannerTimer = duration;
  }

  bigText(text, cls = '', duration = 1.2) {
    const b = this.el.big;
    b.textContent = text;
    b.className = `bigtext show ${cls}`;
    this.bigTimer = duration;
  }

  setLights(count) {
    if (count < 0) {
      this.el.lights.hidden = true;
      return;
    }
    this.el.lights.hidden = false;
    this.el.lightDots.forEach((d, i) => d.classList.toggle('on', i < count));
  }

  setSector(i, cls) {
    const s = this.el.sectors[i];
    if (s) s.className = cls;
  }

  clearSectors() {
    this.el.sectors.forEach((s) => (s.className = ''));
  }

  _text(key, el, value) {
    if (this._last[key] !== value) {
      el.textContent = value;
      this._last[key] = value;
    }
  }

  update(dt, s) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.className = 'banner';
    }
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.el.big.className = 'bigtext';
    }
    const { race, player, cars } = s;
    // position / laps
    if (this.mode === 'race') {
      this._text('pos', this.el.pos, String(player.position));
      this._text('posOf', this.el.posOf, `/${cars.length}`);
      const lap = Math.min(race.laps, (player.lapsCompleted || 0) + 1);
      this._text('lap', this.el.lap, `${lap}/${race.laps}`);
      this._text('race', this.el.race, formatTime(race.state === 'countdown' ? 0 : (player.finished ? player.finishTime : race.time) * 1000));
      this.towerTimer -= dt;
      if (this.towerTimer <= 0) {
        this.towerTimer = 0.25;
        this._updateTower(race, player);
      }
    }
    const lapRunning = player.nextCheckpoint > 0 && race.state !== 'countdown';
    const lapTime = lapRunning ? race.time - player.lapStartTime : 0;
    this._text('lapTime', this.el.lapTime, formatTime(lapTime * 1000));
    this._text('last', this.el.last, formatTime(player.lastLap == null ? null : player.lastLap * 1000));
    const best = this.mode === 'race' ? player.bestLap : race.bestLap;
    this._text('best', this.el.best, formatTime(best == null ? null : best * 1000));
    if (s.delta != null && this.mode === 'timetrial') {
      this.el.delta.hidden = false;
      this._text('delta', this.el.delta, formatDelta(s.delta * 1000));
      const cls = `delta ${s.delta <= 0 ? 'ahead' : 'behind'}`;
      if (this.el.delta.className !== cls) this.el.delta.className = cls;
    } else if (!this.el.delta.hidden) this.el.delta.hidden = true;

    // drift
    const d = race.drift;
    if (d.active && d.combo > 30) {
      this.el.drift.hidden = false;
      this._text('driftPts', this.el.driftPts, Math.round(d.combo).toLocaleString('en-US'));
      this._text('driftMult', this.el.driftMult, `×${d.multiplier}`);
    } else if (!this.el.drift.hidden) this.el.drift.hidden = true;
    if (this.mode === 'free') this._text('driftSum', this.el.driftSum, Math.round(d.total).toLocaleString('en-US'));
    this.el.wrong.hidden = !race.wrongWay;

    this._drawTach(player.physics);
    this._drawMap(cars, player, s.ghost);
  }

  _updateTower(race, player) {
    const rows = race.order
      .map((car) => {
        let gap = '';
        if (car.position === 1) gap = car.finished ? 'FIN' : 'LEADER';
        else {
          const down = race.lapsDown(car);
          if (down >= 1 && !car.finished) gap = `+${down}L`;
          else {
            const g = race.gapToLeader(car);
            gap = g == null ? '' : `+${g.toFixed(1)}`;
          }
        }
        const me = car === player ? ' me' : '';
        return `<li class="${me}"><span class="p">${car.position}</span><span class="bar" style="--c:${car.color}"></span><span class="code">${car.code}</span><span class="gap">${gap}</span></li>`;
      })
      .join('');
    if (rows !== this._last.tower) {
      this.el.tower.innerHTML = rows;
      this._last.tower = rows;
    }
  }

  setFps(visible, fps) {
    this.el.fps.hidden = !visible;
    if (visible) this._text('fps', this.el.fps, `${fps} fps`);
  }

  _drawTach(ph) {
    const ctx = this.tach;
    const S = this.tachSize;
    const c = S / 2;
    const R = S * 0.44;
    ctx.clearRect(0, 0, S, S);
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const maxRpm = 9000;
    const red = ph.spec.redline;
    const rpm = clamp(ph.rpm, 0, maxRpm);
    const shift = rpm > ph.spec.shiftUpRpm - 350;

    // body
    const g = ctx.createRadialGradient(c, c * 0.9, R * 0.1, c, c, R * 1.1);
    g.addColorStop(0, 'rgba(22,28,40,0.82)');
    g.addColorStop(1, 'rgba(8,11,18,0.82)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = shift && Math.floor(performance.now() / 70) % 2 ? 'rgba(255,64,64,0.95)' : 'rgba(232,237,245,0.16)';
    ctx.stroke();

    // redline zone
    const ang = (r) => a0 + (r / maxRpm) * sweep;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,64,64,0.55)';
    ctx.beginPath();
    ctx.arc(c, c, R - 3, ang(red - 700), ang(maxRpm));
    ctx.stroke();

    // ticks + numerals
    ctx.lineCap = 'butt';
    for (let r = 0; r <= maxRpm; r += 250) {
      const a = ang(r);
      const major = r % 1000 === 0;
      const len = major ? S * 0.05 : S * 0.024;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      ctx.strokeStyle = r >= red - 700 ? 'rgba(255,90,90,0.95)' : major ? 'rgba(238,241,245,0.9)' : 'rgba(238,241,245,0.4)';
      ctx.lineWidth = major ? 2.4 : 1.2;
      ctx.beginPath();
      ctx.moveTo(c + cs * (R - 10), c + sn * (R - 10));
      ctx.lineTo(c + cs * (R - 10 - len), c + sn * (R - 10 - len));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = r >= red - 700 ? '#ff6b6b' : 'rgba(238,241,245,0.75)';
        ctx.font = `600 ${Math.round(S * 0.05)}px ${this.fontsReady ? '"Chivo Mono"' : 'monospace'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const rr = R - 10 - S * 0.1;
        ctx.fillText(String(r / 1000), c + cs * rr, c + sn * rr);
      }
    }

    // rpm arc
    const aR = ang(rpm);
    const grad = ctx.createLinearGradient(c - R, c, c + R, c);
    grad.addColorStop(0, '#ffe2a3');
    grad.addColorStop(0.6, '#ffb21a');
    grad.addColorStop(1, '#ff4d2e');
    ctx.strokeStyle = shift ? '#ff4d2e' : grad;
    ctx.lineWidth = S * 0.028;
    ctx.shadowColor = shift ? 'rgba(255,77,46,0.9)' : 'rgba(255,178,26,0.7)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(c, c, R + 2, a0, aR);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // marker
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c + Math.cos(aR) * (R + 2), c + Math.sin(aR) * (R + 2), S * 0.018, 0, Math.PI * 2);
    ctx.fill();

    // nitro gauge in the bottom gap
    const n0 = Math.PI * 0.69;
    const n1 = Math.PI * 0.31;
    ctx.lineWidth = S * 0.022;
    ctx.strokeStyle = 'rgba(82,200,255,0.18)';
    ctx.beginPath();
    ctx.arc(c, c, R - 2, n1, n0);
    ctx.stroke();
    ctx.strokeStyle = ph.nitroActive ? '#b8ecff' : '#52c8ff';
    ctx.shadowColor = 'rgba(82,200,255,0.8)';
    ctx.shadowBlur = ph.nitroActive ? 16 : 6;
    ctx.beginPath();
    ctx.arc(c, c, R - 2, n0 - (n0 - n1) * ph.nitro, n0);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // speed + gear
    const kmh = ph.speed * 3.6;
    const v = this.units === 'mph' ? kmh * 0.621371 : kmh;
    ctx.fillStyle = '#eef1f5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `900 ${Math.round(S * 0.25)}px ${this.fontsReady ? '"Big Shoulders Display"' : 'Impact, sans-serif'}`;
    ctx.fillText(String(Math.round(v)), c, c + S * 0.1);
    ctx.font = `600 ${Math.round(S * 0.042)}px ${this.fontsReady ? '"Saira Semi Condensed"' : 'sans-serif'}`;
    ctx.fillStyle = 'rgba(149,160,179,0.95)';
    ctx.fillText(this.units === 'mph' ? 'MPH' : 'KM/H', c, c + S * 0.17);
    const gear = ph.reverse ? 'R' : ph.speed < 0.5 && ph.throttle < 0.05 ? 'N' : String(ph.gear);
    const gy = c - S * 0.2;
    ctx.strokeStyle = shift ? '#ff4d2e' : 'rgba(232,237,245,0.28)';
    ctx.lineWidth = 1.5;
    const bw = S * 0.13;
    ctx.strokeRect(c - bw / 2, gy - bw * 0.62, bw, bw * 0.9);
    ctx.fillStyle = shift ? '#ff6b4d' : '#ffb21a';
    ctx.font = `800 ${Math.round(S * 0.085)}px ${this.fontsReady ? '"Big Shoulders Display"' : 'Impact, sans-serif'}`;
    ctx.fillText(gear, c, gy + bw * 0.13);
    ctx.font = `600 ${Math.round(S * 0.034)}px ${this.fontsReady ? '"Chivo Mono"' : 'monospace'}`;
    ctx.fillStyle = 'rgba(149,160,179,0.8)';
    ctx.fillText('N₂O', c, c + S * 0.36);
  }

  _drawMap(cars, player, ghost) {
    const ctx = this.map;
    const S = this.mapSize;
    ctx.clearRect(0, 0, S, S);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(4,6,10,0.85)';
    ctx.lineWidth = 8;
    ctx.stroke(this.mapPath);
    ctx.strokeStyle = 'rgba(238,241,245,0.82)';
    ctx.lineWidth = 3;
    ctx.stroke(this.mapPath);
    // start line
    const t = this.track;
    const [sx, sy] = this.mapTransform(t.px[0], t.pz[0]);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-t.heading[0] + Math.PI / 2);
    ctx.fillStyle = '#ffb21a';
    ctx.fillRect(-1.5, -6, 3, 12);
    ctx.restore();
    if (ghost) {
      const [gx, gy] = this.mapTransform(ghost.x, ghost.z);
      ctx.strokeStyle = 'rgba(120,210,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const car of cars) {
      if (car === player) continue;
      const [x, y] = this.mapTransform(car.physics.x, car.physics.z);
      ctx.fillStyle = car.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const [px, py] = this.mapTransform(player.physics.x, player.physics.z);
    ctx.save();
    ctx.translate(px, py);
    // yaw: forward (sin ψ, cos ψ) in x/z → canvas angle
    ctx.rotate(Math.atan2(Math.cos(player.physics.yaw), Math.sin(player.physics.yaw)));
    ctx.fillStyle = '#ffb21a';
    ctx.strokeStyle = '#0b0f17';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
