// Game: owns the renderer and every subsystem, runs the main loop and the
// high-level flow (loading → menu → countdown → race → results).

import * as THREE from 'three';
import { installFogPatch } from './world/fogPatch.js';
import { World } from './world/World.js';
import { createShadowBlobTexture, setMaxAnisotropy } from './world/textures.js';
import { Car } from './vehicle/Car.js';
import { PAINTS } from './vehicle/CarModel.js';
import { WheelInstances } from './vehicle/WheelInstances.js';
import { AIDriver, AI_CAPABILITY } from './ai/AIDriver.js';
import { CameraRig } from './camera/CameraRig.js';
import { Input } from './core/Input.js';
import { Effects } from './fx/Effects.js';
import { PostFX } from './fx/PostFX.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { RaceManager } from './race/RaceManager.js';
import { Ghost } from './race/Ghost.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { setupTouchControls } from './ui/TouchControls.js';
import { QUALITY, loadSave, writeSave } from './core/Settings.js';
import { clamp, formatTime, ordinal, smoothstep } from './core/math.js';

const RIVALS = [
  { name: 'Aria Voss', code: 'VOS', color: '#c8101e', rim: 'black', caliper: '#f2c200', wing: true, skill: 0.99 },
  { name: 'Kenji Sato', code: 'SAT', color: '#e9eef2', rim: 'gunmetal', caliper: '#d11a1a', wing: false, skill: 0.975 },
  { name: 'Mateo Ruiz', code: 'RUI', color: '#1f6fd6', rim: 'silver', caliper: '#ffb21a', wing: true, skill: 0.965 },
  { name: 'Lena Brandt', code: 'BRA', color: '#1d6b4c', rim: 'bronze', caliper: '#d11a1a', wing: false, skill: 0.955 },
  { name: 'Omar Haddad', code: 'HAD', color: '#c9e22b', rim: 'black', caliper: '#1a1a1a', wing: true, skill: 0.945 },
  { name: 'Noor Haidari', code: 'HAI', color: '#5b6068', rim: 'silver', caliper: '#ff5a1f', wing: false, skill: 0.935 },
  { name: 'Felix Moreau', code: 'MOR', color: '#16233f', rim: 'bronze', caliper: '#e8e8e8', wing: true, skill: 0.925 },
];
const DIFFICULTY = { easy: 0.9, medium: 0.955, hard: 1.0 };
const STEP = 1 / 120;

