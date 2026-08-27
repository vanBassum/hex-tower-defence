---
id: 2026-08-26-19h51
date: 2026-08-26
time: "19:51"
title: A unit's strength must be the men on the board, not a second number beside them
builds-on:
supersedes:
---

**Before:** health was a pool with a bar floating above the unit, the way it had
been for the tower defence enemies — a `Health` component and a `HealthBar` to
draw it.

**What changed it:** the unit is already drawn as its men. A pool behind a bar
is therefore a second account of the same fact, and two accounts of one fact
drift.

**Now:** strength *is* the number of men left standing. There is one field, and
the health display is the formation visibly thinning on the board, in the place
the player is already looking. `Health` and `HealthBar` are deliberately left
unused rather than wired up — not dead code awaiting cleanup, but a rejected
representation.

Two details fall out of the same reasoning. The tally is fractional, because
damage is a rate against real time and at fifteen men a rounded-away tick is
most of the fight. And a spent card doubles as that unit's readout — how many
are standing against what it started with — which needed no new UI because the
hand was already on screen: the board says the formation is thinner, the card
says by how much.

Rests on: the men being drawn individually, so that thinning is legible at a
glance without a bar.
