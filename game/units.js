import * as THREE from 'three';
import { hashHex } from '../engine/hex/hex_noise.js';

// What kinds of thing can stand on a hex, and what each of them is for.
//
// ── A unit is a way of using the board ──────────────────────────────────────
// The roster is six, and what they are meant to differ in is not their numbers.
// Each of them changes where the player wants to be standing: the Scout buys
// ground nobody has seen and nothing leaves its post for him, Archers reach
// three hexes so the line in front of them matters, Spearmen reach two so
// *depth* matters, Heavy Infantry moves so little that where it stands is a
// decision taken before the fight, and Cavalry moves far enough to arrive
// somewhere that was safe a moment ago. Swordsmen are the one with nothing
// special about them, on purpose: something has to be the thing the rest are
// read against, and being dependable is a role.
//
// ── The fields are capabilities, never names ────────────────────────────────
// Nothing downstream asks what a unit *is*. Battle asks for `range` and for a
// damage rate; ActionLoop asks for `moveRange` and whether a unit `provokes`; a
// damage modifier names a *trait* and never a type. So an entry here is the
// whole of a unit, and the seventh one is this table and nothing else - which is
// the property that has to survive, because the alternative is five systems each
// carrying its own copy of the list.
//
// ── Casualties are the count, and that is the only health there is ──────────
// A unit *is* fifteen people, so it loses them. There is no hit-point pool
// hidden behind a bar over its head: `people` is the number the mesh draws and
// the number it takes damage out of, and the two cannot drift apart because they
// are one field. A formation thinning out as it fights is a health bar that is
// already on the board, in the place the player is already looking, and it needs
// no UI at all.
//
// Which means "survivability" is a headcount and nothing else. Heavy Infantry
// takes more killing because there are twenty of them; there is no armour, no
// defence number and no damage reduction anywhere on this board, and a stat that
// listed one would be describing a rule that does not exist.
//
// `attack` is the other half and it is a *rate* - people killed per second while
// two units are in reach of each other. Not a die roll and not a turn's worth of
// damage, because there are no turns yet and a number that assumed them would be
// a number that has to be rewritten the day they arrive. It is also why a charge
// is worth a *window* of seconds rather than a first blow: there is no discrete
// attack here for one to be the first of.
//
// ── Scale ────────────────────────────────────────────────────────────────────
// A hex holds an army unit - about fifteen people - and that single fact sets
// the scale of everything on the board. It has to be stated somewhere, so it is
// stated here:
//
//   a hex is 1.73 across flat to flat, and that is roughly 12 m of ground
//   → 1 world unit ≈ 7 m
//   → a person is ~1.8 m, so 0.26 units tall
//   → a tree at ~1.4 units is a ~10 m tree, which is what it should be
//
// The first pass got this badly wrong by drawing a unit as *one* figure at 0.84
// units - a five-metre soldier - which quietly told the eye that a hex was about
// three paces across. Nothing else on the board was at fault; the fix is that a
// unit is a formation of people, and each of them is small.
const SOLDIER = 0.26;        // a person, in world units, per unit of hex size
const FOOTPRINT = 0.72;      // how much of the tile's inradius the formation fills

// A thrust, in soldier heights and radians. The man goes in a little way behind
// the point; almost all of what reads is the shaft dropping from shouldered to
// level, which is why the pitch is the big number here and the lean is not.
const GRIP = 0.55;           // where up the shaft he holds it - his pivot
const THRUST_PITCH = 1.35;   // how far the shaft drops as it goes in
const THRUST_REACH = 0.42;   // and how far the whole shaft travels with it
const LEAN = 0.16;           // how far the man himself leans in behind it
const HIT_RECOIL = 0.24;     // and how far a blow puts him back off it
const HIT_TILT = 0.32;       // tipping him off his feet as it goes

// Going down. He tips away from whatever killed him - he was facing it - and
// then he is left there. The field keeps its dead for now.
const DEATH_SLIDE = 0.28;    // how far the fall carries him back off the line

// How many arrows a body of Archers can have in the air at once. They are drawn
// out of the unit like everything else - one more InstancedMesh, one more draw
// call, no new material - because a material first *drawn* mid-run is a stall,
// and `warmShaders` only knows about what a type builds.
//
// It is a ring rather than a pool with a free list: a shot still flying when its
// slot comes round again has been up longer than the whole volley cycle, which
// at these speeds cannot happen and would only cost one arrow vanishing early.
export const ARROWS = 10;

// ── Tuning that is about more than one unit ─────────────────────────────────
// What a *relationship* between two units is worth. It lives here rather than
// inside the entries because that is what these numbers are - a type below opts
// into a mechanic and names what it applies to, and how much it is worth is
// turned in one place. All of it is provisional.
export const COMBAT = {
  // What a hedge of spears is worth against a horse. A type opts in by naming
  // the trait - `damageVs: { mounted: COMBAT.antiMounted }` - and never by
  // naming Cavalry, so the second mounted thing this game gets is countered on
  // the day it is written and not on the day somebody remembers to come back
  // here.
  antiMounted: 1.6,

  // A charge is the one rule on this board that is about *how* a unit arrived
  // rather than where it is standing. Four numbers and no more: how far it has
  // to have ridden, what the arrival is worth, how long it is worth it for, and
  // how long it keeps looking for something to hit before the moment has passed.
  //
  // `window` is in seconds because a fight is a rate and not a turn - there is
  // no first blow to multiply, so the first second and a bit of the fight stands
  // in for one. `hold` is the other half of the same guarantee, and it is the
  // important half: a charge that never finds anything still has to end, or a
  // horseman who once rode two hexes is a horseman with a permanent bonus.
  charge: { steps: 2, bonus: 1.5, window: 1.2, hold: 4.0 },
};

