---
id: 2026-08-26-20h58
date: 2026-08-26
time: "20:58"
title: A man's identity cannot live in an index the renderer is free to permute
builds-on: 2026-08-26-19h51
supersedes:
---

**Before:** one count per unit was thought fine-grained enough. Casualties
resolved against a single float and a single column.

**What changed it:** the same place in the line emptied every time. With one
float and one column there was only ever one man who *could* be next, so the
scheme could not produce a casualty who happened to be fighting — it could only
produce the same casualty. Watching a full wipe is what made it visible.

**Now:** hit points belong to a man, not to a unit. Each entry carries its own
`hp` and `bite`, both small spreads either side of one, so a unit of fifteen is
still worth fifteen and a wipe still takes people/attack seconds — the
aggregate is preserved while the granularity changes. Damage is spent on the
front rank only and split by each man's bite, so four men holding the same edge
against the same enemy do not run out together, and the casualty is somebody who
was actually fighting.

The general form, and the part worth carrying elsewhere: a man owns his place
rather than deriving it from his instance index, because that index moves.
Culling the tail to hide the dead swaps the dead man's entry to the end, so
anything that makes a man himself has to live in the entry rather than in his
position in the array. Identity cannot be stored in a slot that another system
is entitled to reorder.

Verified across a full wipe: a company of footmen loses slots
0, 2, 2, 1, 0, 2, 1, 0, 3, 2, 1, 0 — all of them on the line, none of them the
same man twice — with the closing cascade keeping the slots a permutation of
0..people-1.
