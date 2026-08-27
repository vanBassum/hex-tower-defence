# Hex Tactics

A real-time tactical exploration game on a hex grid - see
`plan/Core Gameplay Concept.md`. The player controls a few units drawn from a
persistent collection of cards; maps are deliberately bigger than the army that
first enters them, and what you find on a failed run is what lets you get further
on the next one.

**Almost none of that is built yet.** What exists is the world it will be played
on - a drawn island in the sea at blue hour, terrain with real elevation, animated
water, vegetation that moves in a shared wind, lanterns that light the ground -
and the loop that plays on it: **a King standing alone in the fog**, **a hand of
cards that can only be played beside him** - starting with the Scout - and **a
cache out there to find another one in**. The tower defence
prototype this grew out of has been removed - towers, waves, an economy, lives, a
fixed route - because none of it was going to survive the change of genre and
leaving it in would have made every later decision harder to see.

There are no enemies, no turns and no combat, on purpose. Exploration was built
alone so it could be judged alone, against one question: is moving a scout
through an unknown hex world and revealing the map already worth doing? The
pickup and the hand are the second question laid on top of the first: does
finding something out there, and having to have walked the King within reach of
it before it can be used, make the walk worth more than the walk was?

The engine underneath is the component/GameObject engine carried over from the
`armymen` project. Plain ES modules, no build step. Serve the folder and open it,
or use the VS Code Live Server extension:

    python -m http.server 8000

## Controls

| Input | Action |
| --- | --- |
| Mouse over a hex | Cursor follows it |
| Left-click a unit | Select it |
| Left-click anywhere else | Deselect |
| Hover, while selected | The route there is picked out |
| Right-click | Walk that route |
| Right-drag | Rotate, and lean off the dive curve |
| Click a card | Pick it up, ready to place |
| Left-click a lit tile, holding one | Deploy it beside the King |
| `Esc`, or right-click | Put the card back down |
| `WASD` / arrows | Pan |
| Middle-drag | Pan, holding the grabbed ground point under the cursor |
| Wheel | Zoom toward the cursor; pitch dives from top-down to near-horizontal |
| `Alt` + left-drag | Rotate as well, for a mouse whose right button is spoken for |
| `Q` / `E` | Rotate one hex face |

Left selects, right moves, and they are split because they answer different
questions - with one button, clicking a tile means "go there" or "never mind"
depending on state the player cannot see.

The right button used to belong to the game alone, on the grounds that it is the
order button. It is shared with the camera now, and split by *gesture* rather
than by state: a press is an order, a drag is a rotate. That is the one way two
meanings can share a button without the player having to know which mode they are
in, because nobody has ever pressed a button meaning to drag it. The split is a
distance rather than a timer - five pixels of slop, and until they are crossed
nothing at all has happened, so an order given with a shaky hand is still an
order and not a tenth of a degree of camera. `Alt` + left-drag still rotates, for
a mouse where the right button is spoken for.

There is no third button for taking things. What is on the board is picked up
by *standing on it*, which is the only interaction a tactical game already has
room for and the only one that needs nothing explained.

Holding a card is a mode, and it is the only one in the game. It takes over the
left button entirely (while a card is up, left-click places it and nothing else)
and it cannot be held at the same time as a selected unit, because the two would
be two meanings for one click. Arming a card drops the selection and
selecting a unit drops the card: two lines, and no flag anybody has to read.

Developer keys, which are not game UI and are not meant to become it: `F` hides
the fog layer, `V` rings what the force is currently lighting up, `R` reveals the
whole board. `window.hex` in the console has the rest - `setViewDistance(n)`,
`teleport(q, r)`, `spawn(q, r, type)`, `lookAt(q, r)`, and `pickups` for taking
one without walking to it. How far a scout sees is a number
that has to be *tried*, and a knob you have to reload the page to change is a knob
you turn twice and then stop turning.

## Layout

    engine/game.js                     render loop + GameObject registry
    engine/gameobject.js               GameObject / Component base classes
    engine/hex/hex_grid.js             axial hex grid, ranges, lines, occupancy, A*
    engine/hex/hex_noise.js            deterministic per-hex noise
    engine/hex/visibility.js           what the player has seen of the board
    engine/assets.js                   glTF loading + clone cache (unused for now)
    engine/components/camera_rig.js    pan / orbit / zoom camera
    engine/components/atmosphere.js    sky, fog, skylight - what hour it is
    engine/components/directional_light.js
    engine/components/ground_plane.js  flat shadow-receiving ground (unused)
    engine/components/ambient_motes.js drifting specks - fireflies, water sparkle
    engine/components/hex_water.js     sea as hex tiles, shaded by depth
    engine/components/water_plane.js   flat ocean beyond the tiles
    engine/components/hex_ground.js    tile tops + cliff faces, grass tones
    engine/components/hex_region_outline.js  border around a hex region (unused)
    engine/components/hex_grid_renderer.js  hex outlines
    engine/components/visibility_mask.js  unwatched hexes, unlit
    engine/components/hex_overlay.js   filled hex tiles (cursor, ranges)
    engine/components/hex_picker.js    mouse to hex, plus the cursor on it
    engine/components/health.js        hit points, hit descriptors, death hook
    engine/components/health_bar.js    camera-facing bar above the owner
    engine/components/path_follower.js constant-speed walk along world points
    game/maps.js                       map definitions + expansion
    game/mood.js                       the palette and the wind, in one place
    game/props.js                      procedural trees, rocks, scrub, lanterns
    game/components/prop_layer.js      places a map's decoration + its wind
    game/units.js                      unit types + their placeholder meshes
    game/pickups.js                    what is left on the board to be found
    game/cards.js                      a unit you may put on the board, once
    game/components/unit.js            something standing on a hex
    game/components/pickup.js          something on a hex worth walking to
    game/components/unit_control.js    the force: selection, movement, vision, pickups
    game/components/deployment.js      the hand, and the ground beside the King
    game/components/enemy_force.js     who is out there, and what they do about you
    game/components/battle.js          what happens when the two sides touch
    game/ui/card_bar.js                that hand, along the bottom of the screen
    game/debug.js                      developer knobs for the exploration pass
    game/main.js                       scene setup
    tools/map.mjs                      prints the board as text, for authoring

