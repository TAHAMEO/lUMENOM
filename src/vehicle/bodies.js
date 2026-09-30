// Car bodies the player can drive. Each entry ties a visual model to the
// geometry the simulation needs: axle positions and track (physics spec),
// collision outline, headlamp positions and in-car camera mounts. All
// positions are in the car's local frame: +Z forward, +Y up, +X left, origin at
// the centre of gravity on the ground.
//
// Engine, gearbox and grip stay shared so every body races on equal terms.

export const BODIES = {
  lumenom: {
    id: 'lumenom',
    name: 'Lumenom GT',
    spec: {},
    extents: {
      front: 2.21,
      rear: 2.43,
      halfWidth: 0.99,
      circles: [
        [1.3, 1.0],
        [0.0, 1.02],
        [-1.45, 1.02],
      ],
    },
    headlamps: [
      [0.62, 0.68, 2.05],
      [-0.62, 0.68, 2.05],
    ],
    cams: { hood: [0, 1.12, 0.25], hoodLook: [0, 1.0, 30], bumper: [0, 0.5, 2.3], bumperLook: [0, 0.45, 30] },
    sharedWheels: true,
  },
  slk: {
    id: 'slk',
    name: 'SLK 200',
    // R172: 2430 mm wheelbase, 1559/1565 mm track, 19" wheels, 52:48 weight split
    spec: {
      mass: 1435,
      inertia: 2050,
      cgToFront: 1.165,
      cgToRear: 1.265,
      cgHeight: 0.5,
      halfTrack: 0.781,
      wheelRadius: 0.32,
    },
    extents: {
      front: 2.05,
      rear: 2.08,
      halfWidth: 0.91,
      circles: [
        [1.15, 0.92],
        [0.0, 0.93],
        [-1.2, 0.93],
      ],
    },
    headlamps: [
      [0.66, 0.66, 1.7],
      [-0.66, 0.66, 1.7],
    ],
    // driver's eye (left-hand drive) and the grille
    cams: { hood: [0.37, 1.15, -0.64], hoodLook: [0.37, 1.0, 30], bumper: [0, 0.45, 2.1], bumperLook: [0, 0.42, 30] },
    sharedWheels: false,
  },
};

export const BODY_LIST = Object.values(BODIES);

export const bodyOf = (id) => BODIES[id] || BODIES.lumenom;
