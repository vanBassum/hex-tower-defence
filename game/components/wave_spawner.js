import { Component } from '../../engine/gameobject.js';
import { spawnEnemy } from '../enemies.js';

// Runs a level's wave table, one wave per request: `count` enemies at
// `interval`, then it waits.
//
// Nothing starts a wave except the player asking for one. A wave clock would be
// deciding the two things this game is supposed to be about - how long you get
// to look at the board before committing, and whether you take on two waves at
// once - and neither is a decision a timer should be making. Sending the next
// wave while the last one is still walking is allowed, and it is the player's
// call rather than a punishment for falling behind.
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
    this._phase     = 'ready';   // 'ready' | 'spawning' | 'done'
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
  get canSend()      { return this._phase === 'ready'; }
  get allSent()      { return this._phase === 'done'; }
  get enemiesAlive() { return this.gameObject.game.enemies?.length ?? 0; }

  start() {
    if (!this.waves.length) this._phase = 'done';
  }

  // Returns false when there is nothing to send, so the caller does not have to
  // reproduce the rule.
  sendNextWave() {
    if (this._phase !== 'ready') return false;
    this._phase = 'spawning';
    this._spawned = 0;
    this._timer = 0;      // first enemy leaves on the next frame
    return true;
  }

  update(dt) {
    if (this._phase === 'done') {
      if (!this.complete && this.enemiesAlive === 0) {
        this.complete = true;
        this._onComplete?.();
      }
      return;
    }
    if (this._phase !== 'spawning') return;

    this._timer -= dt;
    if (this._timer > 0) return;

    const wave = this.waves[this.waveIndex];
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

    // Paid on finishing spawning rather than on the wave being cleared: the
    // player may already have sent the next one, so "cleared" has no single
    // moment. It exists so a player who is losing can still afford to build -
    // kill-only income turns a bad wave into an unrecoverable spiral, which makes
    // difficulty a cliff instead of a slope.
    if (wave.bonus) this._onBonus?.(wave.bonus, this.waveIndex);

    this.waveIndex++;
    this._phase = this.waveIndex >= this.waves.length ? 'done' : 'ready';
  }
}