## Map

`MAP_1` is a 75-hex island in 144 tiles of sea, drawn inside a radius-9 envelope.
It is terrain plus one place that holds something: no route through it, nothing
scheduled to arrive, no positions marked as special. Where anything *goes* and
when is the tactical layer's business, and a map with opinions about that is a
level rather than a place.

The pickup is the one exception, and it is deliberate. Where a reward sits is a
statement about the place - this corner is worth the walk, that one is worth the
risk - in exactly the way a spawn timer is not. It is the same kind of authoring
as where the lanterns go, and `node tools/map.mjs` prints it as `P` for the
reason it prints everything else: how far it sits from where a run begins is a
number being tuned, and it cannot be judged from a pair of axial coordinates.

The enemies are the other thing a level places, for the same reason: where a
picket stands is a statement about the ground it is standing on. `node
tools/map.mjs` prints them as `e`.

There is deliberately no deployment zone in the map any more. Where the player
may bring units in is a fact about where their King is standing, not about the
level, so a map has no say in it.

`buildMap` expands the definition into what the scene needs - the grid, per-hex
elevation, the sea tiles, the crags (marked occupied, so impassable), the props
and the scatter - and refuses outlines that are wrong: a prop off the board, a
pickup or a deployment hex somewhere nothing can walk to, or an island
accidentally drawn as two.

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
sea is not, and everything that asks - ground mesh, rim cliffs, grid lines,
elevation regions - already went through `inBounds`. Water being drawn but off the
board is therefore free: nothing stands or walks there without a single extra
rule. `buildMap` refuses an outline that strands a hex from the rest, or that
drops a prop into the sea.

Every cut narrows the ground somewhere, and narrow ground is where a tactical
decision lives - the difference between advancing on a front and advancing in
single file:

- The **north-east bay** cuts the middle of the island down to a causeway.
  Anything crossing it can be met from one side only. The high ground on its west
  shoulder overlooks the approach.
- The **corner beyond it is a promontory** pointing into that bay: the strongest
  ground here, and finite, because the sea is behind it.
- A **second bay** bites into the east shore, splitting it into the promontory's
  flank and the headland south of it.
- The north-west is a **two-hex spit** and the south is a single lobe carrying the
  small hill as a **cape**, so no edge of the island is a straight board rim.

**Crags** (`^`) are the non-playable terrain: land that stands at `cragLevel` and
is marked occupied in the grid, so it is impassable. Four of the five are scenery
- a ridge on the highland, a stack on the promontory point, a knoll by the
southern cape. The fifth, at `1,0`, stands in open ground on purpose: it takes a
hex off the causeway's south shoulder, which is the only shoulder the causeway
has, so the crossing is narrow on both counts. Occupancy is a grid fact rather
than a rule each consumer reimplements, which is the only reason a crag being
impassable needed no code anywhere else.

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

Making grass, cliff and water actually *meet* - the coast is still a hard edge,
with no foam or wet rock - is the obvious next terrain job.

Elevation is a second authored layer: integer levels per hex, world height being
`level * 0.22`. Regions are declared as a centre plus radius, a run, or a hex
list, applied low-to-high, and crags are stamped last so a crag on a summit still
stands above it.

The board is one merged mesh with vertex colours: a top face per hex at its own
height, and a cliff face on every edge where the neighbour sits lower. Off-board
edges drop to a base depth, so the board reads as one solid landmass. A single
cliff material covers every drop - hill sides and the rim alike - which is what
keeps varied elevation looking like the same piece of land.

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
and leaves gaps - a tuft on every tile reads as carpet. It skips the crags and
the hand-placed props, which is what keeps the authored composition
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
- **Lanterns are placement, not decoration.** Five of them, from the north-west
  spit across the causeway to the southern headland - close enough that the pools
  nearly touch, far enough that the dark between them is still dark. Each is a prop that owns its own
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

There is no road and no marked positions. There was a paved causeway across the
island with a red tile at one end and a blue tile at the other, which stated that
the place was a track to be defended - so it went when the genre did. What the
lanterns string together is the only route the map still suggests, and suggesting
is all it does.

## Exploration

The first thing that plays on the board. One Scout, one stat, and a map that has
to be walked to be seen.

