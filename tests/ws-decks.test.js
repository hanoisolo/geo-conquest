// Tests for js/ws-decks.js. Run: node tests/ws-decks.test.js

const assert = require("node:assert/strict");
class MemStore { constructor(limit = Infinity) { this.m = new Map(); this.limit = limit; } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { if (String(v).length > this.limit) throw new Error("QuotaExceededError"); this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new MemStore();
const D = require("../js/ws-decks.js");
let pass = 0, fail = 0;
const t = (name, fn) => { globalThis.localStorage = new MemStore(); try { fn(); pass++; } catch (e) { fail++; console.log("✘ " + name + ": " + e.message); } };
const q = (i, extra = {}) => Object.assign({ q: "Question number " + i + "?", options: ["A" + i, "B" + i, "C" + i, "D" + i], answer: 1, tier: "easy", explain: "why " + i, hints: ["h" + i], category: "cat" }, extra);
const deck = (n = 3, extra = {}) => Object.assign({ title: "Fractions", subject: "Math", grade: "Grade 5", sources: ["a.pdf", "b.png"], questions: Array.from({ length: n }, (_, i) => q(i + 1)) }, extra);

t("save then list/get", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const id = r.value.id;
  assert.equal(typeof id, "string");
  const l = D.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].count, 3);
  assert.equal(l[0].title, "Fractions");
  const g = D.get(id);
  assert.equal(g.questions[0].id, "WS-" + id + "-1");
  for (const item of g.questions) {
    assert.equal(item.source, "worksheet");
    assert.equal(item.continent, null);
    assert.equal(item.territory, null);
    assert.equal(item.type, "text");
  }
});

t("list newest first", () => {
  const a = D.save(deck(1, { createdAt: 1000 }));
  const b = D.save(deck(1, { createdAt: 5000 }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(D.list()[0].createdAt, 5000);
});

t("save with same id replaces", () => {
  const r1 = D.save(deck());
  assert.equal(r1.ok, true);
  const id = r1.value.id;
  const r2 = D.save(Object.assign(deck(), { id: id, title: "Replaced" }));
  assert.equal(r2.ok, true);
  const l = D.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].title, "Replaced");
});

t("MAX_DECKS limit", () => {
  for (let i = 0; i < D.MAX_DECKS; i++) {
    const r = D.save(deck(1, { title: "Deck " + i }));
    assert.equal(r.ok, true, "save " + i + " should succeed");
  }
  const extra = D.save(deck(1, { title: "One too many" }));
  assert.equal(extra.ok, false);
  assert.equal(extra.error.kind, "full");
  assert.equal(D.list().length, D.MAX_DECKS);
});

t("MAX_BYTES limit", () => {
  let sawFull = false;
  for (let i = 0; i < 6; i++) {
    const r = D.save(deck(500, {
      title: "Big " + i,
      questions: Array.from({ length: 500 }, (_, j) => q(j + 1, { q: "x".repeat(290), explain: "y".repeat(390) }))
    }));
    if (!r.ok) {
      assert.equal(r.error.kind, "full");
      sawFull = true;
    }
    const stored = localStorage.getItem(D.KEY);
    if (stored !== null) {
      assert.ok(stored.length <= D.MAX_BYTES, "stored length " + stored.length + " exceeds MAX_BYTES");
    }
  }
  assert.ok(sawFull, "expected at least one save to be rejected as full");
});

t("quota exceeded reports full", () => {
  globalThis.localStorage = new MemStore(10);
  const r = D.save(deck());
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "full");
});

t("missing storage reports storage error", () => {
  delete globalThis.localStorage;
  const r = D.save(deck());
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "storage");
  assert.deepEqual(D.list(), []);
});

t("rename", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const id = r.value.id;
  const rr = D.rename(id, "Decimals");
  assert.equal(rr.ok, true);
  assert.equal(D.list()[0].title, "Decimals");
  const blank = D.rename(id, "   ");
  assert.equal(blank.ok, false);
  assert.equal(blank.error.kind, "invalid");
  const nf = D.rename("nope", "x");
  assert.equal(nf.ok, false);
  assert.equal(nf.error.kind, "not_found");
});

