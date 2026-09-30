import { Game } from './Game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function progress(p, msg) {
  $('loading-fill').style.width = `${Math.round(p * 100)}%`;
  $('loading-pct').textContent = `${Math.round(p * 100)}%`;
  if (msg) $('loading-status').textContent = msg;
}

function showError(err) {
  console.error(err);
  $('loading').hidden = true;
  $('error').hidden = false;
  const webgl = /webgl/i.test(String(err && err.message));
  $('error-text').textContent = webgl
    ? "This browser can't start WebGL 2, which the game needs. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration turned on."
    : `The game failed to start: ${err && err.message ? err.message : err}`;
}

async function start(hotData = {}) {
  const game = new Game($('scene'));
  window.__lumenom = game;
  if (hotData.settings) Object.assign(game.settings, hotData.settings);
  try {
    await game.init(progress);
  } catch (err) {
    showError(err);
    return;
  }
  window.claude?.hot?.snapshot?.(() => ({ settings: game.settings }));

  // Developer/test hooks: ?tod=night&q=ultra&demo=race&ff=8&cam=chase&manual=1
  if (params.get('tod')) game.applySettings({ timeOfDay: params.get('tod') });
  if (params.get('q')) game.applySettings({ quality: params.get('q') });
  const demo = params.get('demo');
  if (demo) {
    game.startMode(demo);
    game.race.startCountdown(true);
    game.autopilot = params.get('drive') !== 'manual';
    game.playerAI.skill = 0.97;
    if (params.get('cam')) game.rig.setMode(params.get('cam'), true);
    const ff = Number(params.get('ff') || 0);
    if (ff > 0) game.fastForward(ff);
    game.rig.snapBehind(game.player);
  } else if (params.get('cam')) {
    game.rig.setMode(params.get('cam'), true);
  }

  const loading = $('loading');
  if (params.get('manual')) {
    loading.hidden = true;
    for (let i = 0; i < 3; i++) game.frame(1 / 60);
    window.__ready = true;
    return;
  }
  game.start();
  loading.classList.add('fade');
  setTimeout(() => (loading.hidden = true), 700);
  window.__ready = true;
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
