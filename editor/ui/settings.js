import { esc } from './dom.js';
import { dealable, cardName } from '../../game/cards.js';

// The level's own settings, and the army it is tested against.
//
// A modal, for the reason the library is one: none of this is editing. A name is
// typed once, a deck is chosen once and then adjusted between fights, and a row
// of controls for either standing permanently in front of the board would be
// paying rent on something used twice a session.
//
// The two halves are here together because they are the same question asked from
// either end - how big may the army be, and what is in it - and splitting them
// across two panels would mean opening both to answer it.
//
// It holds no state: `open(level)` paints what it is given and every control
// reports out. Cards are added by clicking a kind and removed by clicking one in
// the deck, which is the whole interaction - no drag, no selection, no counts to
// type.
export class LevelSettings {
  constructor({ root, onName, onLimit, onAdd, onRemove, onClear }) {
    this._root = root;
    root.innerHTML = `
      <div class="sheet">
        <header>
          <h2>Level</h2>
          <span class="hint">Settings, and the army you test with</span>
        </header>
        <div class="body">
          <label class="field">
            <span class="k">Name</span>
            <input type="text" data-act="name" spellcheck="false" placeholder="Untitled">
          </label>
          <div class="field">
            <span class="k">Deck limit</span>
            <span class="stepper">
              <button type="button" data-act="limit" data-by="-1">−</button>
              <b class="limit">6</b>
              <button type="button" data-act="limit" data-by="1">+</button>
            </span>
          </div>

          <div class="deck">
            <div class="dhead">
              <span class="k">Test deck</span>
              <b class="count">0 / 6</b>
            </div>
            <div class="chips hold"></div>
            <p class="dhint">Click a card to add it. Click one in the deck to take it back.</p>
            <div class="chips adds"></div>
          </div>
        </div>
        <footer>
          <button type="button" data-act="clear" class="is-plain">Empty the deck</button>
          <button type="button" data-act="close">Done</button>
        </footer>
      </div>
    `;
    this._name  = root.querySelector('[data-act=name]');
    this._limit = root.querySelector('.limit');
    this._count = root.querySelector('.count');
    this._hold  = root.querySelector('.chips.hold');
    this._adds  = root.querySelector('.chips.adds');

    this._name.oninput = () => onName(this._name.value);
    for (const b of root.querySelectorAll('[data-act=limit]')) {
      b.onclick = () => onLimit(+b.dataset.by);
    }
    this._adds.onclick = (e) => {
      const b = e.target.closest('button[data-card]');
      if (b) onAdd(b.dataset.card);
    };
    this._hold.onclick = (e) => {
      const b = e.target.closest('button[data-card]');
      if (b) onRemove(b.dataset.card);
    };
    root.querySelector('[data-act=clear]').onclick = () => onClear();
    root.querySelector('[data-act=close]').onclick = () => this.close();
    root.onclick = (e) => { if (e.target === root) this.close(); };
  }

  get isOpen() { return this._root.open; }

  open(level) {
    this.render(level);
    if (!this._root.open) this._root.showModal();
  }

  close() { this._root.close(); }

  render(level) {
    const limit = level.deckLimit ?? 6;
    const deck = level.deck ?? [];
    if (this._name.value !== level.name) this._name.value = level.name;
    this._limit.textContent = String(limit);
    this._count.textContent = `${deck.length} / ${limit}`;
    this._count.classList.toggle('is-full', deck.length >= limit && limit > 0);

    // The cards in hand, in the order they were added, one chip each - so three
    // Swordsmen are three chips rather than a number, which is what a hand of cards
    // actually is.
    this._hold.innerHTML = deck.length
      ? deck.map((key, i) => `<button type="button" class="held" data-card="${esc(key)}"
           title="Take this one back">${esc(cardName(CARD_OF[key]))}<i>×</i></button>`).join('')
      : `<span class="empty">${level.deck ? 'No cards - the King goes in alone.'
                                         : 'No army chosen yet.'}</span>`;

    // And what can be added, dimmed when the deck is full. Built from the cards
    // the game can deal, so a card added to the game turns up here.
    const full = deck.length >= limit;
    this._adds.innerHTML = dealable().map(card =>
      `<button type="button" data-card="${esc(card.key)}" ${full ? 'disabled' : ''}
        title="${esc(card.role)}">+ ${esc(cardName(card))}</button>`).join('');
  }
}

// A card by key, for the chips - `cardName` wants the card rather than the key.
const CARD_OF = Object.fromEntries(dealable().map(c => [c.key, c]));
