// The player's side of the level: what they can spend, what they can afford to
// lose, and whether the level is still running. Deliberately plain data with
// methods — the HUD reads it every frame rather than subscribing to events.
export class GameState {
  constructor({ currency = 0, lives = 20 } = {}) {
    this.currency = currency;
    this.lives    = lives;
    this.maxLives = lives;
    this.status   = 'playing';   // 'playing' | 'won' | 'lost'
    this.killed   = 0;
    this.leaked   = 0;
    this.earned   = 0;
    this.spent    = 0;
  }

  get defeated() { return this.lives <= 0; }
  get playing()  { return this.status === 'playing'; }

  canAfford(cost) { return this.currency >= cost; }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.currency -= cost;
    this.spent += cost;
    return true;
  }

  earn(amount) {
    this.currency += amount;
    this.earned += amount;
  }

  registerKill(enemy) {
    this.killed++;
    this.earn(enemy.type.bounty);
  }

  registerLeak(enemy) {
    this.leaked++;
    this.lives = Math.max(0, this.lives - enemy.type.leakDamage);
  }
}
