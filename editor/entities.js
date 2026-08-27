import { UNIT_TYPES } from '../game/units.js';
import { moveKing, placeUnit, whyNot } from './level.js';

// What the Place tool can put on a board.
//
// The list is built out of `UNIT_TYPES` rather than written here, which is the
// whole point: there is no editor-side idea of what a Scout is, so a unit added
// to the game appears in the palette with its own name and its own side and
// nothing here has to be told. Which side that is comes from `hostile` on the
// type - see the invariant in CLAUDE.md - so the editor has no side field to
// disagree with the game about.
//
// An entry is a `kind` and a `put`. `kind` is what occupies a hex, and it is the
// word `entityAt` in level.js answers with; `put` does it. Card pickups,
// objectives, props and spawn points are entries here with their own `kind` and
// their own two-line `put`, and the tool, the palette and the preview all work
// on them unchanged - which is the reason placing is one tool and not one tool
// per category.

// The King is not a unit in the level file - he is one hex on his own, so that
// "exactly one player start" is the shape of the data rather than a rule. That
// makes him the one entry with a hand-written body.
const KING = {
  id: 'king',
  kind: 'king',
  name: 'King',
  group: 'Player start',
  // Placing him again moves him. There is nowhere for a second one to go.
  note: 'Moves the existing King',
  put: (level, hex) => moveKing(level, hex.q, hex.r),
};

const UNIT = (key) => {
  const type = UNIT_TYPES[key];
  return {
    id: key,
    kind: 'unit',
    name: type.name,
    group: type.hostile ? 'Enemy' : 'Friendly',
    // The only two numbers the game reads off a type today, so the only two
    // worth showing. There is deliberately no per-placement override of either:
    // `Unit` takes its strength from its type, and a count in the editor that
    // nothing reads would be a stat invented here.
    note: `${type.people} men · sees ${type.viewDistance}`,
    put: (level, hex) => placeUnit(level, key, hex.q, hex.r),
  };
};

// The King, and the other side. Deliberately not the player's own units: what the
// player brings is a hand they choose - six cards, played beside the King wherever
// he happens to be standing - and a level that stood Footmen on the board would be
// answering that for them. A level says where the player *starts* and what is
// waiting for them; the army is theirs.
//
// The editor tests against a deck instead, which is the same arrangement a run
// has. See the level's `deck` and the Level panel that fills it.
export const PLACEABLES = [
  KING,
  ...Object.keys(UNIT_TYPES)
    .filter(k => k !== 'king' && UNIT_TYPES[k].hostile)
    .map(UNIT),
];

export const PLACEABLE_BY_ID = Object.fromEntries(PLACEABLES.map(p => [p.id, p]));

// The palette's headings, in the order the entries first ask for them - so a new
// category is a new `group` string on an entry and not a second list.
export function placeableGroups() {
  const groups = [];
  for (const entry of PLACEABLES) {
    let group = groups.find(g => g.name === entry.group);
    if (!group) groups.push(group = { name: entry.group, options: [] });
    group.options.push(entry);
  }
  return groups;
}

// Why this entry cannot go on this hex, or null. It is the level's rule, asked
// through the entry's `kind`, so the answer is the same one erase and import get.
export function refusal(level, entry, hex) {
  return hex ? whyNot(level, entry.kind, hex.q, hex.r) : 'nothing under the cursor';
}
