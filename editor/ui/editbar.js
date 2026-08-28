import { esc } from './dom.js';

// The left panel, and the shape of it is the model: HOW, then WHAT, then WHICH,
// then the numbers.
//
//   TOOL      five interactions - select, place, tile, brush, erase
//   CONTENT   seven categories - what the interaction acts on
//   ASSETS    which of that category, and several at once
//   SETTINGS  whatever the tool and the category both understand
//
// Reading downward is reading a sentence: brush / trees / these three kinds /
// this radius. The old rail was one list where every entry was a tool *and* a
// category at once, so "scatter" and "stand one" were different buttons and every
// new kind of thing needed a new pair of them. Nothing here knows what a tree is.
//
// ── Assets are built to become thumbnails ────────────────────────────────────
// Every asset button already has a `.thumb` element inside it, empty today and
// carrying the name underneath. Rendering a model into that box later is filling
// in something that is already there - not a change to how selection works, how
// multi-select works, or how the palette is laid out. That is the only reason the
// markup is heavier than the text it currently shows.
//
// It holds no state. Which tool is active, which assets are ticked and what the
// settings say all live with the editor, because they outlive any one render.
export class EditBar {
  constructor({ root, onTool, onContent, onAsset, onSetting }) {
    this._root = root;
    root.innerHTML = `
      <div class="bar">
        <div class="block">
          <span class="blabel">Tool</span>
          <div class="tools"></div>
        </div>
        <div class="block">
          <span class="blabel">Content</span>
          <div class="contents"></div>
        </div>
        <div class="block">
          <span class="blabel">Assets <b class="count"></b></span>
          <div class="assets"></div>
        </div>
        <div class="block settings"></div>
        <p class="hint"></p>
      </div>
    `;
    this._tools = root.querySelector('.tools');
    this._contents = root.querySelector('.contents');
    this._assets = root.querySelector('.assets');
    this._count = root.querySelector('.count');
    this._settings = root.querySelector('.settings');
    this._hint = root.querySelector('.hint');

    this._tools.onclick = (e) => {
      const b = e.target.closest('button[data-tool]');
      if (b && !b.disabled) onTool(b.dataset.tool);
    };
    this._contents.onclick = (e) => {
      const b = e.target.closest('button[data-content]');
      if (b) onContent(b.dataset.content);
    };
    // Click replaces the selection, ctrl or shift adds to it - the convention from
    // every list anybody has ever used. Choosing three things has to be three
    // clicks and not a mode, because it is the thing this palette is for.
    this._assets.onclick = (e) => {
      const b = e.target.closest('button[data-asset]');
      if (b) onAsset(b.dataset.asset, e.ctrlKey || e.metaKey || e.shiftKey);
    };
    // One listener for every control, now and later: a button says which setting
    // it belongs to and which way to nudge it, and this turns that into one call.
    this._settings.onclick = (e) => {
      const b = e.target.closest('button[data-key]');
      if (b) onSetting(b.dataset.key, +b.dataset.by);
    };
  }

  // `tools` is [{tool, enabled}], `assets` the current category's palette,
  // `selected` a Set of asset ids, `settings` the descriptors to draw and `values`
  // what they currently say.
  update({ tools, tool, contents, content, assets, selected, thumbs, settings, values, hint, note }) {
    this._tools.innerHTML = tools.map(({ tool: t, enabled }) => `
      <button type="button" data-tool="${esc(t.id)}" ${enabled ? '' : 'disabled'}
              class="tool ${t.id === tool.id ? 'is-on' : ''}"
              title="${esc(t.name)}${enabled ? ` - ${esc(t.hint)}` : ' - not for this content'}"
        >${t.icon}</button>`).join('');

    // `short` where a name does not fit two-to-a-row, and the full name is still
    // the tooltip - a truncated label is a label that stopped being one.
    this._contents.innerHTML = contents.map(c => `
      <button type="button" data-content="${esc(c.id)}" title="${esc(c.name)}"
              class="cat ${c.id === content.id ? 'is-on' : ''}"
        >${esc(c.short ?? c.name)}</button>`).join('');

    // A category with one thing in it still draws a palette. It reads as the same
    // control everywhere, and the day it has three entries nothing has changed.
    //
    // The picture is the control now and the name is the caption: two trees are
    // told apart by looking, which is what a shape is for, and the name is what
    // confirms it. An asset with no picture keeps its name and gets a marked box
    // rather than an empty one - a palette missing a render should look like a
    // render that is missing, not like a gap in the list.
    this._assets.innerHTML = assets.map(a => {
      const url = thumbs?.get(a.id);
      return `
      <button type="button" data-asset="${esc(a.id)}"
              class="asset ${selected.has(a.id) ? 'is-on' : ''}"
              title="${esc(a.name)}${a.note ? ` - ${esc(a.note)}` : ''}">
        <span class="thumb${url ? '' : ' is-missing'}"
          >${url ? `<img src="${url}" alt="" draggable="false">` : '?'}</span>
        <span class="aname">${esc(a.name)}</span>
      </button>`;
    }).join('');
    this._count.textContent = assets.length
      ? `${selected.size}/${assets.length}`
      : '';

    // Steppers when the tool has numbers, and otherwise whatever the tool has to
    // say instead - which for Select is what it is holding. The block is the same
    // block either way: it is where the panel talks about the current state.
    this._settings.innerHTML = settings.map(s => stepper(s, values[s.key])).join('')
      || `<p class="none">${esc(note ?? 'No settings')}</p>`;
    this._hint.textContent = hint;
  }
}

// A whole number with a minus and a plus. The buttons carry the key and the
// direction, which is what lets one delegated listener serve all of them.
function stepper(setting, value) {
  const at = value ?? setting.min;
  // `step` is how much a press is worth, which a brush radius and a light's
  // brightness do not agree about: one is a count of rings and the other is a
  // number that has to travel from 2 to 40 without forty presses.
  const by = setting.step ?? 1;
  return `<div class="setting">
    <span class="slabel">${esc(setting.label)}</span>
    <span class="stepper">
      <button type="button" data-key="${esc(setting.key)}" data-by="${-by}"
              ${at <= setting.min ? 'disabled' : ''}>−</button>
      <b>${at}</b>
      <button type="button" data-key="${esc(setting.key)}" data-by="${by}"
              ${at >= setting.max ? 'disabled' : ''}>+</button>
    </span>
  </div>`;
}
