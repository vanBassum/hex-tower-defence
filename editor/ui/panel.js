import { esc } from './dom.js';

// What the editor has to say about itself, and the tools for shaping a board, in
// DOM. It holds no level state: it is handed the level and the selection and
// paints what it finds - the same arrangement the card bar has, so there is one
// account of what is being edited.
//
// Everything done *to a level* - saving, naming, files - is behind the one
// `Levels` button. What stands permanently on screen is only what is used while
// working: what the selected tile is, and the handful of controls that change it.
//
// ── The rose ────────────────────────────────────────────────────────────────
// Six buttons, laid out where the six neighbours actually are. A dropdown of
// direction names would be smaller and would make growing a board a reading
// exercise; a shape you can point at is the difference between sketching a
// passage and specifying one.
//
// The positions are the board's, seen from the default camera: +x is right and
// +z is toward the viewer, so [0,-1] is the top and [+1,0] is the lower right.
// They do not follow the camera round. They could, and it would be worse - a
// control that rearranges itself while you drag is a control you have to re-read
// every time, and the arrows would still be lying at every angle that is not a
// multiple of sixty degrees.
const ROSE = [
  { q:  0, r: -1, area: 'n',  label: 'N'  },
  { q: +1, r: -1, area: 'ne', label: 'NE' },
  { q: +1, r:  0, area: 'se', label: 'SE' },
  { q:  0, r: +1, area: 's',  label: 'S'  },
  { q: -1, r: +1, area: 'sw', label: 'SW' },
  { q: -1, r:  0, area: 'nw', label: 'NW' },
];

export class EditorPanel {
  constructor({ root, onLevels, onAdd, onDelete, onRaise }) {
    this._root = root;
    root.innerHTML = `
      <div class="rows"></div>
      <div class="tools">
        <div class="rose">
          ${ROSE.map(d => `<button type="button" class="dir" style="grid-area:${d.area}"
             data-q="${d.q}" data-r="${d.r}" title="Add a tile ${d.label}">+</button>`).join('')}
          <span class="hub"></span>
        </div>
        <div class="bar">
          <button type="button" data-act="lower" title="Lower the selected tile">Lower</button>
          <button type="button" data-act="raise" title="Raise the selected tile">Raise</button>
        </div>
        <div class="bar">
          <button type="button" data-act="delete" class="is-danger">Delete tile</button>
        </div>
      </div>
      <div class="bar">
        <button type="button" data-act="levels">Levels</button>
      </div>
      <div class="status"></div>
    `;
    this._rows  = root.querySelector('.rows');
    this._tools = root.querySelector('.tools');
    this._status = root.querySelector('.status');

    root.querySelector('.rose').onclick = (e) => {
      const b = e.target.closest('button.dir');
      if (b) onAdd(+b.dataset.q, +b.dataset.r);
    };
    const act = {
      raise:  () => onRaise(+1),
      lower:  () => onRaise(-1),
      delete: () => onDelete(),
      levels: () => onLevels(),
    };
    for (const [name, fn] of Object.entries(act)) {
      root.querySelector(`[data-act=${name}]`).onclick = fn;
    }
  }

  // `tile` is null for a hex the level has nothing on, and `hex` is null for
  // nothing selected at all. `canDelete` is the King's veto, which is the level's
  // business to know and not this file's.
  update({ level, hex, tile, canDelete = false, taken = [] }) {
    const rows = [
      ['Level', esc(level.name)],
      ['Tiles', String(level.tiles.length)],
      ['Selected', hex ? `${hex.q}, ${hex.r}` : '—'],
    ];
    if (hex) {
      rows.push(['Terrain', tile ? tile.terrain : 'off board']);
      if (tile) rows.push(['Height', String(tile.level ?? 0)]);
    }
    this._rows.innerHTML = rows
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join('');

    // With nothing selected there is nothing to shape, so the whole block goes
    // quiet rather than offering six buttons that would do nothing.
    const live = !!tile;
    this._tools.classList.toggle('is-idle', !live);
    // A direction whose hex already has a tile on it is spent - saying so on the
    // button is what makes the rose readable as "where the board can still grow"
    // rather than as six identical plusses.
    //
    // A button's `data-q`/`data-r` are a *direction*, and `taken` is a list of
    // hexes, so the selected hex has to be added back in to compare them. The
    // first version compared the two directly and looked right by coincidence -
    // an offset of 1,0 matching a tile that happened to be at 1,0.
    const takenSet = new Set(taken.map(t => `${t.q},${t.r}`));
    for (const b of this._tools.querySelectorAll('button.dir')) {
      const here = !!hex && takenSet.has(`${hex.q + +b.dataset.q},${hex.r + +b.dataset.r}`);
      b.disabled = !live || here;
      b.classList.toggle('is-there', live && here);
    }
    this._tools.querySelector('[data-act=raise]').disabled = !live;
    this._tools.querySelector('[data-act=lower]').disabled = !live;
    this._tools.querySelector('[data-act=delete]').disabled = !live || !canDelete;
  }

  // One line at the bottom: what the last thing that happened was, or why
  // something was refused. There is no "saved" among them - every edit is
  // already stored, and a message saying so after every one is noise.
  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }

  // A refusal must not outlive the thing it was refusing. Ordinary messages are
  // left alone - they are still true - but "the King is standing there" sitting
  // under the panel after two successful edits is the panel lying about the last
  // thing that happened.
  clearError() {
    if (this._status.classList.contains('is-error')) this.setStatus(null);
  }
}
