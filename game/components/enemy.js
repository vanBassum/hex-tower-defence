import { Component } from '../../engine/gameobject.js';

// Marks a GameObject as an enemy and keeps it in game.enemies, which is the one
// place towers will look for targets.
export class Enemy extends Component {
  constructor(type) {
    super();
    this.type = type;
  }

  start() {
    const { game } = this.gameObject;
    (game.enemies ??= []).push(this);
  }

  destroy() {
    const list = this.gameObject.game?.enemies;
    const i = list ? list.indexOf(this) : -1;
    if (i >= 0) list.splice(i, 1);
  }

  get position() { return this.gameObject.position; }
}
