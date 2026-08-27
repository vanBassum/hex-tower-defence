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
// setting by naming one and this file does not learn about it. There are two
// control types - a whole number, and a choice out of grouped options - and a
// third is a third branch in `control()`.
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

    // One listener for every control, now and later: a button says which setting
    // it belongs to and either which way to nudge it or what to set it to, and
    // this turns that into one call.
    this._settings.onclick = (e) => {
      const b = e.target.closest('button[data-key]');
      if (!b) return;
      this._onSetting(b.dataset.key,
        b.dataset.value !== undefined ? { value: b.dataset.value } : { by: +b.dataset.by });
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

function control(setting, value) {
  return setting.groups ? choice(setting, value) : stepper(setting, value);
}

// A choice out of grouped options: the group's name over a row of chips, and the
// selected one's own note underneath. The chips wrap, so a category that grows
// from two entries to six costs a line rather than a redesign.
function choice(setting, value) {
  const groups = setting.groups ?? [];
  const all = groups.flatMap(g => g.options);
  const at = all.find(o => o.id === value) ?? all[0];
  return `<div class="choice">
    ${groups.map(g => `
      <span class="glabel">${esc(g.name)}</span>
      <div class="chips">${g.options.map(o => `
        <button type="button" data-key="${esc(setting.key)}" data-value="${esc(o.id)}"
                class="${o.id === at?.id ? 'is-on' : ''}">${esc(o.name)}</button>`).join('')}
      </div>`).join('')}
    ${at?.note ? `<p class="snote">${esc(at.note)}</p>` : ''}
  </div>`;
}

// A whole number with a minus and a plus. The buttons carry the key and the
// direction, which is what lets one delegated listener serve all of them.
function stepper(setting, value) {
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
