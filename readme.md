# Hex Tower Defence

Hex-grid tower defence, built on the component engine carried over from the
`armymen` project. Phase 1 is complete: a board with a fixed path, eight waves,
buildable machine-gun towers, an economy, and win/lose conditions. No geometry
mechanics yet - that starts in Phase 2.

Plain ES modules, no build step. Serve the folder and open it:

    python -m http.server 8000

## Controls

| Input | Action |
| --- | --- |
| Left-click a hex | Build a machine gun (40c) |
| `WASD` / arrows | Pan |
| Middle-drag | Orbit |
| Wheel | Zoom |

The build cursor turns green on a legal hex and red otherwise, and shows the
range ring of the tower you would be placing.

## Layout

    engine/game.js                     render loop + GameObject registry
    engine/gameobject.js               GameObject / Component base classes
    engine/hex/hex_grid.js             axial hex grid, lines, occupancy, A*
    engine/hex/hex_noise.js            deterministic per-hex noise
    engine/components/camera_rig.js    pan / orbit / zoom camera
    engine/components/directional_light.js
    engine/components/ground_plane.js  flat shadow-receiving ground
    engine/components/hex_ground.js    tile tops + cliff faces, grass tones
    engine/components/hex_ground_detail.js  dirt patches + flower clusters
    engine/components/hex_region_outline.js  border around a hex region
    engine/components/hex_grid_renderer.js  hex outlines
    engine/components/hex_overlay.js   filled hex tiles (path, build cursor)
    engine/components/health.js        hit points, hit descriptors, death hook
    engine/components/health_bar.js    camera-facing bar above the owner
    engine/components/path_follower.js constant-speed walk along world points
    game/level.js                      level definition + path expansion
    game/game_state.js                 currency, lives, win/lose status
    game/enemies.js                    enemy stat table + spawn factory
    game/props.js                      procedural trees and rocks
    game/towers.js                     tower stat table + build factory
    game/components/enemy.js           enemy marker, keeps game.enemies
    game/components/tower.js           targeting + hitscan fire
    game/components/tower_placer.js    mouse-to-hex build cursor
    game/components/shot_tracer.js     fading muzzle-to-target line
    game/components/wave_spawner.js    runs the level's wave table
    game/components/level_director.js  end conditions
    game/components/prop_layer.js      places a level's decoration
    game/components/hud.js             readout + end-of-level banner
    game/main.js                       scene setup

## Level

`LEVEL_1` is a radius-6 board. Its path is stated as waypoints and expanded into
hexes by `HexGrid.hexLine`, so it reads as straight runs: a 10-hex diagonal
across the middle, a 120-degree corner, then 6 hexes down to the base. Spawn is red,
base is blue. The path hexes are collected into `pathKeys`, which both drives
tower placement rejection and tells `HexGround` which tiles are path.

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

Dirt patches and flower clusters land on ~12% and ~11% of grass tiles, in one
merged mesh - irregular blobs rather than scaled hexagons, and small crossed
blades rather than flat dots, since a flat dot disappears at gameplay zoom.

Enemies: `grunt` (190 hp, speed 2.0), `runner` (105 hp, 4.2), `brute` (780 hp, 1.3).
Eight waves, 136 enemies, 36,770 total hp. A wave's lead-in starts when the
previous wave finishes spawning, so waves overlap if the board isn't clearing. A
wave's `enemy` can be a repeating pattern, so a wave has an ordering and not just
a head count.

## Balance

Tuned by simulating the real components headlessly against the real level - see
the note below. The economy funds about 13 guns in total, and that ceiling is
what makes placement matter:

| Build | Result |
| --- | --- |
| Covering the corner | win, 28/30 lives |
| Maximum path coverage | win, 23/30 |
| Clustered near the spawn | win, 1/30 |
| Clustered near the base | loss |
| Deliberately poor coverage | loss |

Note that with single-target towers, position matters only because the budget is
capped. Towers fire whenever anything is in range, so on a crowded path a badly
placed tower still shoots almost constantly - coverage buys much less than it
looks like it should. Making position genuinely decisive is what penetration,
splash and prisms are for, starting in Phase 2.