export const UNIT_TYPES = {
  // ── The player's six ───────────────────────────────────────────────────────
  // Information, and almost nothing else.
  //
  // It sees further than anything on the board, walks further than anything but
  // a horse, and cannot fight - which is the trade stated three times over. The
  // fourth statement is the one that makes it a *scouting* unit rather than a
  // fast weak one: nothing leaves its post for a Scout. See `provokesReaction`.
  scout: {
    key: 'scout',
    name: 'Scout',
    // Three rings, and it is the only thing on the island that sees that far.
    // Two was the number when the Scout was the only unit and everything was
    // read against it; with six of them the eyes have to be *distinctly* the
    // eyes, or the reason to keep one alive is a stat nobody can feel.
    viewDistance: 3,
    // Furthest of the foot troops. Looking is what it is for, and a look costs a
    // move like everything else - so the reach of a look is this number.
    moveRange: 6,
    // How many people are in it - the roster and the crowd on the tile are the
    // same number. Three: a scouting party is a handful of men sent out ahead,
    // and a crowd of fifteen read as an army that happened to be looking.
    people: 3,
    // How they stand, and what they carry. Both are silhouette rather than
    // decoration: at this size a formation is read by its outline and by nothing
    // else, so the shape of the crowd and whether anything sticks up out of it
    // are the only two things that can tell one unit from another at a glance.
    formation: 'rings',
    jitter: 0.22,
    lamp: true,
    // It can defend itself and that is all. A Scout that fights is a Scout being
    // used wrong, and the number says so without a rule having to.
    attack: 0.4,
    // Nothing comes for him. An enemy that would leave its post because
    // Swordsmen came inside its threat ring does not move for this one - and
    // that is the whole of the rule. He is not invisible, he is not unfightable,
    // and walking him onto the tile next to something starts exactly the fight
    // it always did. What he does not do is *pull*.
    //
    // Without it the Scout has no job. The point of him is to look at a picket
    // and decide, and a picket that sets off the moment he is three hexes out
    // has already taken the decision. Which is why it is one field on the type
    // read by two lines of the reaction code, rather than a Scout-shaped hole in
    // the AI: see `provokes` below and `_relevant` in action_loop.js.
    provokesReaction: false,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.scout, colors, tuning),
  },

  // The one the army arrives around, and the one thing on the board that is
  // always there. A run begins with a King and nothing else.
  //
  // He is a *base*, and a base that walks. Every card is played onto a tile next
  // to him, so where he is standing is the whole of the force's reach - and
  // because he can be walked, that reach is a thing the player pushes forward
  // and has to defend rather than a corner of the map they return to. The rule
  // used to live on a camp (a place, so the far shore was tedious) and then on
  // the Scout (a viewpoint, so the one unit that had to survive was the one sent
  // ahead to look). On the King it is neither: the Scout goes back to seeing
  // things and the King goes where the army needs to be able to appear.
  //
  // He is worth nothing else yet. Losing him will one day lose the run, and that
  // is a rule to write when there is something on this island that could kill
  // him - today it would be a sentence nobody could test.
  king: {
    key: 'king',
    name: 'King',
    // Two rings. He is not here to see - he is here to be somewhere - but a King
    // who could only see the tiles he was touching left the opening camp with
    // nothing around it to make a first move towards.
    viewDistance: 2,
    // The least of anybody, and for the same reason he is worth the most: moving
    // him moves where the whole army is allowed to arrive.
    moveRange: 3,
    // A retinue rather than a company - nine guards and the man himself, which
    // reads as fewer people than a unit and is exactly the point.
    people: 9,
    formation: 'rings',
    jitter: 0.18,
    // The two things that make him readable at ten pixels, and both are
    // silhouette rather than colour: a figure half again as tall as anyone else
    // at the middle of the group, and a standard flying over the whole tile. The
    // standard is the taller of the two and is what actually finds him on a dark
    // board - a Scout is found by its lamp, the line by its steel, and the King
    // by the flag.
    leader: true,
    standard: true,
    // And a torch, which is the one place the palette rule gets bent on purpose.
    // The King replaced a camp, and a camp was the warm thing on this board -
    // so the warm pocket did not disappear when the camp did, it started
    // walking. It is wider and deeper-orange than the Scout's lamp and does the
    // same job for the opposite reason: the Scout carries a light because it is
    // out alone in the dark, and the King carries one because he is the place
    // everything comes back to.
    lamp: true,
    deployAnchor: true,
    // A retinue of nine that can hold for a moment. He is not a fighting unit
    // and the day he has to be one is the day the run was already lost.
    attack: 1.4,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.king, colors, tuning),
  },

  // The baseline, and deliberately the only one with nothing to explain.
  //
  // They walk into the fight and hold the front of it. No reach, no trait, no
  // charge, no reaction rule - and the temptation to give them something because
  // everybody else has something is the whole reason this comment exists. Five
  // units that each change the shape of a formation are only legible against one
  // that does not, and *being the dependable answer* is a role a player uses:
  // the question "where do the Swordsmen go" has a boring answer, which is what
  // makes it a question you can stop thinking about.
  //
  // They are also what the other five are balanced against. Every number in this
  // file is a comparison with this entry.
  swordsmen: {
    key: 'swordsmen',
    name: 'Swordsmen',
    viewDistance: 1,
    moveRange: 4,
    people: 15,
    // Ranks rather than rings, tighter jitter, and steel above the heads. A
    // hooded crowd and a helmeted block are nearly the same shape at 0.26 units
    // tall; the bristle of shafts standing above them is what actually reads
    // from the game's camera, and it reads instantly.
    formation: 'block',
    jitter: 0.12,
    spears: true,
    lamp: false,
    attack: 2.2,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.swordsmen, colors, tuning),
  },

  // The first troop that kills something it is not standing next to.
  //
  // `range` is the whole of it: Battle already resolves a fight as a fact about
  // where two units are standing, and this widens the distance at which that is
  // true from one hex to three. Nothing is aimed, nothing is spent, there is no
  // volley to order - walk them within three of something and they are killing
  // it, walk them out and they have stopped. That is the same shape as every
  // other rule on this board, which is why it cost ten lines rather than a
  // system.
  //
  // What it buys is the first *asymmetric* exchange the game has had. Everything
  // until now hurt whatever hurt it, so a fight was only ever a question of who
  // had more people; a body of Archers two hexes off takes nothing back, so the
  // question becomes whether the thing being shot can reach them before it dies.
  // The answer is usually yes - which is the point. They are thin, they hit for
  // half what the line does, and the only thing standing between them and
  // something that has noticed them is somebody else.
  //
  // Being shot is what makes an enemy notice: see `_relevant` in action_loop.js.
  // Without that the range simply outruns a picket's threat ring and a volley
  // from three hexes is free damage forever.
  archers: {
    key: 'archers',
    name: 'Archers',
    // Far enough to see most of what they can hit. Not all of it - shooting into
    // ground somebody else is watching is the rest of the force doing its job.
    viewDistance: 2,
    // As far as the line walks. They have to keep up with the men in front of
    // them, or the formation they exist to stand behind leaves them.
    moveRange: 4,
    people: 12,
    // Three hexes. Two was the other candidate and it is a worse number for one
    // reason: at two, every enemy that can be shot is already inside its own
    // threat ring, so the range buys a single free tick and then the fight is
    // the fight it always was. At three there is a hex of ground where they are
    // hurting something that has not started walking yet, and deciding whether
    // to stand in it is the whole of what this unit is for.
    range: 3,
    // Half of what the line hits for. They are not a better front, they are
    // damage that arrives from somewhere the front is not.
    attack: 1.1,
    // Ranks like the line, because they are a body of troops and not a party -
    // what tells them apart is above the heads rather than in the outline of the
    // crowd. A row of short curves standing upright reads as instantly *not* the
    // bristle of straight shafts leaning forward, at any zoom and in any light.
    formation: 'block',
    jitter: 0.20,
    bows: true,
    // Near enough upright. The stave is the silhouette and a stave shouldered at
    // a spear's angle is a spear again.
    spearTilt: 0.10,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.archers, colors, tuning),
  },

  // Reach, and the reason a formation has a back row.
  //
  // Two hexes, through exactly the same `range` field Archers use - this is not
  // shooting, and it does not have to be a different mechanic in order not to be
  // shooting. A body of men with twelve-foot spears standing behind another body
  // of men is fighting the same enemy over their shoulders, and Battle's rule -
  // a fight is a fact about where things are standing - already says so once the
  // number is 2.
  //
  // What it buys is *depth*. Every formation on this board was one rank deep
  // because the second rank could not do anything; a unit that reaches over the
  // one in front of it makes the order of a column matter, and that is the first
  // thing here that makes the shape of an army a decision rather than a
  // consequence of who walked where.
  //
  // The second half is the anti-mounted modifier, and it is the game's first
  // explicit counter. Note what it names: `mounted`, which is a trait on a type,
  // and not Cavalry, which is a type. Spearmen have never heard of Cavalry and
  // never should - see COMBAT.antiMounted. And they have to be worth fielding on
  // a board with no horses on it at all, which the reach alone does.
  spearmen: {
    key: 'spearmen',
    name: 'Spearmen',
    viewDistance: 1,
    // Slower than the line. A hedge is a thing you form and then hold, and
    // walking it about is not what it is for.
    moveRange: 3,
    people: 14,
    range: 2,
    // Just under the line, which is the right place for them: on their own they
    // are slightly worse Swordsmen, and behind Swordsmen they are damage that
    // costs nothing.
    attack: 1.9,
    damageVs: { mounted: COMBAT.antiMounted },
    formation: 'block',
    jitter: 0.10,
    spears: true,
    // Levelled rather than shouldered. The shafts are the read here - a wall of
    // points leaning out at the enemy is what two hexes of reach looks like.
    spearTilt: 0.45,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.spearmen, colors, tuning),
  },

  // A decision taken before the fight starts.
  //
  // Two hexes a move and twenty men. There is no defensive stance, no armour and
  // no blocking rule - the identity is entirely in those two numbers, and it is
  // the plainest thing in this file: they are very hard to shift and they can
  // hardly be repositioned, so the question they ask the player is *where do
  // these want to be standing*, once, rather than *what should these chase*.
  //
  // The temptation is to give them a defence stat. There is no defence anywhere
  // in this game - survivability is a headcount - and inventing one for a single
  // unit would put a rule in the game that exists for one unit. Twenty men is
  // the same idea and it is already drawn on the tile.
  heavy: {
    key: 'heavy',
    name: 'Heavy Infantry',
    viewDistance: 1,
    // The least of the fighting troops, and the whole of what they cost.
    moveRange: 2,
    // Half again the line. On this board that *is* their armour.
    people: 20,
    attack: 2.8,
    formation: 'block',
    // The tightest block on the board and the largest men in it, which is the
    // only read available without a new mesh: everything else the player owns is
    // looser or smaller, so a dense slab of slightly bigger figures is
    // unmistakably these.
    jitter: 0.06,
    spears: true,
    spearTilt: 0.18,
    stature: 1.12,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.heavy, colors, tuning),
  },

  // Distance, and what arriving is worth.
  //
  // Seven hexes a move is almost twice the line, and on a board where a move is
  // the thing you spend, that is the whole unit: they are the answer to
  // something the player noticed on the far side of the field. Everything else
  // about them is ordinary - one hex of reach, one ring of sight, they pull a
  // reaction like anybody else - because a unit that moves like this needs
  // nothing else to be worth a card.
  //
  // The charge is the one exception and it is deliberately one readable rule:
  // ride two hexes, reach something, and the arrival is worth half again for a
  // second. No facing, no lanes, no momentum, no trample. What it produces on
  // the board is the only thing being tested - the same unit standing beside an
  // enemy is a normal fight, and the same unit crossing open ground into one is
  // not - and the counterweight is that Spearmen were written to make riding at
  // them a mistake.
  cavalry: {
    key: 'cavalry',
    name: 'Cavalry',
    // Normal. They are fast, not far-seeing, and a mounted unit that also saw
    // three rings would have taken the Scout's job as well as its own.
    viewDistance: 1,
    moveRange: 7,
    // Fewer than the line, which is most of what the mobility costs: they arrive
    // anywhere and they do not survive being ground down once they are there.
    people: 10,
    // The hardest hit on the board per man, and it has to be: ten men at the
    // line's rate lose a straight fight to fifteen of anything, and a shock unit
    // that cannot win the fight it chose is a fast unit with nothing to do. At
    // 3.0 the arithmetic says the thing the unit is supposed to say - charging
    // Swordsmen it beats them by a hair, standing next to the same Swordsmen it
    // loses - so the charge is the whole difference between those two fights.
    attack: 3.0,
    // What Spearmen are good against. The word is the whole of the coupling.
    traits: ['mounted'],
    charge: COMBAT.charge,
    // A loose fast body rather than a formation, with the lances down. Rings and
    // the tallest figures on the board, because there is no horse to draw yet
    // and the read has to come out of the two knobs there are.
    formation: 'rings',
    jitter: 0.30,
    spears: true,
    spearTilt: 0.95,
    stature: 1.30,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.cavalry, colors, tuning),
  },

  // ── The other side ─────────────────────────────────────────────────────────
  // The first thing on this island that is not the player's, and the shape the
  // rest of them will be poured into: a type with `hostile` on it and a
  // behaviour, so a second kind that keeps its distance or runs for help is a
  // new entry here and a new branch in EnemyForce, not a new system.
  //
  // Raiders hold. They do not come for you, they do not follow you, and nothing
  // happens until something is standing on the tile next to them - at which
  // point Battle costs both sides people for as long as that stays true.
  //
  // They chased, for one version, and it was wrong for a reason worth keeping:
  // the whole job of a Scout is to see a thing before the thing is a problem, and
  // an enemy that starts walking the moment you are three hexes out takes that
  // away. Seeing them, deciding not to touch them, and going somewhere else has
  // to be a move the player can make. The machinery for the other kind is still
  // in EnemyForce under `stance: 'hunt'`, because the next sort along will want
  // it - this one is `'hold'`.
  //
  // They were called Spearmen until the player got a body of Spearmen of their
  // own, and one name for a friendly formation and a hostile mob is one name too
  // few. Nothing else about them changed: same men, same numbers, same post. Old
  // levels naming the old key are brought forward - see LEGACY_KEYS in
  // editor/level.js.
  raiders: {
    key: 'raiders',
    name: 'Raiders',
    hostile: true,
    viewDistance: 1,
    moveRange: 4,
    people: 12,
    attack: 1.8,
    stance: 'hold',
    // A mob rather than a formation, and that is the read. Everything the player
    // owns stands in rings or in ranks; this stands in a crowd, with its spears
    // going every way at once. It works at any zoom and in any light, which
    // colour alone does not.
    formation: 'rings',
    jitter: 0.55,
    spears: true,
    spearTilt: 0.7,
    build: (colors, tuning) => buildSquad(UNIT_TYPES.raiders, colors, tuning),
  },
};

