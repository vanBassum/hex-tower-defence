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
// The table is thin because a card is currently a name and a unit type. What it
// is *not* is a copy of the unit's stats: `unit` points into UNIT_TYPES and the
// card carries nothing the unit already knows, so there is exactly one place to
// change how far Footmen see.
export const CARD_TYPES = {
  // The one the run begins holding. It is a card like any other and always was -
  // the concept doc has the player owning a Scout before they own anything else,
  // and the version where it started already standing on the board was a special
  // case dressed up as a starting position. Played from the hand it costs one
  // click and buys the opening its own beat: an empty marked camp in the fog, and
  // one thing you are allowed to do.
  scout: {
    key: 'scout',
    unit: 'scout',
    note: 'Sees two hexes. Carries the lamp.',
  },

  footman: {
    key: 'footman',
    unit: 'footman',
    // What the player is told, and it is deliberately about the *unit* rather
    // than about the card: a hand is read at a glance while deciding where to
    // put something, so the useful sentence is what the thing does on the board.
    note: 'Fifteen spears. Sees one hex.',
  },
};

// The name shown on a card is the unit's own. A card called anything else would
// be a second name for the same thing, and the player has to match what is in
// their hand to what is standing on the board.
export function cardName(card) {
  return UNIT_TYPES[card.unit]?.name ?? card.key;
}
