---
id: 2026-08-27-09h07-2
date: 2026-08-27
time: "09:07"
title: The game is real-time, and calling it turn-based in the concept doc was a leftover label rather than an intention
builds-on: 2026-08-26-19h51-2
supersedes:
---

**Before:** the concept doc opened by describing the game as "a turn-based
tactical exploration game played on a hex grid", while the combat model built
the same day reasoned explicitly from having *no turn to spend* — real-time
damage rates, a fractional casualty tally, and no pinning. Both statements stood
in the repository at once, and neither had been checked against the other.

**What changed it:** noticing that the two cannot both hold, and settling it in
favour of the implementation. The mechanics that depend on continuous time are
not shortcuts standing in for a turn system: the fractional tally exists
*because* damage is a rate, and the absence of pinning is a direct consequence
of there being no turn boundary to release a held unit.

**Now:** the game is real-time on a hex grid — hexes are the spatial rule, not a
turn structure. "Turn-based" was a genre label carried over from the tower
defence framing rather than a design intention, and it was actively misleading:
read as intent, it makes pinning look like a missing feature instead of a
rejected one. Discrete space with continuous time is the actual shape.

Rests on: the exploration and progression design — persistent unlocks,
deliberately overwhelming areas — being indifferent to whether time is turned or
continuous, which it appears to be, since nothing in it references turns.

**Follows:** the genre line in `plan/Core Gameplay Concept.md` corrected. This
also closes the open question left at the end of note 2026-08-26-19h51-2.
