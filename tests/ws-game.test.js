const assert = require("node:assert/strict");
const loose = require("node:assert");
const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm"); const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const E = require("../js/ws-engine.js");
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, style: {}, dataset: {}, textContent: "", innerHTML: "" });
function loadGame(src, extra = {}) {
  const decks = {};
  const toasts = [];
  const sandbox = { console, Set, Map, Math: Object.create(Math), JSON, Object, Array, String, Number,
    window: {}, document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), body: el() },
    GeoWSEngine: E, GeoWSDecks: { get: (id) => decks[id] || null },
    GeoStorage: { SAVE_VERSION: 2, save() {}, load: () => extra.save || null, clear() {} },
    GeoAvatars: { normalize: (a) => a || "fox", selected: "fox" }, GeoMap: {}, GeoMulti: {} };
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;globalThis.GeoGame = GeoGame;", sandbox);
  const G = sandbox.GeoGame;
  G.toast = (m) => toasts.push(m);
  G.questions = BASE.map((q) => Object.assign({}, q));
  G.contOf = { FRA: "europe", PER: "south-america" }; G.contNameOf = { europe: "Europe", "south-america": "South America" };
  G.nameVariantsOf = { FRA: new Set(["france"]), PER: new Set(["peru"]) };
  G.state = { asked: [], geoSinceMath: 0 };
  return { G, decks, toasts, sandbox };
}
const BASE = [];
for (let i = 0; i < 30; i++) BASE.push({ id: "G" + i, tier: ["easy","medium","hard"][i % 3], territory: i % 2 ? "FRA" : "PER", continent: i % 2 ? "Europe" : "South America", category: "cat" + (i % 4), q: "geo " + i, options: [i % 5 === 0 ? "France" : "Opt" + i, "B", "C", "D"], answer: 0 });
for (let i = 30; i < 50; i++) BASE.push({ id: "G" + i, tier: ["easy","medium","hard"][i % 3], territory: i % 2 ? "ITA" : "BRA", continent: i % 2 ? "Europe" : "South America", category: "cat" + (i % 4), q: "geo " + i, options: ["Opt" + i, "B", "C", "D"], answer: 0 }); // same continent, other countries: exercises the continent rung.
const wsq = (i, tier = "easy", extra = {}) => Object.assign({ id: "WS-deck1-" + i, source: "worksheet", continent: null, territory: null, type: "text", tier, q: "ws " + i, options: ["A" + i, "B", "C", "D"], answer: 0, category: "c" + i }, extra);
const SRC = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
let pass = 0, fail = 0; const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("✘ " + name + ": " + e.message); } };

t("1 default pick path unchanged vs 7525471", () => {
  const ORIG = execFileSync("git", ["show", "7525471:js/game.js"], { cwd: root, encoding: "utf8" });
  const A = loadGame(SRC), B = loadGame(ORIG);
  A.sandbox.Math.random = seeded(42); B.sandbox.Math.random = seeded(42);
  const isos = ["FRA", "PER"], tiers = ["easy", "medium", "hard", "hard"];
  const idsA = [], idsB = [];
  for (let i = 0; i < 60; i++) {
    const qa = A.G.pickQuestion(isos[i % 2], tiers[i % 4]);
    const qb = B.G.pickQuestion(isos[i % 2], tiers[i % 4]);
    idsA.push(qa && qa.id); idsB.push(qb && qb.id);
  }
  assert.deepEqual(idsA, idsB);
  assert.deepEqual(A.G.state.asked, B.G.state.asked);
});

t("2 default giveaway filter still works", () => {
  const { G } = loadGame(SRC);
  assert.equal(G.isGiveawayOn({ id: "x", options: ["France", "B", "C", "D"], answer: 0 }, "FRA"), true);
});

t("3 worksheet questions are never giveaways", () => {
  const { G } = loadGame(SRC);
  assert.equal(G.isGiveawayOn(wsq(1, "easy", { options: ["France", "B", "C", "D"] }), "FRA"), false);
});

t("4 setWorksheetDeck", () => {
  const { G, decks } = loadGame(SRC);
  decks.deck1 = { id: "deck1", questions: [wsq(1), wsq(2, "hard")] };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1" }), true);
  loose.deepEqual(G.wsSettings, { deckId: "deck1", topUp: false, includeMath: false });
  assert.equal(G.setWorksheetDeck({ deckId: "missing" }), false);
  assert.equal(G.wsDeck, null);
  assert.equal(G.setWorksheetDeck(null), false);
  assert.equal(G.wsDeck, null);
  assert.equal(G.wsSettings, null);
});

