import { esc } from './dom.js';

// What the editor has to say about itself, in DOM. It holds no level state: it
// is handed the level and the selection and paints what it finds - the same
// arrangement the card bar has, so there is one account of what is being edited.
//
// One button, and it is the library. Save, Load, Import, Export and Delete all
// used to stand here, and between them they took up more of the panel than the
// readout did - five permanent controls for things that happen once an hour, in
// front of a person whose actual work is clicking tiles. Everything a level *is*
// stays: what it is called, how big it is, what is selected. Everything done *to*
// a level moved behind `Levels`.
export class EditorPanel {
  constructor({ root, onLevels }) {
    this._root = root;
    root.innerHTML = `
      <div class="rows"></div>
      <div class="bar">
        <button type="button" data-act="levels">Levels</button>
      </div>
      <div class="status"></div>
    `;
    this._rows   = root.querySelector('.rows');
    this._status = root.querySelector('.status');
    root.querySelector('[data-act=levels]').onclick = () => onLevels();
  }

  // `tile` is null for a hex the level has nothing on, and `hex` is null for
  // nothing selected at all.
  update({ level, hex, tile }) {
    const rows = [
      ['Level', esc(level.name)],
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

  // One line under the button: what the last thing that happened was, or what
  // was wrong with a file. There is no "saved" among them - every edit is
  // already stored, and a message saying so after every one is noise.
  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }
}
