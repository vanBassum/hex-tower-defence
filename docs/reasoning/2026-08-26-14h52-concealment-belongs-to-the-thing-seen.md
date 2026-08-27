---
id: 2026-08-26-14h52
date: 2026-08-26
time: "14:52"
title: Concealment is a property of the thing being seen, not a layer above it
builds-on: 2026-08-26-14h35-2
supersedes:
---

**Before:** the continuous mist sheet was also the thing that hid unexplored
ground. Fog was a surface drawn over the world, and occlusion was the fog's job.

**What changed it:** a horizontal sheet occludes nothing when you look along it.
It was correct from the intended top-down camera and put the whole unexplored
island in plain view the moment you zoomed in and rotated low. No thickness,
skirt or added geometry addresses that — a blanket is not a wall — so the whole
class of "draw the fog over the world" solutions is dead, not just this one.

**Now:** hiding lives in the objects. A shared blurred world-space visibility
field is patched into every material under an object, and each one answers for
itself: unexplored painted flat in the mist's own colour with its alpha dropped,
explored dimmed and drifted toward the mist, visible untouched. This is correct
from every camera angle for free, because an object that paints itself out has
no silhouette to peer past.

Dimming belongs on the thing being seen for the same reason: a veil floating
above the terrain never reached the tree, the lamp or the unit standing on it.

A second shift rides along with it — whether a thing obeys fog of war is a fact
about the scene, not about the thing. So one sweep patches everything after
construction rather than threading a `visibility` argument through eight
constructors, and the next pickup or enemy is correct by default rather than by
somebody remembering to ask.

Unexplored ground takes the mist's colour rather than black, so from a low
camera the ground and the bank standing on it read as one mass of weather.
Black would say "nothing is there"; this says "you cannot see".

The field carries the reveal at two softnesses, because the two consumers want
opposite things: soft for the mist, since a hard reveal edge on mist reads as a
hexagon, and tight for the hiding, since that one decides what the player may
see and a blur wide enough to flatter the mist would dim the middle of the tile
they are standing on.