**Visibility is state, and drawing it is a separate job.** `VisibilityMap` is a
hex and a state each - `UNEXPLORED`, `EXPLORED`, `VISIBLE` - and the one rule that
matters between them: *seen once is seen forever*. Vision is a fact about now and
comes and goes as units move; discovery is a fact about the run. Keeping them
apart is the whole thing, because if they were one state then walking away from a
hill would un-draw it. Nothing in the map writes `UNEXPLORED` after construction,
which is where that rule is enforced - once, rather than at every call site that
recomputes vision.

`update(sources)` takes a *list* of `{q, r, viewDistance}` rather than a unit,
and recomputes from scratch. Both of those are for the second unit that does not
exist yet. What the player can see is the union over everything they own, so a
unit that owned its own fog would un-see a hex two units were both standing next
to; and a source list means adding that second unit is a longer array here and no
other change anywhere. There is exactly one Scout today and the fog has never
heard of it.

Range is `HexGrid.hexesInRange`, in hex steps. A world-space radius gives a
different shape depending which way the ring runs, which is the sort of bug that
shows up as "vision looks slightly wrong on the diagonals" and takes an afternoon.
It yields hexes inside the *envelope* rather than inside the board, because the
sea has to be discoverable: an island whose coastline is drawn for you from the
first frame is an island you have already been told the shape of.

**Fog controls the mood; hex visibility controls what the player may see.** These
are two systems and it took getting it wrong to see why. The mist is a horizontal
sheet, and a horizontal sheet occludes nothing when you look along it - so the
first version was correct from the intended top-down camera and showed the entire
unexplored island the moment you zoomed in and rotated low. No thickness, skirt or
extra geometry fixes that, because the problem is that a blanket is not a wall.

So the hiding moved into the objects. `VisibilityField` rasterises the
`VisibilityMap` into a blurred world-space texture, and `field.patch(root)` makes
every material under an object read it and answer for itself:

- **unexplored** - painted flat in the mist's own colour, alpha dropped to nothing
  if it was transparent
- **explored** - dimmed and drifted a little toward the mist
- **visible** - untouched

That is correct from every camera angle for free, because an object that paints
itself out has no silhouette to peer past. The fog sheet went back to being
weather: if `FogOfWar` were deleted the board would still be unreadable where it
should be, it would just stop being atmospheric about it.

The colour matters. Undiscovered ground is painted in the *mist's* colour rather
than black, so from a low camera the ground and the bank standing on it read as
one mass of weather. Black would say "nothing is there"; this says "you cannot
see".

**One call per layer, not an argument threaded through every constructor.**
Whether a thing obeys fog of war is a fact about the scene, not about the thing. A
tree, a wave crest, a grid seam and a unit all want identical behaviour, so
`main.js` sweeps the layers once and no component ever hears about it - which is
also what makes the next thing added (a pickup, an enemy) correct by default
rather than by remembering. The patch injects into a stock material through
`onBeforeCompile`, so everything keeps the scene's own lighting.

One wrinkle worth knowing: three keys its program cache on the *source text* of
`onBeforeCompile`, and one closure written once has the same text for every
material it lands on. The per-material flags have to be pushed into
`customProgramCacheKey` by hand, or the first material compiled wins and the rest
quietly share its shader.

**The field is one texture with four channels**, and two of them are the same fact
at two different softnesses:

- `R` discovered, blurred over about a hex - the mist's boundary
- `G` in view right now - drives the dimming of remembered ground
- `B` inside the fogged region at all - so nothing dims the open sea
- `A` discovered, blurred only just enough to take the corners off

`R` has to be soft, because a hard reveal edge on mist is a hexagon. `A` has to be
tight, because it decides what the player is *allowed* to see, and a blur wide
enough to flatter the mist would dim the middle of the tile they are standing on.
Softness is a matter of taste on one and a bug on the other.

**Fog is drawn over the terrain, never cut out of it.** `HexGround` is one merged
mesh, so hiding part of it would mean rebuilding the world every time a unit takes
a step - and rebuilding the world to describe what is *known* about it is the
wrong way round. The ground mesh is built once and never touched; what changes is
a texture it reads.

The layer is **one sheet with a shader on it**, and that is the whole design. An
earlier version built the mist out of a thousand overlapping translucent lenses -
a hex-footprint lid to conceal, blanket discs for the far field, wisps at the
boundary - and no amount of tuning was ever going to fix it, which is worth
writing down because four passes were spent trying. A field of soft-edged
ellipsoids has *silhouettes*, and silhouettes are what the eye counts. Broader,
softer, flatter, more numerous, better shaded: each one only changed the size of
the bubbles. Mist has no silhouette. The only way to have none is for the shape
you see to be painted rather than built.

So there are three parts, and only the first is geometry:

- **The sheet.** A regular triangle lattice spanning the fogged region, its height
  sampled from the terrain and then smoothed, lying over the island like a cloth.
  Draping matters for exactly one reason: the sheet is the only thing hiding the
  board, and a flat plane at crag height would float a full step over the low
  ground and show the coast from any camera below the top of the dive.
- **The mask.** Not the fog's own - it is `VisibilityField`'s, above, and the
  mist is only one of its readers. Of the four channels it uses two: discovered
  (softly) and inside-the-region.
- **The shader.** Three noise fields at three scales drifting at three speeds
  along the level's one wind, over a slow domain warp so they knead each other
  instead of scrolling past. The mask decides how much survives.

