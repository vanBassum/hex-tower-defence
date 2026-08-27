import { esc } from './dom.js';
import { thumbSvg } from './thumb.js';

// The library: every level in this browser, as cards, and everything that can be
// done to one.
//
// It is a modal because none of this is editing. Naming, duplicating, throwing
// away and moving JSON in and out are things done *between* pieces of work, once
// or twice a session, and a permanent row of buttons for them was standing in
// front of the board the rest of the time. Behind one button they cost nothing
// until they are wanted, and there is room to say what each level is.
//
// It holds no state of its own - `open(levels, openId)` paints what it is given
// and every button reports out. A `<dialog>` rather than a div, for what the
// element brings with it: Escape closes, the page behind it stops taking clicks,
// and focus does not wander off into the canvas.
export class LevelLibrary {
  constructor({ root, onOpen, onNew, onRename, onDuplicate, onDelete, onExport, onImport }) {
    this._root = root;
    root.innerHTML = `
      <div class="sheet">
        <header>
          <h2>Levels</h2>
          <span class="hint">Everything here is stored in this browser</span>
        </header>
        <div class="cards"></div>
        <footer>
          <button type="button" data-act="new">New level</button>
          <button type="button" data-act="import">Import JSON…</button>
          <button type="button" data-act="export">Export current</button>
          <button type="button" data-act="close" class="is-plain">Close</button>
        </footer>
        <div class="status"></div>
        <input type="file" accept=".json,application/json" hidden>
      </div>
    `;
    this._cards  = root.querySelector('.cards');
    this._status = root.querySelector('.status');
    this._file   = root.querySelector('input[type=file]');

    // What a card's buttons do. They are read off `data-act` at click time
    // rather than bound per card, because the cards are rebuilt on every change
    // and re-binding six handlers apiece is six handlers to leak.
    this._perCard = {
      open: onOpen, rename: onRename, duplicate: onDuplicate,
      delete: onDelete, export: onExport,
    };
    this._cards.onclick = (e) => {
      const button = e.target.closest('button[data-act]');
      if (!button) return;
      this._perCard[button.dataset.act]?.(button.closest('[data-id]').dataset.id);
    };

    const footer = {
      new: onNew,
      import: () => this._file.click(),
      export: onExport,           // no id - the level that is open
      close: () => this.close(),
    };
    for (const [act, fn] of Object.entries(footer)) {
      root.querySelector(`footer [data-act=${act}]`).onclick = () => fn();
    }

    this._file.onchange = () => {
      const file = this._file.files?.[0];
      // Cleared every time, so choosing the same file twice in a row is two
      // imports rather than one - `change` does not fire on an identical value.
      this._file.value = '';
      if (file) onImport(file);
    };

    // Clicking the backdrop closes, which is the gesture everybody tries. The
    // sheet is a child, so a click that lands inside it never reaches here.
    root.onclick = (e) => { if (e.target === root) this.close(); };
  }

  get isOpen() { return this._root.open; }

  // `levels` is the summaries out of storage; `openId` is which of them is on
  // screen behind this.
  open(levels, openId) {
    this.render(levels, openId);
    if (!this._root.open) this._root.showModal();
  }

  close() {
    this._root.close();
    this.setStatus(null);
  }

  render(levels, openId) {
    this._cards.innerHTML = levels.length
      ? levels.map(entry => card(entry, entry.id === openId)).join('')
      : `<p class="empty">No levels in this browser yet.</p>`;
  }

  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }
}

function card(entry, isOpen) {
  // A level that no longer parses gets a card saying so and one button. It has
  // to be visible to be deletable - a broken entry that cannot be shown is a
  // level nobody can get rid of.
  if (entry.error) {
    return `<article class="card is-broken" data-id="${esc(entry.id)}">
      <div class="title">Unreadable level</div>
      <div class="meta">${esc(entry.error)}</div>
      <div class="acts"><button type="button" data-act="delete">Delete</button></div>
    </article>`;
  }
  const level = entry.level;
  const tiles = level.tiles.length;
  // The board itself, above the name. It is the part of the card that is
  // actually recognised - a level is remembered by its shape long before its
  // name - so it takes the top and the words label it.
  return `<article class="card${isOpen ? ' is-open' : ''}" data-id="${esc(entry.id)}">
    <div class="shot">${thumbSvg(level)}</div>
    <div class="title">${esc(level.name)}${isOpen ? '<span class="badge">open</span>' : ''}</div>
    <div class="meta">${tiles} tile${tiles === 1 ? '' : 's'}${
      level.king ? ` · king at ${level.king.q}, ${level.king.r}` : ''}</div>
    <div class="acts">
      <button type="button" data-act="open"${isOpen ? ' disabled' : ''}>Open</button>
      <button type="button" data-act="rename">Rename</button>
      <button type="button" data-act="duplicate">Duplicate</button>
      <button type="button" data-act="export">Export</button>
      <button type="button" data-act="delete">Delete</button>
    </div>
  </article>`;
}
