# Working in this repo

A real-time tactical exploration game on a hex grid - hexes are the spatial
rule, not a turn structure. Plain ES modules, no build step, three.js from a
CDN import map. This file is the record: the map, the rules that must not be
broken, and where to add things. `readme.md` is deliberately a page - what the
game is and how to run it - and `docs/reasoning/` is how the design got here.

## How to work here

This is a prototype under rapid development. Iteration speed beats robustness.

- **Edit files directly.** Never generate a temporary patch script for an edit
  the editing tools can do.
- **Smallest change that works.** Do not generalise for features nobody asked
  for. A simple request should produce a simple diff.
- **One cheap check, then stop.** `python tools/check.py` and nothing else.
  Screenshots and scripted play sequences only when the request is *about* how
  something looks or behaves at runtime, and one is usually enough.
- **Do not fix what you were not asked to fix.** If something unrelated surfaces,
  say so in one line and leave it.
- **Stop when the task is done.** No follow-on polish, refactors, or extra tests.
- **Report briefly**: what changed, whether the check passed, anything the user
  needs to know.

## Run and verify

    python -m http.server 8000        # then open localhost:8000
    python tools/check.py             # load it headless, fail on any console error
    python tools/check.py --help      # drive the game, click hexes, screenshot
    node tools/map.mjs                # print the board as text (--shape to paste back)

`tools/check.py` is the whole verification budget for a normal change: it loads
the page and exits non-zero on any page or console error. `--page
editor/index.html` points it at the editor instead of the game. Its `--eval`/`--click`
/`--shot` options exist for the rarer case where behaviour or appearance is the
thing being changed - reach for them then, not by default.

## Layout

    engine/                 generic: knows about hexes, not about this game
      game.js               render loop + GameObject registry
      gameobject.js         GameObject / Component base classes
      hex/hex_grid.js       axial grid, ranges, lines, occupancy, A*
      hex/visibility.js     what the player has seen - state only, no drawing
      hex/hex_noise.js      deterministic per-hex hash
      components/           camera, atmosphere, lights, terrain, water, overlays,
                            visibility_mask (what the unknown looks like)
    game/                   this game: what is on the island and what plays on it
      play.js               the game as a callable - every wire between components
      main.js               the game as a *page*: renderer, hour, camera, one level
      maps.js               the level: outline, elevation, props, pickups
      mood.js               every colour and the one wind, in one place
      props.js / units.js / pickups.js / cards.js     what things are
      components/           prop_layer, unit, unit_control, pickup, deployment
      ui/card_bar.js        the hand, in DOM
      debug.js              window.hex - developer knobs, not game UI
    editor/                 the level editor at /editor/ - same world, no game
      level.js              the level *as data*, and the only stored format
      storage.js            levels in localStorage, keyed by id
      tools.js              what the mouse can do; entities.js / objects.js what
                            it can place - both read the game's own definitions
      main.js               second composition root; edits rebuild the board
      ui/                   toolbar (tools + settings), panel, levels (library)
    tools/                  map.mjs (authoring), check.py (verification)

## Invariants

Break one of these and something three files away goes subtly wrong.

- **A unit's position *is* its hex.** World position is a consequence; the walk
  between tiles is an animation over it. The coordinate advances when the march
  *commits* to a tile, not when it arrives - fog, pickups and pathing all depend
  on that being the same instant.
- **Visibility is state; drawing it is a separate job.** `VisibilityMap` is hexes
  and states. Nothing writes `UNEXPLORED` after construction: seen once is seen
  forever. Whatever draws it reads it and never writes.
- **Hidden ground is unlit, not covered.** `VisibilityMask` is the only drawing
  of visibility and it hides nothing with geometry: a hex the force is not
  watching *right now* collapses to `MOOD.hidden`, keeping a trace of its own
  brightness so the land still reads as continuing into the dark.
- **An unwatched hex leaks nothing.** Land is dimmed; everything standing on it -
  units, enemies, props, pickups - is `discard`ed outright (`patch(go, { cull:
  true })` in `main.js`), so there is no shape on screen to read. Visibility
  itself stays binary: watched or night, decided by the fragment's own hex.
- **Softening may only ever remove light.** `MOOD.hidden.fade` laps the night
  back over the outer edge of *watched* tiles, along the perimeter of the whole
  region. There is deliberately no term anywhere that can lift an unwatched hex,
  and that asymmetry is what lets the edge be soft while the rule is hard - so
  anything added here fades the lit side inward, never the dark side outward.
- **The hex edge is rebuilt in the shader.** The fragment turns its own world
  position back into axial coordinates and reads a one-texel-per-hex table, so
  the boundary is the real hex boundary. `maskHexAt` in `visibility_mask.js` is
  `HexGrid.worldToHex` written twice - change one and change the other.
- **`mask.patch` is one call per layer in `main.js`**, never an argument threaded
  through a constructor. Anything new added to the scene obeys fog of war by
  being in that sweep.
- **Occupancy lives in the grid.** Crags and units hold a key; `isWalkable` and
  A* already ask. Making something impassable is `grid.occupy`, and making
  something walkable-onto (a pickup) is simply not calling it.
- **Every colour is in `mood.js`.** The palette is coupled on purpose - lanterns
  only read warm because the world is cool. Never hard-code a colour in a
  component.
