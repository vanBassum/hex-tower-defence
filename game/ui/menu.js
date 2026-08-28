import { thumbSvg } from '../../editor/ui/thumb.js';

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
// The card is the editor library's plan view - `thumbSvg`, the same function, not
// a copy - because "which board is this" is the same question in both places and
// it has one good answer. A three-quarter render would be the game's own picture
// and exactly wrong for it: it foreshortens half the board and needs a camera.
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
    <span class="menu-shot">${thumbSvg(entry.preview, { width: 260, height: 120 })}</span>
    <span class="menu-title">${text(entry.name)}</span>
    <span class="menu-blurb">${text(entry.blurb)}</span>
    <span class="menu-meta">${entry.locked ? 'Locked' : `${tiles} tiles`}</span>
  </button>`;
}

// The names and blurbs are ours rather than anybody's, but they end up as markup
// and a level file is a thing a person can hand you.
function text(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