**Gameplay stays on hexes; the field is where the hexagon is thrown away.** The
pipeline is `hexes -> texture -> blur -> opacity`. `VisibilityMap` is read and
never written, so the rules stay exactly as discrete as they were - a hex is
unexplored, explored or visible and nothing in between - while what is drawn has
no hex in it anywhere. A fourth noise field nudges the mask's own threshold up and
down, so the line between known and unknown is a ragged coast rather than a
contour of the blur. The reveal *animates* by easing the blurred field rather than
the hex one: the operation is linear, so an eased blur is still a blur, and the
mist visibly recedes rather than stepping.

**Depth into the unknown removes detail rather than adding it.** Both the alpha
variation and the colour variation are scaled by a factor that falls to almost
nothing well inside the unexplored, leaving a near-opaque sheet with a slow swell
in it. Not because the sheet has to hide anything any more - the ground below it
has already painted itself out - but because structure in the deep field is
structure that invites reading, and there is nothing out there to read. All the
tearing, holing and wisping is spent at the boundary, which is the only place it
says anything.

**The sheet writes depth and discards where it is clear**, which sounds
contradictory and is the point. Over the unknown it swallows anything that would
otherwise draw on top of it; over known ground it leaves no trace, so the path
overlay and the cursor still read through where it passes above them.

**Two boundaries, and the outer one is an artefact.** The reveal boundary is the
player's doing and gets all the noise it can take. The *region* boundary is just
where the level's hex list stops, somewhere out at sea, and drawing attention to
it would be drawing a line round the map: it gets its own much wider blur, a
low-frequency bow to break the envelope's six straight sides, and no lit lip -
that highlight is gated to the reveal boundary, because ungated it painted a
bright outline round the whole fogged area. The region channel is also *grown* out
to sea before it is blurred, and the noise that tears it is clamped one way only.
That clamp is load-bearing: a bulge of mist may wander further out, but it can
never be pulled back inland far enough to thin the bank over a tile nobody has
walked to. An earlier pass without it lifted the fog clean off the eastern
coastline.

**The blanket drapes rather than steps.** Cell heights are constant across a hex,
so a crag standing three levels up would give the sheet a three-level step, and a
step between two hexagons is a hexagon. Each hex's reference height is therefore
raised to its neighbourhood's maximum a couple of rings out and *then* averaged:
the maximum first, because averaging alone pulls a summit's own height down and
the sheet then has to be clamped back up to clear the rock, which puts the
hexagonal step back one tile further on. The lattice is smoothed again on top of
that, which is what kills the last of the hex. A hard floor still guarantees every
vertex clears the tile under it.

**And it lies low.** The sheet floats `MOOD.fogOfWar.height` over that drape, and
one elevation step on this board is 0.22 - so the 0.30 it started at had the mist
riding a step and a half above open ground and reading as a *ceiling*, something
the island was under rather than something lying on it. At 0.12 it skims the
tiles and a formation standing in it is standing in weather up to its waist. It
costs nothing to hide with, because the sheet was never what hid anything: the
terrain paints itself out through `VisibilityField`, and the mist has only ever
been the mood on top of that. The wisps drifting near the reveal line scatter
*proportionally* to that height rather than by the fixed amount they used to,
because a wisp well clear of a low sheet is not air moving through mist - it is a
blob hanging over it.

**Colour is stated outright rather than lit**, which reverses what the blob
version did and is worth the note. A lit material was the right answer while the
mist was geometry: it made the fog take the colour of the hour on its own. A
painted field has no surface to light - it is uniformly flat-on to the sky - so
lighting it buys nothing and costs exact control over how dark and how blue the
deep field reads. The one rule that carries over is that it stays blue-*grey*:
saturated blue sits next to the water and reads as more water.

**The wisps are decoration and nothing rests on them.** A dozen or so small
translucent lenses drift near the reveal line, each dissolving toward its own rim.
They hide nothing and `wisps: 0` costs the layer nothing but parallax - which is
their entire job, because a painted sheet does not move when the camera turns and
a few real objects crossing in front of it are what keep it from reading as a
texture stuck to the ground. The first attempt at them was three times the size
and twice the opacity and put the bubbles straight back: a pale disc seen from a
camera that is mostly looking *down* is a disc, however soft its edge. Small, dim
and thin is the whole of what keeps them readable as air.

Explored-but-unseen ground is dimmed and nothing else. That dimming used to be a
translucent veil painted by the fog sheet and is now done by the objects
themselves, which is both more honest and more useful: a statement about
*visibility* belongs on the thing being seen, and a veil floating above the
terrain never reached the tree, the lamp or the unit standing on the tile. Nothing
is hidden by it - the player has been told what is on that tile and taking it back
would be a lie - it is only darker, which is the difference between remembering a
place and looking at it.

**Nothing is drawn *on* a tile.** There was a pale wash over every hex the
selection could reach and a brighter one along the previewed route, and filling
tiles with flat translucent white turned out to be the cheapest possible way to
say something about a hex and to look exactly that cheap - a sticker on the board,
fighting the crisp tile edges that are the best thing about the terrain. The board
is meant to stay sharp and the fog is meant to be the soft thing, and a hex-shaped
smear of white had that the wrong way round. The reachable wash is gone entirely;
the route preview and the cursor are now *additive* at low strength, so a hex
reads as catching a little more light rather than as having a shape painted on it.
Whatever eventually marks reachability should come from the tile - its own
brightness, a rim, a lift - or from the unit, and not from a decal laid over the
top.

