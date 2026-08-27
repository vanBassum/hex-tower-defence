// What the editor has to say about itself, in DOM. It holds no state: it is
// handed the level and the selected hex and paints what it finds - the same
// arrangement the card bar has, so there is one account of what is selected.
//
// The two buttons are here rather than in main.js because this is the file that
// owns the panel's markup, and they report *out*: what a click does is decided
// where the level lives.
export class EditorPanel {
  constructor({ root, onExport, onImport }) {
    this._root = root;
    this._root.innerHTML = `
      <div class="rows"></div>
      <div class="acts">
        <button type="button" data-act="export">Export</button>
        <button type="button" data-act="import">Import</button>
      </div>
      <div class="status"></div>
      <input type="file" accept=".json,application/json" hidden>
    `;
    this._rows   = this._root.querySelector('.rows');
    this._status = this._root.querySelector('.status');
    this._file   = this._root.querySelector('input[type=file]');

    this._root.querySelector('[data-act=export]').onclick = () => onExport();
    this._root.querySelector('[data-act=import]').onclick = () => this._file.click();
    this._file.onchange = () => {
      const file = this._file.files?.[0];
      // Cleared every time, so choosing the same file twice in a row is two
      // imports rather than one - `change` does not fire on an identical value.
      this._file.value = '';
      if (file) onImport(file);
    };
  }

  // `tile` is null for a hex the level has nothing on, and `hex` is null for
  // nothing selected at all.
  update(level, hex, tile) {
    const rows = [
      ['Level', level.name],
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
  }

  // One line under the buttons: what the last import or export did, or what was
  // wrong with the file. A refused file has to say why somewhere the person is
  // already looking, and an alert box is a thing to dismiss rather than read.
  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }
}
