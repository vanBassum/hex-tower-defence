import { UNIT_TYPES } from './units.js';

// A card is a unit you are allowed to put on the board, once.
//
// That "once" is the whole of the rule and it is worth stating plainly: a card
// is spent when it is played, so a hand of three cards is three units and the
// second copy of a card is what lets you field two of something. The concept doc
// builds its entire progression on that arithmetic - finding another Footmen
// card is not an upgrade to the Footmen, it is a second body of Footmen - so the
// hand is a list of cards rather than a table of counts. Two entries that happen
// to name the same unit are two cards, and nothing has to special-case it.
//
// The table is thin because a card is currently a name, a unit type and a job.
// What it is *not* is a copy of the unit's stats: `unit` points into UNIT_TYPES
// and the card carries nothing the unit already knows, so there is exactly one
// place to change how far Footmen see.
//
// ── `role` says what a troop is for, never what its numbers are ─────────────
// "Sees one hex" is a stat wearing a sentence, and it is the wrong thing to put
// in front of somebody deciding where to put a unit down. A hand is read at a
// glance, in the second between finding a card and choosing a tile, and what has
// to survive that second is the *job*: this one goes ahead, that one stands in
// front.
//
// The numbers have their own place on the card now - see `cardStats` at the
// bottom of this file - because there are finally enough of them to compare.
// That is the condition this was always waiting on: one number is trivia, and
// three is a decision. They are a row of figures under the role rather than a
// sentence pretending to be one, and they are still the quieter half of the
// card, because what a troop is *for* is what you read first.
// How many cards a run may open with, unless a level says otherwise. It is
// stated here rather than wherever a hand is dealt because it is a rule about the
// hand and not about any one way of filling it - the player choosing six at the
// start of a run and the editor assembling six to test against are the same limit
// seen twice.
export const HAND_LIMIT = 6;

export const CARD_TYPES = {
  // The one card that is never played. The King is on the board before the first
  // frame and no hand ever holds him unspent - but every other unit the player
  // owns says how it is doing on the face of a card, and the one unit the run
  // cannot afford to lose was the one with nowhere to say it. So he is dealt
  // already spent and already bound to the man standing there, which costs a
  // flag and buys him the same readout as everybody else. See
  // `Deployment.addPlacedCard`.
  king: {
    key: 'king',
    unit: 'king',
    role: 'The army arrives beside him.',
  },

  // In the game, and in nobody's hand. The run used to be dealt one of these and
  // it is not any more: the King sees as far as a Scout does, so the card bought
  // a second pair of eyes that saw exactly what the first pair already did. The
  // type and the card both stay - a Scout that goes somewhere the King must not
  // is still the job this game will want - and the way back is one entry in
  // `DEBUG.startingHand` or one pickup that grants it.
  scout: {
    key: 'scout',
    unit: 'scout',
    role: 'Goes where nothing is known.',
  },

  footman: {
    key: 'footman',
    unit: 'footman',
    role: 'Holds the ground the King takes.',
  },

  // The job, not the number. "Three hexes" is a stat wearing a sentence, and
  // what has to survive the second between finding this card and choosing a tile
  // is that these are the ones who do not have to be there.
  archers: {
    key: 'archers',
    unit: 'archers',
    role: 'Kills what it never has to reach.',
  },
};

// Which cards a hand can be *dealt*. The King is never among them: he is on the
// board before the first frame and his card is bound to the man standing there.
export function dealable() {
  return Object.values(CARD_TYPES).filter(c => c.key !== 'king');
}

// The name shown on a card is the unit's own. A card called anything else would
// be a second name for the same thing, and the player has to match what is in
// their hand to what is standing on the board.
export function cardName(card) {
  return UNIT_TYPES[card.unit]?.name ?? card.key;
}

// The figures on the face of a card, read straight off the unit type. It lives
// here for the reason `cardName` does: a card points into UNIT_TYPES and carries
// no copy of anything the unit already knows, so there is one place `attack` is
// written down and a card cannot go stale against the thing it plays.
//
// Three, and only three, because they are the three that differ in a way the
// player can act on. `viewDistance` is left out - it is a real difference and it
// is not one you spend while choosing where to put somebody down - and there is
// no defence or armour here because there is none in the game: a stat row that
// listed one would be describing rules that do not exist.
//
// A unit with no `range` has one hex, which is what everything assumed before
// Archers. It is stated rather than left blank because a blank reads as "none".
export function cardStats(card) {
  const t = UNIT_TYPES[card.unit];
  if (!t) return [];
  return [
    { key: 'people', text: String(t.people ?? 1),
      label: 'People - how many are in it, and the only health it has' },
    // The one that has to be spelled to a decimal: 1.1 and 2.2 are the whole
    // difference between Archers and Footmen, and rounding it hides that.
    { key: 'attack', text: (t.attack ?? 0).toFixed(1),
      label: 'Attack - people it kills a second while it is fighting' },
    { key: 'range', text: String(t.range ?? 1),
      label: 'Range - how many hexes away it can hurt something' },
  ];
}