**The world lights up as it is found.** Every prop is scaled from nothing when its
hex stops being unexplored, and a lantern's flame, halo and `PointLight` all ramp
with it. That started as a way to keep the fog thin and stayed because it is the
board answering the player: walk into a corner of the island and the lamp somebody
left there comes up as you arrive, rather than having been on all along in a place
nobody had been. It also fixed something that was simply wrong - an undiscovered
lantern was still casting a real light, which lit the *inside* of the bank
standing over it and put a warm bloom on the cloud above a tile nobody had seen.
A lamp never goes back out: what is known does not un-know itself.

**A unit's position is its hex.** The world position is a consequence, and the
walk between two tiles is an animation over that consequence. The coordinate
advances one tile at a time as the march reaches it, so a long walk *reveals* a
long walk: the fog lifts a tile at a time along the route, and where you chose to
go is what you find out about. A unit holds its hex in the grid's occupancy set,
which is how it becomes impassable to everything else for nothing - crags already
work that way, and `isWalkable` and A* already ask.

**A move is a route, not a step.** Walking an island a tile at a time is a lot of
clicking to say one thing, and the route is the interesting part anyway - which is
why hovering a destination draws it before you commit to it. It is walked at a
constant speed straight through, the way `PathFollower` walks a list of points: a
distance budget is spent across waypoints, so a corner never costs a frame of
movement and a tile boundary is not an event. The first version eased each tile
separately, which put an accelerate-and-stop in the middle of every hex - fifteen
people repeatedly coming to rest on their way somewhere. The easing that remains
is at the two ends of the *whole* route, which is where a body actually does start
and stop. The gait that rides on top is driven by distance covered rather than by
progress through a tile, for the same reason: tied to the tile it resets at every
hex and reads as a stumble.

There are still no movement points, no terrain cost and no turns. Every one of
those is a decision the tactical layer has to make, and making them here, before
there is a game to make them against, is deciding them in the dark.

**You may only order a move into ground you have discovered**, and A* is given
every unseen hex as impassable. That is not a restriction bolted onto the fog; it
is what fog *means*. A route that threads perfectly between crags nobody has seen
is the player reading the level file, and the whole point of the Scout is that
finding the way is the thing being played.

The Scout has one gameplay stat, `viewDistance`, and it is `2`. That is far enough
that stepping forward visibly buys something and short enough that the island still
takes a walk to learn. It is in `game/debug.js` next to the starting hand, and
`window.hex.setViewDistance(n)` changes it live, because that number is the whole
tuning surface of this milestone.

**Scale is set by what stands on a tile**, and it is stated in `game/units.js`
because everything else is measured against it. A hex holds an army unit of about
fifteen people, so it is roughly 12 m of ground and one world unit is about 7 m -
which makes a person 0.26 units and a tree about 0.8. The first pass drew a unit
as a *single* figure 0.84 units tall, a five-metre soldier, and that one object
quietly told the eye that a hex was three paces across; every prop on the board
had to come down by a third once it was fixed. A unit is now a formation - two
InstancedMeshes, a body pass and a head pass, so it costs two draw calls whatever
it is made of, and so the day a formation has to lose people it is a `count`.

Three things the first passes got wrong, all the same mistake - putting light or
weight where the eye was already going:

- The Scout's lamp started at lantern strength. It washed the tiles around it
  amber, so the one part of the board the player is looking at was the one part
  not in the level's palette, and the warm cliff faces at the coast lit up into
  what read as a selection outline. The lamp says *where the scout is standing*.
  The fog is what makes that tile legible.
- The move highlight started at the opacity a highlight wants on a bright board.
  On grass a lantern is already tinting warm, at dusk, it was invisible.
- The cloud started at a near-white albedo, so the fog was the brightest thing in
  frame and the discovered clearing was a dark hole punched in it. Cloud has to be
  pale *against a dark sea* and still lose to a lit tile.

`HexPicker` also grew a second pass while this went in. It intersects a flat
plane rather than raycasting the terrain, which was off by a whole hex on a hill
seen from a low camera - cosmetic while nothing could be clicked, and a bug the
moment aiming at high ground sent the Scout somewhere else. It now solves the
plane twice: once at `y = 0` to find roughly which tile, then again at *that
tile's* height. One correction covers one step of elevation, which is all this
board has, and it is still two plane intersections rather than a raycast against
the merged ground mesh.

## The first pickup

The concept doc's whole loop rests on one sentence: a run is worth making even
when it is lost, because something found on it is kept. The first thing that
tests that is one cache, on the small hill three hexes east of where the Scout
starts - somebody's colours planted in the ground, their spears stacked beside
them, a shield propped at the foot - and what it holds is the Footmen who carried
them.

**Walking onto it is the whole interaction**: no key, no prompt, no button. It
does not hold its hex in the grid's occupancy set, and that is the only reason it
can be walked onto at all - crags and units do hold theirs, so not holding one is
not a rule but the absence of one. It is taken the moment a unit's hex *becomes*
its hex, which on a route is when the march commits to the tile rather than when
it lands on it. That is the same instant the fog opens there, and it has to be: a
unit's position is its hex, the walk is an animation over that, and a reward that
waited for the animation would be the one thing on the board that disagreed about
where the unit was standing.