t("remove", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const id = r.value.id;
  const rm = D.remove(id);
  assert.equal(rm.ok, true);
  assert.equal(D.get(id), null);
  const nf = D.remove("nope");
  assert.equal(nf.ok, false);
  assert.equal(nf.error.kind, "not_found");
});

t("invalid decks rejected", () => {
  const empty = D.save(deck(0));
  assert.equal(empty.ok, false);
  assert.equal(empty.error.kind, "invalid");
  const allBad = D.save(deck(2, {
    questions: [q(1, { options: ["only", "two"] }), q(2, { options: ["a", "b"] })]
  }));
  assert.equal(allBad.ok, false);
  assert.equal(allBad.error.kind, "invalid");
});

t("api keys never stored or exported", () => {
  const d = Object.assign(deck(), { apiKey: "sk-SECRET", key: "sk-SECRET", questions: [q(1, { apiKey: "sk-SECRET" })] });
  const r = D.save(d);
  assert.equal(r.ok, true);
  const stored = localStorage.getItem(D.KEY);
  assert.ok(stored !== null && !stored.includes("sk-SECRET"), "apiKey leaked into storage");
  const ex = D.exportJson(r.value.id);
  assert.equal(ex.ok, true);
  assert.ok(!ex.value.json.includes("sk-SECRET"), "apiKey leaked into export");
});

t("exportJson shape", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const ex = D.exportJson(r.value.id);
  assert.equal(ex.ok, true);
  assert.equal(ex.value.filename, "fractions.geodeck.json");
  const parsed = JSON.parse(ex.value.json);
  assert.equal(parsed.format, "geo-conquest-deck");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.deck.id, undefined);
  assert.equal(parsed.deck.questions.length, 3);
  assert.equal(parsed.deck.questions[0].id, undefined);
});

t("exportJson missing deck", () => {
  const ex = D.exportJson("nope");
  assert.equal(ex.ok, false);
  assert.equal(ex.error.kind, "not_found");
});

t("export/import round trip", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const id = r.value.id;
  const ex = D.exportJson(id);
  assert.equal(ex.ok, true);
  const imp = D.importJson(ex.value.json);
  assert.equal(imp.ok, true);
  const newId = imp.value.id;
  assert.notEqual(newId, id);
  assert.equal(imp.value.questions.length, 3);
  const orig = D.get(id);
  imp.value.questions.forEach((item, i) => {
    assert.ok(item.id.startsWith("WS-" + newId + "-"), "bad question id: " + item.id);
    assert.equal(item.q, orig.questions[i].q);
  });
  assert.equal(D.list().length, 2);
});

t("import twice creates distinct decks", () => {
  const r = D.save(deck());
  assert.equal(r.ok, true);
  const ex = D.exportJson(r.value.id);
  assert.equal(ex.ok, true);
  const i1 = D.importJson(ex.value.json);
  const i2 = D.importJson(ex.value.json);
  assert.equal(i1.ok, true);
  assert.equal(i2.ok, true);
  assert.notEqual(i1.value.id, i2.value.id);
  assert.equal(D.list().length, 3);
});

t("bad imports rejected", () => {
  const cases = [
    ["not json", "not json"],
    ["array", JSON.stringify([1])],
    ["wrong format", JSON.stringify({ format: "other", version: 1, deck: deck() })],
    ["wrong version", JSON.stringify({ format: "geo-conquest-deck", version: 2, deck: deck() })],
    ["too large", "x".repeat(D.MAX_BYTES + 1)],
    ["non-string", 42]
  ];
  for (const [label, input] of cases) {
    const r = D.importJson(input);
    assert.equal(r.ok, false, label + ": expected ok false");
    assert.equal(r.error.kind, "invalid", label + ": expected invalid");
  }
});

