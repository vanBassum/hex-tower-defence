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

  // Ground nobody is looking at. Not a fog colour and not a wash over the tile -
  // the tile is simply *unlit*, and what is left is the night the rest of the
  // frame is already made of. It sits between the sky and the distance haze, and
  // dark enough that the horizon is where the island stops rather than where the
  // black square around it stops.
  //
  // `keep` is the only reason it is not a hole cut in the board: a trace
  // of the surface's own shading survives, so a cliff and a tile top out there
  // are still just separable and the land reads as continuing into the dark.
  // Raise it and the unknown turns into dim terrain you can read; drop it to zero
  // and the island ends in a flat silhouette.
  hidden: {
    color: 0x070c16,
    // Tiny, and it has to be: this is added on top of the night in *linear*
    // light, where a hundredth is already a shape you can read. At 0.02 the
    // unknown stops being dark and becomes dim terrain with trees in it.
    keep:  0.006,
    // How far the night laps back over the ground the player *can* see, as a
    // fraction of a hex's width, so the lit region ends in a soft edge instead
    // of along a hex boundary. It only ever takes light off a watched tile - it
    // cannot lift an unwatched one - which is what keeps the softening cosmetic
    // and the rule binary. Past about a quarter it starts eating whole tiles.
    fade:  0.18,

    // And the air out in it, so the unknown is deep rather than empty. Every
    // number here is small for the same reason keep is: it is added to a
    // near-black colour in linear light, where a hundredth is already something
    // you can see.
    //
    // It is meant to read as darkness at a glance and as weather only once you
    // have watched it for a few seconds. If it reads as fog on sight, amount is
    // too high; if it reads as a texture sliding past, scale is too small.
    air: {
      amount: 0.008,
      // Blue-weighted rather than grey: the night gets deeper, never smokier.
      tint:   0x4d80ff,
      scale:  17.0,      // world units across one shape - about a third of the board
      speed:  0.17,      // world units a second, so a hex takes most of a minute
      hold:   1.1,       // how far into the dark the air stays out of the boundary
    },
  },

  // A unit has to survive being the smallest thing in a dark frame. The cloak is
  // lifted off the grass rather than made bright - a figure that glows is a token
  // on a board - and the lamp below is what actually finds it.
  //
  // The shared keys are the level's; a block under a unit type's own name wins
  // over them. Two units have to be told apart at a distance where each of them
  // is about ten pixels tall, and colour alone will not do it - the Scout is a
  // hooded crowd carrying a light and the Footmen are a helmeted block carrying
  // steel - but colour is what stops them being the same *material* as well as
  // the same shape.
  units: {
    cloak: 0x4a6a94,
    trim:  0x2c3d55,
    skin:  0x8c8377,
    select: 0x8fd8e8,
    lampGlow: 0xffb45c,

    // Blue is the player's. Everything they own is one family of it, told apart
    // by silhouette rather than by hue, and the enemy is the only red on the
    // board - which at blue hour means red is also the only *warm* thing that is
    // not a lamp.
    scout: {
      cloak: 0x4a6a94,
      trim:  0x2b3f5c,
    },

    king: {
      cloak:  0x2f4c80,
      trim:   0x22314c,
      gold:   0xd8b268,
      banner: 0x4d7fbe,
      pole:   0x2a231d,
      lampGlow: 0xffa855,
    },

    footman: {
      cloak: 0x3a5c8a,
      trim:  0x9db4d0,
      steel: 0x9db4d0,
    },

    spearmen: {
      cloak: 0x6e2b2b,
      trim:  0xb0554a,
      steel: 0x8a6f66,
    },
  },


  // The colours somebody left on the island. Warm, because on this board warm
  // means people: the lanterns already spent that meaning and a pickup is the
  // same sentence with nobody standing in it. The cloth is the lightest thing on
  // the level after a flame, which is what makes it the thing you walk toward.
  pickups: {
    pole:    0x2f2721,
    cloth:   0xc0763a,
    steel:   0x8d97a6,
    leather: 0x4a3b2c,
    glow:    0xffb45c,
  },

  // Dimmer and shorter than a lantern, and that gap is the point: a lamp on a
  // post is a place somebody lives, and this is a place somebody stopped. Bright
  // enough to be seen from the next tile, not bright enough to be mistaken for
  // the settlement the lantern chain describes.
  pickupLight: {
    color: 0xff9a3c,
    intensity: 6.5,
    distance: 5.0,
    decay: 2,
  },

  // The King's torch: wider and deeper than the Scout's lamp, and still well
  // under a lantern. It is the camp's warmth, walking - which is what he is now
  // - so it wants to read as a pocket of light with people in it rather than as
  // one person carrying a lamp. Judge it against the lantern pools it has to sit
  // between without being mistaken for one.
  kingFire: {
    color: 0xff8a3a,
    intensity: 4.2,
    distance: 5.0,
    decay: 2,
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

    // Pale, not warm: the amber on this board is spoken for, and cloth that is
    // merely light reads as cloth rather than as a fourth lamp somebody left
    // burning. Nothing places a stake at the moment - they marked a camp that no
    // longer exists - but claimed ground is a thing a later map will want to say.
    pennant: 0xbdb096,
  },

  // Where a card may be played, which is only ever drawn while one is held. It
  // answers "where may this go" and nothing else, so it is allowed to be the
  // brightest thing on the board for the second it is up.
  //
  // The treatment the route preview settled on: additive, so a hex catches a
  // little more light rather than having a shape painted onto it.
  deploy: {
    color: 0xffc98a,
    opacity: 0.16,
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
