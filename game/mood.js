// Cozy dusk mood tuned from the current rendered scene.
//
// Goal:
// - darker, calmer blue-hour world
// - warm lantern pools that read clearly as amber, not green/yellow
// - water stays alive, but no longer becomes the brightest object in the scene
// - terrain remains readable without looking daylight-lit
// - long soft shadows and subtle atmospheric depth
//
// Keep these values coupled. The palette is designed around the contrast between
// a cool world and warm local lights.

export const MOOD = {
  // A little darker and less saturated than the current render.
  // Fog is kept close to the sky so the horizon disappears naturally.
  sky: 0x15283f,
  fog: {
    color: 0x23384d,
    near: 36,
    far: 115,
  },

  // The current scene is still quite brightly filled from above.
  // Pull the world lighting down so lanterns become meaningful.
  hemisphere: {
    sky: 0x8198b5,
    ground: 0x303746,
    intensity: 3.8,
  },

  ambient: {
    color: 0x56617a,
    intensity: 1.15,
  },

  // Keep reflections present, but stop the neutral environment from lifting
  // everything back toward daylight.
  environmentIntensity: 0.16,

  // Very late warm sunlight. Low enough to shape forms rather than illuminate
  // the whole board.
  sun: {
    position: [26, 7.5, 17],
    color: 0xffc89d,
    intensity: 1.45,
    shadowExtent: 42,
  },

  ground: {
    // Slightly darker and richer than the current result.
    grassColors: [
      0x263a2a,
      0x30482f,
      0x395538,
    ],

    dirtColor: 0x554833,
    rockColor: 0x5d5a58,
    cliffColor: 0x493927,
  },

  // Almost invisible while idle. Interaction highlighting should ideally use a
  // separate brighter colour elsewhere.
  gridColor: 0x172419,

  water: {
    // The current water is visually dominating the board.
    // Darker body, restrained crest.
    depthColors: [
      0x204654,
      0x193b49,
      0x132f3b,
    ],

    oceanColor: 0x102937,

    // Still visibly cyan, but less neon than before.
    crestColor: 0x70b9cc,
  },

  props: {
    trunk: 0x33271e,

    // Keep trees darker than grass so silhouettes survive.
    foliage: 0x203b29,
    foliage2: 0x29472b,

    scrub: 0x29432b,
    blade: 0x38562e,

    rock: 0x55585f,

    lantern: 0x27211c,
    lanternGlow: 0xffa33f,
  },

  // Warm, tighter pools. The current pools look a little greenish because they
  // are blending with strong cool world lighting. Lowering the global fill and
  // warming the lantern helps.
  lanternLight: {
    color: 0xff9d3f,
    intensity: 13.5,
    distance: 7.5,
    decay: 2,
  },

  // Keep these sparse. They should be noticed occasionally, not constantly.
  motes: {
    firefly: 0xffc866,

    fireflyLight: {
      color: 0xffb94d,
      intensity: 1.7,
      distance: 2.5,
      decay: 2,
    },

    sparkle: 0x8fd4e8,
  },

  // Useful global tuning knobs.
  exposure: 0.82,
  lanternFlickerAmount: 0.035,
};


// One shared weather system for water and vegetation.
//
// Slower than the previous version so the scene feels calm rather than windy.
// Individual trees/grass can still apply their own amplitude and phase offsets.
export const WIND = {
  angle: 0.55,
  length: 13,
  period: 4.8,
  strength: 0.75,
};
