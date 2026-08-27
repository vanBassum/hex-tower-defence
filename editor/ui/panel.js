import { esc } from './dom.js';

// What the editor has to say about itself, in DOM. It holds no level state: it is
// handed the level and whatever the mouse is over and paints what it finds.
//
// It used to be where editing happened - a rose of six directions, Raise, Lower,
// Delete, all acting on one selected hex. Those are gone, and not because they
// did not work: shaping a board one hex at a time through buttons in a corner is
// filling in a form about a map. The tools do that in the viewport now, so what
// is left here is a readout and the way to the library.
//
// The readout follows the *cursor* rather than a selection, for the same reason:
// while painting, the interesting hex is the one under the brush.
export class EditorPanel {
  constructor({ root, onLevels, onPlay, onFog }) {
    this._root = root;
    root.innerHTML = `
      <div class="rows"></div>
      <div class="bar">
        <button type="button" data-act="play" class="is-primary">Play <kbd>P</kbd></button>
      </div>
      <label class="check">
        <input type="checkbox" data-act="fog">
        <span>Fog of war</span>
      </label>
      <div class="bar">
        <button type="button" data-act="levels">Levels</button>
      </div>
      <div class="status"></div>
    `;
    this._rows   = root.querySelector('.rows');
    this._status = root.querySelector('.status');
    root.querySelector('[data-act=levels]').onclick = () => onLevels();
    root.querySelector('[data-act=play]').onclick = () => onPlay();
    this._fog = root.querySelector('[data-act=fog]');
    this._fog.onchange = () => onFog(this._fog.checked);
  }

  // `hex` is what the cursor is over, or null, and `tile` is the level's tile
  // there - null for a hex the board does not reach.
  update({ level, hex, tile, fog = true }) {
    if (this._fog.checked !== fog) this._fog.checked = fog;
    const rows = [
      ['Level', esc(level.name)],
      ['Tiles', String(level.tiles.length)],
      ['Hex', hex ? `${hex.q}, ${hex.r}` : '—'],
      ['Height', tile ? String(tile.level ?? 0) : hex ? 'no ground' : '—'],
    ];
    this._rows.innerHTML = rows
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join('');
  }

  // One line under the button: what the last thing that happened was, or why
  // something was refused. There is no "saved" among them - every edit is
  // already stored, and a message saying so after every one is noise.
  setStatus(text, isError = false) {
    this._status.textContent = text ?? '';
    this._status.classList.toggle('is-error', !!isError);
  }

  // A refusal must not outlive the thing it was refusing. Ordinary messages are
  // left alone - they are still true - but a complaint sitting under the panel
  // after two successful edits is the panel lying about the last thing that
  // happened.
  clearError() {
    if (this._status.classList.contains('is-error')) this.setStatus(null);
  }
}
