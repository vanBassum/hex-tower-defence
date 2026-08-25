import { Component } from '../gameobject.js';

// A hit descriptor accompanies damage so the target can reason about *where* it
// came from, not just how much arrived. Armour that only holds from the front,
// or a beam whose power has already been split, both need this.
//   { amount, kind, direction, source }
//   direction: {x, z} unit vector the damage was travelling along
//   source:    {x, y, z} world origin of the shot, or null
export function makeHit({ kind = 'generic', direction = null, source = null } = {}) {
  return { kind, direction, source };
}

// Hit points with a death hook. onDeath fires exactly once — several towers can
// land a killing blow in the same frame — and damage is clamped so overkill is
// reported rather than silently absorbed.
export class Health extends Component {
  constructor({ max = 100, onDeath = null } = {}) {
    super();
    this.max     = max;
    this.hp      = max;
    this.onDeath = onDeath;
  }

  get fraction() { return this.max > 0 ? this.hp / this.max : 0; }
  get isDead()   { return this.hp <= 0; }

  // Returns the damage actually absorbed, so a caller can tell how much of its
  // shot was wasted on an already-dying target.
  damage(amount, hit = null) {
    if (amount <= 0 || this.isDead) return 0;

    // Sibling components get to reshape incoming damage before it lands. This
    // is the seam mirrors and armour hang off; nothing uses it yet.
    let incoming = amount;
    for (const c of this.gameObject.components) {
      if (c === this || typeof c.modifyIncomingDamage !== 'function') continue;
      incoming = c.modifyIncomingDamage(incoming, hit);
      if (incoming <= 0) return 0;
    }

    const applied = Math.min(incoming, this.hp);
    this.hp -= applied;
    if (this.hp <= 0) this.onDeath?.(this.gameObject, hit);
    return applied;
  }

  heal(amount) {
    if (amount <= 0 || this.isDead) return 0;
    const applied = Math.min(amount, this.max - this.hp);
    this.hp += applied;
    return applied;
  }
}