**It is somebody's kit, not a glowing box**, and that is what saves it from
needing a label. An object with a story does not have to be explained: colours
left standing, arms stacked, a shield nobody came back for. The one concession to
game-ness is the light, and the lanterns already spent the meaning of a warm
pocket on this board - somebody was here. A pickup is that sentence with nobody
left standing in it, which is why it is lit at all and why it is lit *dimmer and
shorter* than a lamp on a post: a lantern is a place somebody lives, and this is a
place somebody stopped.

**The banner is waved rather than posed**, and it is the water's trick and the
vegetation's for the third time: a pure function of position and time, with the
ripple growing along the cloth so the attached edge stays on the pole and the free
edge does the moving, and that free edge pulled back in as it waves because cloth
does not stretch. The amplitude rides the island's one gust, so the banner goes
quiet when the trees do, and it streams downwind for the same reason - three
effects with private weather look like three effects.

**It is found before it is lit**, like a lantern, and for the harder of the two
reasons rather than the flourish: a real `PointLight` burning on an undiscovered
tile lights the *inside* of the fog bank standing over it. Everything else about
hiding it is free, because `field.patch` sweeps its layer with the rest and a
component that never hears about fog of war gets it right by default.

**Taking it is a lift, not a fade.** A pickup that dissolves in place says the
object was never really there; one that rises off its pole says somebody took it.
It holds its shape for the first third of the take and then goes, so what the eye
follows is the lift. The flare that goes with it is spent almost entirely on the
*light* and hardly at all on the halo, which is the one thing here that had to be
tuned twice: a small additive sphere reads as air around a flame, and the same
sphere half again as large reads as a pale disc pasted over the scene - the exact
mistake the fog's wisps were shrunk to fix. What should visibly brighten is the
grass, not the sphere.

**What it grants is a card, not a unit.** Nothing appears where the cache stood.
The Footmen it names go into the hand at the bottom of the screen and can only be
played beside the King - see below. `UnitControl` reports the grant and stops
there: it has never heard of a card, and the pickup has never heard of where one
can be played.

**The Footmen are a second unit type, and one stat is all they are allowed.** They
see one ring where the Scout sees two, and that is the whole of their cost:
walking with the escort in front is safer and slower to learn from, which is what
keeps the Scout a job after the rescue arrives. What they hit and what they can
take waits for combat, because a number written before there is anything to spend
it on is a number nobody has had to defend.

What they *look* like had to do more work than that. Two formations of fifteen
people 0.26 units tall are the same ten pixels of dark shape at the game's camera,
so colour alone was never going to separate them - what separates them is the
outline: a hooded crowd standing in rings around a lamp, against a helmeted block
in ranks with a bristle of spears above it. The spears are one more
`InstancedMesh` pass, each at its own small angle because fifteen shafts at one
angle is a comb, and they are the thing that actually reads at range. They and the
helmets are also the only steel on a Footman, so the two parts that catch light
are the two parts that should.

**Collecting lives in `UnitControl`**, which is not scope creep: it is the join
between the only two lists that component already owns - what the player has, and
where it is standing. Nothing else in the scene knows both, and anything that did
would be a third list to keep in step with those two. The pickup itself knows how
long it takes to be lifted off its pole and nothing else; it is handed a callback
rather than the force.

Where it sits is a level decision, and `node tools/map.mjs` prints it as `P` -
because judging "extremely difficult to miss" from a pair of axial coordinates is
exactly what that tool exists to make unnecessary. Three hexes is close enough to
find in the first minute and far enough that a step has to be taken to see it at
all: a reward already visible from the start hex is a reward the player was given
rather than one they found. The board does the rest with the only two things it
has - raised ground, and a light in the dark.

## Where reinforcements arrive

A card is *where* as much as it is *what*, and getting that "where" wrong twice
is what settled it.

A reinforcement that can appear anywhere costs nothing, so the cache on the far
shore would be a reward collected by touching it. The first fix was a **camp**:
four hexes on the south-west shore, and everything played there. It worked, and
it was still wrong - it made a rule about a *place*, and the consequence was that
the far end of the island became tedious rather than dangerous. The cost of
finding something over there was a walk home.

The second was the **Scout**, which was better and still not right: it made the
one unit that must survive the same one you send ahead to look at things, so the
rule pulled against itself.

**The rule lives on the King.** He is the one unit the game puts on the board
itself, he walks, and every card is played onto a free tile next to him - so where he is standing is the
whole of the force's reach, and that reach is something the player pushes
forward and has to defend rather than a corner of the map they return to. He is
a base, and the base moves.

Everything else falls out of it without being written down anywhere:

- Walking the King forward extends where the army can appear, and walks the one
  thing you cannot lose toward whatever is out there.
- It is why the King cannot be a card and the Scout can. A card is played beside
  something, so something has to be there first - and the run opens with exactly
  one thing on the board and exactly one thing you are allowed to do with it.
- The Scout goes back to being what it is for: it sees two hexes and finds
  things, and it does not have to survive for the force to keep functioning.
- Footmen cannot bring anyone in either. The King is the only anchor, so an army
  that has marched away from him is an army that cannot be reinforced.
- Which unit anchors is `deployAnchor: true` on its type and `Deployment.anchors()`
  filtering the roster by it - so a second kind of anchor later is one field and
  no change here at all.