t("malicious import cleaned", () => {
  const payload = {
    format: "geo-conquest-deck",
    version: 1,
    deck: {
      title: "<img src=x onerror=alert(1)>",
      subject: "Math",
      grade: "Grade 5",
      sources: ["a.pdf"],
      questions: [q(1, { q: "y".repeat(1000) }), q(2, { options: ["a", "b", "c"] }), q(3)]
    }
  };
  const r = D.importJson(JSON.stringify(payload));
  assert.equal(r.ok, true);
  assert.equal(typeof r.value.title, "string");
  assert.equal(r.value.title, "<img src=x onerror=alert(1)>");
  assert.equal(r.value.questions.length, 2, "question with 3 options should be dropped");
  assert.ok(r.value.questions.every((item) => item.q.length <= 300), "q not capped at 300");
  assert.ok(r.value.questions.some((item) => item.q === "y".repeat(300)), "capped question missing");
  const protoJson = '{"format":"geo-conquest-deck","version":1,"deck":{"__proto__":{"polluted":1},"title":"x","questions":[' + JSON.stringify(q(1)) + ']}}';
  D.importJson(protoJson);
  assert.equal(({}).polluted, undefined, "prototype pollution detected");
});

t("import with all bad questions rejected", () => {
  const payload = {
    format: "geo-conquest-deck",
    version: 1,
    deck: {
      title: "All Bad",
      subject: "Math",
      grade: "Grade 5",
      questions: [q(1, { options: ["a", "b"] }), q(2, { options: ["a", "b"] })]
    }
  };
  const r = D.importJson(JSON.stringify(payload));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "invalid");
});

t("corrupt storage tolerated", () => {
  localStorage.setItem(D.KEY, "{bad");
  assert.deepEqual(D.list(), []);
  const r = D.save(deck());
  assert.equal(r.ok, true);
  assert.equal(D.list().length, 1);
  localStorage.setItem(D.KEY, JSON.stringify({ version: 9, decks: [] }));
  assert.deepEqual(D.list(), []);
});

t("stored deck with bad id dropped", () => {
  const r = D.save(deck(1));
  assert.equal(r.ok, true);
  const id = r.value.id;
  const stored = JSON.parse(localStorage.getItem(D.KEY));
  const evil = JSON.parse(JSON.stringify(stored.decks[0]));
  evil.id = "../x";
  stored.decks.push(evil);
  localStorage.setItem(D.KEY, JSON.stringify(stored));
  const all = D.readAll();
  assert.equal(all.version, 1);
  assert.ok(Array.isArray(all.decks));
  const ids = all.decks.map((d) => d.id);
  assert.equal(ids.length, 1);
  assert.equal(ids[0], id);
});

t("sources capped at 10", () => {
  const sources = Array.from({ length: 15 }, (_, i) => "src" + i + ".pdf");
  const r = D.save(deck(1, { sources: sources }));
  assert.equal(r.ok, true);
  assert.equal(r.value.sources.length, 10);
  assert.equal(D.get(r.value.id).sources.length, 10);
});

t("import renumbers question ids", () => {
  const text = JSON.stringify({ format: "geo-conquest-deck", version: 1, deck: deck(2, { questions: [q(1, { id: "WS-other-7" }), q(2, { id: "WS-other-9" })] }) });
  const r = D.importJson(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.questions.map((x) => x.id), ["WS-" + r.value.id + "-1", "WS-" + r.value.id + "-2"]);
  const s = D.save(deck(2, { questions: [q(1, { id: "custom" }), q(2)] }));
  assert.equal(s.ok, true);
  assert.deepEqual(s.value.questions.map((x) => x.id), ["WS-" + s.value.id + "-1", "WS-" + s.value.id + "-2"]);
});

t("readAll ignores stored blob with wrong version", () => {
  const ok = D.save(deck());
  assert.equal(ok.ok, true);
  const raw = JSON.parse(localStorage.getItem(D.KEY));
  raw.version = 9;
  localStorage.setItem(D.KEY, JSON.stringify(raw));
  assert.deepEqual(D.list(), []);
});

t("import rejects oversized valid JSON", () => {
  const text = JSON.stringify({ format: "geo-conquest-deck", version: 1, deck: Object.assign(deck(), { pad: "x".repeat(D.MAX_BYTES) }) });
  assert.equal(D.importJson(text).error.kind, "invalid");
});

console.log(fail ? `${fail} ws-decks checks FAILED` : `${pass} ws-decks checks passed`); process.exit(fail ? 1 : 0);
