// Cozy dusk mood tuned from the current rendered scene.
//
// Goal:
// - darker, calmer blue-hour world
// - warm lantern pools that read clearly as amber, not green/yellow
// - water stays alive, but no longer becomes the brightest object in the scene
// - terrain remains readable without looking daylight-lit
// - long soft shadows and subtle atmospheric depth
//
// Second pass: the first one went far enough into the dark that the high ground
// stopped reading. The correction is all in the cool fill - skylight and ambient
// up about a fifth, the sun untouched. Raising the sun instead would have flattened
// the lantern pools, because the pools are only bright by comparison.
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

  // Skylight, and the one lever that reaches cliff faces. A hemisphere light
  // gives a vertical surface the midpoint of its two colours, so the `ground`
  // term - not `sky` - is what lights every cliff and rock side on the board.
  // It was dark enough that those faces collapsed into silhouette; lifting it
  // brings their shapes back without touching how bright the grass tops read.
  hemisphere: {
    sky: 0x8aa2c0,
    ground: 0x404a5d,
    intensity: 4.4,
  },

  ambient: {
    color: 0x5b6781,
    intensity: 1.40,
  },

  // Keep reflections present, but stop the neutral environment from lifting
  // everything back toward daylight.
  environmentIntensity: 0.18,

  // Very late warm sunlight. Low enough to shape forms rather than illuminate
  // the whole board. Deliberately left where it was through the brightness pass:
  // the sun is the warm light, and lifting it competes with the lanterns.
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
    // Stone reads cool at this hour - the warm grey it had was borrowing a
    // daylight sun that is no longer there. Both are pre-scale albedos:
    // hex_ground dims rock to 0.7 and cliff faces to 0.6 and then fades them
    // toward the foot, so they have to start higher than they look here.
    rockColor: 0x5c606b,
    cliffColor: 0x4f4433,
  },

  // The unknown, lying over the board as mist. One draped sheet with a
  // procedural cloud field painted on it - see fog_of_war.js - so what is set
  // here is the palette of that field rather than the material of any object.
  //
  // The colours are stated outright rather than left to the scene's lighting,
  // which is a reversal of what the blob version did and worth writing down. A
  // lit material was the right answer while the mist was *geometry*: it made the
  // fog take the colour of the hour on its own. A painted field has no surface to
  // light - it is uniformly flat-on to the sky - so lighting it buys nothing and
  // costs the one thing that matters most out in the deep field, which is exact
  // control over how dark and how blue the unknown reads.
  //
  // The one rule that carries over: keep it blue-*grey*. Saturated blue sits next
  // to the water and reads as more water.
  fogOfWar: {
    color:       0x27303f,   // the body of it
    colorLight:  0x46536a,   // where the field piles up thick
    rimColor:    0x76889f,   // the lit lip on a receding edge
    rimStrength: 0.45,
    opacity:     1.0,

    // Contrast in the noise, at the boundary and deep in the unknown. The second
    // number of each pair is the important one and it is small on purpose: far
    // from anything discovered the sheet has to *hide* the board, and visible
    // structure out there is structure the player can read the terrain through.
    // All the tearing and wisping is spent at the edge, where it says something.
    detail: [0.95, 0.13],    // how much the cloud field thins the alpha
    shade:  [1.00, 0.50],    // and how much it moves the colour

    // Ground that has been walked and is not being watched: dimmed, not fogged.
    exploredColor:   0x0d1a2b,
    exploredOpacity: 0.34,

    // A few real lenses drifting near the reveal line. Decoration only - they
    // hide nothing - and the count is deliberately in the tens, not the hundreds.
    // Their whole job is parallax: the sheet is painted and does not move when
    // the camera turns, and a handful of objects crossing in front of it is what
    // keeps it from reading as a texture stuck to the ground.
    // Keep them small and dim. Scaled up they stop being air and go straight
    // back to being pale discs lying on the bank.
    wisps:       14,
    wispColor:   0x4a5468,
    wispOpacity: 0.14,
  },

  // A unit has to survive being the smallest thing in a dark frame. The cloak is
  // lifted off the grass rather than made bright - a figure that glows is a token
  // on a board - and the lamp below is what actually finds it.
  units: {
    cloak: 0x5a6b84,
    trim:  0x323c4c,
    skin:  0x8c8377,
    lampGlow: 0xffb45c,
    select: 0x8fd8e8,
  },

  // Much dimmer and shorter-reaching than a lantern, and the first pass had it
  // wrong in a way worth writing down: at lantern strength the scout's own light
  // washed its whole neighbourhood amber, which cost two separate things. The
  // grass around it stopped being dusk green - so the one part of the board the
  // player is looking at was the one part not in the level's palette - and the
  // warm cliff faces at the coast lit up into what read as a selection outline.
  // The lamp's job is to say where the scout is standing, not to light the tile
  // it is standing on: the fog is what makes that tile legible.
  scoutLamp: {
    color: 0xffa64d,
    intensity: 2.6,
    distance: 3.4,
    decay: 2,
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

    rock: 0x5c616c,

    lantern: 0x27211c,
    lanternGlow: 0xff8f33,
  },

  // Deeper orange, and brighter to match. Green grass subtracts red from any
  // light landing on it, so a light that is merely warm comes back yellow-green;
  // the fix is to take green out of the lamp and then push hard enough that the
  // pool centre saturates to amber rather than settling at olive. The intensity
  // bump also holds the lit/unlit contrast steady against the raised fill above -
  // the pools are only bright relative to the dark, so lifting one means lifting
  // the other.
  lanternLight: {
    color: 0xff822e,
    intensity: 15.0,
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
