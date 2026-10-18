/* ============================================================
   ws-decks.js — saved worksheet decks in localStorage
   (list, save, rename, delete, export/import). Never stores API keys.
   ============================================================ */
"use strict";

const GeoWSDecks = {
  KEY: "geoConquestDecksV1",
  VERSION: 1,
  MAX_DECKS: 20,
  MAX_BYTES: 2000000,
  EXPORT_FORMAT: "geo-conquest-deck",

  V() {
    return typeof GeoWSValidate !== "undefined" ? GeoWSValidate : require("./ws-validate.js");
  },
  cfg() {
    return typeof GeoWSConfig !== "undefined" ? GeoWSConfig : require("./ws-config.js");
  },
  store() {
    return typeof localStorage !== "undefined" ? localStorage : null;
  },

  readAll() {
    var s = GeoWSDecks.store();
    if (!s) return { version: 1, decks: [] };
    var raw;
    try {
      raw = s.getItem(GeoWSDecks.KEY);
    } catch (e) {
      return { version: 1, decks: [] };
    }
    if (!raw) return { version: 1, decks: [] };
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { version: 1, decks: [] };
    }
    if (!data || typeof data !== "object" || data.version !== GeoWSDecks.VERSION || !Array.isArray(data.decks)) {
      return { version: 1, decks: [] };
    }
    var kept = [];
    for (var i = 0; i < data.decks.length; i++) {
      var d = data.decks[i];
      var clean = GeoWSDecks.sanitizeDeck(d, d && d.id);
      if (clean) kept.push(clean);
    }
    return { version: 1, decks: kept };
  },

  writeAll(data) {
    var s = GeoWSDecks.store();
    if (!s) {
      return { ok: false, error: { kind: "storage", message: "Saving isn't available in this browser." } };
    }
    var str;
    try {
      str = JSON.stringify({ version: 1, decks: data.decks });
    } catch (e) {
      return { ok: false, error: { kind: "full", message: "Deck storage is full. Delete a deck and try again." } };
    }
    if (str.length > GeoWSDecks.MAX_BYTES) {
      return { ok: false, error: { kind: "full", message: "Deck storage is full. Delete a deck and try again." } };
    }
    try {
      s.setItem(GeoWSDecks.KEY, str);
    } catch (e) {
      return { ok: false, error: { kind: "full", message: "Deck storage is full. Delete a deck and try again." } };
    }
    return { ok: true };
  },

  sanitizeQuestion(q, deckId, n) {
    if (!q || typeof q !== "object") return null;
    var repaired = GeoWSDecks.V().repairQuestion({
      q: q.q,
      options: q.options,
      answer: q.answer,
      tier: q.tier,
      explain: q.explain,
      hints: q.hints,
      category: q.category
    }, n - 1, []);
    if (!repaired) return null;
    return {
      id: "WS-" + deckId + "-" + n,
      source: "worksheet",
      continent: null,
      territory: null,
      type: "text",
      tier: repaired.tier,
      q: repaired.q,
      options: repaired.options,
      answer: repaired.answer,
      explain: repaired.explain,
      hints: repaired.hints,
      category: repaired.category
    };
  },

  sanitizeDeck(d, id) {
    if (!d || typeof d !== "object" || !Array.isArray(d.questions)) return null;
    if (typeof id !== "string" || !/^[a-z0-9]{4,24}$/.test(id)) return null;
    var cfg = GeoWSDecks.cfg();
    var c = function (v, cap) { return GeoWSDecks.V().clean(v, cap); };
    var kept = [];
    for (var i = 0; i < d.questions.length; i++) {
      if (kept.length >= cfg.MAX_PER_DECK) break;
      var sq = GeoWSDecks.sanitizeQuestion(d.questions[i], id, kept.length + 1);
      if (sq) kept.push(sq);
    }
    if (kept.length === 0) return null;
    var sources = Array.isArray(d.sources) ? d.sources : [];
    var cleanSources = [];
    for (var j = 0; j < sources.length && j < 10; j++) {
      var cs = c(sources[j], 80);
      if (cs) cleanSources.push(cs);
    }
    return {
      id: id,
      title: c(d.title, cfg.CAPS.title) || "My worksheets",
      subject: c(d.subject, cfg.CAPS.subject) || "General",
      grade: c(d.grade, cfg.CAPS.grade),
      count: kept.length,
      createdAt: Number.isFinite(d.createdAt) ? d.createdAt : Date.now(),
      sources: cleanSources,
      questions: kept
    };
  },

  list() {
    var all = GeoWSDecks.readAll();
    var out = all.decks.map(function (d) {
      return { id: d.id, title: d.title, subject: d.subject, grade: d.grade, count: d.count, createdAt: d.createdAt };
    });
    out.sort(function (a, b) { return b.createdAt - a.createdAt; });
    return out;
  },

  get(id) {
    var all = GeoWSDecks.readAll();
    for (var i = 0; i < all.decks.length; i++) {
      if (all.decks[i].id === id) return all.decks[i];
    }
    return null;
  },

  save(deck) {
    var id = (deck && deck.id) || GeoWSDecks.V().newDeckId();
    if (typeof id !== "string" || !/^[a-z0-9]{4,24}$/.test(id)) {
      return { ok: false, error: { kind: "invalid", message: "This deck has an invalid id." } };
    }
    var clean = GeoWSDecks.sanitizeDeck(Object.assign({}, deck, { id: id }), id);
    if (!clean) {
      return { ok: false, error: { kind: "invalid", message: "This deck has no usable questions." } };
    }
    var data = GeoWSDecks.readAll();
    var replaced = false;
    for (var i = 0; i < data.decks.length; i++) {
      if (data.decks[i].id === id) {
        data.decks[i] = clean;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      if (data.decks.length >= GeoWSDecks.MAX_DECKS) {
        return { ok: false, error: { kind: "full", message: "You can keep up to 20 decks. Delete one to save a new deck." } };
      }
      data.decks.push(clean);
    }
    var w = GeoWSDecks.writeAll(data);
    if (!w.ok) return w;
    return { ok: true, value: clean };
  },

  rename(id, title) {
    var t = GeoWSDecks.V().clean(title, GeoWSDecks.cfg().CAPS.title);
    if (!t) {
      return { ok: false, error: { kind: "invalid", message: "Please enter a name." } };
    }
    var all = GeoWSDecks.readAll();
    var deck = null;
    for (var i = 0; i < all.decks.length; i++) {
      if (all.decks[i].id === id) {
        deck = all.decks[i];
        break;
      }
    }
    if (!deck) {
      return { ok: false, error: { kind: "not_found", message: "Deck not found." } };
    }
    deck.title = t;
    var w = GeoWSDecks.writeAll(all);
    if (!w.ok) return w;
    return { ok: true, value: deck };
  },

  remove(id) {
    if (!GeoWSDecks.get(id)) {
      return { ok: false, error: { kind: "not_found", message: "Deck not found." } };
    }
    var all = GeoWSDecks.readAll();
    all.decks = all.decks.filter(function (d) { return d.id !== id; });
    var w = GeoWSDecks.writeAll(all);
    if (!w.ok) return w;
    return { ok: true };
  },

  exportJson(id) {
    var deck = GeoWSDecks.get(id);
    if (!deck) {
      return { ok: false, error: { kind: "not_found", message: "Deck not found." } };
    }
    var json = JSON.stringify({
      format: GeoWSDecks.EXPORT_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      deck: {
        title: deck.title,
        subject: deck.subject,
        grade: deck.grade,
        createdAt: deck.createdAt,
        sources: deck.sources,
        questions: deck.questions.map(({q,options,answer,tier,explain,hints,category}) => ({q,options,answer,tier,explain,hints,category}))
      }
    }, null, 2);
    var slug = deck.title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/^-+|-+$/g, "");
    if (slug.length > 40) slug = slug.slice(0, 40);
    if (!slug) slug = "deck";
    return { ok: true, value: { json: json, filename: slug + ".geodeck.json" } };
  },

  importJson(text) {
    if (typeof text !== "string" || text.length > GeoWSDecks.MAX_BYTES) {
      return { ok: false, error: { kind: "invalid", message: "That file is too big or not a deck file." } };
    }
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: { kind: "invalid", message: "That file isn't a valid deck file." } };
    }
    var plain = function (o) {
      return !!o && typeof o === "object" && !Array.isArray(o);
    };
    if (!plain(obj) || obj.format !== GeoWSDecks.EXPORT_FORMAT || obj.version !== 1 || !plain(obj.deck)) {
      return { ok: false, error: { kind: "invalid", message: "That file isn't a Geo Conquest deck." } };
    }
    var newId = GeoWSDecks.V().newDeckId();
    return GeoWSDecks.save({
      id: newId,
      title: obj.deck.title,
      subject: obj.deck.subject,
      grade: obj.deck.grade,
      createdAt: obj.deck.createdAt,
      sources: obj.deck.sources,
      questions: obj.deck.questions
    });
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = GeoWSDecks;
