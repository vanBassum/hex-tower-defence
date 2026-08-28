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
// It holds no state about *levels* - `open(levels, openId)` paints what it is
// given and every button reports out. The one thing it does keep is which filter
// is showing, and that is not an exception: which of them you are looking at is a
// fact about looking, not about the levels, and the editor behind it has no use
// for the answer. A `<dialog>` rather than a div, for what the element brings
// with it: Escape closes, the page behind it stops taking clicks, and focus does
// not wander off into the canvas.
//
// -- Two kinds of level in one list -----------------------------------------
// Levels stored in this browser and levels that ship with the game, told apart by
// `entry.system` and shown together. One list with a filter rather than two
// sections, because they are the same kind of thing and the question asked of the
// list is almost always "where is the one I want" rather than "which sort is it".
// The filter is there for the times it is the other question.
//
// What separates them is what a card offers. A system level is a file in the
// repository and this browser has no business pretending to own it, so it cannot
// be opened, renamed or deleted - it has one button, and the copy is yours.
export class LevelLibrary {
  constructor({ root, onOpen, onNew, onRename, onDuplicate, onDelete, onExport,
                onImport, onFork }) {
    this._root = root;
    this._filter = 'all';
    this._levels = [];
    this._openId = null;
    root.innerHTML = `
      <div class="sheet">
        <header>
          <h2>Levels</h2>
          <span class="hint">Yours are stored in this browser; system levels ship with the game</span>
        </header>
        <div class="filters">
          <button type="button" data-filter="all" class="is-on">All</button>
          <button type="button" data-filter="mine">Mine</button>
          <button type="button" data-filter="system">System</button>
        </div>
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
      delete: onDelete, export: onExport, fork: onFork,
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

    this._filters = root.querySelector('.filters');
    this._filters.onclick = (e) => {
      const button = e.target.closest('button[data-filter]');
      if (!button) return;
      this._filter = button.dataset.filter;
      this.render(this._levels, this._openId);
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
    this._levels = levels;
    this._openId = openId;
    for (const b of this._filters.querySelectorAll('button')) {
      b.classList.toggle('is-on', b.dataset.filter === this._filter);
    }
    const shown = levels.filter(e => this._filter === 'all'
      || (this._filter === 'system') === !!e.system);
    this._cards.innerHTML = shown.length
      ? shown.map(entry => card(entry, entry.id === openId)).join('')
      : `<p class="empty">${EMPTY[this._filter]}</p>`;
  }

  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }

  // See the note on EditorPanel.clearError: a refused file must not still be
  // being complained about after the next thing works.
  clearError() {
    if (this._status.classList.contains('is-error')) this.setStatus(null);
  }
}

const EMPTY = {
  all:    'No levels yet.',
  mine:   'None of your own yet. Duplicate a system level to start from one.',
  system: 'No levels ship with the game.',
};

function card(entry, isOpen) {
  // A level that no longer parses gets a card saying so and one button. It has
  // to be visible to be deletable - a broken entry that cannot be shown is a
  // level nobody can get rid of.
  if (entry.error) {
    // A broken *stored* level has to be deletable, or it is a level nobody can
    // get rid of. A broken system level is a file somebody has to go and fix, so
    // it says so and offers nothing.
    return `<article class="card is-broken" data-id="${esc(entry.id)}">
      <div class="title">Unreadable ${entry.system ? 'system ' : ''}level</div>
      <div class="meta">${esc(entry.error)}</div>
      <div class="acts">${entry.system ? '' : '<button type="button" data-act="delete">Delete</button>'}</div>
    </article>`;
  }
  const level = entry.level;
  const tiles = level.tiles.length;
  // One button on a system level rather than five greyed out: what you can do
  // with it is take a copy, and a row of things you cannot do is a row of things
  // to read every time.
  const acts = entry.system
    ? `<button type="button" data-act="fork">Duplicate</button>`
    : `<button type="button" data-act="open"${isOpen ? ' disabled' : ''}>Open</button>
      <button type="button" data-act="rename">Rename</button>
      <button type="button" data-act="duplicate">Duplicate</button>
      <button type="button" data-act="export">Export</button>
      <button type="button" data-act="delete">Delete</button>`;
  const badge = entry.system ? '<span class="badge is-system">system</span>'
              : isOpen ? '<span class="badge">open</span>' : '';
  // The board itself, above the name. It is the part of the card that is
  // actually recognised - a level is remembered by its shape long before its
  // name - so it takes the top and the words label it.
  return `<article class="card${isOpen ? ' is-open' : ''}${entry.system ? ' is-system' : ''}" data-id="${esc(entry.id)}">
    <div class="shot">${thumbSvg(level)}</div>
    <div class="title">${esc(level.name)}${badge}</div>
    <div class="meta">${tiles} tile${tiles === 1 ? '' : 's'}${
      level.king ? ` · king at ${level.king.q}, ${level.king.r}` : ''}</div>
    <div class="acts">${acts}</div>
  </article>`;
}
