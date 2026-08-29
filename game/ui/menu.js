// The screen the game opens on: which board.
//
// It is DOM over the top of the scene, for the reason the card bar is - a menu is
// a menu, and drawing one in the world means building text layout and hit testing
// against a camera. Behind it the renderer is already running on an empty sky,
// which is what it should look like before there is an island.
//
// It holds no state. `show(entries)` paints what it is handed and reports the
// pick; whether a board may be started is `locked` on the entry, decided by
// whatever eventually keeps score - see the note in game/levels.js. A locked card
// draws itself and refuses the click, so the day there is progression this file
// does not change.
//
// ── The card does not show the board ────────────────────────────────────────
// It did, for a while: the editor library's plan view, the same `thumbSvg` the
// library draws, on the reasoning that "which board is this" is one question with
// one good answer. It is two questions, and that was the mistake. In the editor
// you are looking at a level you are building and the plan *is* the level; on the
// way into a run, the same picture is the coastline, the crags, the way through
// and every picket standing on it - handed over before the first step. Finding
// that out is what there is to do here, and a list that gives it away is a list
// that plays the level for you.
//
// So the picture is the dark instead: a lattice of hexes barely off the
// background, identical on every card, because it is not a picture of any board.
// It is deliberately not nothing - a card with a hole where the picture goes
// reads as broken, and this says the honest thing, which is that there is
// something out there and you have not seen it. The only fact about size left is
// the tile count in the corner, which is how long a board is rather than what is
// in it.
export class Menu {
  constructor({ root, onPick = null } = {}) {
    this._root = root;
    this._onPick = onPick;
    this._entries = [];
    root.innerHTML = `
      <div class="menu-sheet">
        <header>
          <h1>Hex Tactics</h1>
          <p>Walk an island in the dark. Every soldier is one you found.</p>
        </header>
        <div class="menu-cards"></div>
        <footer><a class="menu-editor" href="editor/">Level editor</a></footer>
      </div>`;
    this._cards = root.querySelector('.menu-cards');
    this._cards.onclick = (e) => {
      const card = e.target.closest('button[data-id]');
      if (!card || card.disabled) return;
      const entry = this._entries.find(l => l.id === card.dataset.id);
      if (entry) this._onPick?.(entry);
    };
  }

  show(entries) {
    this._entries = entries;
    this._cards.innerHTML = entries.map(card).join('');
    this._root.classList.remove('is-away');
  }

  hide() { this._root.classList.add('is-away'); }
}

function card(entry) {
  // A board that would not load says so and cannot be started. It is still shown,
  // because a level that vanishes from a list is a level nobody can tell you is
  // broken.
  if (entry.error) {
    return `<button type="button" class="menu-card is-broken" data-id="${entry.id}" disabled>
      <span class="menu-title">${text(entry.name)}</span>
      <span class="menu-blurb">${text(entry.error)}</span>
    </button>`;
  }
  const tiles = entry.preview?.tiles?.length ?? 0;
  return `<button type="button" class="menu-card${entry.locked ? ' is-locked' : ''}"
      data-id="${entry.id}"${entry.locked ? ' disabled' : ''}>
    <span class="menu-shot">${UNKNOWN}</span>
    <span class="menu-title">${text(entry.name)}</span>
    <span class="menu-blurb">${text(entry.blurb)}</span>
    <span class="menu-meta">${entry.locked ? 'Locked' : `${tiles} tiles`}</span>
  </button>`;
}

// Ground nobody has walked, drawn once and reused on every card.
//
// It is drawn *lighter* than the panel rather than in `MOOD.hidden`, which is the
// colour a hidden hex actually collapses to on the board: that colour is
// near-black and on a near-black card there is nothing to see. What has to come
// across here is the tiling, so it is the grid's own pale blue at an opacity that
// leaves it at the edge of visible - the board's dark read through a card rather
// than a swatch of it.
//
// The variation is a fixed hash rather than a random one, and the reason is that
// this string is built once at import and shared: two cards that differed would
// be two boards described, which is the thing this is here instead of.
const UNKNOWN = (() => {
  const w = 260, h = 108, r = 11;
  const dx = r * 1.5, dy = r * Math.sqrt(3);
  const hex = (cx, cy) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const cells = [];
  for (let col = 0, i = 0; col * dx < w + dx; col++) {
    for (let row = 0; row * dy < h + dy; row++, i++) {
      const cx = col * dx, cy = row * dy + (col % 2 ? dy / 2 : 0);
      // A deterministic wobble, so the field is not a uniform grey grid. Two
      // primes and a fract: the same trick hex_noise plays, without needing it.
      const n = ((i * 2654435761) % 1000) / 1000;
      cells.push(`<polygon points="${hex(cx, cy)}" opacity="${(0.03 + n * 0.05).toFixed(3)}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
    `<g fill="#8fd8e8" stroke="none">${cells.join('')}</g></svg>`;
})();

// The names and blurbs are ours rather than anybody's, but they end up as markup
// and a level file is a thing a person can hand you.
function text(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
