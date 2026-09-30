# Lumenom Racer

A 3D racing game that runs in the browser, built with [Three.js](https://threejs.org/).
Everything you see and hear is generated in code at load time: the circuit, terrain,
trees, the car, every texture and every sound. The game ships no image, model or audio files.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

Build a static version with `npm run build` (output in `dist/`, which any static host can serve),
and run the tests with `npm test`.

A WebGL 2 capable browser is required (current Chrome, Edge, Firefox or Safari).

### Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle | `W` / `↑` | Right trigger |
| Brake, hold to reverse | `S` / `↓` | Left trigger |
| Steer | `A` `D` / `←` `→` | Left stick |
| Handbrake (start a drift) | `Space` | A |
| Nitro | `Shift` | X |
| Change camera | `C` | Y |
| Reset to track | `R` | Back |
| Pause | `Esc` / `P` | Start |
| Mute · hide HUD · frame rate | `M` · `H` · `F` | |

Phones and tablets get on-screen controls. Drifting and tucking in behind a rival
(slipstream) refill nitro.

## Modes

- **Race**: 1–10 laps against up to 7 AI rivals, with an F1-style five-light start,
  a live timing tower with gaps, and a results table.
- **Time Trial**: set laps alone. Your best lap is saved and replayed as a hologram
  ghost, with a live delta and purple/green/yellow sector colours.
- **Free Drive**: the open circuit with drift scoring.

Settings cover time of day (sunset, midday, night), four graphics tiers, lap count,
number of rivals, rival pace, units and volume. They persist in `localStorage`.

## What's inside

**Circuit.** *Lumenom Ring* is a 3.15 km loop defined by 31 control points. A
Catmull-Rom spline is sampled every 2 m into frames carrying elevation, banking,
curbs, grass or gravel runoff, and barrier offsets. The same cross-section function
builds the road mesh and answers the physics' height queries, so the wheels sit
exactly on what you see. A minimum-curvature racing line and a friction-circle speed
profile are computed for the AI.

**World.** A chunked heightfield (4 m cells near the track, growing to 64 m at the
horizon) blends from the verges into hills, an infield lake and a ring of mountains.
About 13,600 instanced trees with distance LOD, 26,000 grass tufts that sway in the wind,
grandstands with crowds, pit garages, a start gantry whose lights run the countdown,
sponsor boards (all brands are fictional), a footbridge, braking boards and chevrons.

**Car.** The supercar body is a lofted parametric surface: superellipse cross-sections
with spline-interpolated parameters and wheel arches carved into the floor line. The
glasshouse is a second loft with diagonal A- and C-pillars. Headlights, intakes and
skirts are patches evaluated on the same surface so they sit flush. Clear-coated paint
reflects an environment map rendered from the sky. Wheels for every car are drawn
through shared instanced meshes.

**Physics.** A bicycle model with a Pacejka-style tyre curve, friction circle on the
driven axle, weight transfer, downforce, ABS and brake distribution, a torque-curve
engine with a six-speed automatic, speed-sensitive steering with countersteer assist,
a drift state for handbrake slides, slipstream, nitro, surface grip, and vertical
dynamics so the back-section crest goes light (and airborne with nitro). It steps
at 120 Hz or faster, independent of frame rate.

**AI.** Pure-pursuit steering on the racing line, lane limits around nearby cars,
passing only where there is room, time-to-contact braking, yielding on the outside of
corners, staggered launches, slide recovery, nitro on straights and mild rubber-banding.

**Rendering.** Physically based materials, ACES tone mapping, a Preetham sky with
clouds (or a star field and moon at night), sun-tinted height fog patched into every
shader, texel-snapped soft shadows that follow the car, and a post chain of 4× MSAA,
GTAO (Ultra), bloom and a lens pass (sun flare, speed blur, chromatic aberration,
grading, vignette and grain). At night, real point lights hop between the nearest
street lamps and the cars carry spot lights.

**Audio.** Web Audio synthesis: a V8 built from damped exhaust-pulse cycles
(two RPM layers, load-dependent filtering, induction roar and backfires), tyre squeal,
wind, surface rumble, curb buzz, impacts, scraping, nitro, crowd, and doppler-shifted
engines for nearby rivals.

## Project layout

```
src/
  main.js              boot, loading screen, debug URL hooks
  Game.js              renderer, main loop, game flow
  world/               track, terrain, vegetation, props, sky, lighting, textures
  vehicle/             car physics, procedural car model, instanced wheels
  ai/                  AI driver
  race/                race manager (laps, sectors, gaps), ghost
  fx/                  particles, skid marks, post-processing
  audio/               synthesized sound
  camera/              chase, hood, bumper, orbit and TV cameras
  ui/                  HUD, menus, touch controls
tests/                 Vitest suites for track, physics, race logic and AI
```

Debug hooks for testing: `?demo=race` starts a race on autopilot, and `ff=<seconds>`
fast-forwards it. `tod=night`, `q=ultra` and `cam=hood` set lighting, graphics tier and camera.

## License

MIT
