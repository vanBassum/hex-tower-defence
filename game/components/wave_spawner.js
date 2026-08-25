import { Component } from '../../engine/gameobject.js';
import { spawnEnemy } from '../enemies.js';

// Runs a level's wave table: a lead-in delay, then `count` enemies at
// `interval`. The next wave's delay starts as soon as the previous wave has
// finished spawning, not when the map is clear, so falling behind means facing
// two waves at once.
export class WaveSpawner extends Component {
  constructor({ waves, worldPath, onLeak = null, onKill = null, onBonus = null, onComplete = null } = {}) {
    super();
    this.waves      = waves ?? [];
    this.waveIndex  = 0;
    this.complete   = false;
    this._worldPath = worldPath;
    this._onLeak    = onLeak;
    this._onKill    = onKill;
    this._onBonus   = onBonus;
    this._onComplete = onComplete;
    this._phase     = 'delay';   // 'delay' | 'spawning' | 'done'
    this._timer     = 0;
    this._spawned   = 0;
  }

  // A wave's `enemy` is either a type key or a repeating pattern of them, so a
  // wave can be described by its ordering and not just its head count.
  _enemyAt(wave, index) {
    return Array.isArray(wave.enemy) ? wave.enemy[index % wave.enemy.length] : wave.enemy;
  }

  get totalWaves()   { return this.waves.length; }
  // 1-based, and clamped so it still reads as the final wave once spawning ends.
  get waveNumber()   { return Math.min(this.waveIndex + 1, this.totalWaves); }
  get spawning()     { return this._phase === 'spawning'; }
  get enemiesAlive() { return this.gameObject.game.enemies?.length ?? 0; }
  get timeToNextWave() { return this._phase === 'delay' ? Math.max(0, this._timer) : 0; }

  start() {
    if (!this.waves.length) { this._phase = 'done'; return; }
    this._timer = this.waves[0].delay ?? 0;
  }

  update(dt) {
    if (this._phase === 'done') {
      if (!this.complete && this.enemiesAlive === 0) {
        this.complete = true;
        this._onComplete?.();
      }
      return;
    }

    this._timer -= dt;
    if (this._timer > 0) return;

    const wave = this.waves[this.waveIndex];
    if (this._phase === 'delay') {
      this._phase = 'spawning';
      this._spawned = 0;
    }

    spawnEnemy(this.gameObject.game, this._enemyAt(wave, this._spawned), this._worldPath, {
      onLeak: this._onLeak,
      onDeath: this._onKill,
    });
    this._spawned++;

    if (this._spawned < wave.count) {
      // Add rather than assign so a long frame does not stretch the cadence.
      this._timer += wave.interval;
      return;
    }

    // Paid on finishing spawning rather than on the wave being cleared: waves
    // overlap, so "cleared" has no single moment. It exists so a player who is
    // losing can still afford to build - kill-only income turns a bad wave into
    // an unrecoverable spiral, which makes difficulty a cliff instead of a slope.
    if (wave.bonus) this._onBonus?.(wave.bonus, this.waveIndex);

    this.waveIndex++;
    if (this.waveIndex >= this.waves.length) {
      this._phase = 'done';
    } else {
      this._phase = 'delay';
      this._timer = this.waves[this.waveIndex].delay ?? 0;
    }
  }
}
