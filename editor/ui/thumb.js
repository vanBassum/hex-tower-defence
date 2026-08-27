import { HexGrid } from '../../engine/hex/hex_grid.js';
import { MOOD } from '../../game/mood.js';

// A level's shape, at the size of a card.
//
// Deliberately not the renderer. A card needs to answer "which board is this" in
// the quarter of a second somebody spends scanning a library, and the thing that
// answers it is the outline - where the coast is, where the high ground is, where
// the King stands. Three-quarter view is what makes a board look like a place and
// is exactly wrong for that: it foreshortens the far half, hides tiles behind
// cliffs, and needs a camera aimed at something. A plan view has no camera and no
// hidden tiles.
//
// It is also the cheap answer, and that matters at a dozen cards: an SVG string
// costs a string concatenation, where a dozen WebGL contexts - or one context
// rendered a dozen times into canvases - costs the frame the library opens on.
//
// The colours are the world's own, out of MOOD, because a preview in its own
// palette is a preview of a different game. What it does not have is any of the
// lighting - a plan view lit by a low sun would be half in shadow - so terrain
// tone is all the tone there is, and elevation is said by lifting it.

// The geometry only. A bare grid is the cheapest way to reuse the one definition
// of where a flat-top hex sits and what its corners are - nothing here asks it a
// question about the board, so it needs no shape and no occupancy.
const GEO = new HexGrid({ size: 10 });

const PAD = 3;              // breathing room inside the box, in the same units
const LIFT = 0.16;          // how much a level of elevation brightens a tile

export function thumbSvg(level, { width = 228, height = 96 } = {}) {
  const tiles = level.tiles ?? [];
  if (!tiles.length) return '';

  // One pass to place every tile and find the box they all fit in. Water is
  // drawn with the land rather than behind it: on this board a sea tile is a
  // tile, and leaving it out would draw a bay as a hole.
  const shapes = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tiles) {
    const corners = GEO.hexCorners(t.q, t.r);
    const points = corners.map(c => `${round(c.x)},${round(c.z)}`).join(' ');
    shapes.push(`<polygon points="${points}" fill="${tileColor(t)}"/>`);
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.z < minZ) minZ = c.z;
      if (c.z > maxZ) maxZ = c.z;
    }
  }

  // The King, as a mark rather than a figure. At this size a shape would be four
  // pixels of nothing; what reads is a warm dot in a cool board, which is what he
  // is on the real one too.
  const king = level.king && `<circle cx="${round(GEO.hexToWorld(level.king.q, level.king.r).x)}" ` +
    `cy="${round(GEO.hexToWorld(level.king.q, level.king.r).z)}" r="4.4" ` +
    `fill="${css(MOOD.kingFire.color)}" stroke="${css(0x0b1220)}" stroke-width="1.6"/>`;

  // `preserveAspectRatio` does the fitting, so a wide board and a tall one both
  // arrive centred at whatever size the card is - and the box is the level's own
  // extent, so a small level fills the card exactly as a large one does. Scale is
  // not information here; shape is.
  const w = maxX - minX + PAD * 2;
  const h = maxZ - minZ + PAD * 2;
  return `<svg class="thumb" viewBox="${round(minX - PAD)} ${round(minZ - PAD)} ${round(w)} ${round(h)}" ` +
    `width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    // A hairline between tiles in the board's own grid colour, drawn as a stroke
    // on the whole group rather than per tile: at this size adjacent edges are a
    // pixel apart, and one shared stroke is what keeps the hexes legible instead
    // of merging the land into a blob.
    `<g stroke="${css(MOOD.gridColor)}" stroke-width="0.7">${shapes.join('')}</g>${king || ''}</svg>`;
}

function tileColor(tile) {
  if (tile.terrain === 'water') return css(MOOD.water.depthColors[0]);
  if (tile.terrain === 'crag')  return css(MOOD.ground.rockColor);
  // Grass, brightened by height. The real ground picks its tone from noise in
  // patches; a thumbnail that did the same would be dithering four pixels, so
  // this takes the base tone and says the one thing the plan view cannot show
  // otherwise - that this tile is higher than that one.
  return css(lighten(MOOD.ground.grassColors[1], (tile.level ?? 0) * LIFT));
}

// Toward white by `amount`. In sRGB, like every other colour offset in this
// project - see the note in CLAUDE.md about how much subtler a linear one looks.
function lighten(hex, amount) {
  if (amount <= 0) return hex;
  const k = Math.min(amount, 1);
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return (Math.round(r + (255 - r) * k) << 16) |
         (Math.round(g + (255 - g) * k) << 8) |
          Math.round(b + (255 - b) * k);
}

function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// Two decimals is well past what a hundred-pixel picture can show, and it keeps
// the markup readable when something looks wrong in the inspector.
function round(n) {
  return Math.round(n * 100) / 100;
}
