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
      detail.js             the ground cover: sets, and the scatter that derives
                            it from a patch rather than storing it
      components/           prop_layer, unit, unit_control, pickup, deployment,
                            action_loop (EXPERIMENT: one action at a time)
      ui/card_bar.js        the hand, in DOM
      debug.js              window.hex - developer knobs, not game UI
    editor/                 the level editor at /editor/ - same world, no game
      level.js              the level *as data*, and the only stored format
      storage.js            levels in localStorage, keyed by id
      tools.js              HOW you edit: five interactions, and every setting
      content.js            WHAT you edit: seven categories, each implementing
                            the same verbs over the game's own definitions
      ghost.js              the see-through preview of a precise placement
      marker.js             the ring round the one object that is selected
      thumbnails.js         the palette's pictures: renders each asset once,
                            caches the PNG, packs the renderer away
      main.js               second composition root; edits rebuild the board
      ui/                   editbar (tool/content/assets/settings), panel,
                            levels (library)
    levels/                 editor levels as files, for importing - skirmish.json
                            is the encounter the action loop is tested against
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
- **A tool is HOW, a content category is WHAT, and they are independent.**
  `tools.js` holds five interactions - select, place, tile, brush, erase - and
  knows nothing about trees. `content.js` holds seven categories, each
  implementing whichever of `place` / `tile` / `brush` / `erase` / `wheel` it
  supports and declaring which tools and settings it understands. Thirty-five
  combinations, none of them written down: the tool contributes the gesture, the
  category contributes the meaning, `main.js` crosses them. Adding a kind of
  thing to the board is an entry in one of those two files and never a new
  interaction - which is the thing this arrangement exists to prevent, because
  the editor it replaced had a separate tool per category and every new category
  arrived with its own brush, its own palette and its own idea of what the right
  button meant.
- **A palette thumbnail is a photograph, not a view.** `thumbnails.js` renders
  each asset once through the game's own builders, keeps the PNG for the life of
  the page and tears the preview renderer down at the end of the batch. So the
  palette is `<img>` tags and reopening a category costs nothing - forty live
  previews at sixty frames a second to look at a list is not a trade anybody would
  make. The studio is deliberately *not* the game's scene: bright, neutral, no fog
  and no environment, because the board is a dusk island and everything rendered
  in its light comes out a dark smudge at icon size. Materials are the one thing
  borrowed from the world, because the colour is what makes a rock a rock. Every
  entry point is a batch, so every entry point closes the studio.
- **Framing fits the bounding box in screen space, not the sphere.** A sphere
  around fifteen men is as wide as the formation and the men are short, so the
  subject ends up in a thin band across an empty picture. Per-category camera
  angles exist and there are exactly two, both about how flat the subject is.
- **What the preview highlights is exactly what the press does.** Area verbs are
  handed `previewHexes()`, not the raw footprint. Not a nicety - a brush that
  acted on hexes it had not highlighted wrote ground cover into the sea, and the
  editor then refused to reopen the level it had just saved.
- **A click picks what it points at, not what is on the hex.** The arrow
  hit-tests the scene with the picker's own ray, so clicking a tree selects the
  tree and clicking the grass beside it selects the tile - two different
  intentions that "what is on this hex" cannot tell apart. A mesh gets back to the
  level through `userData.placement`, hung on every prop by `PropLayer`, and
  through `userData.unit` on a figure. A *scattered* tuft has no entry to select,
  so clicking one selects the patch that grew it. With no pointer - the console,
  tools/check.py - there is no ray, and picking falls back to the top thing on the
  hex: not a lesser answer, the honest answer to the only question that can be
  asked by coordinates.
- **A selected tile is a lit hex; a selected object is a ring.** Two visuals
  because they are two selections, and that is the only thing on screen that says
  which of them a click found.
- **A drag does not rebuild the board.** The level is updated as always - it is
  still the only state - and then the one visual consequence is applied by hand,
  which is moving the mesh that is already there. A rebuild is ten milliseconds
  and a write to local storage on a full board, and a drag would pay both on every
  pointer move to draw a picture that differs by one object having moved. The
  rebuild and the store happen once, on release.
