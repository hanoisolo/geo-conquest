const assert = require("node:assert/strict"); const E = require("../js/ws-engine.js");
let pass = 0, fail = 0; const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("✘ " + name + ": " + e.message); } };
const mkq = (i, tier = "easy", category = "c" + (i % 3)) => ({ id: "WS-d-" + i, tier, category, q: "q" + i, options: ["a","b","c","d"], answer: 0, source: "worksheet", continent: null, territory: null });

t("1 tier preferred: hard picks never return the easy question", () => {
  const deck = [mkq(1, "easy"), mkq(2, "hard"), mkq(3, "hard")];
  const deckIds = new Set(deck.map(q => q.id));
  for (let i = 0; i < 20; i++) {
    const asked = [];
    const q = E.pick(deck, asked, "hard", {});
    assert.ok(q, "pick " + i + " returned a question");
    assert.ok(deckIds.has(q.id), "pick " + i + " is from the deck");
    assert.notEqual(q.id, "WS-d-1", "pick " + i + " never returns the easy question");
  }
});

t("2 no repeats within a cycle: 10 picks give 10 distinct deck ids", () => {
  const deck = [];
  for (let i = 1; i <= 10; i++) deck.push(mkq(i, i % 2 === 0 ? "hard" : "easy"));
  const deckIds = new Set(deck.map(q => q.id));
  const asked = [];
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const q = E.pick(deck, asked, "easy", {});
    assert.ok(q, "pick " + i + " returned a question");
    assert.ok(deckIds.has(q.id), "pick " + i + " is from the deck");
    ids.push(q.id);
  }
  assert.equal(new Set(ids).size, 10, "all 10 ids are distinct");
  assert.deepStrictEqual(asked, ids, "asked accumulates the full cycle in pick order");
});

t("3 off-tier deck questions are used before top-up", () => {
  const deck = [mkq(1, "easy"), mkq(2, "easy"), mkq(3, "easy")];
  const deckIds = new Set(deck.map(q => q.id));
  let baseCalls = 0;
  const opts = { topUp: true, pickBase: () => { baseCalls++; return { id: "BASE" }; } };
  const asked = [];
  for (let i = 0; i < 3; i++) {
    const q = E.pick(deck, asked, "hard", opts);
    assert.ok(q, "pick " + i + " returned a question");
    assert.ok(deckIds.has(q.id), "pick " + i + " is from the deck, got " + (q && q.id));
    assert.notEqual(q.id, "BASE", "pick " + i + " is not a base question");
  }
  assert.equal(baseCalls, 0, "pickBase not called while off-tier deck questions remain");
});

t("4 reshuffle without top-up: asked holds exactly one deck id after the restart", () => {
  const deck = [mkq(1), mkq(2), mkq(3)];
  const deckIds = new Set(deck.map(q => q.id));
  const asked = [];
  for (let i = 0; i < 3; i++) {
    const q = E.pick(deck, asked, "easy", {});
    assert.ok(q && deckIds.has(q.id), "pick " + (i + 1) + " is from the deck");
  }
  assert.equal(asked.length, 3, "first cycle fills asked with the deck ids");
  const q4 = E.pick(deck, asked, "easy", {});
  assert.ok(q4, "4th pick returned a question");
  assert.ok(deckIds.has(q4.id), "4th pick is from the deck");
  const deckInAsked = asked.filter(id => deckIds.has(id));
  assert.equal(deckInAsked.length, 1, "exactly one deck id remains in asked");
  assert.equal(deckInAsked[0], q4.id, "the remaining deck id is the new pick");
});

t("5 top-up after cycle: one base question, then a fresh deck question", () => {
  const deck = [mkq(1), mkq(2)];
  const deckIds = new Set(deck.map(q => q.id));
  let baseCalls = 0;
  const opts = { topUp: true, pickBase: () => { baseCalls++; return { id: "BASE" }; } };
  const asked = [];
  const q1 = E.pick(deck, asked, "easy", opts);
  const q2 = E.pick(deck, asked, "easy", opts);
  assert.ok(q1 && deckIds.has(q1.id), "pick 1 is from the deck");
  assert.ok(q2 && deckIds.has(q2.id), "pick 2 is from the deck");
  assert.equal(baseCalls, 0, "pickBase not called before the cycle completes");
  const q3 = E.pick(deck, asked, "easy", opts);
  assert.ok(q3, "pick 3 returned a question");
  assert.equal(q3.id, "BASE", "pick 3 is the base question");
  assert.equal(baseCalls, 1, "pickBase called exactly once");
  const q4 = E.pick(deck, asked, "easy", opts);
  assert.ok(q4, "pick 4 returned a question");
  assert.ok(deckIds.has(q4.id), "pick 4 is from the deck, got " + (q4 && q4.id));
  assert.equal(baseCalls, 1, "pickBase not called again");
  const deckInAsked = asked.filter(id => deckIds.has(id));
  assert.equal(deckInAsked.length, 1, "no stale deck ids beyond the new one");
  assert.equal(deckInAsked[0], q4.id);
});

