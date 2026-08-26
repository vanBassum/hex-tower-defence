// The hand, along the bottom of the screen.
//
// The first piece of the game that is not the world. It is DOM rather than
// something drawn in the scene, and that is a decision rather than a shortcut: a
// card is a *menu*, not an object on the island, and putting it in the world
// would mean building text layout, hit testing and focus handling against a
// camera that pans and rotates. The board stays a board and the hand stays a
// hand.
//
// It owns no state. `update(deployment)` is called whenever the hand or the
// arming changes and paints whatever it is given, so there is exactly one
// account of what the player holds and it lives in the Deployment component.
//
// Elements are kept per card rather than rebuilt, for one reason worth knowing:
// a card that is re-created on every change replays its entrance animation every
// time anything else happens, which is the whole bar flinching each time a card
// is armed.
export class CardBar {
  constructor({ root, onArm = null } = {}) {
    this._root = root;
    this._onArm = onArm;
    this._els = new Map();   // hand entry -> element

    this._hint = document.createElement('div');
    this._hint.className = 'hand-hint';
    this._list = document.createElement('div');
    this._list.className = 'hand-cards';
    root.append(this._hint, this._list);
  }

  update(deployment) {
    const hand = deployment.hand;
    // An empty hand is not an empty bar with nothing in it - it is no bar. There
    // is nothing to say before the first card is found, and a permanent empty
    // frame at the bottom of the screen is a promise the opening does not need
    // to make.
    this._root.classList.toggle('is-empty', hand.length === 0);

    for (const entry of hand) {
      let el = this._els.get(entry);
      if (!el) {
        el = this._build(entry);
        this._els.set(entry, el);
        this._list.append(el);
      }
      el.classList.toggle('is-armed', deployment.armed === entry);
      el.classList.toggle('is-spent', entry.spent);
      el.disabled = entry.spent;
      el.querySelector('.card-state').textContent = entry.spent ? 'Deployed' : 'Deploy';
    }

    // The hint is composed by the component that knows the conditions, not here.
    // Every case it turns on - armed, nowhere to place, an empty board waiting
    // for the first card - is a fact about the deployment, and a bar that worked
    // them out for itself would be a second account of the same state.
    const hint = deployment.hint;
    this._hint.textContent = hint;
    this._hint.classList.toggle('is-on', !!hint);
  }

  _build(entry) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card';
    el.innerHTML =
      `<span class="card-art">${ART[entry.card.unit] ?? ART.default}</span>` +
      `<span class="card-name"></span>` +
      `<span class="card-note"></span>` +
      `<span class="card-state">Deploy</span>`;
    el.querySelector('.card-name').textContent = name(entry.card);
    el.querySelector('.card-note').textContent = entry.card.note ?? '';
    el.addEventListener('click', () => this._onArm?.(entry));
    return el;
  }
}

function name(card) {
  return card.name ?? NAMES[card.unit] ?? card.key;
}

// Kept here rather than imported from units.js so the bar has no opinion about
// the scene: it is handed cards and draws them.
const NAMES = { scout: 'Scout', footman: 'Footmen' };

// The art is the unit's silhouette and nothing else, because the silhouette is
// what the player has to match against the thing standing on the board - the
// spears above the helmets are how a Footman is told apart at the game's camera,
// so they are how the card is told apart too.
const ART = {
  footman: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.85">
        <line x1="8"  y1="29" x2="10" y2="3"/>
        <line x1="23" y1="29" x2="22" y2="2"/>
        <line x1="38" y1="29" x2="36" y2="4"/>
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="21" r="3.6"/><circle cx="26" cy="20" r="3.6"/><circle cx="40" cy="21" r="3.6"/>
        <path d="M8 30 l3.5 -6 h1 L16 30z M22 30 l3.5 -7 h1 L30 30z M36 30 l3.5 -6 h1 L44 30z" opacity="0.75"/>
      </g>
    </svg>`,
  scout: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="20" cy="14" r="4"/>
        <path d="M14 30 l5 -12 h2 L26 30z"/>
        <circle cx="35" cy="17" r="3.2" opacity="0.9"/>
      </g>
      <line x1="35" y1="17" x2="35" y2="30" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
    </svg>`,
  default: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <circle cx="24" cy="16" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/>
    </svg>`,
};
