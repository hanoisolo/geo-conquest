const assert = require("node:assert/strict");
const V = require("../js/ws-validate.js");
const C = require("../js/ws-config.js");

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log("✘ " + name + ": " + e.message); } }
const mk = (q, options, answer, extra = {}) => Object.assign({ q, options, answer }, extra);

t("config: model ids, limits, frozen providers", () => {
  assert.equal(C.OCR_MODEL, "mistral-ocr-latest");
  assert.equal(C.PROVIDERS.mistral.model, "zai-glm-5-3");
  assert.equal(C.PROVIDERS.mistral.fallbackModel, "mistral-large-4");
  assert.equal(C.PROVIDERS.gemini.model, "gemini-3.8-flash");
  assert.equal(C.PROVIDERS.openai.model, "gpt-6-luna");
  assert.equal(C.MAX_FILE_MB, 5);
  assert.equal(C.MAX_FILES, 10);
  assert.equal(C.MAX_PER_SHEET, 25);
  assert.equal(C.MAX_PER_DECK, 500);
  assert.equal(C.CAPS.q, 300);
  assert.equal(Object.isFrozen(C.PROVIDERS.mistral), true);
});

t("cleanLatex: converts common latex to unicode", () => {
  assert.equal(V.cleanLatex("\\frac{1}{2}"), "1/2");
  assert.equal(V.cleanLatex("\\sqrt {9}"), "√9");
  assert.equal(V.cleanLatex("x^2"), "x²");
  assert.equal(V.cleanLatex("3 \\times 4"), "3 × 4");
  assert.equal(V.cleanLatex("$5$"), "5");
});

t("normalizeSheet: parses fenced json string reply", () => {
  const raw = "Sure!\n```json\n" + JSON.stringify({ meta: { title: "Fractions" }, questions: [mk("1/2 of 4?", ["1", "2", "3", "4"], 1)] }) + "\n```";
  const r = V.normalizeSheet(raw);
  assert.equal(r.ok, true);
  assert.equal(r.value.meta.title, "Fractions");
  assert.equal(r.value.meta.subject, "General");
  const q = r.value.questions[0];
  assert.equal(q.options[q.answer], "2");
});

t("normalizeSheet: non-json string is bad_output", () => {
  const r = V.normalizeSheet("not json");
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "bad_output");
});

t("normalizeSheet: json array string rejected", () => {
  const r = V.normalizeSheet("[1]");
  assert.equal(r.ok, false);
});

t("normalizeSheet: empty questions rejected", () => {
  const r = V.normalizeSheet({ questions: [] });
  assert.equal(r.ok, false);
  assert.ok(r.error.message.includes("No usable questions"));
});

t("normalizeSheet: targetGrade and levels key", () => {
  const r = V.normalizeSheet({ meta: { targetGrade: "Grade 5" }, levels: [mk("Q?", ["a", "b", "c", "d"], 0)] });
  assert.equal(r.ok, true);
  assert.equal(r.value.meta.grade, "Grade 5");
  assert.equal(r.value.questions.length, 1);
});

t("repairQuestion: case-insensitive correctAnswer match", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Capital of France?", options: ["Paris", "Rome", "Oslo", "Bern"], correctAnswer: "PARIS" }, 0, w);
  assert.ok(q);
  assert.equal(q.options[q.answer], "Paris");
});

t("repairQuestion: missing correct answer appended", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], correctAnswer: "Lima" }, 0, w);
  assert.ok(q);
  assert.equal(q.options[3], "Lima");
  assert.equal(q.answer, 3);
  assert.equal(w.length, 1);
});

t("repairQuestion: too few options with missing correct is null", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Q?", options: ["a", "b", "c"], correctAnswer: "Lima" }, 0, w);
  assert.equal(q, null);
});

t("repairQuestion: dedupe leaves too few options", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Q?", options: ["a", "A", "b", "c"], answer: 0 }, 0, w);
  assert.equal(q, null);
});

t("repairQuestion: five options trimmed to four keeping correct", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d", "e"], answer: 4 }, 0, w);
  assert.ok(q);
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.answer], "e");
});

t("repairQuestion: tier normalization", () => {
  const w = [];
  const q1 = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], answer: 0, tier: "banana" }, 0, w);
  assert.equal(q1.tier, "medium");
  const q2 = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], answer: 0, difficulty: "Hard" }, 0, w);
  assert.equal(q2.tier, "hard");
});

t("repairQuestion: hints normalization", () => {
  const w = [];
  const q1 = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], answer: 0, hint: "think" }, 0, w);
  assert.deepEqual(q1.hints, ["think"]);
  const q2 = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], answer: 0, hints: ["a", "b", "c"] }, 0, w);
  assert.equal(q2.hints.length, 2);
});

t("repairQuestion: long q truncated to CAPS.q", () => {
  const w = [];
  const q = V.repairQuestion({ q: "x".repeat(400), options: ["a", "b", "c", "d"], answer: 0 }, 0, w);
  assert.equal(q.q.length, C.CAPS.q);
});

t("repairQuestion: non-object item is null with warning", () => {
  const w = [];
  const q = V.repairQuestion("str", 0, w);
  assert.equal(q, null);
  assert.equal(w.length, 1);
});

t("repairQuestion: out-of-range answer recovered from correctAnswer", () => {
  const w = [];
  const q = V.repairQuestion({ q: "Q?", options: ["a", "b", "c", "d"], answer: 9, correctAnswer: "b" }, 0, w);
  assert.ok(q);
  assert.equal(q.options[q.answer], "b");
});

t("normalizeSheet: proto pollution attempt is inert", () => {
  const r = V.normalizeSheet('{"__proto__":{"polluted":1},"questions":[{"q":"Q?","options":["a","b","c","d"],"answer":0}]}');
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
});