// ── What the systems ask of a type ──────────────────────────────────────────
// Three questions, asked by Battle, ActionLoop and EnemyForce, and every one of
// them answered out of the table above. This is the seam that keeps the unit
// list out of the rules: none of those files names a unit, and none of them has
// to be opened the day a seventh one is written.

// Whether a unit carries a word. Traits are categories a *rule* may name -
// `mounted` is the only one so far - and they exist so a counter can be written
// against a kind of thing rather than against a type.
export function hasTrait(unit, trait) {
  return !!unit?.type?.traits?.includes(trait);
}

// Whether an enemy will leave its post because this one came near. True of
// everything except the Scout, and it is a property of the unit because the
// alternative is the same sentence written into every place an enemy looks at
// the roster.
export function provokes(unit) {
  return unit?.type?.provokesReaction !== false;
}

// How fast one unit takes people off another: its own rate, times whatever its
// type says about the *kind* of thing it is hitting. Everything true of the pair
// rather than of the attacker goes here; what is true of this moment - a charge -
// is Unit's, because Unit is the only thing that knows how the attacker arrived.
// See `Unit.strike`.
export function damageRate(attacker, target) {
  let rate = attacker.attack ?? 0;
  const vs = attacker.type?.damageVs;
  if (!vs) return rate;
  for (const [trait, mult] of Object.entries(vs)) {
    if (hasTrait(target, trait)) rate *= mult;
  }
  return rate;
}

