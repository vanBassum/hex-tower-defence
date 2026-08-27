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
};

// The name shown on a card is the unit's own. A card called anything else would
// be a second name for the same thing, and the player has to match what is in
// their hand to what is standing on the board.
export function cardName(card) {
  return UNIT_TYPES[card.unit]?.name ?? card.key;
}
