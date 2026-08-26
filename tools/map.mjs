// Prints a map's board as text: `node tools/map.mjs`.
//
// Authoring a silhouette, a hill or a prop position by reading axial coordinates
// off a list does not work - the shape is the thing being judged, and it has to
// be visible while it is being edited. Columns are q, rows are 2r+q, which is
// exactly how flat-top hexes stagger, so this map has the board's real geometry.
import { MAP_1, buildMap } from '../game/maps.js';

const map = buildMap(MAP_1);
const { grid } = map;

const key = (q, r) => `${q},${r}`;
const propAt = new Map(map.props.map(p => [key(p.q, p.r), p.type]));
// Pickups print too, and they have to: where the first one sits is a level
// design decision about what the player finds and when, which is exactly the
// kind of thing this tool exists so nobody has to judge from a coordinate.
const pickupAt = new Set(map.pickups.map(p => key(p.q, p.r)));
const GLYPH = { tree: ' T ', rock: ' r ', bush: ' b ', grass: ' , ', lantern: ' i ' };

const cells = new Map();   // "row,q" -> glyph
let minRow = Infinity, maxRow = -Infinity, minQ = Infinity, maxQ = -Infinity;

const mark = (row, q, glyph) => {
  cells.set(`${row},${q}`, glyph);
  if (row < minRow) minRow = row;
  if (row > maxRow) maxRow = row;
  if (q < minQ) minQ = q;
  if (q > maxQ) maxQ = q;
};

// Sea first, so land glyphs overwrite it and the printed extent covers both.
for (const { q, r } of map.water) mark(2 * r + q, q, ' ~ ');

for (const { q, r } of grid.allHexes()) {
  const lvl = map.levels.get(key(q, r)) ?? 0;

  let glyph;
  if (pickupAt.has(key(q, r)))             glyph = ' P ';
  else if (propAt.has(key(q, r)))          glyph = GLYPH[propAt.get(key(q, r))] ?? ' * ';
  else if (map.blockedKeys.has(key(q, r))) glyph = ' X ';
  else if (lvl >= 2)                       glyph = ' ^ ';
  else if (lvl === 1)                      glyph = ' n ';
  else                                     glyph = ' . ';

  mark(2 * r + q, q, glyph);
}

// `--shape` prints the same board as a paste-ready `shape` block for maps.js,
// which is how an edited silhouette gets back into the map.
if (process.argv.includes('--shape')) {
  const R = MAP_1.radius;
  console.log('  shape: [');
  for (let row = -2 * R; row <= 2 * R; row++) {
    let line = '';
    for (let q = -R; q <= R; q++) {
      const glyph = cells.get(`${row},${q}`);
      line += glyph === ' ~ ' ? ' ~ ' : glyph ? ' # ' : '   ';
    }
    console.log(`    '${line.replace(/\s+$/, '')}',`);
  }
  console.log('  ],');
  process.exit(0);
}

console.log(`${MAP_1.name}: ${[...grid.allHexes()].length} land hexes, ` +
            `${map.water.length} sea, ${map.blocked.length} crags\n`);
console.log('      ' + Array.from({ length: maxQ - minQ + 1 }, (_, i) =>
  String(minQ + i).padStart(3)).join(''));
for (let row = minRow; row <= maxRow; row++) {
  let line = '';
  for (let q = minQ; q <= maxQ; q++) line += cells.get(`${row},${q}`) ?? '   ';
  console.log(String(row).padStart(4) + '  ' + line.replace(/\s+$/, ''));
}
console.log('');
console.log('  ~ sea  X crag (solid)  n hill  ^ high hill  ' +
            'T tree  b bush  r rock  i lantern  P pickup  . grass');
console.log('  columns are q; rows are 2r+q, so r = (row - q) / 2');
