/* ============================================================
   tests/math.test.js — plain-Node tests for js/math.js.

   Run with:  node tests/math.test.js
   Exits 1 on any failure. No dependencies.

   For every skill: 3000 samples with a seeded RNG (mulberry32).
   The correct value is recomputed from `operands` with this
   file's OWN rational arithmetic (independent of js/math.js),
   and options are parsed with a local parser for
   "a", "-a", "a.bc", "a/b", "w a/b".
   ============================================================ */
"use strict";

const GeoMath = require("../js/math.js");

/* ---------- seeded RNG (mulberry32) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- independent rational arithmetic ---------- */
function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}
function rat(n, d) {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function rAdd(x, y) { return rat(x.n * y.d + y.n * x.d, x.d * y.d); }
function rSub(x, y) { return rat(x.n * y.d - y.n * x.d, x.d * y.d); }
function rMul(x, y) { return rat(x.n * y.n, x.d * y.d); }
function rDiv(x, y) { return rat(x.n * y.d, x.d * y.n); }
function rEq(x, y) { return x.n === y.n && x.d === y.d; }
function rCmp(x, y) { return x.n * y.d - y.n * x.d; }

/* ---------- option parser: "a", "-a", "a.bc", "a/b", "w a/b", "$a.bc" ---------- */
function parseOption(str) {
  let s = String(str).trim();
  if (s.charAt(0) === "$") s = s.slice(1); // money options
  let m = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (m) {
    const w = parseInt(m[1], 10), num = parseInt(m[2], 10), den = parseInt(m[3], 10);
    if (den === 0) return null;
    const sign = w < 0 ? -1 : 1;
    return rat(sign * (Math.abs(w) * den + num), den);
  }
  m = s.match(/^(-?\d+)\/(\d+)$/);
  if (m) {
    const den = parseInt(m[2], 10);
    if (den === 0) return null;
    return rat(parseInt(m[1], 10), den);
  }
  m = s.match(/^(-?)(\d+)\.(\d+)$/);
  if (m) {
    const neg = m[1] === "-";
    const whole = parseInt(m[2], 10);
    const frac = m[3];
    const den = Math.pow(10, frac.length);
    const n = whole * den + parseInt(frac, 10);
    return rat(neg ? -n : n, den);
  }
  if (/^-?\d+$/.test(s)) return rat(parseInt(s, 10), 1);
  return null;
}

/* ---------- expression evaluator (skill "order") ---------- */
function evalExpr(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === " ") { i++; continue; }
    if ("+-*/x()".indexOf(ch) !== -1) { tokens.push(ch); i++; continue; }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < expr.length && expr[j] >= "0" && expr[j] <= "9") j++;
      tokens.push(expr.slice(i, j));
      i = j;
      continue;
    }
    throw new Error("bad char in expr: " + ch);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? rAdd(v, r) : rSub(v, r);
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "x") {
      const op = next();
      const r = parseFactor();
      v = (op === "*" || op === "x") ? rMul(v, r) : rDiv(v, r);
    }
    return v;
  }
  function parseFactor() {
    const t = next();
    if (t === "(") {
      const v = parseExpr();
      if (next() !== ")") throw new Error("missing ) in expr");
      return v;
    }
    if (t === "-") return rat(-parseFactor().n, parseFactor().d);
    if (t === "+") return parseFactor();
    if (/^\d+$/.test(t)) return rat(parseInt(t, 10), 1);
    throw new Error("bad token in expr: " + t);
  }
  const v = parseExpr();
  if (pos !== tokens.length) throw new Error("trailing tokens in expr");
  return v;
}

/* ---------- recompute the correct value from operands ---------- */
function recompute(operands) {
  const a = operands.a, b = operands.b;
  switch (operands.op) {
    case "+": return rAdd(a, b);
    case "-": return rSub(a, b);
    case "*": return rMul(a, b);
    case "/": return rDiv(a, b);
    case "simplify": return rat(a.n, a.d);
    case "order": return evalExpr(operands.expr);
    default: throw new Error("unknown op: " + operands.op);
  }
}

/* ---------- standalone-token test ---------- */
function containsToken(text, token) {
  const esc = String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9])" + esc + "([^A-Za-z0-9]|$)").test(text);
}

/* ---------- tiny check harness ---------- */
let checks = 0;
let failures = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 40) console.error("FAIL: " + msg);
  }
}
function isInt(x) {
  return typeof x === "number" && isFinite(x) && Math.floor(x) === x;
}

