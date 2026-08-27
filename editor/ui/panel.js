// What the editor has to say about itself, in DOM. It holds no level state: it
// is handed the level and the selection and paints what it finds - the same
// arrangement the card bar has, so there is one account of what is being edited.
//
// The buttons are here rather than in main.js because this is the file that owns
// the panel's markup, and they report *out*: what a click does is decided where
// the level lives.
//
// The order of the bars is the split that matters. New and Save act on the level
// that is open; the list and Load/Delete act on whichever saved level is pointed
// at; and the last pair is how a level crosses the boundary of the browser at
// all, to be committed to git or handed to somebody else. Import and export were
// the only way in and out when they were written and are now the secondary way,
// which is what the dimmer row says.
export class EditorPanel {
  constructor({ root, onRename, onNew, onSave, onLoad, onDelete, onExport, onImport }) {
    this._root = root;
    root.innerHTML = `
      <label class="name">
        <span class="k">Level</span>
        <input class="v" type="text" spellcheck="false" placeholder="Untitled">
      </label>
      <div class="rows"></div>
      <div class="bar">
        <button type="button" data-act="new">New</button>
        <button type="button" data-act="save">Save</button>
      </div>
      <div class="bar">
        <select class="saved"></select>
      </div>
      <div class="bar">
        <button type="button" data-act="load">Load</button>
        <button type="button" data-act="delete">Delete</button>
      </div>
      <div class="bar is-secondary">
        <button type="button" data-act="export">Export</button>
        <button type="button" data-act="import">Import</button>
      </div>
      <div class="status"></div>
      <input type="file" accept=".json,application/json" hidden>
    `;
    this._name   = root.querySelector('.name input');
    this._rows   = root.querySelector('.rows');
    this._select = root.querySelector('select.saved');
    this._status = root.querySelector('.status');
    this._file   = root.querySelector('input[type=file]');

    // Which saved level Load and Delete act on. It is the panel's own state, not
    // the level's: the list is a place to point at something other than what is
    // open, which is the whole reason there is a Load button and not just a
    // dropdown that loads on change.
    this._pick = null;

    this._name.oninput = () => onRename(this._name.value);
    this._select.onchange = () => { this._pick = this._select.value || null; };

    const act = {
      load:   () => this._pick && onLoad(this._pick),
      delete: () => this._pick && onDelete(this._pick),
      new:    () => onNew(),
      save:   () => onSave(),
      export: () => onExport(),
      import: () => this._file.click(),
    };
    for (const [name, fn] of Object.entries(act)) {
      root.querySelector(`[data-act=${name}]`).onclick = fn;
    }

    this._file.onchange = () => {
      const file = this._file.files?.[0];
      // Cleared every time, so choosing the same file twice in a row is two
      // imports rather than one - `change` does not fire on an identical value.
      this._file.value = '';
      if (file) onImport(file);
    };
  }

  // `tile` is null for a hex the level has nothing on, `hex` is null for nothing
  // selected at all, `saved` is the names in local storage and `storage` is what
  // the current level's standing among them is.
  update({ level, hex, tile, saved = [], storage = '' }) {
    // Never written while it is being typed into - assigning value moves the
    // caret to the end, and this is called on every keystroke.
    if (this._name.value !== level.name) this._name.value = level.name;

    const rows = [
      ['Storage', storage],
      ['Tiles', String(level.tiles.length)],
      ['Selected', hex ? `${hex.q}, ${hex.r}` : '—'],
    ];
    if (hex) {
      rows.push(['Terrain', tile ? tile.terrain : 'off board']);
      if (tile) rows.push(['Elevation', String(tile.level ?? 0)]);
    }
    this._rows.innerHTML = rows
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join('');

    // The list, and a dot on the entry that is open - so the dropdown says which
    // of these levels is the one on screen rather than only which one the
    // buttons below it would act on.
    if (!this._pick || !saved.includes(this._pick)) {
      this._pick = saved.includes(level.name) ? level.name : (saved[0] ?? null);
    }
    this._select.innerHTML = saved.length
      ? saved.map(n => `<option value="${esc(n)}">${esc(n)}${n === level.name ? ' •' : ''}</option>`).join('')
      : '<option value="">nothing saved yet</option>';
    this._select.value = this._pick ?? '';
    this._select.disabled = !saved.length;
    for (const a of ['load', 'delete']) {
      this._root.querySelector(`[data-act=${a}]`).disabled = !saved.length;
    }
  }

  // One line at the bottom: what the last action did, or what was wrong with the
  // file. A refused level has to say why somewhere the person is already
  // looking, and an alert box is a thing to dismiss rather than read.
  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }
}

// Level names come from a text field and go into markup, so they get escaped.
function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
