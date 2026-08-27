// What the editor has to say about itself, in DOM. It holds no state: it is
// handed the level and the selected hex and paints what it finds - the same
// arrangement the card bar has, so there is one account of what is selected.
export class EditorPanel {
  constructor({ root }) {
    this._root = root;
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
    this._root.innerHTML = rows
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join('');
  }
}