/* ---------- real city-pair distances the generator may use ---------- */
const REAL_DISTANCES = [
  ["Toronto", "Ottawa", 450],
  ["Toronto", "Montreal", 540],
  ["Paris", "Lyon", 470],
  ["Rome", "Florence", 280],
  ["Sydney", "Melbourne", 880],
  ["Cairo", "Alexandria", 220],
];
function isRealTrip(c1, c2, km) {
  return REAL_DISTANCES.some((t) => t[0] === c1 && t[1] === c2 && t[2] === km);
}

/* ---------- per-question validation ---------- */
function validate(q, tier, skill, ctx) {
  const where = ctx + " [" + tier + "/" + skill + "]";
  check(typeof q.id === "string" && new RegExp("^MATH-" + skill + "-[0-9a-z]{6}$").test(q.id),
    where + " id format: " + q.id);
  check(q.type === "math" && q.category === "math", where + " type/category");
  check(q.tier === tier && q.skill === skill, where + " tier/skill fields");
  check(typeof q.q === "string" && q.q.length > 0, where + " q non-empty");
  check(Array.isArray(q.options) && q.options.length === 4, where + " exactly 4 options");
  check(isInt(q.answer) && q.answer >= 0 && q.answer <= 3, where + " answer index in 0..3");
  check(q.options.every((o) => typeof o === "string" && o.length > 0), where + " options are non-empty strings");
  check(new Set(q.options).size === 4, where + " option strings distinct: " + JSON.stringify(q.options));

  // value shape: reduced fraction, d > 0
  check(q.value && isInt(q.value.n) && isInt(q.value.d) && q.value.d > 0, where + " value shape");
  check(gcd(q.value.n, q.value.d) === 1 || (q.value.n === 0 && q.value.d === 1), where + " value is reduced");

  // operands shape
  check(["+", "-", "*", "/", "simplify", "order"].indexOf(q.operands.op) !== -1, where + " operands.op");
  for (const key of ["a", "b"]) {
    const o = q.operands[key];
    check(o && isInt(o.n) && isInt(o.d) && o.d > 0, where + " operands." + key + " shape");
  }

  // independently recompute the correct value
  const expected = recompute(q.operands);
  check(rEq(expected, q.value),
    where + " recompute: expected " + expected.n + "/" + expected.d +
    ", got " + q.value.n + "/" + q.value.d + " (q: " + q.q + ")");

  // options parse, distinct values, answer matches, no other option matches
  const vals = q.options.map(parseOption);
  check(vals.every((v) => v !== null), where + " options parse: " + JSON.stringify(q.options));
  if (vals.every((v) => v !== null)) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        check(!rEq(vals[i], vals[j]),
          where + " options " + i + "," + j + " have the same value (" + q.options[i] + " vs " + q.options[j] + ")");
      }
    }
    check(rEq(vals[q.answer], q.value),
      where + " options[answer] (" + q.options[q.answer] + ") != value (" + q.value.n + "/" + q.value.d + ")");
    for (let j = 0; j < 4; j++) {
      if (j !== q.answer) {
        check(!rEq(vals[j], q.value),
          where + " option " + j + " (" + q.options[j] + ") also equals the answer");
      }
    }
  }

  // hints: 2-5 items, non-empty text, last hint hides the answer, bars sane
  check(Array.isArray(q.hints) && q.hints.length >= 2 && q.hints.length <= 5,
    where + " 2-5 hints (got " + (q.hints ? q.hints.length : "none") + ")");
  if (Array.isArray(q.hints)) {
    q.hints.forEach((h, i) => {
      check(h && typeof h.text === "string" && h.text.trim().length > 0, where + " hint " + i + " has text");
      if (h && h.bars !== undefined) {
        check(Array.isArray(h.bars), where + " hint " + i + " bars is an array");
        if (Array.isArray(h.bars)) {
          for (const bar of h.bars) {
            check(isInt(bar.n) && isInt(bar.d) && bar.n >= 0 && bar.n <= bar.d && bar.d <= 24,
              where + " bar out of range: " + JSON.stringify(bar));
          }
        }
      }
    });
    const last = q.hints[q.hints.length - 1];
    check(!containsToken(last.text, q.options[q.answer]),
      where + " last hint leaks the answer '" + q.options[q.answer] + "': " + last.text);
  }

  // explain
  check(typeof q.explain === "string" && q.explain.length > 0, where + " explain non-empty");

  // review: multiplication sign is "×" (U+00D7), never " x "
  const allTexts = [q.q, q.explain].concat(q.hints.map((h) => h.text));
  for (const t of allTexts) {
    check(t.indexOf(" x ") === -1, where + " uses ' x ' instead of '×': " + t);
  }
  if ((skill === "mul" || skill === "mul2" || skill === "fracmul") && q.q.indexOf("What is") === 0) {
    check(q.q.indexOf("×") !== -1, where + " plain mul question missing ×: " + q.q);
  }
  if (skill === "neg" && q.operands.op === "*") {
    check(q.q.indexOf("×") !== -1, where + " neg mul question missing ×: " + q.q);
  }
  if (skill === "order") {
    check(q.q.indexOf("×") !== -1 || q.q.indexOf("÷") !== -1,
      where + " order question missing ×/÷: " + q.q);
  }

  // review: money questions format every option as $X.XX
  if (q.q.indexOf("$") !== -1) {
    for (let j = 0; j < 4; j++) {
      check(/^\$[0-9]+\.[0-9]{2}$/.test(q.options[j]),
        where + " money option not $X.XX: " + q.options[j]);
    }
  }

  // review: no "1 <plural noun>" anywhere in the question
  check(!/\b1 (litres|pages|crates|seats|rows|packs|jugs|books|cars|explorers|students|teams|regions|slices|pieces|days|classes|families|kilograms|kilometres|metres)\b/.test(q.q),
    where + " bad plural with 1: " + q.q);

  // review: realism — only real city-pair distances, no Machu Picchu, hikers <= 30 km
  check(q.q.indexOf("Machu Picchu") === -1, where + " mentions Machu Picchu");
  {
    const re1 = /([0-9]+) km from ([A-Za-z]+) to ([A-Za-z]+)/g;
    let m;
    while ((m = re1.exec(q.q)) !== null) {
      check(isRealTrip(m[2], m[3], parseInt(m[1], 10)),
        where + " invented distance: " + m[0]);
    }
    const re2 = /from ([A-Za-z]+) to ([A-Za-z]+) is about ([0-9]+) km/g;
    while ((m = re2.exec(q.q)) !== null) {
      check(isRealTrip(m[1], m[2], parseInt(m[3], 10)),
        where + " invented distance: " + m[0]);
    }
    if (/hiker/i.test(q.q)) {
      const nums = q.q.match(/[0-9]+/g) || [];
      for (const ns of nums) {
        check(parseInt(ns, 10) <= 30, where + " hiker distance too big: " + q.q);
      }
    }
  }

  // review: fracsame/fracdiff/simplify are never trivial or degenerate
  if (skill === "fracsame" || skill === "fracdiff" || skill === "simplify") {
    check(q.operands.a.d >= 3, where + " denominator >= 3 (a): " + q.operands.a.d);
    check(q.operands.a.n >= 1, where + " numerator >= 1 (a): " + q.operands.a.n);
    if (skill !== "simplify") {
      check(q.operands.b.d >= 3, where + " denominator >= 3 (b): " + q.operands.b.d);
      check(q.operands.b.n >= 1, where + " numerator >= 1 (b): " + q.operands.b.n);
    }
    check(!rEq(q.value, q.operands.a), where + " result equals operand a");
    check(!rEq(q.value, q.operands.b), where + " result equals operand b");
  }
  if (q.q.indexOf("island") !== -1) {
    check(q.operands.a.d >= 3, where + " island split into >= 3 regions");
    check(q.operands.a.n + q.operands.b.n !== q.operands.a.d,
      where + " island parts add up to the whole: " + q.q);
  }

  // review: subtraction results are never 0
  if (skill === "sub" ||
      (skill === "dec" && q.operands.op === "-") ||
      ((skill === "fracsame" || skill === "fracdiff") && q.operands.op === "-")) {
    check(q.value.n > 0, where + " subtraction result is 0");
  }

  // review: no "0" option for any skill except sub and neg
  if (skill !== "sub" && skill !== "neg" && vals.every((v) => v !== null)) {
    for (let j = 0; j < 4; j++) {
      check(vals[j].n !== 0, where + " option " + j + " is 0: " + q.options[j]);
    }
  }

  // easy-tier constraints: no negatives, numbers within bounds
  if (tier === "easy") {
    const limit = (skill === "mul" || skill === "div") ? 144 : 1000;
    for (let j = 0; j < 4; j++) {
      const v = vals[j];
      if (v) {
        check(v.n >= 0, where + " easy option " + j + " is negative: " + q.options[j]);
        check(rCmp(v, rat(limit, 1)) <= 0, where + " easy option " + j + " exceeds " + limit + ": " + q.options[j]);
      }
    }
    if (skill === "add" || skill === "sub") {
      check(Math.abs(q.operands.a.n) <= 1000 && q.operands.a.d === 1, where + " operand a in range");
      check(Math.abs(q.operands.b.n) <= 1000 && q.operands.b.d === 1, where + " operand b in range");
    } else if (skill === "mul") {
      check(q.operands.a.d === 1 && q.operands.b.d === 1, where + " mul operands are integers");
      check(q.operands.a.n >= 2 && q.operands.a.n <= 12, where + " mul operand a in 2..12: " + q.operands.a.n);
      check(q.operands.b.n >= 2 && q.operands.b.n <= 12, where + " mul operand b in 2..12: " + q.operands.b.n);
    } else if (skill === "div") {
      check(q.operands.a.d === 1 && q.operands.b.d === 1, where + " div operands are integers");
      check(q.operands.b.n >= 2 && q.operands.b.n <= 12, where + " div divisor in 2..12: " + q.operands.b.n);
      check(q.operands.a.n >= 4 && q.operands.a.n <= 144, where + " div dividend in 4..144: " + q.operands.a.n);
      check(q.operands.a.n % q.operands.b.n === 0, where + " div is exact: " + q.operands.a.n + "/" + q.operands.b.n);
      const quot = q.operands.a.n / q.operands.b.n;
      check(quot >= 2 && quot <= 12, where + " div quotient in 2..12: " + quot);
    }
  }
}

