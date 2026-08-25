## 1. Your ideas

* **Penetrating laser/sniper** — positioning it along the enemy path lets one shot hit multiple targets.
* **Prism** — other laser towers can fire into a prism so multiple lasers can exploit one optimal firing line.
* **Prism efficiency loss** — initially perhaps only 50% of incoming power is redirected. Upgrades can increase this to \~75%.
* **Prism chaining** — multiple prisms allow more complicated routing, but losses stack: 50% → 25% through two prisms.
* **Barrier** — temporarily stops/holds enemies until too many accumulate and it breaks.
* **Barrier + artillery** — the accumulated enemies make artillery/AoE substantially more effective.
* **Barrier-targeting enemies** — certain enemies specifically attack the barrier/build progress and therefore become priority targets.
* **Tower combinations** — towers arranged in specific formations can merge into a larger tower.
* **3 guns → rotary gun** — three normal guns in the correct formation combine into one enormous fast-firing gun.
* **3 mini-cannons → heavy cannon** — same principle, but produces a large slow-firing cannon.
* **Combination changes position** — the resulting large tower is centered between the original towers. The formation therefore determines its final firing geometry.
* **Reserve space for future combinations** — you may discover that an existing tower occupies a required formation position and have to destroy it to construct the larger tower.
* **One-time path switch** — a level can contain an alternative enemy route that the player can permanently activate.
* **Switching isn't primarily monetarily expensive** — its cost is that your existing defense was designed around the old geometry.
* **Plan for both routes** — clever initial placement can keep towers useful after switching.
* **Prisms can preserve usefulness after switching** — lasers that lose their original firing corridor can potentially be redirected toward the new one.
* **Build on the inactive route** — while it's inactive, the player can place towers there.
* **Those towers are destroyed when switching** — making those positions powerful temporary space at the cost of committing against the future switch.
* **Multi-dimensional formula balancing** — tower/enemy strength can be calculated across several categories rather than reduced to one power value.
* **Level diversity matters** — different level geometries should substantially change what works.

## 2. Conclusions for the game

* **Geometry and forward planning should be the game's central identity.**
* A defense should behave more like a **designed system** than a collection of independent towers.
* **More towers shouldn't automatically solve the problem.** A smaller, deliberately constructed defense should be capable of outperforming tower spam.
* **Position is a resource.** Occupying a hex now can prevent a much better formation later.
* **Good decisions should compound.** Correct tower + correct position + correct formation + correct enemy geometry can produce disproportionately good results.
* Synergies should preferably emerge from **actual mechanics**, rather than arbitrary `"adjacent towers get +15%"` bonuses.
* **Geometric advantages should have trade-offs.** Prisms lose power, barriers break, merging sacrifices distributed towers, switching routes invalidates positions.
* **Tower progression can be spatial rather than purely numerical.** Building three small towers into the right geometry can be how you obtain a powerful tower.
* **Levels become puzzles without becoming puzzle games.** The player examines paths, firing lines, future formations and possible route changes while still playing a TD.
* **Maps can contain future opportunities that should be recognized early.** Reserving a seemingly useful empty hex can be the correct decision because it's needed five waves later.
* **Enemy variety can challenge the structure of the defense**, not merely demand more DPS.
* **Progression should gradually teach the geometric language.** Early levels make useful arrangements obvious; later levels expect the player to recognize opportunities and plan independently.
* The underlying formulas provide **balance and consistency**, while the geometry determines how much value the player actually extracts from those numbers.



## Phase 1 — Something playable

- [x] Create a small hex-grid map.
- [x] Create a fixed enemy path through the hex grid.
- [x] Spawn enemies in waves.
- [x] Give enemies health and movement speed.
- [x] Add currency.
- [x] Allow placing towers on valid hexes.
- [x] Make towers acquire targets.
- [x] Make enemies take damage and die.
- [x] Give currency for kills.
- [x] Add lives/base health and a lose condition.
- [x] Add a simple win condition after the final wave.

## Phase 2 — First geometry mechanic

- [x] Add a basic machine-gun tower. *(built in Phase 1 as the real thing, not a placeholder)*
- [ ] Add a laser tower.
- [ ] Make the laser fire in a direction rather than simply at a target.
- [ ] Make the laser penetrate every enemy along its beam.
- [ ] Preview the laser firing line while placing it.
- [ ] Create an L-shaped test level.
- [ ] Make the long section obviously attractive for head-on laser placement.
- [ ] Test whether alignment noticeably changes laser effectiveness.

