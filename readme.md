# Hex Tactics

A real-time tactical exploration game on a hex grid. A King stands alone in the
dark with a hand of cards that can only be played beside him, and the island has
to be walked to be seen.

**[Play it in the browser](https://vanbassum.github.io/hex-tower-defence/)** ·
**[Level editor](https://vanbassum.github.io/hex-tower-defence/editor/)**

Early prototype: the world and the exploration loop exist, the game on top of
them mostly does not. No turns, no cost to a step, no losing a run yet.

## Run it

Plain ES modules, three.js from a CDN, no build step.

    python -m http.server 8000        # then open localhost:8000, or /editor/
    python tools/check.py             # load it headless, fail on any console error
    python tools/check.py --page editor/index.html    # the same, for the editor
    node tools/map.mjs                # print the board as text

## Where things are

| | |
| --- | --- |
| `CLAUDE.md` | the map of the codebase, the invariants, and where to add things |
| `plan/Core Gameplay Concept.md` | what the game is meant to become |
| `docs/reasoning/` | the log of how the design got here, one shift at a time |
| `engine/` | generic: knows about hexes, not about this game |
| `game/` | this game: what is on the island and what plays on it |
| `editor/` | the level editor at `/editor/` - the same world, with the game taken out |

Controls are listed in the corner of the screen while you play. The long design
prose that used to fill this file is in the git history, and its conclusions are
in `CLAUDE.md`.
