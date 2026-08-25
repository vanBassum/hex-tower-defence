import { Component } from '../../engine/gameobject.js';

const PANEL_CSS = [
  'position:fixed', 'top:12px', 'left:12px', 'padding:10px 14px',
  'font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace',
  'color:#eee', 'background:rgba(0,0,0,.5)', 'border-radius:6px',
  'pointer-events:none', 'white-space:pre',
].join(';');

// Sits over the canvas, so unlike the readout it has to take clicks.
const BUTTON_CSS = [
  'position:fixed', 'bottom:22px', 'left:50%', 'transform:translateX(-50%)',
  'padding:11px 22px', 'font:600 14px/1 system-ui,sans-serif', 'color:#fff',
  'background:#2f6f3f', 'border:1px solid rgba(255,255,255,.25)', 'border-radius:7px',
  'cursor:pointer', 'pointer-events:auto', 'box-shadow:0 4px 14px rgba(0,0,0,.45)',
].join(';');

const BANNER_CSS = [
  'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
  'justify-content:center', 'flex-direction:column', 'gap:6px',
  'font:600 42px/1.2 system-ui,sans-serif', 'color:#fff',
  'text-shadow:0 3px 18px rgba(0,0,0,.85)', 'pointer-events:none',
].join(';');

const HOVER_HINT = {
  'ok':        'click to build',
  'on-path':   'the enemy walks here',   // the route is no longer drawn, so say what it is
  'blocked':   'solid rock',
  'occupied':  'hex already taken',
  'too-poor':  'not enough currency',
  'off-board': '',
};

// Corner readout, the send-wave button and an end-of-level banner. Scaffolding,
// not UI design — it exists so the economy, the end conditions and the one thing
// the player has to press are legible while playing.
export class Hud extends Component {
  constructor({ state, spawner, placer }) {
    super();
    this._state = state;
    this._spawner = spawner;
    this._placer = placer;
  }

  start() {
    this._panel = document.createElement('div');
    this._panel.style.cssText = PANEL_CSS;
    document.body.appendChild(this._panel);

    this._button = document.createElement('button');
    this._button.style.cssText = BUTTON_CSS;
    this._button.addEventListener('click', () => this._spawner.sendNextWave());
    document.body.appendChild(this._button);

    this._banner = document.createElement('div');
    this._banner.style.cssText = BANNER_CSS;
    this._banner.style.display = 'none';
    document.body.appendChild(this._banner);
  }

  update() {
    const s = this._state;
    const w = this._spawner;
    const type = this._placer.type;

    let wave;
    if (w.complete)      wave = 'all waves cleared';
    else if (w.allSent)  wave = `${w.totalWaves} / ${w.totalWaves}  all sent`;
    else if (w.spawning) wave = `${w.waveNumber} / ${w.totalWaves}  spawning`;
    else                 wave = `${w.waveNumber} / ${w.totalWaves}  waiting for you`;

    this._updateButton();

    const hint = this._placer.hoverStatus ? HOVER_HINT[this._placer.hoverStatus] ?? '' : '';

    this._panel.textContent = [
      `Lives      ${s.lives} / ${s.maxLives}`,
      `Currency   ${s.currency}`,
      `Wave       ${wave}`,
      `Alive      ${w.enemiesAlive}    Killed ${s.killed}    Leaked ${s.leaked}`,
      '',
      `${type.name}  ${type.cost}c   ${hint}`,
    ].join('\n');

    if (s.playing) { this._banner.style.display = 'none'; return; }
    this._banner.style.display = 'flex';
    this._banner.innerHTML = s.status === 'won'
      ? `Level cleared<div style="font:400 16px system-ui">${s.lives} / ${s.maxLives} lives remaining &middot; ${s.killed} killed</div>`
      : `Base destroyed<div style="font:400 16px system-ui">wave ${w.waveNumber} of ${w.totalWaves} &middot; ${s.leaked} leaked</div>`;
  }

  // The button is the level's clock, so it says what it will do rather than what
  // it is called: sending a wave while the last one is still walking is a
  // decision, and the label has to make that visible.
  _updateButton() {
    const w = this._spawner;
    const b = this._button;
    if (!this._state.playing || w.allSent) { b.style.display = 'none'; return; }

    b.style.display = 'block';
    b.disabled = !w.canSend;
    b.style.opacity = w.canSend ? '1' : '0.45';
    b.style.cursor = w.canSend ? 'pointer' : 'default';
    b.style.background = w.enemiesAlive > 0 ? '#8a5a22' : '#2f6f3f';
    b.textContent = w.canSend
      ? (w.enemiesAlive > 0
          ? `Send wave ${w.waveNumber} of ${w.totalWaves}  (${w.enemiesAlive} still alive)`
          : `Send wave ${w.waveNumber} of ${w.totalWaves}`)
      : `Wave ${w.waveNumber} spawning`;
  }

  destroy() {
    this._panel?.remove();
    this._button?.remove();
    this._banner?.remove();
  }
}
