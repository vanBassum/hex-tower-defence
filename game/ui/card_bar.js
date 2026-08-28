import { cardStats } from '../cards.js';

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
      el.classList.toggle('is-lost', !!entry.unit?.dead);
      el.disabled = entry.spent;
      this._state(el, entry);
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
      `<span class="card-role"></span>` +
      `<span class="card-stats"></span>` +
      `<span class="card-fill"><i></i></span>` +
      `<span class="card-state">Deploy</span>`;
    el.querySelector('.card-name').textContent = name(entry.card);
    // What it is for, not what it is worth. See the note in cards.js: a stat on
    // the face of a card is a number nobody asked for in the one second they
    // have to read it.
    el.querySelector('.card-role').textContent = entry.card.role ?? '';
    // Built once rather than on every update, because a unit type's figures do
    // not change - what changes is how the unit that was played is doing, and
    // that is the fill and the footer below.
    //
    // One rendering for every card there will ever be: the row is whatever
    // `cardStats` returns, so a fourth number is an entry in cards.js and an icon
    // here, and never a special case for one card.
    const stats = el.querySelector('.card-stats');
    for (const s of cardStats(entry.card)) {
      const item = document.createElement('span');
      item.className = 'card-stat';
      // The icons have to be learnable, and there is nowhere on a card this size
      // to write a word. Hovering one says what it is - which is the whole of the
      // discovery, and costs no space at all.
      item.title = s.label;
      item.setAttribute('aria-label', s.label);
      item.innerHTML = `${STAT_ICONS[s.key] ?? ''}<b>${s.text}</b>`;
      stats.append(item);
    }
    el.addEventListener('click', () => this._onArm?.(entry));
    return el;
  }
}

// How the unit this card played is doing, which is the only thing a spent card
// still has to say. A count against what it started with rather than a
// percentage: fifteen people is a number the player can see on the board and
// count, and "80%" is a number about a bar.
CardBar.prototype._state = function (el, entry) {
  const u = entry.unit;
  const fill = el.querySelector('.card-fill i');

  if (!entry.spent) {
    el.querySelector('.card-state').textContent = 'Deploy';
    fill.style.width = '0%';
    return;
  }
  if (!u || u.dead) {
    el.querySelector('.card-state').textContent = 'Lost';
    fill.style.width = '0%';
    return;
  }
  const max = u.type.people ?? 1;
  el.querySelector('.card-state').textContent = `${u.people} of ${max}`;
  fill.style.width = `${Math.max(0, Math.min(1, u.people / max)) * 100}%`;
};

function name(card) {
  return card.name ?? NAMES[card.unit] ?? card.key;
}

// Kept here rather than imported from units.js so the bar has no opinion about
// the scene: it is handed cards and draws them.
const NAMES = {
  king: 'King', scout: 'Scout', swordsmen: 'Swordsmen', archers: 'Archers',
  spearmen: 'Spearmen', heavy: 'Heavy Infantry', cavalry: 'Cavalry',
};

// The art is the unit's silhouette and nothing else, because the silhouette is
// what the player has to match against the thing standing on the board - the
// steel above the helmets is how a body of Swordsmen is told apart at the game's camera,
// so they are how the card is told apart too.
// The three figures, drawn in the same hand as the card art above them: flat
// shapes in `currentColor`, no strokes finer than the art uses, and each one the
// thing it counts rather than a symbol for it. A crowd is people, an attack is a
// spear - which is what most of this army is actually holding - and range is the
// ring the game already draws on the ground round a unit.
//
// Emoji were the obvious answer and are the wrong one: they arrive in whatever
// the operating system feels like, in full colour, at a weight nothing else on
// this card shares, and a card that is warm parchment everywhere else gets a
// bright blue cartoon in the middle of it.
const STAT_ICONS = {
  people: /* html */`
    <svg viewBox="0 0 14 12" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="4" cy="3.4" r="2"/><path d="M1 11 l2.4 -5.2 h1.2 L7 11z"/>
        <circle cx="10" cy="4.4" r="1.6" opacity="0.62"/>
        <path d="M7.6 11 l1.9 -4.2 h1 L12.4 11z" opacity="0.62"/>
      </g>
    </svg>`,
  // Upright with a crossguard, rather than the obvious diagonal blade: at eleven
  // pixels a diagonal is a slash and nothing else - it was drawn that way first
  // and read as punctuation. The guard is the whole of what makes it a weapon,
  // and it only works across the vertical.
  attack: /* html */`
    <svg viewBox="0 0 14 12" aria-hidden="true">
      <g fill="currentColor">
        <path d="M7 0.6 L8.5 3.2 V7 H5.5 V3.2z"/>
        <path d="M3.6 7 H10.4 V8.3 H3.6z"/>
        <path d="M6.3 8.3 H7.7 V11.2 H6.3z" opacity="0.7"/>
      </g>
    </svg>`,
  range: /* html */`
    <svg viewBox="0 0 14 12" aria-hidden="true">
      <circle cx="7" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.62"/>
      <circle cx="7" cy="6" r="1.6" fill="currentColor"/>
    </svg>`,
  // Ground covered, drawn as ground: two chevrons and a bar under them. A boot
  // was the obvious answer and reads as a boot at this size and nothing else -
  // what has to come across is *distance*, and an arrow going somewhere is the
  // only thing eleven pixels wide that says it.
  move: /* html */`
    <svg viewBox="0 0 14 12" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <path d="M4 2.6 L8 6 L4 9.4" opacity="0.62"/>
        <path d="M8.6 2.6 L12.6 6 L8.6 9.4"/>
      </g>
      <path d="M0.8 5.2 H4.4 V6.8 H0.8z" fill="currentColor" opacity="0.4"/>
    </svg>`,
};

