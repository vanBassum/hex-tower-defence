# Hex Tower Defence

Hex-grid tower defence, built on the component engine carried over from the
`armymen` project. Phase 1 is complete: a board with a fixed path, eight waves,
buildable machine-gun towers, an economy, and win/lose conditions. No geometry
mechanics yet - that starts in Phase 2. The environment pass in `plan/VI.md` has
turned the board into a drawn island in the sea and set it at blue hour; the
route is still walked but no longer drawn.

Plain ES modules, no build step. Serve the folder and open it:

    python -m http.server 8000

## Controls

| Input | Action |
| --- | --- |
| Left-click a hex | Build a machine gun (40c) |
| **Send wave** button | Start the next wave |
| `WASD` / arrows | Pan |
| Middle-drag | Orbit |
| Wheel | Zoom |

The build cursor turns green on a legal hex and red otherwise, and shows the
range ring of the tower you would be placing.

Nothing starts a wave except that button. A wave clock would be deciding the two
things this game is about - how long you get to look at the board before
committing, and whether you take on two waves at once - and neither is a decision
a timer should make. Sending the next wave while the last one is still walking is
allowed; the button turns amber and says how many are still alive, because that
is a choice rather than a punishment for falling behind.

## Layout

    engine/game.js                     render loop + GameObject registry
    engine/gameobject.js               GameObject / Component base classes
    engine/hex/hex_grid.js             axial hex grid, lines, occupancy, A*
    engine/hex/hex_noise.js            deterministic per-hex noise
    engine/assets.js                   glTF loading + clone cache (unused for now)
    engine/components/camera_rig.js    pan / orbit / zoom camera
    engine/components/atmosphere.js    sky, fog, skylight - what hour it is
    engine/components/directional_light.js
    engine/components/ground_plane.js  flat shadow-receiving ground (unused by LEVEL_1)
    engine/components/ambient_motes.js drifting specks - fireflies, water sparkle
    engine/components/hex_water.js     sea as hex tiles, shaded by depth
    engine/components/water_plane.js   flat ocean beyond the tiles
    engine/components/hex_ground.js    tile tops + cliff faces, grass tones
    engine/components/hex_region_outline.js  border around a hex region (unused)
    engine/components/hex_grid_renderer.js  hex outlines
    engine/components/hex_overlay.js   filled hex tiles (path, build cursor)
    engine/components/health.js        hit points, hit descriptors, death hook
    engine/components/health_bar.js    camera-facing bar above the owner
    engine/components/path_follower.js constant-speed walk along world points
    game/level.js                      level definition + path expansion
    game/mood.js                       the palette and the wind, in one place
    game/game_state.js                 currency, lives, win/lose status
    game/enemies.js                    enemy stat table + spawn factory
    game/props.js                      procedural trees, rocks, scrub, lanterns
    game/towers.js                     tower stat table + build factory
    game/components/enemy.js           enemy marker, keeps game.enemies
    game/components/tower.js           targeting + hitscan fire
    game/components/tower_placer.js    mouse-to-hex build cursor
    game/components/shot_tracer.js     fading muzzle-to-target line
    game/components/wave_spawner.js    runs the level's wave table
    game/components/level_director.js  end conditions
    game/components/prop_layer.js      places a level's decoration + its wind
    game/components/hud.js             readout + end-of-level banner
    game/main.js                       scene setup
    tools/map.mjs                      prints the board as text, for authoring

## Level

`LEVEL_1` is a 75-hex island drawn inside a radius-6 envelope. Its path is stated
as waypoints and expanded into hexes by `HexGrid.hexLine`, so it reads as straight
runs: a 10-hex diagonal across the middle, a 120-degree corner, then 6 hexes down
to the base. None of it is drawn - see *Blue hour* below. The path hexes are
collected into `pathKeys`, which drives tower placement rejection.

## The island

The outline is *drawn*, not listed - a block of text in the level whose rows are
the board as `node tools/map.mjs` prints it (columns are q, rows are 2r+q, which
is how flat-top hexes stagger). `#` is land, `^` is a crag, `~` is a sea tile, and
a blank is open ocean. A silhouette is the one thing that cannot be authored from
a list of coordinates: it has to be edited in the shape it will actually have, so
the tool prints the board and `--shape` prints it back as a paste-ready block.

`radius` is now only the envelope the board is drawn inside: the island reaches
radius 6 and the sea it sits in takes the three rings beyond it - 75 land hexes
and 144 of water.

