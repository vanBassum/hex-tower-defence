---
id: 2026-08-27-09h07
date: 2026-08-27
time: "09:07"
title: The no-toolchain constraint is also what makes the game publishable, so a bundler would cost more than it looks
builds-on:
supersedes:
---

**Before:** having no build step was treated as a local development
convenience — plain ES modules, three.js off a CDN importmap, open `index.html`
and go. Its only weight was thought to be ergonomic, and therefore tradeable
against anything a bundler might offer.

**What changed it:** putting the game on GitHub Pages. Every path in the source
is relative and the single external dependency resolves through the importmap,
so the same files work unchanged from a `file://` checkout and from the
`/hex-tower-defence/` subpath Pages serves them under. Deploying turned out to
be a file copy — there is no build to configure, break, or keep fed, and no
build-vs-dev divergence to debug.

**Now:** "no toolchain" is a load-bearing property of the project rather than a
preference. It is what makes hosting free of a pipeline, and what guarantees
that what a player runs is byte-for-byte what was developed against. Adding a
bundler would not merely add a step; it would end that identity and insert a
configurable stage between the source and the thing people play, so its real
price is much higher than the setup cost it appears to carry.

Rests on: three.js remaining available from a CDN, and no future dependency
needing resolution at build time. A dependency that cannot be reached by URL is
the thing that would break this, not a growing amount of code.