- **A category's erase takes only its own.** Right-click and the Erase tool both
  go through the chosen category's `erase`, so removing a lamp cannot fell the
  tree beside it, and ground can only be destroyed while Terrain is the category
  you are holding.
- **Decoration is sorted by how it is *authored*, not by how big it is.**
  `category` on a prop type is the whole rule, and there are four:
  `detail` (ground cover, painted by the hundred and derived from a patch),
  `prop` (placed *or* scattered, and either way a real instance),
  `tree` (placed only - a thing tall enough to hide a unit behind is never
  scattered), `landmark` (placed one at a time, and the only category whose
  placements carry settings of their own). Size correlates, but it is not the
  rule: the rule is how much control the author gets per object, and it goes up as
  the object matters more. The four editor tools are that list, and a new kind of
  thing is an entry in `PROP_TYPES` with a category - never a new tool.
- **Nothing is ever stored about one *scattered* tuft.** A painted hex stores one
  patch - which kinds grow there, how thick, and a seed - and `detailPlacements`
  regenerates the tufts from it identically on every load. There is nowhere to put
  a fact about an individual scattered tuft, so anything the author needs to
  control has to be a number on the patch. A tuft placed deliberately is not this:
  that is an instance in `props` with a `dx`/`dz`, like every other placed thing,
  and the two share a tile without either knowing. The migration that folds
  per-tuft props into patches therefore runs only for files at version 6 or older
  - from 7 on, a detail-typed prop means somebody put it there.
- **A mixture is a selection, not a type.** The asset palette is multi-select and
  a patch stores the list that was ticked, so "grass with stones through it" needs
  no `stony grass` type to exist. Anything that only exists because the data
  could not hold a combination is a sign the data is wrong - that is what the old
  predefined detail sets were, and they are gone.
- **A scattering is patchy because it varies over more than one hex.** `clumpAt`
  is smooth across tiles and everything scattered - ground cover *and* props -
  draws from the same field, so rocks thin out where the grass thins out. A count
  taken from each hex's own hash reads as speckle on a grid; the per-hex hash is
  in there at half weight, and only to stop two tiles in one thick patch both
  coming out exactly full.
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
  plays (`DEBUG.startingHand`). **The editor has no palette for the player's own
  troops, and that is the rule and not an omission** - a level says where the army
  arrives and what is waiting for it, and which army comes is the player's answer
  to that. The one player-side thing a level places is the King: the `start`
  category in `editor/content.js`, one asset, no erase, because a board with
  nowhere to arrive cannot be opened. The format still *carries* a friendly unit,
  and `play.js` still hands one to the roster, so a level written before this
  reads back unchanged - there is simply no way to author another.
- **EXPERIMENT: the board takes one action at a time.** `ActionLoop` in
  `game/components/action_loop.js` is a prototype of turn-like play with no turn
  in it: pick a group, spend one move, the enemies that move made *relevant*
  answer it, the fight resolves, control comes back. There is no End Turn and no
  enemy phase - an enemy that the action did not concern does nothing at all,
  which is the whole claim being tested. Three rules hold it together. **There is
  exactly one authority on whether an order may be given** and it is
  `loop.canCommand()`; nothing else keeps a busy flag, because two booleans about
  the same fact is how a game ends up taking an order in the middle of a fight.
  **The other side stops thinking for itself** - the loop sets `EnemyForce.auto =
  false` and hands it one decision per player action, and leaving both running is
  an enemy that reacts *and* keeps walking while the player is choosing.
  **`tactical: false` on `startPlay` removes the whole of it** and gives back the
  real-time game unchanged, which is the seam an experiment has to have to be an
  experiment. Every number is in `TACTICS` at the top of that file, because the
  reaction rules are expected to be rewritten several times before this is kept
  or deleted.
- **A move allowance is told to `UnitControl`, not checked beside it.**
  `control.maxSteps` clamps `_pathTo`, so the reachable overlay, the route
  preview and the right-button order are one answer rather than three that can
  disagree - the same reason area verbs are handed `previewHexes()`.
