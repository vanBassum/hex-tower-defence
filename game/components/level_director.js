import { Component } from '../../engine/gameobject.js';

// Owns the level's end conditions. Losing is checked before winning so an enemy
// that leaks on the same frame the last wave clears still counts as a loss.
// Time is frozen rather than the loop stopped: the camera runs on unscaled time,
// so the player can still look over the board afterwards.
export class LevelDirector extends Component {
  constructor({ state, spawner }) {
    super();
    this.state = state;
    this._spawner = spawner;
  }

  update() {
    const s = this.state;
    if (!s.playing) return;

    if (s.defeated) {
      s.status = 'lost';
      this.gameObject.game.timeScale = 0;
      return;
    }
    if (this._spawner.complete) {
      s.status = 'won';
      this.gameObject.game.timeScale = 0;
    }
  }
}
