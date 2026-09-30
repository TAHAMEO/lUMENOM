// "Lumenom Ring": a 3.3 km clockwise circuit with a long pit straight, a fast
// sweeper, an S-section into a hairpin, a climbing back section over a crest,
// a chicane and a forest sweep that feeds the final corner.
// Points are [x, y, z] in metres; y is elevation. +X is east, +Z is south.

export const LUMENOM_RING = {
  id: 'lumenom-ring',
  name: 'Lumenom Ring',
  halfWidth: 7,
  spacing: 2,
  // Where the start/finish line sits (the nearest sample becomes index 0).
  start: [-210, -306],
  // Distance-keyed humps added on top of the smoothed elevation (cosine bumps).
  // The back-section crest makes the car go light around 200 km/h.
  bumps: [{ at: 1650, height: 2.8, width: 78 }],
  points: [
    [-330, 0, -302],
    [-120, 0, -309],
    [90, 0, -306],
    [260, 0.5, -298],
    [365, 1.5, -262],
    [425, 3, -185],
    [438, 4.5, -105],
    [410, 5.5, -30],
    [425, 6.5, 45],
    [488, 7, 100],
    [548, 7, 165],
    [566, 6.5, 236],
    [534, 6, 292],
    [470, 6, 300],
    [428, 6.5, 262],
    [360, 9, 222],
    [250, 14, 226],
    [140, 21, 268],
    [30, 25, 318],
    [-95, 22, 345],
    [-205, 16, 322],
    [-282, 11, 262],
    [-292, 8.5, 188],
    [-266, 7, 134],
    [-282, 6, 78],
    [-380, 5, 42],
    [-478, 4, -8],
    [-548, 3, -95],
    [-560, 2, -185],
    [-520, 1, -262],
    [-440, 0.3, -296],
  ],
};
