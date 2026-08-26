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
// front. Numbers are for comparing two of something you already understand, and
// they will get their own place on the card when there are enough of them to
// compare - a row of figures, not prose pretending to be a description.
export const CARD_TYPES = {
  // The one the run begins holding. It is a card like any other and always was -
  // the concept doc has the player owning a Scout before they own anything else,
  // and a Scout that started already standing somewhere was a special case
  // dressed up as a starting position. Played from the hand it costs one click
  // and buys the opening its own beat: a King alone in the fog, one card, and one
  // thing you are allowed to do. It works now only because the King is on the
  // board first - a card has to be played beside something.
  scout: {
    key: 'scout',
    unit: 'scout',
    role: 'Goes where nothing is known.',
  },

  footman: {
    key: 'footman',
    unit: 'footman',
    role: 'Holds the ground the Scout finds.',
  },
};

// The name shown on a card is the unit's own. A card called anything else would
// be a second name for the same thing, and the player has to match what is in
// their hand to what is standing on the board.
export function cardName(card) {
  return UNIT_TYPES[card.unit]?.name ?? card.key;
}