const ART = {
  // The two things that find the King on the board are the standard over the
  // tile and the one figure taller than the rest, so they are the two things
  // here and the retinue is only what makes him the tall one.
  king: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <line x1="24" y1="30" x2="24" y2="2"/>
      </g>
      <path d="M24 3 h10 v7 h-10z" fill="currentColor" opacity="0.55"/>
      <g fill="currentColor">
        <circle cx="24" cy="14" r="4"/>
        <path d="M18 30 l5 -13 h2 L30 30z"/>
        <circle cx="12" cy="20" r="3" opacity="0.7"/>
        <path d="M8 30 l3.5 -7 h1 L16 30z" opacity="0.7"/>
        <circle cx="36" cy="20" r="3" opacity="0.7"/>
        <path d="M32 30 l3.5 -7 h1 L40 30z" opacity="0.7"/>
      </g>
    </svg>`,
  swordsmen: /* html */`
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
  // The same ranks the Swordsmen card draws, with the one difference the board
  // itself uses: curves standing over the heads instead of straight shafts
  // leaning forward. Nothing here says three hexes - what has to be matched is
  // the shape of the thing on the tile.
  archers: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.3" fill="none" opacity="0.85" stroke-linecap="round">
        <path d="M7 4 q5 8 0 16"/>
        <path d="M21 3 q5 8 0 16"/>
        <path d="M35 4 q5 8 0 16"/>
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="21" r="3.6"/><circle cx="26" cy="20" r="3.6"/><circle cx="40" cy="21" r="3.6"/>
        <path d="M8 30 l3.5 -6 h1 L16 30z M22 30 l3.5 -7 h1 L30 30z M36 30 l3.5 -6 h1 L44 30z" opacity="0.75"/>
      </g>
    </svg>`,
  // The same ranks again, with the shafts *levelled* instead of shouldered -
  // which is exactly the difference on the board, and exactly what two hexes of
  // reach means: they are fighting over the top of whoever is in front.
  spearmen: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.85">
        <line x1="4"  y1="13" x2="26" y2="8"/>
        <line x1="12" y1="19" x2="34" y2="13"/>
        <line x1="20" y1="24" x2="44" y2="18"/>
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="21" r="3.6"/><circle cx="26" cy="20" r="3.6"/><circle cx="40" cy="21" r="3.6"/>
        <path d="M8 30 l3.5 -6 h1 L16 30z M22 30 l3.5 -7 h1 L30 30z M36 30 l3.5 -6 h1 L44 30z" opacity="0.75"/>
      </g>
    </svg>`,
  // Four rather than three, shoulder to shoulder, and no daylight between them.
  // The card has to say *slab* - that is the whole unit - and a crowd with gaps
  // in it is any other crowd.
  heavy: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.9">
        <line x1="9"  y1="26" x2="9"  y2="5"/>
        <line x1="20" y1="26" x2="20" y2="4"/>
        <line x1="31" y1="26" x2="31" y2="5"/>
        <line x1="42" y1="26" x2="42" y2="4"/>
      </g>
      <g fill="currentColor">
        <circle cx="9" cy="19" r="4.2"/><circle cx="20" cy="18" r="4.2"/>
        <circle cx="31" cy="19" r="4.2"/><circle cx="42" cy="18" r="4.2"/>
        <path d="M4 30 l4 -8 h2 L14 30z M15 30 l4 -9 h2 L25 30z M26 30 l4 -8 h2 L36 30z M37 30 l4 -9 h2 L47 30z"/>
      </g>
    </svg>`,
  // Two, leaning, with the lances down and forward. Fewer figures than anything
  // else in the hand and the only ones off the vertical, which is as close as
  // flat shapes get to saying "at speed".
  cavalry: /* html */`
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.85">
        <line x1="2"  y1="6"  x2="30" y2="14"/>
        <line x1="14" y1="14" x2="46" y2="23"/>
      </g>
      <g fill="currentColor">
        <circle cx="15" cy="15" r="4"/>
        <path d="M9 30 l7 -12 h2 L22 30z"/>
        <circle cx="31" cy="19" r="3.4" opacity="0.8"/>
        <path d="M26 30 l6 -9 h2 L38 30z" opacity="0.8"/>
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
