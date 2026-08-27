## Game Progression / Core Gameplay Concept

The game is a **real-time tactical exploration game played on a hex grid** — hexes are the spatial rule, not a turn structure. Time runs continuously: damage is a rate, and units engage or disengage by where they stand rather than by entering a locked combat state. The player controls a small collection of units represented by **cards**. These cards form the player's persistent collection and determine which units can be brought into a map.

The central idea is that maps are **not necessarily intended to be completed on the first attempt**. Instead, exploring maps allows the player to discover permanent upgrades, additional units, new unit types, and eventually access to other maps. The player gradually builds a larger and more capable army, allowing them to return to places that were previously too dangerous.

### Cards and Units

Before starting most runs, the player chooses a **deck/loadout of cards** from the cards they have permanently unlocked.

A card represents something the player can deploy at the beginning of the map. Initially these are primarily units.

Cards can represent:

* A Scout.
* Basic combat troops.
* Additional copies of an existing troop.
* Eventually completely new unit types or abilities.

Importantly, obtaining another card for a unit can increase the number of those units the player can deploy. For example, if the player initially owns one basic troop card and later discovers another copy, future runs can potentially start with **two basic troops**.

This makes exploration directly increase the player's capabilities.

### Persistent Progression

Things discovered during a run can become **permanent unlocks**.

The player therefore doesn't need to "win" a map for the run to have been worthwhile. They might enter a map, discover one useful card, eventually get overwhelmed, and die. That card nevertheless becomes available when preparing for the next run.

The basic progression loop becomes:

**Enter map → explore → discover something → encounter stronger resistance → eventually fail or retreat → use newly unlocked resources → start another run.**

The player gradually pushes farther into the world.

### Maps Are Initially Larger Than the Player Can Handle

A key design principle is that a map does not need to be balanced around the player's current army being able to clear everything.

The first time a player enters a map, there may deliberately be areas that are effectively impossible.

For example:

* The player can reach an early card pickup.
* Beyond that is an enemy force that their current units cannot defeat.
* Other unexplored sections remain behind that enemy.
* The player eventually loses.
* Later, after obtaining more units elsewhere, they can return.
* The previously overwhelming encounter is now manageable.
* Defeating it opens up another section of the same map.

This makes old maps remain relevant instead of becoming disposable completed levels.

### Non-Linear Map Progression

Progression does not have to be:

**Map 1 → Map 2 → Map 3 → Map 4**

Instead, maps form a network of opportunities.

The player might explore Map 1 until further progress becomes difficult, discover Map 2, play Map 2 and acquire new units, then return to Map 1 and use those units to reach somewhere previously inaccessible.

If the player becomes stuck somewhere, they can try another map or return to an easier map to search for things they previously missed.

This creates a natural reason to revisit locations without simply making the player grind the exact same level repeatedly.

### Unlocking Maps Through Exploration

New maps can themselves be **discoverable pickups inside existing maps**.

Rather than automatically unlocking Map 2 after "completing" Map 1, the player might physically discover something that unlocks access to Map 2.

This has several advantages.

It gives exploration an important purpose beyond finding combat upgrades, and it allows the game designer to control progression without requiring completely linear level completion.

The placement of map unlocks can also encourage players to explore deeper into a map.

For example, an easily accessible area might contain a useful troop card, while discovering the next map requires surviving significantly farther.

The player therefore has reasons to continue exploring after obtaining the first obvious reward.

---

## First Map / Tutorial

The first map should introduce these ideas almost entirely through gameplay rather than explaining them through menus or text.

### First Run

The game begins immediately.

The player initially owns only a **Scout**.

There may not even need to be a deck-building screen yet because there is no meaningful choice to make.

The Scout is primarily useful for **movement, exploration and revealing the map**, rather than fighting.

The level geometry and visual design strongly guide the player toward an early pickup. It should be extremely difficult to miss.

That pickup contains the player's first **basic combat troop card**.

The player continues exploring.

Shortly afterward, the Scout encounters an enemy force.

The important part is that this encounter is intentionally unfair: **the Scout cannot realistically defeat it**.

The player gets destroyed.

This is an intentional first failure rather than punishment for playing badly.

### Second Run

After dying, the player returns to the preparation/deployment stage for the first time.

Something has changed:

They now permanently own:

* the Scout;
* the basic troop discovered during the previous run.

This is where the game introduces the idea of choosing/deploying cards.

The player enters the same map again but now has a small tactical force.

When approaching the enemy that killed the Scout previously, the solution should be intuitive.

Instead of sending the Scout directly into danger, the player can **move the combat troop forward first**.

The combat unit engages and defeats the enemy.

The Scout can then safely move beyond the encounter and continue revealing the map.

This teaches several systems simultaneously without explicitly explaining them:

**The Scout explores.
Combat units protect the Scout and clear threats.
Things discovered during failed runs persist.
Death does not reset all progress.
Returning to a map stronger allows you to reach new territory.**

The player learns the fundamental structure of the entire game through this single sequence.

---

## Intended Player Realization

Ideally, the player's first few runs produce a sequence of realizations:

**Run 1:**
*"I can explore this world."*

**Pickup:**
*"I found something."*

**First death:**
*"I couldn't get past those enemies."*

**Run 2 preparation:**
*"Wait—I kept the thing I found."*

**Second encounter:**
*"Now I can use this troop to deal with the enemy that killed me."*

**Exploring beyond it:**
*"So every time I find something, I may be able to push farther next time."*

**Discovering another map:**
*"I don't necessarily need to finish this place right now. I can explore somewhere else and come back later."*

That final realization is especially important because it establishes the intended long-term gameplay loop:

**Explore → acquire → fail/reach a limit → expand your options → return stronger → penetrate farther → discover more.**

The player's growing **collection of cards is therefore effectively their progression system**, while the maps act as persistent tactical spaces that gradually become more accessible as that collection grows.
