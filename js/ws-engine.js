/* ============================================================
   ws-engine.js — question picking for "My worksheets" mode.
   Pure (no DOM): deck questions first, by tier, reshuffling the
   deck when every question has been asked; optional top-up.
   ============================================================ */
"use strict";

const GeoWSEngine = {
  pick: function (deck, asked, tier, opts) {
    opts = opts || {};
    if (!Array.isArray(deck) || deck.length === 0) {
      return opts.pickBase ? opts.pickBase() : null;
    }
    const rnd = typeof opts.random === "function" ? opts.random : Math.random;
    const askedSet = new Set(asked);
    let unasked = deck.filter(function (q) { return !askedSet.has(q.id); });
    if (unasked.length === 0) {
      if (opts.topUp && typeof opts.pickBase === "function") {
        const b = opts.pickBase();
        GeoWSEngine.resetCycle(deck, asked);
        if (b) {
          return b;
        }
      } else {
        GeoWSEngine.resetCycle(deck, asked);
      }
      unasked = deck.slice();
    }
    let pool = unasked.filter(function (q) { return q.tier === tier; });
    if (pool.length === 0) {
      pool = unasked;
    }
    const lastId = asked[asked.length - 1];
    const last = deck.find(function (q) { return q.id === lastId; });
    if (last) {
      const preferred = pool.filter(function (q) {
        return (q.category || "worksheet") !== (last.category || "worksheet");
      });
      if (preferred.length) {
        pool = preferred;
      }
    }
    const q = pool[Math.floor(rnd() * pool.length)];
    asked.push(q.id);
    if (asked.length > 600) {
      asked.splice(0, 200);
    }
    return q;
  },

  resetCycle: function (deck, asked) {
    const ids = new Set();
    if (Array.isArray(deck)) {
      for (let i = 0; i < deck.length; i++) {
        ids.add(deck[i].id);
      }
    }
    for (let j = asked.length - 1; j >= 0; j--) {
      if (ids.has(asked[j])) {
        asked.splice(j, 1);
      }
    }
    return asked;
  },

  isUsedUp: function (deck, asked) {
    if (!Array.isArray(deck) || deck.length === 0) {
      return false;
    }
    const askedSet = new Set(asked);
    for (let i = 0; i < deck.length; i++) {
      if (!askedSet.has(deck[i].id)) {
        return false;
      }
    }
    return true;
  },

  smallDeck: function (deck, threshold) {
    const t = typeof threshold === "number" ? threshold : 25;
    return deck.length < t;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = GeoWSEngine;