/* ---------- formatFraction unit tests ---------- */
const ffCases = [
  [3, 4, "3/4"], [-1, 2, "-1/2"], [4, 2, "2"], [7, 4, "1 3/4"], [-7, 4, "-1 3/4"],
  [6, 3, "2"], [0, 5, "0"], [10, 4, "2 1/2"], [-3, 3, "-1"], [22, 7, "3 1/7"],
];
for (const c of ffCases) {
  check(GeoMath.formatFraction(c[0], c[1]) === c[2],
    "formatFraction(" + c[0] + "," + c[1] + ") = " + GeoMath.formatFraction(c[0], c[1]) + ", want " + c[2]);
}

/* ---------- parseOption unit tests ---------- */
const poCases = [
  ["42", 42, 1], ["-5", -5, 1], ["12.75", 51, 4], ["0.3", 3, 10],
  ["7/12", 7, 12], ["-1/2", -1, 2], ["1 7/12", 19, 12], ["-1 3/4", -7, 4],
  ["$7.40", 37, 5], ["$1.20", 6, 5], ["$0.50", 1, 2], ["$473.00", 473, 1],
];
for (const c of poCases) {
  const v = parseOption(c[0]);
  check(v !== null && v.n === c[1] && v.d === c[2],
    "parseOption(\"" + c[0] + "\") = " + (v ? v.n + "/" + v.d : "null") + ", want " + c[1] + "/" + c[2]);
}

