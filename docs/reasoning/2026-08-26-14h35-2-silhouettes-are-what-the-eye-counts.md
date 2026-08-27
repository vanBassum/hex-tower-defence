---
id: 2026-08-26-14h35-2
date: 2026-08-26
time: "14:35"
title: Silhouettes are what the eye counts, so fog must be continuous while the rules stay discrete
builds-on:
supersedes:
---

**Before:** fog of war was built from a thousand overlapping translucent
lenses — one soft-edged ellipsoid per revealed area — on the assumption that
enough softness would blend them into weather.

**What changed it:** every round of tuning only changed the size of the bubbles.
A soft-edged primitive still has a silhouette, and silhouettes are what the eye
counts. The failure was not in the parameters, so no parameter could fix it.

**Now:** mist cannot be assembled out of per-area primitives at any softness;
the drawn fog has to be one continuous surface — a single triangle sheet draped
over the terrain with a procedural cloud field painted on it (three noise scales
drifting along the level's wind over a slow domain warp).

The general form of the insight is a split between rule and presentation:
gameplay visibility stays discrete on hexes, and the hex visibility map is
rasterised into a world-space texture and blurred. The rules stay exact while
nothing drawn has a hexagon in it. Structure also has to fall away deep in the
unknown, because visible structure out there is structure the terrain can be
read through.

The same reasoning separates the two boundaries, only one of which is the
player's doing: the reveal edge is theirs and takes all the noise it can carry,
while the region edge is only where the level's hex list stops and so needs a
wider blur and a low-frequency bow to break the envelope's straight sides.

Rests on: the player never needing to see the exact tile boundary of the
reveal.