const DEFAULT_COLORS = {
  cloak: 0x5a6b84,
  trim:  0x323c4c,
  skin:  0x8c8377,
  steel: 0x99a3b3,
  gold:  0xc9a55e,
  bow:   0xb08a52,
  arrow: 0xd8c9a8,
  banner: 0xb8894a,
  pole:  0x2f2721,
  lampGlow: 0xffb45c,
  select:   0x8fd8e8,
};

// A formation, and knowingly a placeholder: fifteen figures built out of the
// same low-segment flat-shaded primitives the props are, so they sit in the
// scene instead of on top of it.
//
// Two InstancedMeshes rather than thirty objects - a body pass and a head pass -
// so a unit costs two draw calls whatever it is made of, and so the day a
// formation has to lose people it is a `count`. A type that carries spears adds
// a third pass and nothing else.
//
// The Scout's lamp is not decoration. It is the one thing that makes a unit
// findable on a board lit at blue hour, and a scout carrying its own light is
// also the reason it is the thing that reveals the map. The line does not get
// one: two lamps walking the island would say the two units do the same job, and
// the thing that makes them findable instead is the steel above their heads.
//
// Colours come in per type as well as per scene - `colors[type.key]` wins over
// `colors` - so the mood file can say what a Scout looks like and what Swordsmen
// look like without a second palette being threaded through the constructor.
function buildSquad(type, colors = {}, tuning = {}) {
  const c = { ...DEFAULT_COLORS, ...colors, ...(colors[type.key] ?? {}) };
  const hexSize = tuning.hexSize ?? 1;
  const inradius = hexSize * Math.sqrt(3) / 2;
  const reach = inradius * FOOTPRINT;
  // A man's height, and the one knob a type has over how big its people are.
  // It exists because there is no horse mesh and no plate armour: Heavy Infantry
  // and Cavalry have to be told apart from the line by the two things a
  // formation is read by, which are its outline and how tall it stands.
  const h = SOLDIER * hexSize * (type.stature ?? 1);
  const n = type.people ?? 12;

  const group = new THREE.Group();
  const own = [];

  // Body and head are separate passes rather than one merged person, because at
  // this size the head is a third of what reads as a silhouette and it wants its
  // own colour.
  const bodyGeo = new THREE.CylinderGeometry(h * 0.13, h * 0.22, h * 0.66, 4);
  bodyGeo.translate(0, h * 0.33, 0);
  const headGeo = new THREE.IcosahedronGeometry(h * 0.15, 0);
  headGeo.translate(0, h * 0.80, 0);

  const bodyMat = new THREE.MeshLambertMaterial({ color: c.cloak, flatShading: true });
  const headMat = new THREE.MeshLambertMaterial({ color: c.trim, flatShading: true });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
  const heads  = new THREE.InstancedMesh(headGeo, headMat, n);
  group.add(bodies, heads);
  own.push(bodies, heads);

  // A spear is drawn as one tapered shaft with no head on it: a tip at this
  // scale is a third of a pixel, and what carries is the line and the fact that
  // it catches light the cloaks do not.
  //
  // A bow goes through the same pass - one InstancedMesh, one geometry swapped -
  // because what a unit carries is a shape and not a system. It is a curved
  // stave standing upright rather than a straight shaft leaning forward, and it
  // is drawn tall enough to break the silhouette above the heads, because that
  // is the only part of a formation that reads at the game's camera.
  let spears = null;
  if (type.spears || type.bows) {
    let geo;
    if (type.bows) {
      const arc = 2.3;
      geo = new THREE.TorusGeometry(h * 0.46, h * 0.022, 3, 7, arc);
      geo.rotateZ(-arc / 2);          // the arc symmetric about +X
      geo.rotateY(-Math.PI / 2);      // and swung round into the plane he faces
      // Held at the chest and standing well past the head. The first pass had it
      // ending about level with the helmets, which is exactly where a silhouette
      // stops working: the read is the *outline*, and a bow inside the crowd's
      // own outline is a crowd. It has to clear the heads the way a spear does.
      geo.translate(0, h * 0.62, 0);
    } else {
      geo = new THREE.CylinderGeometry(h * 0.008, h * 0.022, h * 1.7, 3);
      geo.translate(0, h * 0.85, 0);
    }
    // Wood rather than steel. Half the read is that the curves are dull where
    // the shafts opposite them are bright.
    const mat = new THREE.MeshLambertMaterial({
      color: type.bows ? c.bow : c.steel, flatShading: true,
    });
    spears = new THREE.InstancedMesh(geo, mat, n);
    group.add(spears);
    own.push(spears);
  }

  // And what leaves them. Pale rather than wooden: an arrow is a tenth of a hex
  // long crossing a board lit at blue hour, and the only thing that makes it
  // readable is being the lightest thing in the frame for the half second it is
  // up. Never culled - the mesh's bounds are the formation's and an arrow spends
  // its whole flight outside them.
  let arrows = null;
  if (type.bows) {
    // Longer and fatter than an arrow really is. At this scale a true one is
    // three pixels of nothing from the game's camera, and a shot nobody can see
    // is the same as no shot - so it is drawn at about the length of a man, which
    // is the smallest thing on this board that reliably reads.
    const arrowGeo = new THREE.CylinderGeometry(h * 0.018, h * 0.030, h * 0.95, 3);
    arrowGeo.rotateX(Math.PI / 2);        // laid along +Z, which is the way it flies
    arrows = new THREE.InstancedMesh(
      arrowGeo,
      new THREE.MeshLambertMaterial({ color: c.arrow, flatShading: true }),
      ARROWS,
    );
    arrows.frustumCulled = false;
    group.add(arrows);
    own.push(arrows);
  }

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const grip = new THREE.Vector3();
  // YXZ, so the pitch happens inside the yaw. On the default XYZ the yaw is
  // applied to a shaft that is still vertical, which it does nothing to, and a
  // thrust then goes the same way whichever way the man is facing.
  const tilt = new THREE.Euler(0, 0, 0, 'YXZ');

  // Each person's own yaw, size, spear tilt, constitution and place in the line,
  // kept so the melee can move them without rebuilding any of it. `x/z` is where
  // they stand in formation and `cx/cz` is where they actually are.
  //
  // The entries are swapped between instances as men fall - a `count` culls the
  // tail and cannot be told to skip a hole in the middle - so everything that
  // makes one man himself has to live in here rather than being derived from the
  // index he happens to be drawn at.
  const spots = [];
  // `yaw` is passed rather than read off the spot because a fight turns people:
  // in formation everyone points the way the unit does, and in a fight they
  // point at whoever is opposite them. The spear follows it - a shouldered shaft
  // that stayed pointed the old way is the tell that a man only slid sideways.
  // `fell` is how far over he is, 0 upright to 1 flat; `drop` lifts him off the
  // group's origin, which is what lets a body stay where it died while the unit
  // it belonged to marches somewhere else. See Unit._writeMelee.
  const write = (i, x, z, yaw = spots[i].yaw, lunge = 0, jolt = 0, fell = 0, drop = 0) => {
    const sp = spots[i];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);      // the way he is facing
    const tip = fell * fell * (3 - 2 * fell);
    // Forward behind his own thrust, back off the blow that answers it, and back
    // again off the one that finishes him. One number, because a man taking one
    // while giving one is doing both at once.
    const push = lunge * LEAN - jolt * HIT_RECOIL - tip * DEATH_SLIDE;
    pos.set(x + fx * push * h, drop, z + fz * push * h);
    // Tipped back off his feet, which is what a man pivots about when he is
    // knocked rather than when he leans - and all the way over when it is the
    // last one. Pure yaw when he is neither, so the common case still costs one
    // axis-angle.
    if (jolt > 0 || tip > 0) {
      tilt.set(-(jolt * HIT_TILT + tip * Math.PI * 0.5), yaw, 0);
      quat.setFromEuler(tilt);
    } else {
      quat.setFromAxisAngle(up, yaw);
    }
    scale.set(sp.s, sp.s, sp.s);
    m.compose(pos, quat, scale);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    if (spears) {
      // The shaft goes further in than the man does, and drops as it goes. It
      // comes back with him too - a spear that held its place while its owner
      // was knocked off it reads as a fencepost.
      const ahead = lunge * THRUST_REACH - jolt * HIT_RECOIL - tip * DEATH_SLIDE;
      pos.x = x + fx * ahead * h + Math.cos(yaw) * h * 0.16;
      pos.z = z + fz * ahead * h - Math.sin(yaw) * h * 0.16;
      tilt.set(sp.tilt.x + lunge * THRUST_PITCH - tip * Math.PI * 0.5, yaw, sp.tilt.z);
      quat.setFromEuler(tilt);
      // Pivot at his grip. The shaft's geometry stands on the ground, so
      // rotating it as composed swings it about his feet and lays it flat
      // instead of levelling it at chest height. The grip comes down with him as
      // he falls, or the shaft ends up lying in the air where his hand was.
      const gy = GRIP * h * sp.s * (1 - tip);
      grip.set(0, gy, 0).applyQuaternion(quat);
      pos.x -= grip.x;
      pos.y = gy - grip.y + drop;
      pos.z -= grip.z;
      m.compose(pos, quat, scale);
      spears.setMatrixAt(i, m);
    }
  };

  // One arrow in flight, in the mesh's own space. `vis` at zero is how a slot
  // with nothing in it is hidden - an InstancedMesh has no per-instance
  // visibility, and a `count` cannot skip a hole in the middle.
  const writeArrow = arrows ? (i, x, y, z, yaw, pitch, vis = 1) => {
    tilt.set(pitch, yaw, 0);
    quat.setFromEuler(tilt);
    pos.set(x, y, z);
    scale.set(vis, vis, vis);
    m.compose(pos, quat, scale);
    arrows.setMatrixAt(i, m);
  } : null;
  if (writeArrow) for (let i = 0; i < ARROWS; i++) writeArrow(i, 0, 0, 0, 0, 0, 0);

  const spread = type.jitter ?? 0.22;
  for (let i = 0; i < n; i++) {
    // A formation with a leader in it leaves the middle spot for him rather than
    // standing somebody where he goes, so the ranks are filled from one place
    // further along.
    const { x, z } = formationSpot(type.leader ? i + 1 : i, n, reach, type.formation);
    // A rank that is exactly a rank reads as a fence. Jitter is keyed to the
    // index so a squad looks the same every time it is drawn, and how much of it
    // a unit gets is the type's business: a scouting party stands about, and a
    // line of Swordsmen is supposed to look like it was told where to stand.
    const jx = (hashHex(i, 0, 11) - 0.5) * reach * spread;
    const jz = (hashHex(i, 0, 17) - 0.5) * reach * spread;
    // They face the way the unit does, but not to the degree - people in a
    // formation are pointed the same way, not machined into it.
    const yaw = (hashHex(i, 0, 23) - 0.5) * 0.7;
    // A little variation in height, because fifteen identical people is a
    // colonnade.
    const s = 0.88 + hashHex(i, 0, 29) * 0.26;

    // Spears are shouldered rather than planted, each at its own angle: fifteen
    // shafts at one angle is a comb.
    const t = type.spearTilt ?? 0.26;
    spots.push({
      x: x + jx, z: z + jz, cx: x + jx, cz: z + jz, yaw, cyaw: yaw, s,
      tilt: new THREE.Euler((hashHex(i, 0, 31) - 0.5) * t, yaw, (hashHex(i, 0, 37) - 0.5) * t),
      // Where he stands when the unit is fighting. It starts as the index and
      // stops being it the first time somebody falls - see Unit._closeUp.
      slot: i,
      // What he can take, and how much of a blow lands on him. Both are small
      // spreads either side of one, so a unit of fifteen is still worth fifteen
      // and the four men on the line do not run out at the same instant.
      hp: 0.62 + hashHex(i, 0, 41) * 0.76,
      bite: 0.70 + hashHex(i, 0, 43) * 0.60,
      // His own rhythm, in seconds and in seconds. A line of men all going in on
      // the same frame is a machine rather than a fight, and the periods are
      // deliberately not multiples of each other so they do not drift into step.
      beat: 0.82 + hashHex(i, 0, 47) * 0.71,
      phase: hashHex(i, 0, 53) * 2.4,
      // How much of wearing a blow he has left, and whether his own thrust has
      // already landed this beat. See Unit.struck.
      flinch: 0,
      landed: false,
      // How far over he is and where in the world he went down. See Unit._fall.
      down: 0,
      wx: 0, wy: 0, wz: 0, wyaw: 0,
    });
    write(i, x + jx, z + jz);
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (spears) spears.instanceMatrix.needsUpdate = true;

  // A figure this small is well under a shadow-map texel at this range, so
  // casting from it costs a draw call and buys a flicker - the same trade the
  // grass tufts already made.
  bodies.castShadow = heads.castShadow = false;
  if (spears) spears.castShadow = false;

  // The man himself: the same shapes as everyone else and half again as big,
  // because a leader drawn from a different kit reads as a different game. The
  // crown is three facets of gold and is not really visible at the game's
  // camera - it is there for the one moment somebody zooms in, and the height is
  // what does the work the rest of the time.
  if (type.leader) {
    const scale = 1.45;
    const kingBody = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.13, h * 0.24, h * 0.66, 5),
      new THREE.MeshLambertMaterial({ color: c.cloak, flatShading: true }),
    );
    kingBody.position.y = h * 0.33 * scale;
    kingBody.scale.setScalar(scale);

    const kingHead = new THREE.Mesh(
      new THREE.IcosahedronGeometry(h * 0.15, 0),
      new THREE.MeshLambertMaterial({ color: c.skin, flatShading: true }),
    );
    kingHead.position.y = h * 0.80 * scale;
    kingHead.scale.setScalar(scale);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.15, h * 0.13, h * 0.09, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: c.gold, flatShading: true, side: THREE.DoubleSide }),
    );
    crown.position.y = h * 0.93 * scale;
    group.add(kingBody, kingHead, crown);
    own.push(kingBody, kingHead, crown);
  }

  // The standard. Tall enough to clear every head on the tile and then some,
  // because it is the thing that has to be picked out from across a fogged
  // board - the King is the one unit the player must always be able to find, on
  // account of being the only place anything can be brought in.
  //
  // The cloth is furled in the geometry rather than animated. Everything else
  // that flies on this island waves on the shared wind, and a Unit has no wind
  // plumbing; a flat rectangle would read as dead where a curved one reads as
  // caught, and that is the whole of what the curve is buying.
  if (type.standard) {
    const H = h * 2.4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(h * 0.022, h * 0.032, H, 5),
      new THREE.MeshLambertMaterial({ color: c.pole, flatShading: true }),
    );
    pole.position.set(-reach * 0.12, H * 0.5, -reach * 0.24);
    group.add(pole);

    const cw = h * 0.62, ch = h * 0.78;
    const clothGeo = new THREE.PlaneGeometry(cw, ch, 6, 2);
    const pos = clothGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = pos.getX(i) + cw * 0.5;          // 0 at the pole, cw at the fly
      pos.setZ(i, Math.sin((bx / cw) * Math.PI * 1.4) * cw * 0.16 * (bx / cw));
    }
    clothGeo.translate(cw * 0.5 + h * 0.03, -ch * 0.5, 0);
    const cloth = new THREE.Mesh(
      clothGeo,
      new THREE.MeshLambertMaterial({ color: c.banner, flatShading: true, side: THREE.DoubleSide }),
    );
    cloth.position.set(pole.position.x, H * 0.96, pole.position.z);
    group.add(cloth);

    const finial = new THREE.Mesh(
      new THREE.OctahedronGeometry(h * 0.055, 0),
      new THREE.MeshLambertMaterial({ color: c.gold, flatShading: true }),
    );
    finial.position.set(pole.position.x, H * 1.03, pole.position.z);
    group.add(finial);

    own.push(pole, cloth, finial);
  }

  // The lamp-bearer stands at the front of the formation. An unlit bead plus a
  // real point light, for the reason the lanterns have one each: a glow with no
  // source is a mystery and a source with no glow is a decoration.
  let light = null;
  if (type.lamp) {
    const bead = new THREE.Mesh(
      new THREE.IcosahedronGeometry(h * 0.22, 0),
      new THREE.MeshBasicMaterial({ color: c.lampGlow }),
    );
    bead.position.set(reach * 0.18, h * 1.05, reach * 0.92);
    bead.userData.noShadow = true;
    group.add(bead);
    own.push(bead);

    // The light itself can be handed in, and that matters far more than it looks.
    // three bakes the number of point lights in the scene into every shader
    // program it compiles, so one new lamp arriving with a deployed unit
    // invalidates the program of every material on the board and recompiles the
    // lot - two seconds of freeze on the frame a card is played. A borrowed lamp
    // was already in the scene, so the count never moves. See the pool in
    // main.js; making one here is the fallback when there is none left to borrow.
    light = tuning.lampLight ?? new THREE.PointLight();
    light.color.set(tuning.lamp?.color ?? c.lampGlow);
    light.intensity = tuning.lamp?.intensity ?? 2.6;
    light.distance = tuning.lamp?.distance ?? 3.4;
    light.decay = tuning.lamp?.decay ?? 2;
    light.position.copy(bead.position);
    group.add(light);
  }

  // Selection is a ring on the ground rather than a tint on the people: they are
  // small and dark by design, and recolouring the one readable thing on the board
  // to say "chosen" costs the thing that made it readable. It is sized off the
  // *tile* rather than off the formation, because what is selected is the unit
  // standing on that hex.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(inradius * 0.86, inradius * 0.032, 4, 30),
    new THREE.MeshBasicMaterial({
      color: c.select, transparent: true, opacity: 0.85, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  ring.userData.noShadow = true;
  group.add(ring);
  own.push(ring);

  for (const o of own) o.userData.ownMaterial = true;

  group.userData.selectionRing = ring;
  group.userData.lamp = light;
  group.userData.people = n;
  // The passes whose `count` is the unit's strength. Losing people is lowering a
  // number here and nothing else - which is what the two-pass instanced build
  // was for in the first place, written down long before there was anything on
  // this island that could take somebody out of a formation.
  group.userData.ranks = spears ? [bodies, heads, spears] : [bodies, heads];
  group.userData.spots = spots;
  group.userData.write = write;
  group.userData.reach = reach;
  // Where an arrow leaves from, so Unit does not have to know what a soldier
  // height is to put one at the right place on a man's bow.
  group.userData.bowY = h * 0.62;
  group.userData.writeArrow = writeArrow;
  group.userData.flushArrows = arrows ? () => { arrows.instanceMatrix.needsUpdate = true; } : null;
  group.userData.flush = () => {
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (spears) spears.instanceMatrix.needsUpdate = true;
  };
  return group;
}

// Where the i-th person stands. Sizes are fractions of the tile's reach rather
// than absolute, so a layout survives a change of hex size, and both layouts
// keep their shape at any count - which is what lets a formation that has lost
// people still be the same formation.
function formationSpot(i, n, reach, layout = 'rings') {
  return layout === 'block' ? blockSpot(i, n, reach) : ringSpot(i, n, reach);
}

// Concentric rings, filled outward: a party standing around rather than drawn
// up. Local +Z is the way the unit faces, and a ring has no front, which is
// exactly right for the people whose job is looking at things.
function ringSpot(i, n, reach) {
  const RINGS = [
    { count: 1, radius: 0.00 },
    { count: 5, radius: 0.44 },
    { count: 9, radius: 0.85 },
  ];
  let seen = 0;
  for (const ring of RINGS) {
    if (i < seen + ring.count) {
      const k = i - seen;
      // Each ring is turned off the one inside it, so people do not line up
      // along radial spokes.
      const a = (Math.PI * 2 * k) / ring.count + seen * 0.7;
      const r = ring.radius * reach;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }
    seen += ring.count;
  }
  // More people than the rings hold: spiral outward rather than refuse.
  const k = i - seen;
  const a = k * 2.399;
  return { x: Math.cos(a) * reach, z: Math.sin(a) * reach };
}

// Ranks abreast, front rank toward +Z, which is the direction the unit walks and
// turns to face. A block has a front, and that is the point of it: Swordsmen
// are the thing you put between the Scout and whatever is out there, so which
// way they are pointed has to be visible before there is any combat to prove it.
function blockSpot(i, n, reach) {
  const cols = 5;
  const rows = Math.max(1, Math.ceil(n / cols));
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: (col - (cols - 1) / 2) * (reach * 2 / cols),
    // Rows run back from the front, and the whole block is centred on the tile.
    z: ((rows - 1) / 2 - row) * (reach * 1.6 / rows),
  };
}