Only `HexGrid` knows about it. `inBounds` means *playable*, so land is in it and
sea is not, and everything that asks - ground mesh, rim cliffs, grid lines, build
rejection, elevation regions - already went through `inBounds`. Water being drawn
but off the board is therefore free: nothing builds or walks there without a
single extra rule. `buildLevel` refuses an outline that strands a hex away from the
route, or that drops a prop or the route into the sea.

Every cut says where a stretch of route can be covered from:

- The **north-east bay** comes right up to the second half of the diagonal, so
  that stretch is a causeway with water on its north side and can only be shot at
  from the south. The first half keeps its north shoulder, which is also the high
  ground - so the two halves of one straight run play differently.
- The **corner is a promontory** into that bay. It is the strongest ground on the
  level, both legs of the route passing within reach, and the sea behind it is
  what makes that strength finite.
- A **bay bites into the middle of the descending run**, so its east shore is two
  separate pieces: the promontory's flank and the base's headland.
- The spawn sits on a **two-hex spit** and the south is one lobe carrying the
  small hill as a **cape**, so neither end of the route is a straight board rim.

**Crags** (`^`) are the non-playable terrain: land that stands at `cragLevel` and
is marked occupied in the grid, so it is impassable as well as unbuildable. Four
of the five are scenery - a ridge on the highland, a stack on the promontory
point, a knoll by the southern cape. The fifth, at `1,0`, is inside the play area
on purpose: it takes a build hex off the causeway's south side, which is the only
side the causeway has. The build cursor reports it as "solid rock" rather than
"already taken", because one is a property of the map and the other is something
the player did.

**Water** is hex tiles, on the same grid and drawn the same way as the land: one
merged, vertex-coloured mesh, sitting one elevation step below the lowest land so
the coast is a real drop that the island's own rim cliffs descend past.

A flat tinted plane was tried first and it did not work - it has no relationship
to the island standing in it, so it reads as the colour *behind* the board rather
than as water. What fixes that is tone as a function of distance to the coast:
tiles touching land are shallow and light, two out is mid, beyond that is open
water. That gradient is the thing a single colour cannot say - that the land
continues underwater and the water has a bottom. Depth is measured breadth-first
through the water itself rather than as a distance to the nearest land hex, so an
inlet stays shallow along its whole length.

Straight distance bands are a perfect offset of the coastline, which reads as a
ring drawn around the island, so a broad noise field pushes each tile one band
either way. Patch-scaled, like the grass tones, so it makes sandbanks and deep
pockets rather than per-tile speckle. `WaterPlane` is then only a flat ocean below
the tiles, in the palette's deep tone: it gives the sea no edge and saves the tile
field from needing a rim. It sits far enough down that a trough never dips below
it, which would show the flat ocean punching up through a moving wave.

The surface moves, and it is deliberately *not* a simulation. Every vertex height
is a pure function of where that vertex is and what time it is - two crossing sine
trains, at an angle to each other so they drift in and out of phase and the sea
does not look like corrugated iron. That buys three things for nothing:
neighbouring tiles agree about their shared corners because they ask the same
question at the same point, so the surface cannot tear; there is no state to step,
settle, or go unstable; and the cost is a couple of sines per vertex.

A wave this size is only a few degrees of tilt, which barely catches the light, so
crests also brighten and troughs darken - a straight multiply on the vertex colour,
which is already linear. That is the part that actually reads as movement from the
game's camera. Normals are recomputed each frame because the faces are flat
shaded, and that is what turns the height field into light moving across water.

A ripple spreading from a point - a shell landing in the sea - is another term in
the same function: amplitude falling off with distance from the splash and with
time since it, phase driven by `distance - speed * age`. A per-tile field that
passes ripples between neighbours would do it too, but for an ambience effect it
is a simulation to keep stable for no visible gain, so the analytic version is
what this waits to need.

Making grass, path, cliff and water actually *meet* - the coast is still a hard
edge, with no foam or wet rock - is the next step in `plan/VI.md`, not this one.

Elevation is a second authored layer: integer levels per hex, world height being
`level * 0.22`. Regions are declared as a centre plus radius, a run, or a hex
list, applied low-to-high; path hexes are stamped last at `pathLevel`, so a
mis-authored hill can never flatten the route. Hills are kept clear of the path
so its step stays readable.

