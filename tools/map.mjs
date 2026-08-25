// Prints a level's board as text: `node tools/map.mjs`.
//
// Authoring a silhouette, a hill or a prop position by reading axial coordinates
// off a list does not work - the shape is the thing being judged, and it has to
// be visible while it is being edited. Columns are q, rows are 2r+q, which is
// exactly how flat-top hexes stagger, so this map has the board's real geometry.
import { LEVEL_1, buildLevel } from '../game/level.js';

const level = buildLevel(LEVEL_1);
const { grid } = level;

const key = (q, r) => `${q},${r}`;
const propAt = new Map(level.props.map(p => [key(p.q, p.r), p.type]));
const GLYPH = { tree: ' T ', rock: ' r ', bush: ' b ', grass: ' , ', lantern: ' i ' };

const cells = new Map();   // "row,q" -> glyph
let minRow = Infinity, maxRow = -Infinity, minQ = Infinity, maxQ = -Infinity;

// Sea first, so land glyphs overwrite it and the printed extent covers both.
for (const { q, r } of level.water) {
  const row = 2 * r + q;
  cells.set(`${row},${q}`, ' ~ ');
  if (row < minRow) minRow = row;
  if (row > maxRow) maxRow = row;
  if (q < minQ) minQ = q;
  if (q > maxQ) maxQ = q;
}

for (const { q, r } of grid.allHexes()) {
  const row = 2 * r + q;
  const lvl = level.levels.get(key(q, r)) ?? 0;

  let glyph;
  if (q === level.spawn.q && r === level.spawn.r)     glyph = '[S]';
  else if (q === level.goal.q && r === level.goal.r)  glyph = '[B]';
  else if (level.pathKeys.has(key(q, r)))             glyph = '###';
  else if (propAt.has(key(q, r)))                     glyph = GLYPH[propAt.get(key(q, r))] ?? ' * ';
  else if (level.blockedKeys.has(key(q, r)))          glyph = ' X ';
  else if (lvl >= 2)                                  glyph = ' ^ ';
  else if (lvl === 1)                                 glyph = ' n ';
  else                                                glyph = ' . ';

  cells.set(`${row},${q}`, glyph);
  if (row < minRow) minRow = row;
  if (row > maxRow) maxRow = row;
  if (q < minQ) minQ = q;
  if (q > maxQ) maxQ = q;
}

// `--shape` prints the same board as a paste-ready `shape` block for level.js,
// which is how an edited silhouette gets back into the level.
if (process.argv.includes('--shape')) {
  const R = LEVEL_1.radius;
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

console.log(`${LEVEL_1.name}: ${[...grid.allHexes()].length} hexes, ` +
            `${level.path.length} on the route\n`);
console.log('      ' + Array.from({ length: maxQ - minQ + 1 }, (_, i) =>
  String(minQ + i).padStart(3)).join(''));
for (let row = minRow; row <= maxRow; row++) {
  let line = '';
  for (let q = minQ; q <= maxQ; q++) line += cells.get(`${row},${q}`) ?? '   ';
  console.log(String(row).padStart(4) + '  ' + line.replace(/\s+$/, ''));
}
console.log('')
console.log('  [S] spawn  [B] base  ### route (not drawn in game)  ~ sea  X crag (solid)  ' +
            'n hill  ^ high hill  T tree  b bush  r rock  i lantern  . grass');
console.log('  columns are q; rows are 2r+q, so r = (row - q) / 2');
