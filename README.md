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

## Cars

Pick your car in the garage on the main menu:

- **Lumenom GT**, the game's own supercar.
- **Mercedes-Benz SLK 200** (R172, 2011–2016) in AMG Line trim with the roof stowed.
  Its physics use the real car's 2,430 mm wheelbase, 1,559/1,565 mm tracks and 19-inch
  wheels; engine and grip are shared with the GT so races stay close. The in-car camera
  (`C`) puts you in the driver's seat, where the dials follow the engine and road speed.

## Showroom

`/showroom.html` (the **Showroom** button on the menu) is a studio viewer for the SLK 200:
orbit and zoom, eight period Mercedes paints, left- or right-hand drive, headlamps, a
turntable, camera presets including the angle of the reference press photo, and
**Download .glb** to take the model into Blender or any glTF viewer.

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

**SLK 200.** The body is a signed distance field built from blueprint-style profiles:
plan width with tumblehome and a shoulder crease, a hood that dips between the fender
crowns and carries twin power domes, a crowned rear deck, and nose and tail profiles swept
back in plan view, all blended with fillets. It is meshed by casting rays from the plan
view's medial axis, spaced by curvature so creases and fillets get more vertices, then the
openings (arches, cockpit, grille, intakes, lamps, vent, plate recess, diffuser) are cut as
trims whose boundaries carry lips, walls, lenses and chrome. The tail lamps use a
cylindrical trim so they wrap around the corners. Proportions were fitted to a reference
press photo: its camera was solved from the wheels and the horizon, then the body was
adjusted until photo silhouette rays grazed it (within about 2 cm) and feature outlines
were projected onto it.

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
  vehicle/             car physics, procedural car model, instanced wheels, car bodies
    slk/               SLK 200: shape field, mesher, exterior, cabin, wheels, textures
  showroom/            SLK 200 studio viewer and glTF export
  ai/                  AI driver
  race/                race manager (laps, sectors, gaps), ghost
  fx/                  particles, skid marks, post-processing
  audio/               synthesized sound
  camera/              chase, hood, bumper, orbit and TV cameras
  ui/                  HUD, menus, touch controls
tests/                 Vitest suites for track, physics, race logic, AI and the SLK model
```

Debug hooks for testing: `?demo=race` starts a race on autopilot, and `ff=<seconds>`
fast-forwards it. `tod=night`, `q=ultra`, `cam=hood` and `car=slk` set lighting, graphics
tier, camera and car. The showroom takes `?shots=f34,side:900x450` to render views offscreen
and `?mask=1` for a paint silhouette (used to compare against the reference photo).

## License

MIT. Mercedes-Benz, SLK and the three-pointed star are trademarks of Mercedes-Benz Group AG;
the SLK 200 here is an unofficial, fan-made model and is not endorsed by them.