t("6 topUp off by default: pickBase is never called", () => {
  const deck = [mkq(1), mkq(2)];
  const deckIds = new Set(deck.map(q => q.id));
  let baseCalls = 0;
  const opts = { pickBase: () => { baseCalls++; return { id: "BASE" }; } };
  const asked = [];
  const q1 = E.pick(deck, asked, "easy", opts);
  const q2 = E.pick(deck, asked, "easy", opts);
  assert.ok(q1 && deckIds.has(q1.id), "pick 1 is from the deck");
  assert.ok(q2 && deckIds.has(q2.id), "pick 2 is from the deck");
  const q3 = E.pick(deck, asked, "easy", opts);
  assert.ok(q3, "pick 3 returned a question");
  assert.ok(deckIds.has(q3.id), "pick 3 is still a deck question after reshuffle");
  assert.equal(baseCalls, 0, "pickBase never called without topUp");
});

t("7 topUp with pickBase returning null falls through to a deck question", () => {
  const deck = [mkq(1), mkq(2)];
  const deckIds = new Set(deck.map(q => q.id));
  let baseCalls = 0;
  const opts = { topUp: true, pickBase: () => { baseCalls++; return null; } };
  const asked = [];
  const q1 = E.pick(deck, asked, "easy", opts);
  const q2 = E.pick(deck, asked, "easy", opts);
  assert.ok(q1 && q2, "first two picks returned questions");
  const q3 = E.pick(deck, asked, "easy", opts);
  assert.ok(q3, "pick 3 returned a question");
  assert.ok(deckIds.has(q3.id), "pick 3 is from the deck, got " + (q3 && q3.id));
  assert.equal(baseCalls, 1, "pickBase was tried once and returned null");
});

t("8 empty deck: null without pickBase, the pickBase result with it", () => {
  assert.equal(E.pick([], [], "easy", {}), null, "empty deck and no pickBase gives null");
  const base = { id: "BASE" };
  const q = E.pick([], [], "easy", { pickBase: () => base });
  assert.deepStrictEqual(q, base, "empty deck returns the pickBase result");
});

t("9 one-question deck is never null", () => {
  const deck = [mkq(1)];
  const asked = [];
  for (let i = 0; i < 5; i++) {
    const q = E.pick(deck, asked, "easy", {});
    assert.ok(q, "pick " + (i + 1) + " returned a question");
    assert.equal(q.id, "WS-d-1", "pick " + (i + 1) + " is the only question");
  }
});

t("10 variety: avoids the category of the last asked question", () => {
  const deck = [mkq(1, "easy", "x"), mkq(2, "easy", "x"), mkq(3, "easy", "y")];
  for (let i = 0; i < 20; i++) {
    const asked = ["WS-d-1"];
    const q = E.pick(deck, asked, "easy", {});
    assert.ok(q, "run " + i + " returned a question");
    assert.equal(q.id, "WS-d-3", "run " + i + " picks the only non-x unasked question");
  }
});

t("11 deterministic random: random() -> 0 picks pool[0]", () => {
  const deck = [mkq(1, "easy", "x"), mkq(2, "easy", "x"), mkq(3, "easy", "x")];
  const q = E.pick(deck, [], "easy", { random: () => 0 });
  assert.ok(q, "pick returned a question");
  assert.equal(q.id, "WS-d-1", "pool[0] is picked");
});

t("12 resetCycle removes deck ids in place, keeping non-deck ids in order", () => {
  const deck = [mkq(1), mkq(2)];
  const asked = ["G1", "WS-d-1", "G2", "WS-d-2"];
  const alias = asked;
  E.resetCycle(deck, asked);
  assert.deepStrictEqual(alias, ["G1", "G2"], "same array object now holds only the non-deck ids, in order");
});

t("13 isUsedUp and smallDeck", () => {
  const deck = [mkq(1), mkq(2)];
  assert.equal(E.isUsedUp(deck, ["G0", "WS-d-1", "WS-d-2"]), true, "all deck ids asked");
  assert.equal(E.isUsedUp(deck, ["G0", "WS-d-1"]), false, "a deck id is still missing");
  assert.equal(E.isUsedUp(deck, []), false, "empty asked is not used up");
  assert.equal(E.isUsedUp([], []), false, "empty deck is not used up");
  const arr = n => Array.from({ length: n }, (_, i) => mkq(i + 1));
  assert.equal(E.smallDeck(arr(24)), true, "24 items is a small deck");
  assert.equal(E.smallDeck(arr(25)), false, "25 items is not a small deck");
  assert.equal(E.smallDeck(arr(3), 2), false, "3 items is not below threshold 2");
});

t("14 asked cap: a 600-entry asked is trimmed to 401 by a pick", () => {
  const deck = [mkq(1), mkq(2)];
  const asked = [];
  for (let i = 1; i <= 600; i++) asked.push("G" + i);
  const q = E.pick(deck, asked, "easy", {});
  assert.ok(q, "pick returned a question");
  assert.equal(asked.length, 401, "asked is capped at 400 plus the new id");
  assert.ok(asked.includes(q.id), "the picked id is in asked");
});

console.log(fail ? `${fail} ws-engine checks FAILED` : `${pass} ws-engine checks passed`); process.exit(fail ? 1 : 0);