He is worth nothing else yet. Losing him will one day lose the run, and that is
a rule to write when there is something on this island that could kill him -
today it would be a sentence nobody could test.

**The opening is one card.** A King alone in a clearing of fog seven hexes
across, a Scout in hand, and a line of text saying to click it. That is the whole
game stated in one frame: this is yours, this is where things arrive, put
something down. The Scout being a card rather than a unit already standing there
is worth the one click - it teaches the bar at the bottom before the first cache
is ever found, which is the only part of this that is not self-evident from the
board.

**A King is read by his standard.** Every unit on this board is ten pixels of
dark shape at the game's camera, so each one gets a silhouette rather than a
colour: the Scout is a hooded crowd around a lamp, the Footmen a helmeted block
under a bristle of spears, and the King a small retinue with a flag flying over
it. The flag is the tallest thing any unit has, because the King is the one the
player must always be able to find. Inside the ring stands one figure half again
as tall as anyone else, built from exactly the same shapes as the rest - a
leader drawn from a different kit reads as a different game - and the crown on
him is for the moment somebody zooms in, not for the moment they are playing.

He also carries a **torch**, and that is the one place the palette rule is bent
on purpose. The King replaced a camp; a camp was the warm thing on this board; so
the warm pocket did not disappear when the camp did, it started walking. It is
wider and deeper-orange than the Scout's lamp and it is there for the opposite
reason - the Scout carries a light because it is out alone in the dark, and the
King carries one because he is the place everything comes back to.

**The zone is computed, never stored.** It moves every time anything takes a
step, and a cached copy would be one more thing to remember to invalidate on a
board where units are the only thing that ever moves. It is drawn once and only
while a card is held: the route preview's treatment at slightly higher strength -
additive, so a tile catches more light rather than having a hexagon painted onto
it - because "where may this go" is not a question anybody is asking until they
are holding something. The camp's always-on rim went with the camp; a ring drawn
permanently around a unit that already has a torch and a selection ring is a
third thing competing to describe one tile.

**The hand is the first piece of the game that is not the world**, and it is DOM.
That is a decision rather than a shortcut: a card is a menu, not an object on the
island, and putting it in the scene would mean building text layout, hit testing
and focus against a camera that pans and rotates. It holds no state at all -
`CardBar.update(deployment)` paints whatever it is handed, hint line included -
so there is one account of what the player has, and it lives in the component
that also knows where it can be played.

Cards are warm where every other piece of chrome on the page is cool, and the
level already spent that meaning: warm is what somebody left behind. The art on a
card is the unit's *silhouette*, because the silhouette is what has to be matched
against the thing standing on the board - spears above helmets on the card,
spears above helmets on the tile.

**A card says what a troop is for, and never what its numbers are.** "Sees one
hex" is a stat wearing a sentence, and it is the wrong thing to put in front of
somebody deciding where to put a unit down: a hand is read in the second between
finding a card and choosing a tile, and what has to survive that second is the
*job*. This one goes ahead; that one stands in front. Numbers are for comparing
two things you already understand, and they get their own place on the card when
there are enough of them to compare - a row of figures, not prose pretending to
be a description. The field is called `role` so that nobody writes a stat into it
by accident.

**One card is one unit.** It is spent when played, and stays in the hand greyed
rather than vanishing. Removing it would be tidier and would throw away the thing
a first run most needs to show: that what was found in the dark is what is now
standing on the board. A second copy of a card is therefore a second body of
Footmen and not a better one - the arithmetic the whole progression loop in the
concept doc rests on - so the hand is a list of cards rather than a table of
counts, and two entries naming the same unit need no special case.

**Everything that can go wrong is a state that says so.** A King boxed in lights
up as nothing, which looks exactly like a highlight that has not arrived yet, so
the hint says there is no room beside him instead - and stops saying it the
moment something moves. That needed a subscription this component would not obviously have
reached for: a unit stepping aside frees a tile without changing what anybody has
*discovered*, so watching visibility alone leaves both the highlight and the hint
a step behind the board. Occupancy is already a grid fact with a listener on it,
which is the only reason that is two lines.

**Playing a card is a mode, and it is the only one in the game.** It takes the
left button entirely while it is up, and it cannot be held at the same time as a
selected unit - arming a card drops the selection, selecting a unit drops the
card. Two lines, and no flag anybody has to read.

## The other side

Two bodies of Spearmen hold the neck of the island, past the cache and short of
everything the causeway leads to. They are the first thing here that is not the
player's, and combat is the *next* milestone rather than this one - so what is
built is the smallest thing that makes an encounter mean something, and nothing
that would have to be decided without an enemy anybody has ever fought.

**A unit's strength is its people count.** Fifteen people is what a formation
draws and what damage comes out of, and they are one field - so the health
display is the unit itself thinning out, on the board, in the place the player is
already looking. There is no bar over anybody's head. `Health` and `HealthBar`
have been sitting unused in the engine since the tower defence cull and this
deliberately does not use them: a pool of hit points behind a bar is a second
account of the same fact, and two accounts drift. Losing people is lowering
`count` on the instanced passes, which is what the two-pass build was written for
long before there was anything on this island that could take somebody out of a
rank.

The float behind it matters. Damage is a *rate* against real time, so the tally
is fractional and `people` is what it rounds up to - otherwise the smallest tick
either kills somebody or is thrown away, and at fifteen people a thrown-away tick
is most of the fight.