## Phase 3 — Mirror enemy

- [ ] Add enemy facing/direction.
- [ ] Create a mirror enemy.
- [ ] Make its front block/reflect laser damage.
- [ ] Make its rear vulnerable to lasers.
- [ ] Make normal enemies able to travel behind mirrors.
- [ ] Create a `Mirror → Armour → Mirror → Armour` wave.
- [ ] Test attacking that formation head-on.
- [ ] Test attacking it from behind after the 90° corner.
- [ ] Tune it until the rear attack is dramatically more efficient.
- [ ] Allow conventional towers to eventually destroy mirrors from the front.
- [ ] Make that brute-force solution clearly less efficient than exploiting geometry.

## Phase 4 — Artillery + barriers

- [ ] Add an artillery tower.
- [ ] Give artillery splash damage.
- [ ] Add a placeable barrier.
- [ ] Make enemies stop at the barrier.
- [ ] Allow enemies to accumulate in front of it.
- [ ] Give the barrier a breaking condition.
- [ ] Test barrier + artillery against clustered enemies.
- [ ] Add an enemy that specifically attacks barriers.
- [ ] Add tower target-priority controls so that enemy can be prioritized.

## Phase 5 — Tesla

- [ ] Add a Tesla tower.
- [ ] Make lightning jump from one enemy to a nearby enemy.
- [ ] Allow several consecutive jumps.
- [ ] Make enemy spacing determine whether the chain continues.
- [ ] Test Tesla against enemies accumulated around a barrier.

## Phase 6 — Prism

- [ ] Add a prism structure.
- [ ] Allow lasers to target/connect to a prism.
- [ ] Let the prism redirect incoming laser power.
- [ ] Make the outgoing direction controllable through placement/orientation.
- [ ] Start prism efficiency around 50%.
- [ ] Allow multiple lasers to feed one prism.
- [ ] Allow prism → prism connections.
- [ ] Compound efficiency losses through multiple prisms.
- [ ] Add a prism efficiency upgrade.
- [ ] Test \~50% → \~75%.
- [ ] Create geometry where a prism makes an otherwise poor laser position useful.

## Phase 7 — Tower formations

- [ ] Define a three-tower formation.
- [ ] Detect when three compatible towers form that pattern.
- [ ] Calculate the resulting formation center.
- [ ] Add three small guns → rotary gun.
- [ ] Replace the three towers with the rotary gun at their center.
- [ ] Add three mini-cannons → heavy cannon.
- [ ] Make the heavy cannon slow and extremely powerful.
- [ ] Make existing towers capable of blocking formation construction.
- [ ] Create a map where reserving formation space is advantageous.

## Phase 8 — Path switching

- [ ] Create a map with two possible enemy routes.
- [ ] Show both routes to the player from the beginning.
- [ ] Add a one-time irreversible route switch.
- [ ] Allow building on the currently inactive route.
- [ ] Destroy towers occupying the route when it becomes active.
- [ ] Make existing tower positions substantially change in value after switching.
- [ ] Test whether planning placements for both configurations is worthwhile.
- [ ] Test whether prisms can preserve useful laser placements across the switch.

## Phase 9 — Start making it a game

- [ ] Create tower/enemy capability categories.
- [ ] Build formulas for baseline tower cost/effectiveness.
- [ ] Build formulas for enemy/wave strength.
- [ ] Add a wave-preview system.
- [ ] Design waves around enemy **ordering**, not merely enemy counts.
- [ ] Design maps around specific geometric opportunities.
- [ ] Make an introductory level that teaches penetration.
- [ ] Make a level that introduces mirrors after teaching head-on lasers.
- [ ] Make a level that teaches barrier + artillery.
- [ ] Make a level that introduces tower formations.
- [ ] Make a level that introduces prisms.
- [ ] Make a level that introduces path switching.

## Important checkpoint

- [ ] **STOP adding mechanics.**
- [ ] Build one 10–15 minute level using several of the systems above.
- [ ] Play it repeatedly.
- [ ] Try winning with several different layouts.
- [ ] Check whether good planning clearly beats tower spam.
- [ ] Check whether you can look at the map *before wave 1* and formulate a plan.
- [ ] Check whether changing one tower's position can meaningfully change the outcome.
- [ ] Only then decide which mechanics deserve expansion.


