import { Component } from '../../engine/gameobject.js';

// Troops the level stood on the board for the player to *find*.
//
// A dormant group is a real unit built the same way every other one is, standing
// on its hex from the first frame, and belonging to nobody. It is not on the
// roster - which is the whole of what makes it inert, because everything in this
// game reads the roster and not a flag. It does not see, cannot be selected,
// cannot be ordered, is not fought, is not reacted to, and has no card. The
// moment an *active* friendly can see the hex it is standing on, it joins the
// force and is a normal group for the rest of the run.
//
// ── Why this is not a pickup ────────────────────────────────────────────────
// A pickup is a thing on the board that grants a card, and a card is played at
// the King. That is the right shape for "somebody left their colours here" and
// the wrong one for "there are fifteen men standing in that field": the men are
// already where they are, so walking back to camp to deploy them is asking the
// player to undo the fiction. Nothing here touches Deployment - what a woken
// group does about the card bar is handed in as `onWake`, so this file knows
// that cards exist about as much as a pickup knows what a card is.
//
// ── Why visibility and not a radius ─────────────────────────────────────────
// The trigger is `VisibilityMap.isVisible` on the group's own hex, and that is
// the entire rule. A proximity check would be a second, worse answer to a
// question the game already answers well: view distance, the size of the force
// and which unit is doing the looking all feed the fog, so they all feed
// discovery too, for free and without this file knowing any of them exist. The
// dependency runs one way - visibility says what is visible, this decides what
// that means - and nothing about troops has been put into the fog.
export class Garrison extends Component {
  constructor({
    visibility,
    control,             // the roster a woken group joins
    onWake = null,       // (unit) => void, for whatever else should hear about it
  } = {}) {
    super();
    this._visibility = visibility;
    this._control = control;
    this.onWake = onWake;
    this.dormant = [];
  }

  // Takes a unit out of play without taking it off the board. Hidden outright
  // rather than dimmed or ghosted: a silhouette in the dark is a promise that
  // there is something over there, and the point of these is to be found.
  //
  // Its hex stays occupied. The men are standing on it, and the only thing that
  // can be said against that is that an enemy route would bend round a tile that
  // looks empty - which cannot be watched happening, because a tile nobody has
  // seen is a tile with no route drawn to it and no group left standing on it.
  add(unit) {
    if (!unit || this.dormant.includes(unit)) return unit;
    unit.gameObject.object3D.visible = false;
    this.dormant.push(unit);
    return unit;
  }

  start() {
    // Once up front, because the roster's first `refreshVision` happened when the
    // Force was added and this was not listening yet - and a group the level
    // stood inside the King's opening view is discovered before the first frame
    // rather than on the first step he takes.
    this._check();
    this._unsub = this._visibility.onChange(() => this._check());
  }

  destroy() { this._unsub?.(); }

  _check() {
    if (!this.dormant.length) return;
    const woke = this.dormant.filter(u => this._visibility.isVisible(u.q, u.r));
    if (!woke.length) return;

    // Off the list *before* anybody is woken. Waking widens what the force can
    // see, which fires this listener again from inside itself - and a shorter
    // list every time is what makes that terminate rather than a re-entry guard.
    // It is also correct: a Scout found in the dark can discover the group
    // standing beyond him on the same frame.
    this.dormant = this.dormant.filter(u => !woke.includes(u));
    for (const u of woke) {
      u.gameObject.object3D.visible = true;
      this._control.add(u);
      this.onWake?.(u);
    }
    this._control.refreshVision();
  }
}