/* ---------- SKILLS structure ---------- */
check(JSON.stringify(GeoMath.SKILLS) === JSON.stringify({
  easy: ["add", "sub", "mul", "div"],
  medium: ["mul2", "div2", "dec", "fracsame", "simplify"],
  hard: ["fracdiff", "fracmul", "fracdiv", "mixed", "neg", "order"],
}), "SKILLS structure");

/* ---------- per-skill sampling: 3000 samples each ---------- */
const SAMPLES = 3000;
let seed = 1;
for (const tier of ["easy", "medium", "hard"]) {
  for (const skill of GeoMath.SKILLS[tier]) {
    const rng = mulberry32(seed++);
    for (let i = 0; i < SAMPLES; i++) {
      const q = GeoMath.generate(tier, { skill: skill, rng: rng });
      validate(q, tier, skill, "sample " + i);
    }
    console.log("ok " + tier + "/" + skill + ": " + SAMPLES + " samples");
  }
}

/* ---------- generate(tier) without skill, all three tiers ---------- */
for (const tier of ["easy", "medium", "hard"]) {
  const rng = mulberry32(seed++);
  for (let i = 0; i < 200; i++) {
    const q = GeoMath.generate(tier, { rng: rng });
    validate(q, tier, q.skill, "tier-only " + i);
  }
  console.log("ok generate(\"" + tier + "\") without skill: 200 samples");
}

/* ---------- id uniqueness across 10000 calls ---------- */
{
  const rng = mulberry32(0xc0ffee);
  const ids = new Set();
  const tiers = ["easy", "medium", "hard"];
  for (let i = 0; i < 10000; i++) {
    const q = GeoMath.generate(tiers[i % 3], { rng: rng });
    ids.add(q.id);
  }
  check(ids.size === 10000, "id uniqueness: " + ids.size + "/10000 unique");
  console.log("ok id uniqueness: " + ids.size + "/10000");
}

/* ---------- summary ---------- */
console.log("\n" + checks + " checks, " + failures + " failures");
if (failures > 0) {
  console.error("TESTS FAILED");
  process.exit(1);
}
console.log("ALL TESTS PASSED");
