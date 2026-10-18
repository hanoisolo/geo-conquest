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
    const want = (tier === "easy" || tier === "medium" || tier === "hard") ? tier : "medium";
    // Per-tier reshuffle: the deck has questions of the requested tier but all
    // of them are asked, so un-ask that tier before falling back to neighbours.
    const tierIds = new Set();
    deck.forEach(function (q) { if (q.tier === want) tierIds.add(q.id); });
    if (tierIds.size > 0 && !unasked.some(function (q) { return tierIds.has(q.id); })) {
      for (let j = asked.length - 1; j >= 0; j--) {
        if (tierIds.has(asked[j])) {
          asked.splice(j, 1);
        }
      }
      const fresh = new Set(asked);
      unasked = deck.filter(function (q) { return !fresh.has(q.id); });
    }
    let order;
    if (want === "hard") {
      order = ["hard", "medium", "easy"];
    } else if (want === "easy") {
      order = ["easy", "medium", "hard"];
    } else {
      order = rnd() < 0.5 ? ["medium", "easy", "hard"] : ["medium", "hard", "easy"];
    }
    let pool = [];
    for (let i = 0; i < order.length; i++) {
      pool = unasked.filter(function (q) { return q.tier === order[i]; });
      if (pool.length > 0) {
        break;
      }
    }
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
  },

  tierCounts: function (questions) {
    const counts = { easy: 0, medium: 0, hard: 0 };
    if (Array.isArray(questions)) {
      for (let i = 0; i < questions.length; i++) {
        const tier = questions[i] && questions[i].tier;
        if (tier === "easy" || tier === "hard") {
          counts[tier]++;
        } else {
          counts.medium++;
        }
      }
    }
    return counts;
  },

  isLopsided: function (questions) {
    if (!Array.isArray(questions) || questions.length < 6) {
      return false;
    }
    const counts = GeoWSEngine.tierCounts(questions);
    const total = questions.length;
    return counts.easy > total * 0.6 || counts.medium > total * 0.6 || counts.hard > total * 0.6;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = GeoWSEngine;