t("5 deck questions only and tier honoured", () => {
  const { G, decks } = loadGame(SRC);
  const qs = [];
  for (let i = 1; i <= 6; i++) qs.push(wsq(i, i % 2 ? "easy" : "hard"));
  decks.deck1 = { id: "deck1", questions: qs };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1" }), true);
  for (let i = 0; i < 30; i++) {
    if (i % 3 === 0) G.state.asked = [];
    const q = G.pickQuestion("FRA", "hard");
    assert.ok(q, "pick " + i + " returned null");
    assert.ok(q.id.startsWith("WS-deck1-"), "not a deck id: " + q.id);
    assert.equal(q.tier, "hard");
  }
});

t("6 one-question deck with country answer never returns null", () => {
  const { G, decks } = loadGame(SRC);
  decks.deck1 = { id: "deck1", questions: [wsq(1, "easy", { options: ["France", "B", "C", "D"] })] };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1" }), true);
  for (let i = 0; i < 5; i++) {
    const q = G.pickQuestion("FRA", "hard");
    assert.ok(q, "pick " + i + " returned null");
    assert.equal(q.id, "WS-deck1-1");
  }
});

t("7 top-up off by default", () => {
  const { G, decks } = loadGame(SRC);
  decks.deck1 = { id: "deck1", questions: [wsq(1)] };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1" }), true);
  for (let i = 0; i < 6; i++) {
    const q = G.pickQuestion("FRA", "easy");
    assert.ok(q, "pick " + i + " returned null");
    assert.ok(!q.id.startsWith("G"), "base question used: " + q.id);
  }
});

t("8 top-up on mixes base questions", () => {
  const { G, decks } = loadGame(SRC);
  decks.deck1 = { id: "deck1", questions: [wsq(1)] };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1", topUp: true }), true);
  const q1 = G.pickQuestion("FRA", "easy");
  assert.ok(q1, "pick 1 returned null");
  assert.ok(q1.id.startsWith("WS-deck1-"), "pick 1 not from deck: " + q1.id);
  const q2 = G.pickQuestion("FRA", "easy");
  assert.ok(q2, "pick 2 returned null");
  assert.ok(q2.id.startsWith("G"), "pick 2 not from base: " + q2.id);
  const q3 = G.pickQuestion("FRA", "easy");
  assert.ok(q3, "pick 3 returned null");
  assert.ok(q3.id.startsWith("WS-deck1-"), "pick 3 not from deck: " + q3.id);
  assert.equal(G._wsBase, false);
});

t("9 wsNoMath", () => {
  const { G, decks } = loadGame(SRC);
  assert.equal(G.wsNoMath(), false);
  decks.deck1 = { id: "deck1", questions: [wsq(1)] };
  assert.equal(G.setWorksheetDeck({ deckId: "deck1" }), true);
  assert.equal(G.wsNoMath(), true);
  assert.equal(G.setWorksheetDeck({ deckId: "deck1", includeMath: true }), true);
  assert.equal(G.wsNoMath(), false);
});

t("10 newCampaign records state.ws only with a deck", () => {
  const { G, decks } = loadGame(SRC);
  decks.deck1 = { id: "deck1", questions: [wsq(1)] };
  G.showContinentPicker = () => {}; G.persist = () => {};
  assert.equal(G.setWorksheetDeck({ deckId: "deck1", topUp: true }), true);
  G.newCampaign("quest", { deckId: "deck1", topUp: true });
  loose.deepEqual(G.state.ws, { deckId: "deck1", topUp: true, includeMath: false });
  G.newCampaign("quest");
  assert.ok(!("ws" in G.state));
  assert.equal(G.wsDeck, null);
});

t("11 continueCampaign with missing ws deck drops it", () => {
  const { G, toasts } = loadGame(SRC, { save: { mode: "quest", asked: [], avatar: "fox", homeBase: "FRA", ws: { deckId: "gone", topUp: false, includeMath: false } } });
  G.enterGame = () => {}; G.resumePendingChoice = () => {}; G.persist = () => {};
  G.continueCampaign();
  assert.ok(!("ws" in G.state));
  assert.equal(toasts.length, 1);
  assert.equal(G.wsDeck, null);
});

t("12 continueCampaign re-activates an existing ws deck", () => {
  const deck = { id: "deck1", questions: [wsq(1), wsq(2, "hard"), wsq(3)] };
  const { G, decks } = loadGame(SRC, { save: { mode: "quest", asked: [], avatar: "fox", homeBase: "FRA", ws: { deckId: "deck1", topUp: true, includeMath: true } } });
  decks.deck1 = deck;
  G.enterGame = () => {}; G.resumePendingChoice = () => {}; G.persist = () => {};
  G.continueCampaign();
  assert.equal(G.wsDeck.length, deck.questions.length);
  assert.equal(G.wsSettings.topUp, true);
  assert.deepEqual(G.state.ws, { deckId: "deck1", topUp: true, includeMath: true });
});

console.log(fail ? `${fail} ws-game checks FAILED` : `${pass} ws-game checks passed`); process.exit(fail ? 1 : 0);