The board is one merged mesh with vertex colours: a top face per hex at its own
height, and a cliff face on every edge where the neighbour sits lower. Off-board
edges drop to a base depth, so the board reads as one solid landmass. A single
cliff material covers every drop - path steps, hill sides and the rim alike -
which is what keeps varied elevation looking like the same piece of land.

Grass uses three discrete tones picked from a broad noise field, so they form
patches rather than per-tile static - measured at 70% of neighbours sharing a
tone against 37% for random assignment. Per-tile jitter sits deliberately *under*
the tone step (~0.022 against ~0.053): matching them erases the patches and the
ground reads as noise again, which is the trap this pass exists to avoid.

All colour offsets are applied in sRGB space, because a lightness offset in the
linear space three stores by default is far subtler than it looks. Getting that
wrong, plus a triangle winding that pointed every face normal downward, is why
the first attempt at ground colour was invisible.

About 7% of grass tiles take a worn-earth tone instead. That is a whole-tile
colour rather than a decal drawn on top: a blob on grass reads as a sticker,
while a tile that simply *is* dirtier reads as ground.

Props are procedural on purpose. Modelled kits were tried and the baked-in
colours clashed with the terrain palette, so trees and rocks are built in code
where their colours stay under our control. `engine/assets.js` keeps the glTF
loader and clone cache ready - it loads a model once and hands out clones that
share geometry and materials - for when better-matching assets turn up.

Beside the six hand-placed props there is a **scatter**: grass tufts and the odd
bush, spread from the hex hash rather than positioned by hand. `chance` is per
tile and `per` is how many draws a tile gets, so grass arrives in ones and twos
and leaves gaps - a tuft on every tile reads as carpet. It skips the route, the
crags and the hand-placed props, which is what keeps the authored composition
legible underneath the texture, and it is deterministic because a board that
reshuffles its grass every reload cannot be photographed twice. Tufts do not cast
shadows: one is smaller than a shadow map texel at this range, so casting costs a
draw call per blade and buys a flicker.

Everything that grows leans in the wind, and it is the water's trick again - pure
functions of position and time, no state. Three terms, because one sine is a
metronome and a row of metronomes is worse:

- a **gust** travelling across the island, `sin(k·position - w·t)`, shared by
  everything, so a breeze visibly crosses the board and the props downwind lean a
  moment after the ones upwind. Its direction is the water's swell direction: two
  effects with private weather look like two effects, while one direction reads as
  a day with a breeze on it.
- a **flutter** at each prop's own rate and phase. This is the term that stops a
  stand of trees moving as one object.
- a small **crosswind** wobble, because nothing in wind swings along a line.

Whether a prop moves is the prop's own business: `sway` is a field on the type and
rocks simply do not have it. Shorter things get a *bigger* angle, because what the
eye reads is how far the top travels - a tuft leaning 0.2 rad moves its tip about
as far as a tree leaning 0.04, so one number for everything would leave the small
stuff looking bolted down. Amplitude is then scaled by height at build time, where
the height is known, so a tall tree leans further than a short one.

`AmbientMotes` is the last layer: fireflies over the island and glints on the
water, the same component twice with different homes and different patience. Each
mote has a home tile and never leaves its neighbourhood - it drifts on three sines
at unrelated periods - so it is deliberately *not* a particle system. Nothing
spawns, nothing dies, there is no pool, and there is no wrap boundary, which is
exactly where a cheap effect gives itself away. Fading is per mote through
additive blending: black adds nothing, so a mote's colour *is* its opacity, and
raising the curve to a power keeps each one dim most of the time and briefly
bright. That is what makes them read as blinking rather than as a field of dots.

A mote can also carry a real point light, which is what turns a speck into a
firefly: the light rides the same fade, so the grass under one brightens as it
flares. That is the whole difference between something drawn in front of the world
and something in it. It costs a fragment-shader light per firefly, so the count is
the knob that matters - eight is an evening, forty is shader cost with no extra
effect, because nobody can follow forty blinking things at once. The pool only
reaches a couple of units, so they are kept low over the grass: a firefly at head
height lights nothing and is a speck again. Drift periods, flare interval and
`sharpness` all run long: something that flares every few seconds is an event,
while the same light at twice the rate is a strobe you learn to ignore.

Enemies: `grunt` (190 hp, speed 2.0), `runner` (105 hp, 4.2), `brute` (780 hp, 1.3).
Eight waves, 136 enemies, 36,770 total hp. A wave states its shape and nothing
about when it happens - it arrives when the player sends it. A wave's `enemy` can
be a repeating pattern, so a wave has an ordering and not just a head count.