- **The right button is shared by gesture.** A press is an order, a drag past
  `DRAG_SLOP` is a camera rotate. `CameraRig.consumedRightPress` is how the game
  learns which happened, and `main.js` throws the order away when it was a drag.
- **How far an attack carries is `range` on the type, and Battle asks each half
  of a pair separately.** It defaults to the one hex everything assumed before
  Archers, so nothing that predates them changed. What it introduces is the first
  uneven exchange on the board: at two hexes only the shooter reaches, so it
  costs people and pays none - and the counterweight is not a stat, it is that
  being shot makes an enemy *relevant* (`_relevant` in `action_loop.js`) and it
  comes for you. Widening the range without that is free damage forever. Only a
  pair standing next to each other forms a front line; at range the shooters are
  handed a direction, a distance and the target's height, and do nothing with the
  first of those but turn onto it - a volley is not a line.
- **An arrow is pinned to the world, like a corpse and for the same reason.** It
  is drawn out of the shooting unit's own mesh - one more InstancedMesh, no new
  material, because a material first *drawn* mid-run is a stall - so it lives in
  a space that walks off with the unit. `Unit._writeArrows` keeps the flight in
  world coordinates and undoes the unit's transform every frame, exactly as
  `_writeMelee` does for the dead. Anything else the game ever throws goes the
  same way.
- **Battle describes a fight every frame and only charges for it sometimes.** Its
  `active` predicate gates the *cost*, never the description - the poses are
  worked out either way, or pausing the damage would freeze fifteen men
  mid-thrust. That split is what lets the action loop have stretches where
  nothing is happening without the board looking broken.
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
| A troop that kills at a distance | `range` on its type - Battle already asks, and `_relevant` already makes the target notice |
| What a unit carries | `spears` / `bows` on its type - one InstancedMesh, one geometry swapped, never a fourth pass |
| Something a unit throws | an instanced pass and a writer in `buildSquad`'s `userData`; the flight belongs to `Unit` and is kept in world space |
| A prop, tree or landmark | `game/props.js` `PROP_TYPES` (a `name` and a `category`) - the matching category's palette picks it up |
| A kind of ground cover | `PROP_TYPES` with `category: 'detail'` - `detailKinds()` finds it |
| A picture for a new kind of asset | a `preview: { kind, ... }` on the asset entry, and a branch in `build()` in `editor/thumbnails.js` |
| A whole content category | an entry in `CONTENT` in `editor/content.js`: its assets, its tools, its verbs |
| A new editing gesture | an entry in `TOOLS` in `editor/tools.js`, plus that verb on the categories it means something to |
| An editor setting | `SETTINGS` in `editor/tools.js`, then name it on the tool that offers it and the categories that understand it |
| A landmark with settings of its own | a word on its type (`lights`), which is what `when` on a setting reads |
| A pickup | `game/pickups.js` `PICKUP_TYPES`; place it in `maps.js` `pickups` |
| A card | `game/cards.js` `CARD_TYPES`; art in `game/ui/card_bar.js`. `role` says what the troop is *for* - never a stat |
| A unit others deploy beside | `deployAnchor: true` on its type |
| An enemy kind | `UNIT_TYPES` with `hostile` + a behaviour field; place it in `maps.js` `enemies` |
| A leader figure or a standard | `leader` / `standard` on its type (see `king`) |
| Level content | `game/maps.js` - `buildMap` validates and refuses bad placements |
| A reaction rule, or how far a group moves | `TACTICS` in `game/components/action_loop.js` |
| A phase in resolving an action | `STATE` + the switch in `ActionLoop.update` |
| A wire between components | `game/play.js`, never inside either component |
| Something the *page* owns, not the level | `game/main.js` (or `editor/main.js`) |
| A developer knob | `game/debug.js` (`window.hex`), not game UI |
| A level-wide editor control | a mutator in `editor/level.js`, a control in `editor/ui/panel.js`, one `act()` in `editor/main.js` |
| A setting that only applies half the time | `when(state)` on the descriptor, not a second tool |
| A new kind of selectable thing | a `userData` tag where its mesh is built, plus a branch in `ownerOf`, `pickByHex`, `stillThere` and `describeSelection` in `editor/main.js` |

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