t("normalizeSheet: caps at MAX_PER_SHEET with warning", () => {
  const questions = [];
  for (let i = 0; i < 30; i++) questions.push(mk("Q" + i + "?", ["a", "b", "c", "d"], 0));
  const r = V.normalizeSheet({ questions });
  assert.equal(r.ok, true);
  assert.equal(r.value.questions.length, 25);
  assert.ok(r.warnings.some((x) => String(x).includes("25")));
});

const rq = (q, opts, ans, extra = {}) => V.repairQuestion(mk(q, opts, ans, extra), 0, []);

t('20 isDuplicate ignores case, spacing and punctuation', () => {
  const a = rq('What is 2+2?', ['3', '4', '5', '6'], 1);
  const b = rq('what is 2 + 2', ['4', '5', '6', '7'], 0);
  assert.equal(V.isDuplicate(a, b), true);
});

t('21 near-duplicate consistency with jaccard threshold', () => {
  const a = rq('What is the capital city of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 0);
  const b = rq('What is the capital of France?', ['Paris', 'Lima', 'Oslo', 'Bern'], 0);
  assert.equal(V.isDuplicate(a, b), V.jaccard(V.tokens(a.q), V.tokens(b.q)) >= 0.85);
});

t('22 same question text with a different correct answer is not a duplicate', () => {
  const a = rq('What is the capital of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 0);
  const b = rq('What is the capital of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 1);
  assert.equal(V.isDuplicate(a, b), false);
});

t('23 mergeSheets merges three sheets and renumbers ids', () => {
  const s1 = { meta: {}, questions: [
    rq('What is the capital of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 0),
    rq('Which planet is known as the red planet?', ['Mars', 'Venus', 'Jupiter', 'Saturn'], 0),
    rq('How many continents are there?', ['7', '5', '6', '8'], 0)
  ] };
  const s2 = { meta: {}, questions: [
    rq('What is the capital of France!', ['Paris', 'Madrid', 'Oslo', 'Bern'], 0),
    rq('Which ocean is the largest?', ['Pacific', 'Atlantic', 'Indian', 'Arctic'], 0),
    rq('What color comes from mixing blue and yellow?', ['Green', 'Purple', 'Orange', 'Brown'], 0)
  ] };
  const s3 = { meta: {}, questions: [
    rq('Which ocean is the largest!', ['Pacific', 'Atlantic', 'Indian', 'Arctic'], 0),
    rq('How many legs does a spider have?', ['8', '6', '10', '4'], 0),
    rq('What is the largest mammal?', ['Blue whale', 'Elephant', 'Giraffe', 'Shark'], 0)
  ] };
  const merged = V.mergeSheets([s1, s2, s3], 'd1');
  assert.equal(merged.duplicates, 2);
  assert.equal(merged.questions.length, 7);
  merged.questions.forEach((q, i) => {
    assert.equal(q.id, 'WS-d1-' + (i + 1));
    assert.equal(q.source, 'worksheet');
    assert.equal(q.continent, null);
    assert.equal(q.territory, null);
    assert.equal(q.type, 'text');
    assert.equal(q.options.length, 4);
    assert.equal(q.answer >= 0 && q.answer <= 3, true);
  });
});

t('24 merged questions keep the original correct option text', () => {
  const original = rq('Which planet is known as the red planet?', ['Venus', 'Saturn', 'Mars', 'Jupiter'], 2);
  const merged = V.mergeSheets([{ meta: {}, questions: [original] }], 'd1');
  const first = merged.questions[0];
  assert.equal(first.options[first.answer], original.options[original.answer]);
});

t('25 mergeSheets copies explain from a duplicate when the kept explain is empty', () => {
  const kept = rq('What is the capital of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 0, { explain: '' });
  const dup = rq('What is the capital of France!', ['Paris', 'Madrid', 'Oslo', 'Bern'], 0, { explain: 'because' });
  const merged = V.mergeSheets([{ meta: {}, questions: [kept] }, { meta: {}, questions: [dup] }], 'd1');
  assert.equal(merged.questions[0].explain, 'because');
});

t('26 mergeSheets caps the merged deck and warns once', () => {
  const sheets = [];
  for (let s = 1; s <= 26; s++) {
    const questions = [];
    for (let i = 1; i <= 20; i++) {
      const base = s * 100 + i;
      questions.push(rq(`S${s} Q${i}: what is ${base}?`, [String(base), `${base}a`, `${base}b`, `${base}c`], 0));
    }
    sheets.push({ meta: {}, questions: questions });
  }
  const merged = V.mergeSheets(sheets, 'd1');
  assert.equal(merged.questions.length, 500);
  assert.equal(merged.warnings.filter(w => w.includes('maximum')).length, 1);
});

t('27 deckTitle prefers sheet titles, then file names, then a default', () => {
  assert.equal(V.deckTitle([{ meta: { title: '' } }, { meta: { title: 'Birds' } }], []), 'Birds');
  assert.equal(V.deckTitle([{ meta: { title: '' } }], ['a.pdf', 'b.png']), 'a, b');
  assert.equal(V.deckTitle([], []), 'My worksheets');
});

t('28 newDeckId returns distinct lowercase alphanumeric ids', () => {
  const id1 = V.newDeckId();
  const id2 = V.newDeckId();
  assert.equal(id1 === id2, false);
  assert.equal(/^[a-z0-9]+$/.test(id1), true);
  assert.equal(/^[a-z0-9]+$/.test(id2), true);
});

console.log(fail ? `${fail} ws-validate checks FAILED` : `${pass} ws-validate checks passed`);
process.exit(fail ? 1 : 0);
