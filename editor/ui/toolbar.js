import { esc } from './dom.js';

// The tool palette, down the left edge, and the settings for whichever tool is
// active.
//
// It is the permanent home for editing, which is why it is a rail of icons and
// not a row of words: the list is going to grow - units, enemies, objects,
// pickups, objectives - and a vertical rail grows downward into space the
// viewport was not using, where a horizontal one would eat the board. The
// headings come from the tools' own `group`, so a new category costs nothing here.
//
// The settings block is generic on purpose. It renders whatever descriptors the
// active tool declares and reports changes back by key, so a tool gains a
// setting by naming one and this file does not learn about it. Today they are all
// small whole numbers and there is one control type; a second type is a second
// branch in `control()` when something needs one.
//
// It holds no state but which tool is active - the values live with the editor,
// because they outlive any one render of this panel.
export class ToolBar {
  constructor({ root, groups, onSelect, onSetting }) {
    this._root = root;
    this._groups = groups;
    this._onSetting = onSetting;

    root.innerHTML = `
      <div class="rail">
        ${groups.map(g => `
          <div class="group">
            <span class="glabel">${esc(g.name)}</span>
            ${g.tools.map(t => `
              <button type="button" class="tool" data-tool="${esc(t.id)}"
                      title="${esc(t.name)} - ${esc(t.hint)}">${t.icon}</button>`).join('')}
          </div>`).join('')}
      </div>
      <div class="settings"></div>
    `;
    this._rail = root.querySelector('.rail');
    this._settings = root.querySelector('.settings');

    this._rail.onclick = (e) => {
      const b = e.target.closest('button.tool');
      if (b) onSelect(b.dataset.tool);
    };

    // One listener for every stepper, now and later: a control says which key it
    // belongs to and which way it goes, and this turns that into one call.
    this._settings.onclick = (e) => {
      const b = e.target.closest('button[data-key]');
      if (b) this._onSetting(b.dataset.key, +b.dataset.by);
    };
  }

  // `tool` is the active tool and `values` its current settings.
  update(tool, values) {
    for (const b of this._rail.querySelectorAll('button.tool')) {
      b.classList.toggle('is-on', b.dataset.tool === tool.id);
    }
    this._settings.innerHTML = `
      <div class="sname">${esc(tool.name)}</div>
      ${(tool.settings ?? []).map(s => control(s, values[s.key])).join('')}
      <p class="shint">${esc(tool.hint)}</p>
    `;
  }
}

// A whole number with a minus and a plus. The buttons carry the key and the
// direction, which is what lets one delegated listener serve all of them.
function control(setting, value) {
  const at = value ?? setting.min;
  return `<div class="setting">
    <span class="slabel">${esc(setting.label)}</span>
    <span class="stepper">
      <button type="button" data-key="${esc(setting.key)}" data-by="-1"
              ${at <= setting.min ? 'disabled' : ''}>−</button>
      <b>${at}</b>
      <button type="button" data-key="${esc(setting.key)}" data-by="1"
              ${at >= setting.max ? 'disabled' : ''}>+</button>
    </span>
  </div>`;
}
