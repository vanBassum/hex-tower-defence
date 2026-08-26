# Working in this repo

A turn-based tactical exploration game on a hex grid. Plain ES modules, no build
step, three.js from a CDN import map. `readme.md` is the long-form design record
and is worth reading *before changing something it explains*; this file is the
short version - the map, the rules that must not be broken, and where to add
things.

## Run and verify

    python -m http.server 8000        # then open localhost:8000
    python tools/check.py             # load it headless, fail on any console error
    python tools/check.py --help      # drive the game, click hexes, screenshot
    node tools/map.mjs                # print the board as text (--shape to paste back)

`tools/check.py` is the fast way to know a change works: it serves the folder,
loads the page in headless Chromium, and exits non-zero on any page or console
error. Everything in `window.hex` (see `game/debug.js`) is reachable from it, so
a whole play sequence is one command. Prefer it to reasoning about whether the
scene still builds.

## Layout

    engine/                 generic: knows about hexes, not about this game
      game.js               render loop + GameObject registry
      gameobject.js         GameObject / Component base classes
      hex/hex_grid.js       axial grid, ranges, lines, occupancy, A*
      hex/visibility.js     what the player has seen - state only, no drawing
      hex/hex_noise.js      deterministic per-hex hash
      components/           camera, atmosphere, lights, terrain, water, fog, overlays
    game/                   this game: what is on the island and what plays on it
      main.js               composition root - every wire between components is here
      maps.js               the level: outline, elevation, props, pickups
      mood.js               every colour and the one wind, in one place
      props.js / units.js / pickups.js / cards.js     what things are
      components/           prop_layer, unit, unit_control, pickup, deployment
      ui/card_bar.js        the hand, in DOM
      debug.js              window.hex - developer knobs, not game UI
    tools/                  map.mjs (authoring), check.py (verification)

## Invariants

Break one of these and something three files away goes subtly wrong.

- **A unit's position *is* its hex.** World position is a consequence; the walk
  between tiles is an animation over it. The coordinate advances when the march
  *commits* to a tile, not when it arrives - fog, pickups and pathing all depend
  on that being the same instant.
- **Visibility is state; drawing it is a separate job.** `VisibilityMap` is hexes
  and states. Nothing writes `UNEXPLORED` after construction: seen once is seen
  forever. `FogOfWar` and `VisibilityField` read it and never write.
- **Fog is mood; hex visibility is the rule.** The mist hides nothing - every
  material paints *itself* out through `field.patch(layer)`. A horizontal sheet
  occludes nothing when the camera looks along it, which is why this split exists.
- **`field.patch` is one call per layer in `main.js`**, never an argument threaded
  through a constructor. Anything new added to the scene gets fog behaviour by
  being in that sweep.
- **Occupancy lives in the grid.** Crags and units hold a key; `isWalkable` and
  A* already ask. Making something impassable is `grid.occupy`, and making
  something walkable-onto (a pickup) is simply not calling it.
- **Every colour is in `mood.js`.** The palette is coupled on purpose - lanterns
  only read warm because the world is cool. Never hard-code a colour in a
  component.
- **One wind.** `WIND` in `mood.js` drives the swell, the vegetation, the fog
  drift and the banners. Three effects with private weather look like three
  effects.
- **Vision is the union over the force**, recomputed from a source list in
  `UnitControl.refreshVision`. A unit that owned its own fog would un-see a hex
  two units were both standing next to.
- **Cards are played beside the King, not in a fixed zone.** `deployAnchor: true`
  on a unit type is the whole rule; `Deployment.anchors()` filters the roster by
  it and the zone is recomputed on every ask, because it moves whenever anything
  steps. No King on the board means nothing can be brought in - that is the
  point, not a bug. The King is the only unit the game places itself
  (`DEBUG.kingStart`); everything else, the Scout included, is a card the player
  plays (`DEBUG.startingHand`).
- **The right button is shared by gesture.** A press is an order, a drag past
  `DRAG_SLOP` is a camera rotate. `CameraRig.consumedRightPress` is how the game
  learns which happened, and `main.js` throws the order away when it was a drag.
- **Gameplay is discrete, drawing is not.** Rules run on hexes; the hexagon is
  thrown away in `VisibilityField` (hexes → texture → blur → opacity).

## Where to add things

| Adding | Touch |
| --- | --- |
| A unit type | `game/units.js` (+ its palette block in `MOOD.units`) |
| A prop | `game/props.js` `PROP_TYPES`, then place it in `maps.js` |
| A pickup | `game/pickups.js` `PICKUP_TYPES`; place it in `maps.js` `pickups` |
| A card | `game/cards.js` `CARD_TYPES`; art in `game/ui/card_bar.js` |
| A unit others deploy beside | `deployAnchor: true` on its type |
| A leader figure or a standard | `leader` / `standard` on its type (see `king`) |
| Level content | `game/maps.js` - `buildMap` validates and refuses bad placements |
| A wire between components | `game/main.js`, never inside either component |
| A developer knob | `game/debug.js` (`window.hex`), not game UI |

## Conventions

- Comments explain **why**, not what: the trade considered, the version that was
  tried and failed, the reason a number is that number. That prose is the
  project's memory and is expected in new code.
- Prose uses ` - ` rather than em dashes, and stays in the readme's register.
- After a feature lands, `readme.md` gets the design note and the commit message
  carries the reasoning. Commit and push without being asked.
- No build step and no dependencies. If something needs a library, it probably
  needs a different design.

## Gotchas paid for once already

- three.js caches shader programs on the **source text** of `onBeforeCompile`. A
  closure written once has identical text for every material, so per-material
  flags must be pushed into `customProgramCacheKey` by hand.
- Colour offsets are applied in **sRGB**, not linear - a lightness offset in
  linear space is far subtler than it looks.
- A **tinted** light carries a fraction of the luminance its intensity number
  suggests, and three no longer applies pi compensation. Judge intensities by the
  rendered colour, never by the number.
- An additive sphere standing in for bloom reads as a **pale disc** the moment it
  grows. Spend a flare on the light, not on the halo.
- `LineBasicMaterial` line width is always 1px in WebGL. A rim that has to read
  needs something with height beside it.
- Flat-shaded materials ignore the normals attribute (three uses derivatives), so
  animated geometry does not need `computeVertexNormals` every frame.
