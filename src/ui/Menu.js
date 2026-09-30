// Menu, settings, controls, pause and results screens (DOM bindings only;
// the game decides what each action does).

import { PAINTS } from '../vehicle/CarModel.js';
import { BODY_LIST } from '../vehicle/bodies.js';
import { formatTime, ordinal } from '../core/math.js';

const $ = (id) => document.getElementById(id);

export const RIMS = [
  { id: 'silver', name: 'Silver' },
  { id: 'gunmetal', name: 'Gunmetal' },
  { id: 'black', name: 'Black' },
  { id: 'bronze', name: 'Bronze' },
];

export class Menu {
  constructor(game) {
    this.game = game;
    this.menu = $('menu');
    this.settingsEl = $('settings');
    this.controlsEl = $('controls');
    this.pauseEl = $('pause');
    this.resultsEl = $('results');
    this._build();
  }

  _build() {
    const g = this.game;
    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        g.audio.init();
        g.audio.ui();
        fn(e);
      });
    click('btn-race', () => g.startMode('race'));
    click('btn-tt', () => g.startMode('timetrial'));
    click('btn-free', () => g.startMode('free'));
    click('btn-settings', () => this.openSettings());
    click('btn-controls', () => (this.controlsEl.hidden = false));
    click('controls-close', () => (this.controlsEl.hidden = true));
    click('settings-close', () => this.closeSettings());
    click('btn-resume', () => g.resume());
    click('btn-restart', () => g.restart());
    click('btn-pause-settings', () => this.openSettings());
    click('btn-quit', () => g.quitToMenu());
    click('btn-again', () => g.restart());
    click('btn-menu', () => g.quitToMenu());
    click('btn-pause', () => g.pause());
    for (const sheet of [this.settingsEl, this.controlsEl]) {
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) {
          if (sheet === this.settingsEl) this.closeSettings();
          else sheet.hidden = true;
        }
      });
    }

    // garage
    const cars = $('cars');
    cars.innerHTML = BODY_LIST.map((b) => `<button class="chip" role="radio" data-id="${b.id}" id="car-${b.id}">${b.name}</button>`).join('');
    cars.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b || b.disabled) return;
      g.audio.init();
      g.audio.ui();
      g.applySettings({ car: b.dataset.id });
    });
    const sw = $('swatches');
    sw.innerHTML = PAINTS.map(
      (p) => `<button class="swatch" role="radio" data-id="${p.id}" style="--c:${p.color}" aria-label="${p.name}" title="${p.name}"></button>`,
    ).join('');
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b) return;
      g.audio.init();
      g.audio.ui();
      g.applySettings({ paint: b.dataset.id });
    });
    const rims = $('rims');
    rims.innerHTML = RIMS.map((r) => `<button class="chip" role="radio" data-id="${r.id}">${r.name}</button>`).join('');
    rims.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      g.audio.init();
      g.audio.ui();
      g.applySettings({ rim: b.dataset.id });
    });

    // settings controls
    const seg = (id, key) => {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        g.audio.ui();
        g.applySettings({ [key]: b.dataset.v });
      });
    };
    seg('set-tod', 'timeOfDay');
    seg('set-quality', 'quality');
    seg('set-units', 'units');
    seg('set-difficulty', 'difficulty');
    const stepper = (id, key, min, max) => {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        g.audio.ui();
        const v = Math.max(min, Math.min(max, g.settings[key] + Number(b.dataset.d)));
        g.applySettings({ [key]: v });
      });
    };
    stepper('set-laps', 'laps', 1, 10);
    stepper('set-opp', 'opponents', 0, 7);
    $('set-volume').addEventListener('input', (e) => g.applySettings({ volume: Number(e.target.value) }));
    $('set-fps').addEventListener('change', (e) => g.applySettings({ showFps: e.target.checked }));
  }

  /** Reflect settings in every control. */
  sync(settings, records) {
    const mark = (container, attr, value) => {
      for (const b of container.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === String(value)));
    };
    mark($('cars'), 'id', settings.car);
    mark($('swatches'), 'id', settings.paint);
    mark($('rims'), 'id', settings.rim);
    mark($('set-tod'), 'v', settings.timeOfDay);
    mark($('set-quality'), 'v', settings.quality);
    mark($('set-units'), 'v', settings.units);
    mark($('set-difficulty'), 'v', settings.difficulty);
    $('set-laps').querySelector('output').textContent = settings.laps;
    $('set-opp').querySelector('output').textContent = settings.opponents;
    $('set-volume').value = settings.volume;
    $('set-fps').checked = settings.showFps;
    const rivals = settings.opponents === 0 ? 'solo' : `against ${settings.opponents} rival${settings.opponents > 1 ? 's' : ''}`;
    $('meta-race').textContent = `${settings.laps} lap${settings.laps > 1 ? 's' : ''} ${rivals}`;
    const best = records?.bestLap;
    $('meta-tt').textContent = best ? `Beat your ghost · best ${formatTime(best * 1000)}` : 'Set a lap, then chase your ghost';
    $('stat-record').textContent = best ? formatTime(best * 1000) : '—';
  }

  /** Show that a car body is being built (the SLK takes a moment the first time). */
  setCarBusy(id, busy) {
    for (const b of $('cars').querySelectorAll('button')) {
      b.disabled = busy;
      if (b.dataset.id === id) b.classList.toggle('is-busy', busy);
    }
  }

  setTrackStats(track) {
    $('stat-length').textContent = `${(track.length / 1000).toFixed(2)} km`;
    let corners = 0;
    let inCorner = false;
    for (let i = 0; i < track.n; i++) {
      const k = Math.abs(track.curvature[i]);
      if (!inCorner && k > 1 / 180) {
        corners++;
        inCorner = true;
      } else if (inCorner && k < 1 / 400) inCorner = false;
    }
    $('stat-corners').textContent = String(corners);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < track.n; i++) {
      lo = Math.min(lo, track.py[i]);
      hi = Math.max(hi, track.py[i]);
    }
    $('stat-elev').textContent = `${Math.round(hi - lo)} m`;
    // map
    const c = $('trackmap');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 240;
    const H = 160;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const pad = 12;
    const s = Math.min((W - pad * 2) / (track.maxX - track.minX), (H - pad * 2) / (track.maxZ - track.minZ));
    const ox = (W - (track.maxX - track.minX) * s) / 2;
    const oy = (H - (track.maxZ - track.minZ) * s) / 2;
    const P = (i) => [ox + (track.px[i] - track.minX) * s, oy + (track.pz[i] - track.minZ) * s];
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= track.n; i += 3) {
      const [x, y] = P(i % track.n);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(238,241,245,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // elevation-coloured highlight of the climb
    const [sx, sy] = P(0);
    ctx.fillStyle = '#ffb21a';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  showMenu() {
    this.menu.hidden = false;
    this.pauseEl.hidden = true;
    this.resultsEl.hidden = true;
  }

  hideMenu() {
    this.menu.hidden = true;
    this.settingsEl.hidden = true;
    this.controlsEl.hidden = true;
  }

  openSettings() {
    this.settingsEl.hidden = false;
  }

  closeSettings() {
    this.settingsEl.hidden = true;
  }

  showPause(v) {
    this.pauseEl.hidden = !v;
    if (!v) this.settingsEl.hidden = true;
  }

  showResults(rows, { mode, laps, playerCar, title }) {
    const me = rows.find((r) => r.car === playerCar);
    const place = me ? me.position : 1;
    $('res-place').innerHTML = `${place}<small>${ordinal(place).replace(String(place), '')}</small>`;
    $('res-title').textContent = title || (place === 1 ? 'Victory' : `Finished ${ordinal(place).toLowerCase()}`);
    $('res-sub').textContent = `Lumenom Ring · ${laps} lap${laps > 1 ? 's' : ''}`;
    $('res-body').innerHTML = rows
      .map((r) => {
        let time;
        if (typeof r.gap === 'string') time = r.gap;
        else if (r.position === 1 && r.gap != null) time = formatTime(r.gap * 1000);
        else if (r.gap != null) time = `+${(r.gap).toFixed(3)}${r.finished ? '' : ' *'}`;
        else time = 'Running';
        return `<tr class="${r.car === playerCar ? 'me' : ''}"><td>${r.position}</td><td><span class="swatch-dot" style="--c:${r.car.color}"></span>${r.car.name}</td><td>${time}</td><td>${r.bestLap ? formatTime(r.bestLap * 1000) : '—'}</td></tr>`;
      })
      .join('');
    this.resultsEl.hidden = false;
  }

  hideResults() {
    this.resultsEl.hidden = true;
  }
}