const _v = new THREE.Vector3();
const _sun = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    const save = loadSave();
    this.settings = save.settings;
    this.records = save.records;
    this.state = 'loading';
    this.paused = false;
    this.mode = 'race';
    this.autopilot = false;
    this.time = 0;
    this.fps = { frames: 0, acc: 0, value: 60 };
    this.resultsTimer = -1;
  }

  async init(progress = () => {}) {
    installFogPatch();
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
    this.world = new World(renderer, this.scene);
    this.world.presetKey = this.settings.timeOfDay;
    await this.world.build(progress);
    const track = (this.track = this.world.track);
    track.computeSpeedProfile(AI_CAPABILITY);

    progress(0.96, 'Rolling out the cars');
    await new Promise((r) => setTimeout(r, 0));
    this.shadowTex = createShadowBlobTexture();
    this.wheels = new WheelInstances(this.scene, RIVALS.length + 1);
    this.player = this._makeCar({
      id: 0,
      name: 'You',
      code: 'YOU',
      color: this._paint(),
      rim: this.settings.rim,
      caliper: '#d11a1a',
      wing: true,
      plate: 'LMN 01',
      isPlayer: true,
    });
    this.playerAI = new AIDriver(this.player, track, { skill: 0.9, seed: 99 });
    this.rivalCars = [];
    this.ais = [];
    for (let i = 0; i < RIVALS.length; i++) {
      const r = RIVALS[i];
      const car = this._makeCar({ id: i + 1, ...r, plate: `${r.code} ${i + 2}` });
      car.model.root.visible = false;
      this.rivalCars.push(car);
      this.ais.push(new AIDriver(car, track, { skill: r.skill, seed: i + 11 }));
    }
    this.cars = [this.player];

    this.effects = new Effects(this.scene);
    this.rig = new CameraRig(this.camera, track);
    this.rig.groundHeight = (x, z) => this.world.terrain.heightAt(x, z);
    this.input = new Input();
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.race = new RaceManager(track);
    this.ghost = new Ghost(this.scene);
    this.ghost.load(this.records.ghost);
    this.race.bestLap = this.records.bestLap ?? null;
    this.post = new PostFX(renderer, this.scene, this.camera);
    this.hud = new HUD(track);
    this.hud.units = this.settings.units;
    this.menu = new Menu(this);
    this.menu.setTrackStats(track);
    this.touch = setupTouchControls(this.input);

    // Night headlights: two real spots on the player, a pool of two for rivals.
    this.headlights = this._makeHeadlights(this.player);
    this.rivalSpots = [0, 1].map(() => {
      const s = new THREE.SpotLight(0xfff1dc, 0, 70, 0.5, 0.6, 1.6);
      s.visible = false;
      this.scene.add(s, s.target);
      return s;
    });

    this.applyQuality(this.settings.quality);
    this._applyTimeOfDay();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'race' && !this.paused && this.race.state !== 'finished') this.pause();
        this.audio.suspend();
      } else if (!this.paused) this.audio.resume();
    });

    this.gotoMenu();
    progress(1, 'Ready');
    // Warm up shader programs so the first frames don't hitch.
    try {
      await renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* optional */
    }
  }

  _paint() {
    return (PAINTS.find((p) => p.id === this.settings.paint) || PAINTS[0]).color;
  }

  _makeCar(opts) {
    const car = new Car({ track: this.track, ...opts });
    car.model.attachContactShadow(this.shadowTex);
    this.scene.add(car.model.root);
    this.wheels.register(car.model);
    return car;
  }

  _makeHeadlights(car) {
    const lights = [];
    for (const x of [0.62, -0.62]) {
      const s = new THREE.SpotLight(0xfff4e0, 0, 95, 0.42, 0.55, 1.5);
      s.position.set(x, 0.68, 2.05);
      s.target.position.set(x * 1.6, 0.0, 22);
      car.model.root.add(s, s.target);
      s.visible = false;
      lights.push(s);
    }
    return lights;
  }

  start() {
    this.last = performance.now();
    const loop = (now) => {
      const dt = clamp((now - this.last) / 1000, 0, 0.05);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // Flow

  _gridUp(mode) {
    const opp = mode === 'race' ? this.settings.opponents : 0;
    const slots = this.track.gridSlots(opp + 1);
    this.cars = [this.player];
    const scale = DIFFICULTY[this.settings.difficulty] ?? 0.955;
    // rivals never share the player's paint
    const taken = this._paint().toLowerCase();
    const spare = PAINTS.map((p) => p.color).filter((c) => c.toLowerCase() !== taken && !RIVALS.some((r) => r.color.toLowerCase() === c.toLowerCase()));
    for (let i = 0; i < this.rivalCars.length; i++) {
      const car = this.rivalCars[i];
      const active = i < opp;
      car.model.root.visible = active;
      if (!active) continue;
      let color = RIVALS[i].color;
      if (color.toLowerCase() === taken) color = spare[0] || '#888888';
      car.color = color;
      car.model.setPaint(color);
      const ai = this.ais[i];
      ai.baseSkill = RIVALS[i].skill * scale;
      ai.skill = ai.baseSkill;
      ai.stuckTimer = 0;
      car.placeAt(slots[i]);
      this.cars.push(car);
    }
    this.player.placeAt(slots[opp]);
    this.player.color = this._paint();
    for (const car of this.cars) {
      car.input.hold = true;
      car.input.throttle = 0;
      car.input.brake = 1;
      car.input.steer = 0;
      car.input.handbrake = false;
      car.input.nitro = false;
      car.headlights = this.world.preset.night;
    }
    this.effects.clear();
  }

  gotoMenu() {
    this.state = 'menu';
    this.paused = false;
    this.autopilot = false;
    this.resultsTimer = -1;
    this._gridUp('race');
    this.hud.hide();
    this.touch.hide();
    this.menu.showMenu();
    this.menu.sync(this.settings, this.records);
    this.rig.setMode('orbit', true);
    this.rig.orbitAngle = 2.4;
    this.ghost.update(0, null, false);
    this.world.props.startLights.set(0);
    this.input.enabled = true;
  }

  startMode(mode) {
    this.audio.init();
    this.mode = mode;
    this.state = 'race';
    this.paused = false;
    this.autopilot = false;
    this.resultsTimer = -1;
    this._gridUp(mode);
    this.race.setup(mode, this.cars, this.player, {
      laps: this.settings.laps,
      bestLap: this.records.bestLap ?? null,
      bestSplits: this.records.bestSplits ?? null,
    });
    this.menu.hideMenu();
    this.menu.hideResults();
    this.menu.showPause(false);
    this.hud.show(mode);
    this.hud.clearSectors();
    this.touch.show();
    this.rig.setMode(this.settings.camera || 'chase');
    this.rig.camYaw = this.player.physics.yaw;
    this.world.props.startLights.set(0);
    this.race.startCountdown(mode === 'free');
    if (mode === 'free') this.hud.banner('Free drive', '', 2);
    this.prevSplits = null;
  }

  restart() {
    this.startMode(this.mode);
  }

  quitToMenu() {
    this.gotoMenu();
  }

  pause() {
    if (this.state !== 'race' || this.paused) return;
    this.paused = true;
    this.menu.showPause(true);
    this.audio.suspend();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.menu.showPause(false);
    this.menu.closeSettings();
    this.audio.resume();
    this.last = performance.now();
  }

  // ---------------------------------------------------------------------------
  // Settings

  applySettings(partial) {
    const prev = { ...this.settings };
    Object.assign(this.settings, partial);
    const s = this.settings;
    if (partial.quality && partial.quality !== prev.quality) this.applyQuality(s.quality);
    if (partial.timeOfDay && partial.timeOfDay !== prev.timeOfDay) this._applyTimeOfDay();
    if (partial.paint) {
      this.player.model.setPaint(this._paint());
      this.player.color = this._paint();
    }
    if (partial.rim) this._rebuildPlayerRims();
    if (partial.units) this.hud.units = s.units;
    if (partial.volume != null) this.audio.setVolume(s.volume);
    if ((partial.opponents != null || partial.difficulty) && this.state === 'menu') this._gridUp('race');
    this.menu.sync(s, this.records);
    this._save();
  }

  _rebuildPlayerRims() {
    const colors = { silver: 0xc9ccd0, black: 0x1b1c1f, bronze: 0x9c7a44, gunmetal: 0x4a4e55 };
    this.player.model.rimMat.color.setHex(colors[this.settings.rim] ?? colors.silver);
  }

  applyQuality(key) {
    const q = QUALITY[key] || QUALITY.high;
    this.quality = q;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    const wantShadows = q.shadows;
    if (this.renderer.shadowMap.enabled !== wantShadows) {
      this.renderer.shadowMap.enabled = wantShadows;
      this.scene.traverse((o) => {
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    this.world.applyQuality(q);
    this.effects.setDensity(q.particles);
    this.onResize();
    this.post.configure(q);
    this.post.setBloom(this.world.preset.bloom);
  }

  _applyTimeOfDay() {
    this.world.setTimeOfDay(this.settings.timeOfDay);
    const p = this.world.preset;
    this.post.setBloom(p.bloom);
    const night = !!p.night;
    for (const l of this.headlights) {
      l.visible = night;
      l.intensity = night ? 190 : 0;
    }
    for (const s of this.rivalSpots) {
      s.visible = night;
      s.intensity = night ? 55 : 0;
    }
    for (const car of [this.player, ...this.rivalCars]) car.headlights = night;
  }

  _save() {
    writeSave({ settings: this.settings, records: this.records });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
    this.hud?.resize();
  }

  // ---------------------------------------------------------------------------
  // Main loop

  frame(dt) {
    this.time += dt;
    const input = this.input.update();
    this._handleActions();
    if (!this.paused) this._simulate(dt, input);
    this._updateVisuals(dt);
    this._render(dt);
    for (const car of this.cars) {
      car.impacts.length = 0;
      car.frameEvents.length = 0;
    }
    // fps meter
    this.fps.frames++;
    this.fps.acc += dt;
    if (this.fps.acc >= 0.5) {
      this.fps.value = Math.round(this.fps.frames / this.fps.acc);
      this.fps.frames = 0;
      this.fps.acc = 0;
    }
  }

  /** Advance the simulation without rendering (used by demos and tests). */
  fastForward(seconds, step = 1 / 60) {
    const input = this.input.update();
    for (let t = 0; t < seconds; t += step) {
      this._simulate(step, input);
      for (const car of this.cars) {
        car.syncVisual(step);
        car.impacts.length = 0;
        car.frameEvents.length = 0;
      }
    }
  }

  _handleActions() {
    const inp = this.input;
    if (inp.consume('pause')) {
      if (this.state === 'race') {
        if (this.paused) this.resume();
        else if (this.race.state !== 'finished' || this.resultsTimer < 0) this.pause();
      } else if (this.state === 'menu') {
        this.menu.closeSettings();
        document.getElementById('controls').hidden = true;
      }
    }
    if (inp.consume('mute')) {
      this.audio.init();
      const muted = this.audio.toggleMute();
      if (this.state === 'race') this.hud.banner(muted ? 'Sound off' : 'Sound on', '', 1.2);
    }
    if (inp.consume('fps')) this.applySettings({ showFps: !this.settings.showFps });
    if (this.state !== 'race' || this.paused) {
      inp.clearActions();
      return;
    }
    if (inp.consume('camera')) {
      const m = this.rig.cycleDriveMode();
      this.settings.camera = m;
      this._save();
    }
    if (inp.consume('hud')) this.hud.toggleVisible();
    if (inp.consume('reset') && this.race.state === 'running' && !this.autopilot) {
      this.player.resetToTrack();
      this.rig.snapBehind(this.player);
    }
    inp.clearActions();
  }

  _simulate(dt, input) {
    const race = this.race;
    const racing = this.state === 'race' && (race.state === 'running' || race.state === 'finished');
    const p = this.player;
    const pin = p.input;
    if (this.state === 'race' && race.state === 'countdown') {
      // held on the line; throttle revs the engine
      pin.hold = true;
      pin.throttle = input.throttle;
      pin.brake = 1;
      pin.steer = 0;
      pin.handbrake = false;
      pin.nitro = false;
    } else if (racing && !this.autopilot) {
      pin.hold = false;
      pin.throttle = input.throttle;
      pin.brake = input.brake;
      pin.steer = input.steer;
      pin.handbrake = input.handbrake;
      pin.nitro = input.nitro;
      pin.analogSteer = input.analogSteer;
    } else if (!this.autopilot) {
      pin.hold = true;
      pin.throttle = 0;
      pin.brake = 1;
      pin.steer = 0;
      pin.handbrake = false;
      pin.nitro = false;
    } else pin.hold = false;
    const steps = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / steps;
    const cars = this.cars;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < cars.length; i++) {
        const car = cars[i];
        const ai = this.ais[this.rivalCars.indexOf(car)];
        ai.update(h, cars, p, racing);
      }
      if (this.autopilot) this.playerAI.update(h, cars, null, true);
      for (const car of cars) car.step(h);
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) Car.collide(cars[a], cars[b]);
    }
    if (this.state !== 'race') return;
    race.update(dt);
    this._raceEvents();
    // ghost recording/playback in time trial
    if (this.mode === 'timetrial' && p.nextCheckpoint > 0 && race.state === 'running') {
      const lapTime = race.time - p.lapStartTime;
      this.ghost.record(dt, lapTime, p);
      this.ghost.update(dt, lapTime, true);
      this.liveDelta = this.ghost.delta(lapTime, p.proj.distance);
    } else {
      this.ghost.update(dt, null, false);
      this.liveDelta = null;
    }
    if (this.resultsTimer > 0) {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) this._showResults();
    }
  }

  _raceEvents() {
    const hud = this.hud;
    const race = this.race;
    for (const e of race.events) {
      switch (e.type) {
        case 'light':
          hud.setLights(e.count);
          this.world.props.startLights.set(e.count);
          this.audio.beep(false);
          break;
        case 'go':
          hud.setLights(0);
          setTimeout(() => hud.setLights(-1), 900);
          this.world.props.startLights.set(0);
          if (this.mode !== 'free') {
            hud.bigText('Go', 'go', 1.1);
            this.audio.beep(true);
          }
          break;
        case 'lapStart':
          if (this.mode === 'timetrial') this.ghost.startLap();
          hud.clearSectors();
          break;
        case 'sector': {
          const best = e.best;
          const prev = this.prevSplits?.[e.sector];
          const cls = best != null && e.time < best ? 'purple' : prev != null && e.time < prev ? 'green' : best == null && prev == null ? 'green' : 'yellow';
          hud.setSector(e.sector, cls);
          break;
        }
        case 'invalid':
          hud.banner('Lap invalidated', '', 1.6);
          hud.clearSectors();
          if (this.mode === 'timetrial') this.ghost.startLap();
          break;
        case 'lap': {
          this.prevSplits = e.splits;
          hud.setSector(2, e.record ? 'purple' : e.personalBest ? 'green' : 'yellow');
          if (e.record) {
            this.records.bestLap = e.time;
            this.records.bestSplits = e.splits;
            if (this.mode === 'timetrial' && this.ghost.finishLap(true)) this.records.ghost = this.ghost.encode();
            this._save();
            hud.banner(`Lap record ${formatTime(e.time * 1000)}`, 'purple', 3);
          } else if (e.personalBest) {
            hud.banner(`Best lap ${formatTime(e.time * 1000)}`, 'green', 2.5);
          } else {
            hud.banner(`Lap ${formatTime(e.time * 1000)}`, '', 2);
          }
          if (this.mode === 'timetrial') this.ghost.startLap();
          setTimeout(() => hud.clearSectors(), 2500);
          break;
        }
        case 'finalLap':
          setTimeout(() => hud.banner('Final lap', '', 2.4), 2600);
          break;
        case 'finish':
          hud.bigText(e.place === 1 ? 'Winner' : ordinal(e.place), e.place === 1 ? 'go' : '', 3);
          this.autopilot = true;
          this.playerAI.skill = 0.82;
          setTimeout(() => {
            if (this.state === 'race' && this.race.state === 'finished') this.rig.setMode('tv');
          }, 1800);
          this.resultsTimer = 3.8;
          break;
        case 'driftBank':
          hud.banner(`Drift +${e.points.toLocaleString('en-US')}`, '', 1.4);
          if (this.mode === 'free' && e.points >= (this.records.bestDrift || 0)) {
            this.records.bestDrift = e.points;
            this._save();
          }
          break;
        default:
          break;
      }
    }
  }

  _showResults() {
    const rows = this.race.results();
    this.menu.showResults(rows, { mode: this.mode, laps: this.race.laps, playerCar: this.player });
    this.hud.hide();
    this.touch.hide();
  }

  _updateVisuals(dt) {
    for (const car of this.cars) car.syncVisual(this.paused ? 0 : dt);
    this.wheels.update();
    const p = this.player;
    this.rig.update(dt, p);
    const ph = p.physics;
    const fwd = _v.set(Math.sin(ph.yaw), 0, Math.cos(ph.yaw));
    this.world.update(dt, this.camera, p.model.root.position, fwd);
    const night = !!this.world.preset.night;
    if (!this.paused) this.effects.update(dt, this.cars, this.camera, this.renderer.domElement.height, night);
    // impacts shake the camera
    for (const hit of p.impacts) this.rig.shake(hit.strength * 0.9);
    for (const e of p.frameEvents) if (e.type === 'land') this.rig.shake(0.3 + e.strength);
    if (night) this._updateRivalSpots();
    this.audio.update(dt, {
      player: p,
      cars: this.cars,
      camera: this.camera,
      crowdPoint: this.world.props.exclusions[0],
      active: this.state === 'race',
    });
    if (this.state === 'race' && !this.hud.root.hidden) {
      this.hud.update(dt, {
        race: this.race,
        player: p,
        cars: this.cars,
        delta: this.liveDelta,
        ghost: this.ghost.model.root.visible ? this.ghost.model.root.position : null,
      });
    }
    this.hud.setFps(this.settings.showFps && this.state === 'race', this.fps.value);
  }

  _updateRivalSpots() {
    const cp = this.camera.position;
    const rivals = this.cars.filter((c) => c !== this.player);
    rivals.sort((a, b) => a.model.root.position.distanceToSquared(cp) - b.model.root.position.distanceToSquared(cp));
    this.rivalSpots.forEach((s, k) => {
      const car = rivals[k];
      if (!car) {
        s.intensity = 0;
        return;
      }
      s.intensity = 55;
      car.localToWorld(0, 0.7, 2.2, s.position);
      car.localToWorld(0, 0, 24, s.target.position);
      s.target.updateMatrixWorld();
    });
  }

  _render(dt) {
    if (this.skipRender) return;
    const fx = { radialBlur: 0, sunVisible: 0, vignette: 0.3 };
    if (this.state === 'race') {
      const ph = this.player.physics;
      const inCar = this.rig.mode === 'hood' || this.rig.mode === 'bumper';
      fx.radialBlur = smoothstep(55, 88, ph.speed) * 0.45 + (ph.nitroActive ? 0.55 : 0) + (inCar ? 0.1 : 0);
    }
    if (!this.world.preset.night && this.quality.post) {
      _sun.copy(this.world.sunDir).multiplyScalar(3000).add(this.camera.position);
      const ndc = _sun.project(this.camera);
      const facing = this.camera.getWorldDirection(_v).dot(this.world.sunDir) > 0;
      if (facing && Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3) {
        let vis = 1 - smoothstep(0.85, 1.3, Math.max(Math.abs(ndc.x), Math.abs(ndc.y)));
        // terrain occlusion along the sun ray
        const cp = this.camera.position;
        const d = this.world.sunDir;
        for (const dist of [15, 40, 90, 180, 350, 650, 1100, 1800, 2600]) {
          const x = cp.x + d.x * dist;
          const z = cp.z + d.z * dist;
          const y = cp.y + d.y * dist;
          if (this.world.terrain.heightAt(x, z) + 6 > y) {
            vis = 0;
            break;
          }
        }
        this.flareVis = (this.flareVis ?? 0) + (vis - (this.flareVis ?? 0)) * Math.min(1, dt * 8);
        fx.sunPos = (this._sunPos || (this._sunPos = new THREE.Vector2())).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
      } else this.flareVis = (this.flareVis ?? 0) * Math.max(0, 1 - dt * 8);
      fx.sunVisible = (this.flareVis ?? 0) * (this.world.presetKey === 'sunset' ? 1 : 0.3);
      this._sunTint = this._sunTint || new THREE.Color();
      fx.sunTint = this.world.presetKey === 'sunset' ? this._sunTint.setRGB(1, 0.62, 0.32) : this._sunTint.setRGB(1, 0.95, 0.85);
    }
    this.post.render(dt, fx);
  }
}
