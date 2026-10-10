/* ============================================================
   baron.js — Baron von Blunder, the animated rival.

   A small character panel in the side panel (desktop): an
   inline SVG villain (top hat, monocle, moustache — defined
   once as <symbol id="baron-face"> and reused) with a speech
   bubble. On phones (<= 920px, single-column layout) the side
   card is hidden and a small fixed avatar (56px, bottom-left,
   below modal z-index, hidden while any modal is open) shows
   the same bubble beside it.

   The Baron taunts the player when he steals a country, when
   the player misses, occasionally when the player wins one,
   and sulks when the player conquers a continent.

   GeoBaron.say(event) shows a random taunt from TAUNTS[event]
   in the bubble; the Baron bounces in, wiggles while talking,
   and the bubble auto-hides after ~4 s. GeoBaron.sulk() droops
   the Baron when he loses a continent.

   TAUNTS groups ~25 short, kid-friendly taunts by event:
   steal / playerMiss / playerWin / continentLost.
   Animations are pure CSS (see css/style.css); under
   prefers-reduced-motion they are disabled globally.
   ============================================================ */
"use strict";

// `var` (not `const`) so the object also lands on `window` — game.js
// guards its calls with `window.GeoBaron` (same pattern as GeoMath).
var GeoBaron = {
  /** Kid-friendly taunts, grouped by event. */
  TAUNTS: {
    // The Baron grabs a country (his automatic move).
    steal: [
      "Mine now! 😈",
      "Too slow, explorer!",
      "That one's mine — finders keepers, losers weepers!",
      "The Baron claims another! Mwahaha!",
      "Nice try… not nice enough!",
      "I'll take that! 🏴‍☠️",
      "Another one bites the dust — for you!",
    ],
    // The player answered wrong and lost the country.
    playerMiss: [
      "Ouch! That one hurt! 😆",
      "Even I could've answered that!",
      "Wrong! The Baron does a little dance! 💃",
      "Nope! Try again, if you dare!",
      "I knew you'd miss that one! 😏",
      "Swing and a miss! ⚾",
      "The answer was RIGHT there!",
    ],
    // The player conquered a country (occasionally).
    playerWin: [
      "Curses! Lucky guess!",
      "Beginner's luck… it won't last!",
      "Hmph! You got me this time.",
      "Not bad… for a beginner. 😤",
      "I'll get that one back!",
      "Fine. Take it. It's cursed anyway.",
    ],
    // The player conquered a whole continent — the Baron sulks.
    continentLost: [
      "Nooo! My precious continent! 😭",
      "This is the worst day ever! …Okay, second worst.",
      "I'll be back! The Baron always returns! 🦹",
      "You win this round, explorer!",
      "Impossible! …Fine. Impressive. 😠",
    ],
  },

  /** How long the speech bubble stays up (ms). */
  BUBBLE_MS: 4000,
  /** How long the sulk lasts (ms). */
  SULK_MS: 3000,

  /** Modal ids — the floating avatar hides while any of these is open. */
  MODAL_IDS: ["question-modal", "victory-modal", "unlock-modal", "how-modal"],

  _lastTaunt: null,
  _hideTimer: null,
  _sulkTimer: null,
  _observer: null,

  /** True when the floating phone avatar is the active Baron (<= 920px). */
  _floatActive() {
    return !!(window.matchMedia &&
      window.matchMedia("(max-width: 920px)").matches);
  },

  /** True while any modal is open. */
  _anyModalOpen() {
    return this.MODAL_IDS.some((id) => {
      const m = document.getElementById(id);
      return m && !m.classList.contains("hidden");
    });
  },

  /**
   * Say a random taunt for the event ("steal", "playerMiss",
   * "playerWin", "continentLost"). Bounces the Baron in, wiggles
   * him while talking, and auto-hides the bubble after ~4 s.
   */
  say(event) {
    const list = this.TAUNTS[event];
    if (!list || !list.length) return;

    // Pick a random taunt, avoiding an immediate repeat.
    let pick = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1) {
      while (pick === this._lastTaunt) {
        pick = list[Math.floor(Math.random() * list.length)];
      }
    }
    this._lastTaunt = pick;

    if (this._floatActive()) this._sayFloat(pick);
    else this._sayCard(pick);

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hide(), this.BUBBLE_MS);
  },

  /** Desktop: the speech bubble in the side-panel Baron card. */
  _sayCard(text) {
    const bubble = document.getElementById("baron-bubble");
    const textEl = document.getElementById("baron-text");
    const stage = document.getElementById("baron-stage");
    const card = document.getElementById("baron-card");
    if (!bubble || !textEl || !stage || !card) return;

    textEl.textContent = text;
    bubble.classList.remove("hidden");
    // Restart the pop animation even if the bubble was already up.
    bubble.style.animation = "none";
    void bubble.offsetWidth;
    bubble.style.animation = "";

    // Bounce in + wiggle while talking.
    card.classList.remove("bounce");
    stage.classList.remove("talk");
    void card.offsetWidth;
    card.classList.add("bounce");
    stage.classList.add("talk");
  },

  /** Phones: the speech bubble beside the floating avatar. */
  _sayFloat(text) {
    const wrap = document.getElementById("baron-float");
    const bubble = document.getElementById("baron-float-bubble");
    const textEl = document.getElementById("baron-float-text");
    if (!wrap || !bubble || !textEl) return;
    if (this._anyModalOpen()) return; // hidden while a modal is open

    textEl.textContent = text;
    bubble.classList.remove("hidden");
    bubble.style.animation = "none";
    void bubble.offsetWidth;
    bubble.style.animation = "";

    wrap.classList.remove("bounce");
    wrap.classList.remove("talk");
    void wrap.offsetWidth;
    wrap.classList.add("bounce");
    wrap.classList.add("talk");
  },

  /** Hide the speech bubble and stop the wiggle. */
  hide() {
    for (const id of ["baron-bubble", "baron-float-bubble"]) {
      const b = document.getElementById(id);
      if (b) b.classList.add("hidden");
    }
    const stage = document.getElementById("baron-stage");
    if (stage) stage.classList.remove("talk");
    const wrap = document.getElementById("baron-float");
    if (wrap) wrap.classList.remove("talk");
    clearTimeout(this._hideTimer);
  },

  /** The Baron droops when the player conquers a continent. */
  sulk() {
    for (const id of ["baron-card", "baron-float"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove("sulk");
      void el.offsetWidth;
      el.classList.add("sulk");
    }
    clearTimeout(this._sulkTimer);
    this._sulkTimer = setTimeout(() => {
      for (const id of ["baron-card", "baron-float"]) {
        const el = document.getElementById(id);
        if (el) el.classList.remove("sulk");
      }
    }, this.SULK_MS);
  },

  /**
   * Watch the modals: the floating avatar hides while any modal is
   * open (so it never covers the question modal) and comes back
   * when the last one closes.
   */
  _init() {
    if (this._observer) return;
    const sync = () => {
      const float = document.getElementById("baron-float");
      if (!float) return;
      float.classList.toggle("modal-open", this._anyModalOpen());
    };
    this._observer = new MutationObserver(sync);
    for (const id of this.MODAL_IDS) {
      const m = document.getElementById(id);
      if (m) this._observer.observe(m, { attributes: true, attributeFilter: ["class"] });
    }
    sync();
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => GeoBaron._init());
} else {
  GeoBaron._init();
}
