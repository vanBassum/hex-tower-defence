import { Component } from '../../engine/gameobject.js';

const PANEL_CSS = [
  'position:fixed', 'top:12px', 'left:12px', 'padding:10px 14px',
  'font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace',
  'color:#eee', 'background:rgba(0,0,0,.5)', 'border-radius:6px',
  'pointer-events:none', 'white-space:pre',
].join(';');

const BANNER_CSS = [
  'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
  'justify-content:center', 'flex-direction:column', 'gap:6px',
  'font:600 42px/1.2 system-ui,sans-serif', 'color:#fff',
  'text-shadow:0 3px 18px rgba(0,0,0,.85)', 'pointer-events:none',
].join(';');

const HOVER_HINT = {
  'ok':        'click to build',
  'on-path':   'cannot build on the path',
  'occupied':  'hex already taken',
  'too-poor':  'not enough currency',
  'off-board': '',
};

// Corner readout plus an end-of-level banner. Scaffolding, not UI design — it
// exists so the economy and the end conditions are legible while playing.
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
    if (w.complete)                wave = 'all waves cleared';
    else if (w.spawning)           wave = `${w.waveNumber} / ${w.totalWaves}  spawning`;
    else if (w.timeToNextWave > 0) wave = `${w.waveNumber} / ${w.totalWaves}  in ${w.timeToNextWave.toFixed(1)}s`;
    else                           wave = `${w.waveNumber} / ${w.totalWaves}  incoming`;

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

  destroy() {
    this._panel?.remove();
    this._banner?.remove();
  }
}