## Blue hour

The level is set at dusk, and every colour that decides that is in
`game/mood.js`. It is one object because the numbers are not independent: the
lanterns only read as warm because the world around them is not, and the wave
crests only read as bright because the water is dark. Move the sky and the grass
has to follow.

The contrast the whole palette is built around is **a cool quiet world with warm
little pockets of civilization in it**. Everything else follows from that:

- **Skylight does most of the lighting.** A `HemisphereLight` with a blue top and
  a near-black bottom, which is what makes upward faces read as lit by the sky
  and cliff faces as lit by the ground. Its sky colour is deliberately *less*
  blue than the sky itself - a saturated blue light zeroes the red channel of
  everything it touches, and grass lit that way goes grey-blue instead of dusk
  green.
- **The sun is low and dim.** About 17 degrees up, so shadows run roughly three
  times object height across the board, and faint enough that it shapes the
  terrain without lighting it. The warmth in frame is meant to come from the
  lanterns, not from it.
- **Lanterns are placement, not decoration.** Five of them, strung along the route
  about every four hexes - close enough that the pools nearly touch, far enough
  that the dark between them is still dark. Each is a prop that owns its own
  `PointLight`, because a lantern without its light is a decoration and a light
  without its lantern is a mystery. The flame is `MeshBasicMaterial`: a light
  source should not dim when the world does, and it has to stay the brightest
  thing in frame. Around it sits an additive sphere standing in for a bloom pass
  we do not have. Both flicker on two unrelated sines per lantern, and both swell
  very slightly as well as brighten. Both sines are slow and the swing is small
  on purpose: the eye goes to the fastest-moving thing on screen whether or not it
  is worth looking at, and five lamps competing for that on a board meant to be
  quiet is worse than no flicker at all.
- **Dark water, bright crests.** Crests now blend towards a cool sky colour
  instead of multiplying the base brighter. At dusk a dark sea has no headroom to
  brighten into, so the crest has to be *told* what colour to become - and once it
  is, a dark base stops being a problem and becomes the reason the shimmer shows.
- **Fog is a decision with two halves.** Distant geometry fades to the tone-mapped
  fog colour, while a background colour skips tone mapping entirely, so picking
  the two independently leaves a seam along the horizon where the ocean ends.
  `MOOD.sky` is the fog colour run through the tone mapper, which is what makes
  the far ocean and the sky one surface.
- **ACES tone mapping**, because in a dim scene the bright things - a flame, a
  crest - should roll off into colour rather than flatten to white.

`WIND` sits in the same file, for the same reason: the swell and the sway are
computed in different components, and if each carries its own direction and
strength they read as two effects rather than as one day with a breeze on it.
`strength` scales every amplitude at once - water and vegetation - so "calmer" is
one number.

One trap worth knowing before touching the numbers: three.js no longer applies pi
compensation to light intensity, and a *tinted* light carries a fraction of the
luminance its intensity number suggests. A blue skylight at 1.0 lands on green
grass at about a tenth of a white light at 1.0. That is why these intensities read
absurdly high next to the old daylight values - hemisphere 6.0 against the old
ambient 0.4 - and still come out darker. Judge them by the rendered colour, not by
the number.

There is no road, and no marked ends. The route still exists, enemies still walk
it and it is still off-limits for building, but it is not drawn, it no longer
stands a step proud, and the spawn and base tiles are gone with it. A paved
causeway with a red tile at one end and a blue tile at the other states that the
level is a track to be defended, and that is not where this is going. It is an
island, and an island is all grass.

## Balance

**The measured figures no longer describe this level and have been removed.** They
were taken on the radius-6 disc with waves on a timer, and both of those changed:
the island cut the board from 127 hexes to 75, a crag took one of the corner
cluster's build hexes, and waves now arrive when the player asks. Several of the
hexes those runs built on are sea. Re-measuring needs the headless harness rebuilt
against the current components.

What still holds is the shape of the problem. The economy funds about 13 guns in
total, and that ceiling is what makes placement matter at all. With single-target
towers, position matters *only* because the budget is capped: towers fire whenever
anything is in range, so on a crowded path a badly placed tower still shoots
almost constantly, and coverage buys much less than it looks like it should. What
the island adds is stretches of route that can only be covered from one side.
Making position genuinely decisive is still what penetration, splash and prisms
are for, starting in Phase 2.