- **One wind.** `WIND` in `mood.js` drives the swell, the vegetation and the
  banners. Three effects with private weather look like three
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
- **A unit's strength IS the men left standing.** Damage lowers `people`; the
  instances past it are the same men lying on the ground, so the roster and the
  display are one array and cannot drift. `count` stays at the full roster -
  every man is drawn, alive or not. There is no health bar over anything;
  `Health`/`HealthBar` in the engine stay unused on purpose. A unit with nobody
  left removes its own GameObject and every roster drops it via `onDied` - which
  takes its dead with it, the one place bodies do not persist.
- **Hit points belong to a man, not to a unit.** Each entry in `spots` carries
  `hp` and `bite`, spread either side of one so fifteen men are still worth
  fifteen; damage lands on the front rank only. That is what makes the casualty
  somebody who was fighting, and what stops the line emptying in the same place
  every time. `Unit._fall` swaps the dead man's entry to the end, so the tail of
  `spots` is the fallen in the order they fell - everything that makes a man
  himself lives in his `spots` entry, never in the instance index he is drawn
  at.
- **A body is pinned to the world, not to its unit.** It is drawn out of the
  unit's InstancedMesh, so it sits in the unit's local space and would march off
  with it. `_fall` records where he went down and `_writeMelee` undoes the unit's
  transform for him every frame - which is why that pass keeps running for a unit
  that has stopped fighting.
- **Enemies are a unit type with `hostile` and a `stance`**, driven by
  `EnemyForce` and fought by `Battle` (adjacency → casualties, both directions,
  no turn). `'hold'` never moves and costs EnemyForce nothing - Battle fights
  whatever steps next to it. `'hunt'` chases inside `aggro` and returns to its
  post. Spearmen hold, because a Scout has to be able to see a thing and choose
  not to touch it. A new kind is an entry in `UNIT_TYPES`, not a new system.
- **There is one game and both pages call it.** `startPlay()` in `game/play.js`
  builds everything that plays on a board and returns a `teardown`; `game/main.js`
  and the editor's Play button are its two callers. The editor plays a *copy* of
  its level - `parseLevel(stringifyLevel(level))` - so a fight cannot reach back
  into what is being edited, and the camera, sky and sun belong to the page rather
  than to the session, which is why Play is a change of what is on the board and
  not a journey. A second, simpler simulation living in the editor is the thing
  this arrangement exists to make unnecessary.
- **`buildMap` reads two dialects of the same map.** An authored level draws its
  outline as text with hills as regions; an editor level is a list of tiles each
  carrying its own terrain and height. Both land in the same built map. Adding a
  third way to describe a board means teaching `buildMap`, not writing a loader.
- **Gameplay is discrete, drawing is not.** Rules run on hexes; the hexagon is
  thrown away in `VisibilityField` (hexes → texture → blur → opacity).

## Where to add things

| Adding | Touch |
| --- | --- |
| A unit type | `game/units.js` (+ its palette block in `MOOD.units`) |
| A prop | `game/props.js` `PROP_TYPES` (give it a `name`) - the editor's palette picks it up |
| A pickup | `game/pickups.js` `PICKUP_TYPES`; place it in `maps.js` `pickups` |
| A card | `game/cards.js` `CARD_TYPES`; art in `game/ui/card_bar.js`. `role` says what the troop is *for* - never a stat |
| A unit others deploy beside | `deployAnchor: true` on its type |
| An enemy kind | `UNIT_TYPES` with `hostile` + a behaviour field; place it in `maps.js` `enemies` |
| A leader figure or a standard | `leader` / `standard` on its type (see `king`) |
| Level content | `game/maps.js` - `buildMap` validates and refuses bad placements |
| A wire between components | `game/play.js`, never inside either component |
| Something the *page* owns, not the level | `game/main.js` (or `editor/main.js`) |
| A developer knob | `game/debug.js` (`window.hex`), not game UI |
| An editor tool | a mutator in `editor/level.js`, a control in `editor/ui/panel.js`, one `act()` in `editor/main.js` ending in `rebuild()` |

## Conventions

- Comments explain **why**, and only where why is not obvious: a surprising
  constraint, a number that was tuned, an approach that failed. One or two lines.
  Straightforward code gets no comment. The long-form design prose in `readme.md`
  is the existing style there - do not extend that style into source files, and
  do not rewrite readme chapters unless the change actually invalidates them.
- Prose uses ` - ` rather than em dashes.
- Commit and push without being asked. Commit messages: a subject line and a
  couple of sentences, not an essay.
- No build step and no dependencies. If something needs a library, it probably
  needs a different design.

## Gotchas paid for once already

- three bakes **the number of point lights in the scene** into the identity of
  every shader program. One new lamp arriving with a deployed unit therefore
  recompiles every material on the board - two seconds of freeze on the frame a
  card is played. Lamps come out of a pool that has existed since before the
  first frame and are only ever reparented (`lampPool` in `main.js`); anything
  else that wants a light mid-run has to do the same.
- A material's program is also built the first time it is actually **drawn**, so
  a unit type first seen mid-run costs a stall too. `warmShaders()` in `main.js`
  draws one of every type in a frame that is thrown away. `renderer.compile()`
  looks like the tool for that job and is not: it skips anything invisible, and a
  program it does build still stalls the frame that first uses it.

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