**A fight is a fact about where things are standing.** `Battle` takes the two
rosters and, for any two opposing units on adjacent hexes, takes casualties off
both at their own rates. No attack order, no target selection, no turn. Nothing
pins anybody: you can walk out of a fight, or straight through one, and pay for
it in people - a rule that held units in place would be a rule about turns, and
holding somebody still in a game with no turn to spend is holding them still
forever. Flanking is not implemented and happens anyway, because a unit with two
enemies beside it is simply in two pairs.

The numbers are one per type and they are what the first map is balanced on: one
body of Footmen beats one body of Spearmen with a third of itself standing, and
loses to two. That is the encounter the concept doc asks for - the first time you
come up here you lose, and the second time you come up here with more.

**They hold, and holding is the whole behaviour.** Spearmen do not come for you
and do not follow you. Nothing happens until something is standing on the tile
next to them, at which point Battle costs both sides people for as long as that
stays true.

They chased, for one version, and it was wrong for a reason worth keeping: the
entire job of a Scout is to see a thing before the thing is a problem, and an
enemy that sets off the moment you are three hexes out takes that away. Looking
at a picket, deciding not to touch it, and going somewhere else has to be a move
the player can make. `stance` on the type is where that lives - `'hold'` for
these, and `'hunt'` still implemented in `EnemyForce` for the kind that is
*supposed* to deny you the look. A hunter comes for the nearest unit inside
`aggro`, stops one hex short, and walks back to the hex the level stood it on
when nobody is left in range; without that post, a player who pokes and retreats
would drag it across the island a hex at a time.

Enemies think whether or not they are visible, and that is not a cheat: they live
here, and being unobserved does not make them asleep. The fog hides them through
the same `field.patch` sweep as everything else.

**Where they stand took two corrections, and the second is the useful one.** They
were on the north-east crossing, which *looks* like the neck of the island and is
not: pull those two hexes out of the board and nothing becomes unreachable,
because the coast road round by 1,1 and 2,0 goes past them. A picket that blocks
nothing is scenery, and it had only been reading as an encounter because it used
to come and find you - which is the sort of thing that stays hidden until the
behaviour stops covering for the placement.

The real cut is the west shoulder. Two hexes there are the whole of the way onto
the northern hill: take them out and sixteen hexes go with them, a fifth of the
island. They stand on the rising ground looking down the approach, which is what
the elevation was drawn for. Three hexes from where the King starts, which is
close, and stopped mattering the moment they stopped chasing - the first map now
opens with *walk north, see for yourself that the way is held, and go the other
way to find something that gets you through it*.

**A spent card is that unit's readout.** The card keeps hold of what it played,
so it goes on saying something after it is spent: how many are still standing
against what it started with, a thin fill under the art, and then `Lost`. That is
where the comparison lives - the board tells you a formation is thinner and the
card tells you by how much - and it costs no new UI, because the hand was already
on screen. It is polled rather than pushed: damage lands on some frame or other
rather than at an event worth subscribing to, and comparing three cards is
cheaper than the bookkeeping that would avoid it.

**They read as a mob.** Everything the player owns stands in rings or in ranks;
Spearmen stand in a crowd, jittered nearly five times as hard, with their spears
going every way at once and dull red hoods where the Footmen have pale steel
helmets. The colour is the smaller half of that. What carries at the game's
camera is that one of these two crowds is *ordered* and the other is not, which
is legible at any zoom and in any light.

## What is left to build

The world is done enough to play on. Nothing on top of it exists yet, and the
order that matters first:

- **Turns.** Whose turn it is, and what a unit has left to spend on this one.
  Movement is currently free and unlimited, which is the first thing a turn takes
  away.
- **What a step costs.** A move is a whole route already, and it is free: no
  movement points, no terrain cost, no limit on how far a turn carries you. That
  is the other half of the turn above, and the first thing that makes a route a
  decision rather than a click.
- **Combat, properly.** What exists is adjacency and a rate. There is no
  retreating that costs anything, no ground worth holding, no difference between
  attacking and being attacked, and no reason to bring two units instead of one
  big one. Most of those are turns wearing a different hat.
- **Losing.** The King can be killed now and nothing happens when he is: the hand
  says nothing can be brought in, and the run carries on being unplayable rather
  than ending. That is the first thing the next pass owes.
- **The run boundary, and the collection behind the hand.** A card is found,
  played and spent inside one session; nothing survives a reload, and there is no
  losing a run to keep anything *across*. Still the last thing to build rather
  than the first - but the hand is already the shape it needs, because a run
  would deal it from a collection instead of filling it from pickups and
  `Deployment.addCard` would not move.
- **A reason to hold a card back.** Every card in hand is played the moment it
  is found, because nothing is gained by waiting and nothing is lost by
  committing. That only becomes a decision when a card costs something to play -
  a turn, an upkeep, a slot - which is another thing turns bring with them.

Two things deliberately kept out of the way until they are needed: `engine/assets.js`
(glTF loading with a clone cache) and `engine/components/ground_plane.js`.

Every mesh that walks, or is picked up, is a knowing placeholder - hooded figures
with a lamp, a helmeted block with spears, a banner on a pole - all built from the
same flat-shaded primitives the props are, so they sit in the scene rather than on
top of it. None of it is worth art until it is worth art.
