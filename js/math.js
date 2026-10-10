/* ============================================================
   math.js — procedural grade-7 math question generator for
   Geo Conquest.

   Pure module: no dependencies, no build step. Exposes a
   browser global `GeoMath` and `module.exports` under Node.

     GeoMath.SKILLS                skill ids per tier
     GeoMath.generate(tier, opts)  one multiple-choice question
                                   (opts.skill forces a skill,
                                    opts.rng is a [0,1) source)
     GeoMath.formatFraction(n, d)  "3/4", "-1/2", "2", "1 3/4"

   Question shape:
     { id, type: "math", category: "math", tier, skill, q,
       options, answer, value: { n, d }, operands, hints, explain }

   All arithmetic is exact integer rational arithmetic — no
   floats anywhere, so decimals never print artefacts like
   0.30000000000000004.
   ============================================================ */
(function (global) {
  "use strict";

  /* ================= rng helpers ================= */

  function randInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /* ================= exact rational arithmetic ================= */

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function rat(n, d) {
    if (d === 0) throw new Error("GeoMath: division by zero");
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { n: n / g, d: d / g };
  }

  function rAdd(x, y) { return rat(x.n * y.d + y.n * x.d, x.d * y.d); }
  function rSub(x, y) { return rat(x.n * y.d - y.n * x.d, x.d * y.d); }
  function rEq(x, y) { return x.n === y.n && x.d === y.d; }
  function rCmpInt(x, k) { return x.n - k * x.d; } // sign of (x - k)
  function lcm(a, b) { return (a / gcd(a, b)) * b; }

  /* ================= formatting ================= */

  function formatFraction(n, d) {
    const r = rat(n, d);
    if (r.d === 1) return String(r.n);
    const sign = r.n < 0 ? "-" : "";
    const abs = Math.abs(r.n);
    if (abs < r.d) return sign + abs + "/" + r.d;
    return sign + Math.floor(abs / r.d) + " " + (abs % r.d) + "/" + r.d;
  }

  /* Exact decimal string for a terminating rational, built from
     integers only (never from floats). */
  function formatDecimal(n, d) {
    const r = rat(n, d);
    if (r.d === 1) return String(r.n);
    let dd = r.d, twos = 0, fives = 0;
    while (dd % 2 === 0) { dd /= 2; twos++; }
    while (dd % 5 === 0) { dd /= 5; fives++; }
    if (dd !== 1) return formatFraction(r.n, r.d); // non-terminating
    const places = Math.max(twos, fives);
    const scaled = (r.n * Math.pow(10, places)) / r.d; // exact integer
    const sign = scaled < 0 ? "-" : "";
    const s = String(Math.abs(scaled)).padStart(places + 1, "0");
    return sign + s.slice(0, s.length - places) + "." + s.slice(s.length - places);
  }

  /* ================= distractors & option building ================= */

  /* Near-miss integer fills: correct ± k. */
  function intFill(correct, max, min) {
    const out = [];
    for (let k = 1; k <= 20; k++) {
      for (const delta of [-k, k]) {
        const v = correct + delta;
        if (min !== undefined && v < min) continue;
        if (max !== undefined && v > max) continue;
        out.push(rat(v, 1));
      }
    }
    return out;
  }

  /* Near-miss fraction fills around n/d. */
  function fracFill(n, d) {
    const out = [];
    const push = (nn, dd) => { if (dd > 0) out.push(rat(nn, dd)); };
    push(n - 1, d);
    push(n + 1, d);
    if (d > 1) push(n, d - 1);
    push(n, d + 1);
    push(n - d, d);
    push(n + d, d);
    return out;
  }

  /* Pick 3 distractors from `candidates` (common mistakes first,
     near-miss fills after), guaranteeing: every option differs in
     value from the correct answer and from each other, strings are
     distinct, and (when given) values stay within [min, max]. */
  function buildOptions(rng, correctVal, candidates, fmt, bounds) {
    const correctStr = fmt(correctVal.n, correctVal.d);
    const usedVals = [correctVal];
    const usedStrs = new Set([correctStr]);
    const chosen = [];
    const tryAdd = (cand) => {
      if (chosen.length >= 3) return;
      if (!cand) return;
      if (bounds && bounds.noZero && cand.n === 0) return;
      if (bounds && bounds.min !== undefined && rCmpInt(cand, bounds.min) < 0) return;
      if (bounds && bounds.max !== undefined && rCmpInt(cand, bounds.max) > 0) return;
      if (usedVals.some((v) => rEq(v, cand))) return;
      const str = fmt(cand.n, cand.d);
      if (usedStrs.has(str)) return;
      usedStrs.add(str);
      usedVals.push(cand);
      chosen.push(str);
    };
    for (const cand of candidates) tryAdd(cand);
    let k = 1;
    while (chosen.length < 3 && k <= 500) {
      tryAdd(rAdd(correctVal, rat(-k, 1)));
      tryAdd(rAdd(correctVal, rat(k, 1)));
      k++;
    }
    if (chosen.length < 3) throw new Error("GeoMath: could not build 3 distractors");
    const options = [correctStr].concat(chosen);
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = options[i];
      options[i] = options[j];
      options[j] = t;
    }
    return { options: options, answer: options.indexOf(correctStr) };
  }

  /* ================= word problems (easy/medium, ~1 in 5) ================= */

  /* Real approximate driving distances, rounded to the nearest 10 km.
     Only these exact numbers are ever paired with these city names. */
  const DISTANCES = [
    ["Toronto", "Ottawa", 450],
    ["Toronto", "Montreal", 540],
    ["Paris", "Lyon", 470],
    ["Rome", "Florence", 280],
    ["Sydney", "Melbourne", 880],
    ["Cairo", "Alexandria", 220],
  ];

  /* "1 region", "2 regions" — pass an explicit plural for odd nouns. */
  function plural(n, singular, pluralForm) {
    return n + " " + (n === 1 ? singular : (pluralForm || singular + "s"));
  }

  /* Random integer in [lo, hi] whose last digit is not 0
     (avoids boring "3.0" decimals). */
  function randDecInt(rng, lo, hi) {
    let v = randInt(rng, lo, hi);
    while (v % 10 === 0) v = randInt(rng, lo, hi);
    return v;
  }

  /* Money string with exactly 2 decimals: "$4.70", "$473.00".
     Only called with denominators that divide 100. */
  function formatMoney(n, d) {
    const r = rat(n, d);
    const cents = (r.n * 100) / r.d; // exact integer
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const frac = abs % 100;
    return sign + "$" + whole + "." + String(frac).padStart(2, "0");
  }

  /* ================= column arithmetic helpers ================= */

  const PLACE_NAMES = ["ones", "tens", "hundreds", "thousands"];

  function columnAdd(a, b) {
    const steps = [];
    let carry = 0, aa = a, bb = b, place = 0;
    while (aa > 0 || bb > 0 || carry > 0) {
      const top = aa % 10, bot = bb % 10;
      const sum = top + bot + carry;
      steps.push({
        place: place, top: top, bot: bot, sum: sum,
        carryIn: carry, carryOut: sum >= 10 ? 1 : 0, digit: sum % 10,
      });
      carry = sum >= 10 ? 1 : 0;
      aa = Math.floor(aa / 10);
      bb = Math.floor(bb / 10);
      place++;
    }
    return steps;
  }

  function addStepText(s) {
    const name = PLACE_NAMES[s.place];
    const next = PLACE_NAMES[s.place + 1] || "next column";
    const carried = s.carryIn ? " + 1 (carried)" : "";
    if (s.carryOut) {
      return `Add the ${name}: ${s.top} + ${s.bot}${carried} = ${s.sum}. Write ${s.digit}, carry 1 to the ${next}.`;
    }
    return `Add the ${name}: ${s.top} + ${s.bot}${carried} = ${s.sum}.`;
  }

  /* Common mistake: add digit-wise without carrying. */
  function addNoCarry(a, b) {
    let result = 0, place = 1, aa = a, bb = b;
    while (aa > 0 || bb > 0) {
      result += (((aa % 10) + (bb % 10)) % 10) * place;
      aa = Math.floor(aa / 10);
      bb = Math.floor(bb / 10);
      place *= 10;
    }
    return result;
  }

  function columnSub(a, b) {
    const steps = [];
    let borrow = 0, aa = a, bb = b, place = 0;
    while (aa > 0) {
      const topRaw = aa % 10, bot = bb % 10;
      let top = topRaw - borrow;
      let borrowOut = 0;
      if (top < bot) { top += 10; borrowOut = 1; }
      steps.push({
        place: place, topRaw: topRaw, bot: bot,
        borrowIn: borrow, borrowOut: borrowOut, top: top, result: top - bot,
      });
      borrow = borrowOut;
      aa = Math.floor(aa / 10);
      bb = Math.floor(bb / 10);
      place++;
    }
    return steps;
  }

  function subStepText(s) {
    const name = PLACE_NAMES[s.place];
    const next = PLACE_NAMES[s.place + 1] || "next column";
    const borrowed = s.borrowIn ? " - 1 (borrowed)" : "";
    if (s.borrowOut) {
      return `Subtract the ${name}: ${s.topRaw} - ${s.bot}${borrowed} is too small — borrow 1 from the ${next}: ${s.top} - ${s.bot} = ${s.result}.`;
    }
    return `Subtract the ${name}: ${s.topRaw} - ${s.bot}${borrowed} = ${s.result}.`;
  }

  /* Common mistake: subtract the smaller digit from the bigger one. */
  function subNoBorrow(a, b) {
    let result = 0, place = 1, aa = a, bb = b;
    while (aa > 0) {
      result += Math.abs((aa % 10) - (bb % 10)) * place;
      aa = Math.floor(aa / 10);
      bb = Math.floor(bb / 10);
      place *= 10;
    }
    return result;
  }

  /* ================= decimal column hints ================= */

  function decHints(aInt, bInt, op, scale, money) {
    const den = Math.pow(10, scale);
    const colNames = scale === 2 ? ["hundredths", "tenths"] : ["tenths"];
    const hints = [{ text: "Step 1: Line up the decimal points, then work column by column from the right." }];
    let n = 2;
    let carry = 0;
    for (let c = scale - 1; c >= 0; c--) {
      const place = Math.pow(10, c);
      const da = Math.floor(aInt / place) % 10;
      const db = Math.floor(bInt / place) % 10;
      if (op === "+") {
        const sum = da + db + carry;
        const digit = sum % 10;
        const newCarry = sum >= 10 ? 1 : 0;
        hints.push({ text: `Step ${n++}: Add the ${colNames[c]}: ${da} + ${db}${carry ? " + 1 (carried)" : ""} = ${sum}. Write ${digit}${newCarry ? ", carry 1" : ""}.` });
        carry = newCarry;
      } else {
        let top = da - carry;
        let borrow = 0;
        if (top < db) { top += 10; borrow = 1; }
        hints.push({ text: `Step ${n++}: Subtract the ${colNames[c]}: ${da}${carry ? " - 1 (borrowed)" : ""} - ${db}${borrow ? ` — borrow 1: ${top} - ${db}` : ""} = ${top - db}.` });
        carry = borrow;
      }
    }
    const wa = Math.floor(aInt / den);
    const wb = Math.floor(bInt / den);
    if (op === "+") {
      hints.push({ text: `Step ${n++}: Add the whole numbers: ${wa} + ${wb}${carry ? " + 1 (carried)" : ""} = ${wa + wb + carry}.` });
    } else {
      hints.push({ text: `Step ${n++}: Subtract the whole numbers: ${wa}${carry ? " - 1 (borrowed)" : ""} - ${wb} = ${wa - carry - wb}.` });
    }
    hints.push({ text: money
      ? `Final step: Write your answer with a dollar sign and two decimals!`
      : `Final step: Don't forget the decimal point — write your answer!` });
    return hints;
  }

  /* ================= generators ================= */

  /* ---- easy: add up to 1000 ---- */
  function genAdd(rng) {
    let a, b, q;
    if (rng() < 0.2) {
      const kind = randInt(rng, 0, 2);
      if (kind === 0) {
        // real route: the table distance is one of the addends
        const t = pick(rng, DISTANCES);
        a = t[2];
        b = randInt(rng, 10, 1000 - a);
        q = `A family drives about ${a} km from ${t[0]} to ${t[1]}, then ${b} km more the next day. How far did they drive in total?`;
      } else if (kind === 1) {
        a = randInt(rng, 10, 990);
        b = randInt(rng, 10, 1000 - a);
        q = `A cargo ship sailed ${a} km on Monday and ${b} km on Tuesday. How far did it sail in all?`;
      } else {
        a = randInt(rng, 10, 990);
        b = randInt(rng, 10, 1000 - a);
        q = `A delivery truck drove ${a} km in the morning and ${b} km in the afternoon. How far did it drive in total?`;
      }
    } else {
      a = randInt(rng, 10, 990);
      b = randInt(rng, 10, 1000 - a);
      q = `What is ${a} + ${b}?`;
    }
    const sum = a + b;
    const value = rat(sum, 1);
    const steps = columnAdd(a, b);
    if (steps.length > 3) steps.pop(); // fold the final carry into the hundreds step
    const hints = [{ text: "Step 1: Line up the numbers by place value — ones under ones, tens under tens." }];
    let n = 2;
    for (const s of steps) hints.push({ text: `Step ${n++}: ${addStepText(s)}` });
    hints.push({ text: `Final step: Put the columns together — write the number you get!` });
    return {
      q: q,
      value: value,
      operands: { op: "+", a: rat(a, 1), b: rat(b, 1) },
      hints: hints,
      explain: `${a} + ${b} = ${sum}. Add column by column and carry when a column reaches 10.`,
      candidates: [rat(addNoCarry(a, b), 1), rat(sum - 10, 1), rat(sum + 10, 1), rat(sum - 1, 1), rat(sum + 1, 1)].concat(intFill(sum, 1000, 0)),
      fmt: formatFraction,
      bounds: { min: 0, max: 1000, noZero: true },
    };
  }

  /* ---- easy: subtract, positive result up to 1000 ---- */
  function genSub(rng) {
    let a, b, q;
    if (rng() < 0.2) {
      const kind = randInt(rng, 0, 2);
      if (kind === 0) {
        // two real routes: the longer one is always mentioned first
        let t1 = pick(rng, DISTANCES);
        let t2 = pick(rng, DISTANCES);
        while (t2 === t1) t2 = pick(rng, DISTANCES);
        if (t2[2] > t1[2]) { const t = t1; t1 = t2; t2 = t; }
        a = t1[2];
        b = t2[2];
        q = `The drive from ${t1[0]} to ${t1[1]} is about ${t1[2]} km. The drive from ${t2[0]} to ${t2[1]} is about ${t2[2]} km. How much longer is the first drive?`;
      } else {
        a = randInt(rng, 10, 999);
        b = randInt(rng, 1, a - 1); // strictly smaller: the result is never 0
        q = kind === 1
          ? `A water tank holds ${plural(a, "litre")}. ${plural(b, "litre")} were used to water the garden. How much water is left?`
          : `A classroom library has ${plural(a, "book")}. ${plural(b, "book")} were lent out. How many books are left?`;
      }
    } else {
      a = randInt(rng, 10, 999);
      b = randInt(rng, 1, a - 1); // strictly smaller: the result is never 0
      q = `What is ${a} - ${b}?`;
    }
    const diff = a - b;
    const value = rat(diff, 1);
    const steps = columnSub(a, b);
    const hints = [{ text: "Step 1: Line up the numbers by place value — ones under ones, tens under tens." }];
    let n = 2;
    for (const s of steps) hints.push({ text: `Step ${n++}: ${subStepText(s)}` });
    hints.push({ text: `Final step: Put the columns together — write the number you get!` });
    return {
      q: q,
      value: value,
      operands: { op: "-", a: rat(a, 1), b: rat(b, 1) },
      hints: hints,
      explain: `${a} - ${b} = ${diff}. Subtract column by column and borrow when the top digit is too small.`,
      candidates: [rat(subNoBorrow(a, b), 1), rat(diff - 10, 1), rat(diff + 10, 1), rat(diff - 1, 1), rat(diff + 1, 1)].concat(intFill(diff, 1000, 0)),
      fmt: formatFraction,
      bounds: { min: 0, max: 1000 },
    };
  }

  /* ---- easy: times tables 2-12 ---- */
  function genMul(rng) {
    const a = randInt(rng, 2, 12);
    const b = randInt(rng, 2, 12);
    const prod = a * b;
    const value = rat(prod, 1);
    let q;
    if (rng() < 0.2) {
      q = pick(rng, [
        `A train has ${a} cars. Each car holds ${b} explorers. How many explorers are on the train in all?`,
        `A school has ${a} classes with ${b} students in each class. How many students are there in all?`,
      ]);
    } else {
      q = `What is ${a} × ${b}?`;
    }
    const jumps = [];
    for (let i = 1; i < a; i++) jumps.push(i * b);
    const hints = [
      { text: `Step 1: ${a} × ${b} means ${a} groups of ${b}.` },
      { text: `Step 2: Count by ${b}s, ${a} times: ${jumps.join(", ")}.` },
      { text: `Final step: One more jump lands on your answer!` },
    ];
    const nb1 = Math.min(12, Math.max(2, b - 1));
    const nb2 = Math.min(12, Math.max(2, b + 1));
    return {
      q: q,
      value: value,
      operands: { op: "*", a: rat(a, 1), b: rat(b, 1) },
      hints: hints,
      explain: `${a} × ${b} = ${prod}. Count by ${b}s, ${a} times.`,
      candidates: [rat(a * nb1, 1), rat(a * nb2, 1), rat(a + b, 1)].concat(intFill(prod, 144, 0)),
      fmt: formatFraction,
      bounds: { min: 0, max: 144, noZero: true },
    };
  }

  /* ---- easy: exact division by 2-12 ---- */
  function genDiv(rng) {
    const divisor = randInt(rng, 2, 12);
    const quotient = randInt(rng, 2, 12);
    const dividend = divisor * quotient;
    const value = rat(quotient, 1);
    let q;
    if (rng() < 0.2) {
      q = pick(rng, [
        `${dividend} explorers split into teams of ${divisor}. How many teams are there?`,
        `A guidebook has ${dividend} pages. You read ${divisor} pages each day. How many days will it take to finish?`,
      ]);
    } else {
      q = `What is ${dividend} ÷ ${divisor}?`;
    }
    const jumps = [];
    for (let i = 1; i <= quotient; i++) jumps.push(i * divisor);
    const hints = [
      { text: `Step 1: ${dividend} ÷ ${divisor} asks: how many ${divisor}s fit into ${dividend}?` },
      { text: `Step 2: Count by ${divisor}s until you reach ${dividend}: ${jumps.join(", ")}.` },
      { text: `Final step: Count how many jumps you made — that's your answer!` },
    ];
    return {
      q: q,
      value: value,
      operands: { op: "/", a: rat(dividend, 1), b: rat(divisor, 1) },
      hints: hints,
      explain: `${dividend} ÷ ${divisor} = ${quotient}, because ${quotient} × ${divisor} = ${dividend}.`,
      candidates: [rat(quotient + 1, 1), rat(quotient - 1, 1), rat(dividend, 1)].concat(intFill(quotient, 144, 0)),
      fmt: formatFraction,
      bounds: { min: 0, max: 144, noZero: true },
    };
  }

  /* ---- medium: 2-digit × 2-digit ---- */
  function genMul2(rng) {
    const a = randInt(rng, 10, 99);
    let b = randInt(rng, 11, 99);
    if (b % 10 === 0) b += 1;
    const t = Math.floor(b / 10);
    const u = b % 10;
    const prod = a * b;
    const value = rat(prod, 1);
    let q;
    if (rng() < 0.2) {
      q = pick(rng, [
        `A cargo plane carries ${a} crates. Each crate holds ${b} kg of supplies. How many kilograms of supplies are there in all?`,
        `An orchard has ${plural(a, "row")} of ${plural(b, "apple tree")}. How many apple trees are there in all?`,
      ]);
    } else {
      q = `What is ${a} × ${b}?`;
    }
    const hints = [
      { text: `Step 1: Split ${b} into ${t}0 + ${u}.` },
      { text: `Step 2: Multiply ${a} × ${u} = ${a * u}.` },
      { text: `Step 3: Multiply ${a} × ${t}0 = ${a * t * 10}.` },
      { text: `Step 4: Add the two partial products: ${a * u} + ${a * t * 10}.` },
      { text: `Final step: Add them up — that's your answer!` },
    ];
    return {
      q: q,
      value: value,
      operands: { op: "*", a: rat(a, 1), b: rat(b, 1) },
      hints: hints,
      explain: `${a} × ${b} = ${a * u} + ${a * t * 10} = ${prod}. Multiply the ones, then the tens, then add.`,
      candidates: [rat(a * t + a * u, 1), rat(a * (b + 1), 1), rat(a * (b - 1), 1), rat((a + 1) * b, 1)].concat(intFill(prod)),
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* Common mistake: drop a zero in the middle of the quotient. */
  function droppedZero(q) {
    const s = String(q);
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === "0") return parseInt(s.slice(0, i) + s.slice(i + 1), 10);
    }
    return null;
  }

  /* ---- medium: 3-4 digit ÷ 1-digit exact long division ---- */
  function genDiv2(rng) {
    const divisor = randInt(rng, 2, 9);
    const quotient = randInt(rng, 100, 999);
    const dividend = divisor * quotient;
    const value = rat(quotient, 1);
    let q;
    if (rng() < 0.2) {
      q = pick(rng, [
        `A camp has ${dividend} litres of juice. Each jug holds ${divisor} litres. How many jugs can be filled?`,
        `A relief team has ${dividend} food packs. Each family needs ${divisor} packs. How many families can get food?`,
      ]);
    } else {
      q = `What is ${dividend} ÷ ${divisor}?`;
    }
    const digits = String(dividend).split("").map(Number);
    const hints = [];
    let n = 0;
    let cur = 0;
    for (let i = 0; i < digits.length; i++) {
      cur = cur * 10 + digits[i];
      const dq = Math.floor(cur / divisor);
      const prod = dq * divisor;
      let text;
      if (dq === 0) {
        text = i === 0
          ? `${divisor} does not go into ${cur} yet — write 0 and bring down the next digit.`
          : `Bring down the ${digits[i]} to make ${cur}. ${divisor} does not go into ${cur} — write 0.`;
      } else if (i === 0) {
        text = `Start with ${cur}. ${divisor} × ${dq} = ${prod}. Write ${dq}. ${cur} - ${prod} = ${cur - prod}.`;
      } else {
        text = `Bring down the ${digits[i]} to make ${cur}. ${divisor} × ${dq} = ${prod}. Write ${dq}. ${cur} - ${prod} = ${cur - prod}.`;
      }
      hints.push({ text: `Step ${++n}: ${text}` });
      cur -= prod;
    }
    hints.push({ text: `Final step: Read the digits you wrote, in order — that's your answer!` });
    const candidates = [rat(quotient + 1, 1), rat(quotient - 1, 1), rat(dividend, 1)];
    const dz = droppedZero(quotient);
    if (dz !== null) candidates.push(rat(dz, 1));
    candidates.push.apply(candidates, intFill(quotient));
    return {
      q: q,
      value: value,
      operands: { op: "/", a: rat(dividend, 1), b: rat(divisor, 1) },
      hints: hints,
      explain: `${dividend} ÷ ${divisor} = ${quotient}. Check: ${quotient} × ${divisor} = ${dividend}.`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- medium: decimals add/subtract, 1-2 decimal places ---- */
  function genDec(rng) {
    const scale = rng() < 0.5 ? 1 : 2;
    const den = Math.pow(10, scale);
    // word-problem kinds: 0 money +, 1 money -, 2 rope +, 3 rope -
    const kind = rng() < 0.2 ? randInt(rng, 0, 3) : -1;
    const op = (kind === 1 || kind === 3) ? "-" : (kind === 0 || kind === 2) ? "+" : rng() < 0.5 ? "+" : "-";
    let aInt, bInt;
    if (op === "+") {
      aInt = randDecInt(rng, den, den * 10 - 1);
      bInt = randDecInt(rng, den, den * 10 - 1);
    } else {
      aInt = randDecInt(rng, den + 2, den * 10 - 1);
      bInt = randDecInt(rng, den, aInt - 1); // strictly smaller: the result is never 0
    }
    const sumInt = op === "+" ? aInt + bInt : aInt - bInt;
    const value = rat(sumInt, den);
    const aStr = formatDecimal(aInt, den);
    const bStr = formatDecimal(bInt, den);
    const money = kind === 0 || kind === 1;
    const aM = formatMoney(aInt, den);
    const bM = formatMoney(bInt, den);
    let q;
    if (kind === 0) {
      q = pick(rng, [
        `A museum ticket costs ${aM} and a snack costs ${bM}. How much do they cost together?`,
        `You buy a map for ${aM} and a compass for ${bM}. What is the total cost?`,
      ]);
    } else if (kind === 1) {
      q = `You have ${aM}. You spend ${bM}. How much money is left?`;
    } else if (kind === 2) {
      q = `A rope is ${aStr} m long. You tie on ${bStr} m more. How long is the rope now?`;
    } else if (kind === 3) {
      q = `A rope is ${aStr} m long. You cut off ${bStr} m. How much rope is left?`;
    } else {
      q = `What is ${aStr} ${op} ${bStr}?`;
    }
    const candidates = [];
    if (scale === 2) candidates.push(rat(sumInt, den / 10)); // decimal point one place off
    candidates.push(rat(sumInt, 1)); // forgot the decimal point entirely
    candidates.push(rat(sumInt - 1, den), rat(sumInt + 1, den)); // off by one in the last place
    candidates.push(rat(sumInt - 10, den), rat(sumInt + 10, den));
    for (const k of [2, 3, 5, 20, 50, 100]) {
      candidates.push(rat(sumInt - k, den), rat(sumInt + k, den));
    }
    return {
      q: q,
      value: value,
      operands: { op: op, a: rat(aInt, den), b: rat(bInt, den) },
      hints: decHints(aInt, bInt, op, scale, money),
      explain: money
        ? `${aM} ${op} ${bM} = ${formatMoney(sumInt, den)}. Line up the decimal points, then work column by column.`
        : `${aStr} ${op} ${bStr} = ${formatDecimal(sumInt, den)}. Line up the decimal points, then work column by column.`,
      candidates: candidates,
      fmt: money ? formatMoney : formatDecimal,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- medium: fractions with the SAME denominator ---- */
  function genFracSame(rng) {
    const op = rng() < 0.5 ? "+" : "-";
    // denominators >= 3; d = 3 has no valid strict subtraction, so use 4..12 there
    const d = op === "+" ? randInt(rng, 3, 12) : randInt(rng, 4, 12);
    // subtraction needs an >= 3 so a valid bn exists (an > bn, an !== 2*bn)
    let an = randInt(rng, op === "-" ? 3 : 1, d - 1);
    while (gcd(an, d) !== 1) an = randInt(rng, op === "-" ? 3 : 1, d - 1);
    let bn;
    if (op === "-") {
      // an > bn strictly (result never 0) and an !== 2*bn (result never equals b)
      bn = randInt(rng, 1, an - 1);
      while (gcd(bn, d) !== 1 || an === 2 * bn) bn = randInt(rng, 1, an - 1);
    } else {
      bn = randInt(rng, 1, d - 1);
      while (gcd(bn, d) !== 1) bn = randInt(rng, 1, d - 1);
    }
    const ns = op === "+" ? an + bn : an - bn;
    const value = rat(ns, d);
    const answerStr = formatFraction(ns, d);
    let q;
    const wantWord = rng() < 0.2;
    if (wantWord && op === "+" && an + bn < d) {
      // parts never add up to the whole island
      q = `An island is split into ${plural(d, "equal region")}. Forest covers ${plural(an, "region")} and farmland covers ${plural(bn, "region")}. What fraction of the island is forest or farmland together?`;
    } else if (wantWord && op === "-") {
      q = `A tank at a desert oasis is ${an}/${d} full of water. Travellers use ${bn}/${d} of the tank. What fraction of the water is left?`;
    } else {
      q = `What is ${an}/${d} ${op} ${bn}/${d}?`;
    }
    const hints = [
      { text: `Step 1: The bottoms (denominators) are the same — both ${d}. Keep the bottom!`, bars: [
        { n: an, d: d, label: `${an}/${d}` },
        { n: bn, d: d, label: `${bn}/${d}` },
      ] },
      { text: `Step 2: ${op === "+" ? "Add" : "Subtract"} the tops: ${an} ${op} ${bn} = ${ns}, so you have ${ns}/${d}.` },
      { text: `Final step: Write your answer in simplest form!` },
    ];
    const candidates = op === "+"
      ? [rat(an + bn, d + d), rat(an + bn, 1), an !== bn ? rat(an - bn, d) : rat(an + bn + 1, d)]
      : [rat(an + bn, d), rat(an - bn, 1), rat(an - bn, d + d)];
    candidates.push.apply(candidates, fracFill(ns, d));
    return {
      q: q,
      value: value,
      operands: { op: op, a: rat(an, d), b: rat(bn, d) },
      hints: hints,
      explain: `${an}/${d} ${op} ${bn}/${d} = ${ns}/${d}` + (answerStr !== `${ns}/${d}` ? ` = ${answerStr}` : ``) + `. When the bottoms match, keep the bottom and ${op === "+" ? "add" : "subtract"} the tops.`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- medium: simplify a fraction ---- */
  function genSimplify(rng) {
    const g = randInt(rng, 2, 12);
    const m = randInt(rng, 2, Math.floor(24 / g));
    const d = g * m;
    let k = randInt(rng, 1, m - 1);
    while (gcd(k, m) !== 1) k = randInt(rng, 1, m - 1);
    const n = g * k;
    const value = rat(n, d);
    const answerStr = formatFraction(n, d);
    let q;
    if (rng() < 0.2) {
      q = `A map shows that ${n}/${d} of a country's coastline is sandy beach. Write this fraction in simplest form.`;
    } else {
      q = `Simplify the fraction ${n}/${d}.`;
    }
    const hints = [
      { text: `Step 1: Find the biggest number that goes into both ${n} and ${d}. It is ${g}!`, bars: [{ n: n, d: d, label: `${n}/${d}` }] },
      { text: `Step 2: Divide the top and the bottom by ${g}: ${n} ÷ ${g} = ${n / g} and ${d} ÷ ${g} = ${d / g}.` },
      { text: `Final step: Write the new fraction — that's your answer!` },
    ];
    const candidates = [rat(n / g, d), rat(n, d / g), rat(n * g, d * g)];
    if (d - g > 1) candidates.push(rat(n - g, d - g));
    candidates.push.apply(candidates, fracFill(value.n, value.d));
    return {
      q: q,
      value: value,
      operands: { op: "simplify", a: { n: n, d: d }, b: rat(1, 1) }, // a is the unreduced fraction
      hints: hints,
      explain: `${n}/${d} simplifies to ${answerStr} — divide the top and the bottom by ${g}.`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- hard: fractions with DIFFERENT denominators ---- */
  function genFracDiff(rng) {
    for (;;) {
    let d1 = randInt(rng, 3, 12);
    let d2 = randInt(rng, 3, 12);
    while (d2 === d1) d2 = randInt(rng, 3, 12);
    let an = randInt(rng, 1, d1 - 1);
    while (gcd(an, d1) !== 1) an = randInt(rng, 1, d1 - 1);
    let bn = randInt(rng, 1, d2 - 1);
    while (gcd(bn, d2) !== 1) bn = randInt(rng, 1, d2 - 1);
    const op = rng() < 0.5 ? "+" : "-";
    if (op === "-" && an * d2 < bn * d1) {
      const td = d1; d1 = d2; d2 = td;
      const tn = an; an = bn; bn = tn;
    }
    // for subtraction, a = 2*b would make the result equal operand b — redraw
    if (op === "-" && an * d2 === 2 * bn * d1) continue;
    const L = lcm(d1, d2);
    const na = an * (L / d1);
    const nb = bn * (L / d2);
    const ns = op === "+" ? na + nb : na - nb;
    const value = rat(ns, L);
    const answerStr = formatFraction(ns, L);
    const q = `What is ${an}/${d1} ${op} ${bn}/${d2}?`;
    // Conversion steps are skipped when a fraction already has the common bottom (no "7/9 = 7/9" steps).
    const conv = [];
    if (L !== d1) conv.push({ text: `${an}/${d1} = ${na}/${L} (multiply the top and bottom by ${L / d1}).`, bars: L <= 24 ? [{ n: na, d: L, label: `${na}/${L}` }] : undefined });
    if (L !== d2) conv.push({ text: `${bn}/${d2} = ${nb}/${L} (multiply the top and bottom by ${L / d2}).`, bars: L <= 24 ? [{ n: nb, d: L, label: `${nb}/${L}` }] : undefined });
    const keep = L === d1 ? `${an}/${d1}` : L === d2 ? `${bn}/${d2}` : "";
    const steps = [
      { text: `The bottoms (denominators) are ${d1} and ${d2}. Find a number both go into: ${L}.` + (keep ? ` ${keep} already has ${L} on the bottom, so it stays the same.` : ""), bars: [
        { n: an, d: d1, label: `${an}/${d1}` },
        { n: bn, d: d2, label: `${bn}/${d2}` },
      ] },
      ...conv,
      { text: `${op === "+" ? "Add" : "Subtract"} the tops: ${na} ${op} ${nb} = ${ns}, so you have ${ns}/${L}.` },
    ];
    const hints = steps.map((h, i) => {
      const o = { text: `Step ${i + 1}: ${h.text}` };
      if (h.bars) o.bars = h.bars;
      return o;
    });
    hints.push({ text: `Final step: Write your answer in simplest form!` });
    const candidates = [
      rat(op === "+" ? an + bn : an - bn, d1 + d2), // played with the bottoms too
      rat(op === "+" ? na + bn : na - bn, L),       // forgot to convert the second top
      rat(op === "+" ? an + nb : an - nb, L),       // forgot to convert the first top
    ];
    candidates.push.apply(candidates, fracFill(ns, L));
    return {
      q: q,
      value: value,
      operands: { op: op, a: rat(an, d1), b: rat(bn, d2) },
      hints: hints,
      explain: `${an}/${d1} ${op} ${bn}/${d2} = ${na}/${L} ${op} ${nb}/${L} = ${ns}/${L}` + (answerStr !== `${ns}/${L}` ? ` = ${answerStr}` : ``) + `. Find a common bottom first!`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
    }
  }

  /* ---- hard: multiply fractions ---- */
  function genFracMul(rng) {
    const b = randInt(rng, 2, 9);
    const d = randInt(rng, 2, 9);
    let an = randInt(rng, 1, b - 1);
    while (gcd(an, b) !== 1) an = randInt(rng, 1, b - 1);
    let cn = randInt(rng, 1, d - 1);
    while (gcd(cn, d) !== 1) cn = randInt(rng, 1, d - 1);
    const value = rat(an * cn, b * d);
    const answerStr = formatFraction(an * cn, b * d);
    const q = `What is ${an}/${b} × ${cn}/${d}?`;
    const hints = [
      { text: `Step 1: Multiply the tops: ${an} × ${cn} = ${an * cn}.`, bars: [
        { n: an, d: b, label: `${an}/${b}` },
        { n: cn, d: d, label: `${cn}/${d}` },
      ] },
      { text: `Step 2: Multiply the bottoms: ${b} × ${d} = ${b * d}.` },
      { text: `Step 3: So ${an}/${b} × ${cn}/${d} = ${an * cn}/${b * d}.` },
      { text: `Final step: Simplify your fraction — write your answer in simplest form!` },
    ];
    const candidates = [rat(an * cn, b), rat(an, b * d), rat(an + cn, b + d)];
    candidates.push.apply(candidates, fracFill(value.n, value.d));
    return {
      q: q,
      value: value,
      operands: { op: "*", a: rat(an, b), b: rat(cn, d) },
      hints: hints,
      explain: `${an}/${b} × ${cn}/${d} = ${an * cn}/${b * d}` + (answerStr !== `${an * cn}/${b * d}` ? ` = ${answerStr}` : ``) + `. Multiply the tops, multiply the bottoms, then simplify.`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- hard: divide fractions ---- */
  function genFracDiv(rng) {
    const b = randInt(rng, 2, 9);
    const d = randInt(rng, 2, 9);
    let an = randInt(rng, 1, b - 1);
    while (gcd(an, b) !== 1) an = randInt(rng, 1, b - 1);
    let cn = randInt(rng, 1, d - 1);
    while (gcd(cn, d) !== 1) cn = randInt(rng, 1, d - 1);
    const value = rat(an * d, b * cn);
    const answerStr = formatFraction(an * d, b * cn);
    const q = `What is ${an}/${b} ÷ ${cn}/${d}?`;
    const hints = [
      { text: `Step 1: Dividing by a fraction means multiplying by its flip (reciprocal)!`, bars: [
        { n: an, d: b, label: `${an}/${b}` },
        { n: cn, d: d, label: `${cn}/${d}` },
      ] },
      { text: `Step 2: Flip ${cn}/${d} to get ${d}/${cn}.` },
      { text: `Step 3: Now multiply: ${an}/${b} × ${d}/${cn}.` },
      { text: `Step 4: Multiply the tops: ${an} × ${d} = ${an * d}. Multiply the bottoms: ${b} × ${cn} = ${b * cn}.` },
      { text: `Final step: Write your answer in simplest form!` },
    ];
    const candidates = [rat(an * cn, b * d), rat(cn * b, d * an), rat(an + cn, b + d)];
    candidates.push.apply(candidates, fracFill(value.n, value.d));
    return {
      q: q,
      value: value,
      operands: { op: "/", a: rat(an, b), b: rat(cn, d) },
      hints: hints,
      explain: `${an}/${b} ÷ ${cn}/${d} = ${an}/${b} × ${d}/${cn} = ${an * d}/${b * cn}` + (answerStr !== `${an * d}/${b * cn}` ? ` = ${answerStr}` : ``) + `. Flip the second fraction, then multiply!`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- hard: add mixed numbers ---- */
  function genMixed(rng) {
    const w1 = randInt(rng, 1, 5);
    const w2 = randInt(rng, 1, 5);
    const b = randInt(rng, 2, 9);
    const d = randInt(rng, 2, 9);
    let an = randInt(rng, 1, b - 1);
    while (gcd(an, b) !== 1) an = randInt(rng, 1, b - 1);
    let cn = randInt(rng, 1, d - 1);
    while (gcd(cn, d) !== 1) cn = randInt(rng, 1, d - 1);
    const A = rat(w1 * b + an, b);
    const B = rat(w2 * d + cn, d);
    const value = rAdd(A, B);
    const answerStr = formatFraction(value.n, value.d);
    const L = lcm(b, d);
    const na = an * (L / b);
    const nb = cn * (L / d);
    const ns = na + nb;
    const wholes = w1 + w2;
    const q = `What is ${w1} ${an}/${b} + ${w2} ${cn}/${d}?`;
    const convParts = [];
    if (L !== b) convParts.push(`${an}/${b} = ${na}/${L}`);
    if (L !== d) convParts.push(`${cn}/${d} = ${nb}/${L}`);
    const h3 = { text: `Step 3: ${convParts.length ? convParts.join(" and ") + ", so " : ""}${na}/${L} + ${nb}/${L}: ${na} + ${nb} = ${ns}, giving ${ns}/${L}.` };
    if (ns <= L && L <= 24) h3.bars = [{ n: ns, d: L, label: `${ns}/${L}` }];
    const hints = [
      { text: `Step 1: Add the whole numbers: ${w1} + ${w2} = ${wholes}.` },
      { text: `Step 2: Now add the fractions ${an}/${b} + ${cn}/${d}. Find a common bottom: ${L}.`, bars: [
        { n: an, d: b, label: `${an}/${b}` },
        { n: cn, d: d, label: `${cn}/${d}` },
      ] },
      h3,
      { text: ns >= L
        ? `Step 4: ${ns}/${L} is more than 1 whole — turn it into a mixed number and add the extra whole to ${wholes}.`
        : `Step 4: Put it together: ${wholes} wholes and ${ns}/${L}.` },
      { text: `Final step: Write the whole number and the fraction together as a mixed number!` },
    ];
    const candidates = [
      rat(wholes * (b + d) + an + cn, b + d), // added the bottoms too
      rat(wholes * b + an + cn, b),           // kept the first bottom only
      rat((wholes + 1) * L + (ns % L), L),    // one whole too many
    ];
    candidates.push.apply(candidates, fracFill(value.n, value.d));
    return {
      q: q,
      value: value,
      operands: { op: "+", a: A, b: B },
      hints: hints,
      explain: `${w1} ${an}/${b} + ${w2} ${cn}/${d} = ${wholes} wholes and ${ns}/${L} = ${answerStr}. Add the wholes, add the fractions, then combine!`,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { min: 0, noZero: true },
    };
  }

  /* ---- hard: integers with negatives (+, -, x) ---- */
  function genNeg(rng) {
    const op = pick(rng, ["+", "-", "x"]);
    const magA = op === "x" ? randInt(rng, 2, 12) : randInt(rng, 1, 12);
    const magB = op === "x" ? randInt(rng, 2, 12) : randInt(rng, 1, 12);
    let a = rng() < 0.5 ? -magA : magA;
    let b = rng() < 0.5 ? -magB : magB;
    if (a > 0 && b > 0) a = -a; // at least one negative
    const value = op === "+" ? rat(a + b, 1) : op === "-" ? rat(a - b, 1) : rat(a * b, 1);
    const opSym = op === "x" ? "×" : op;
    let q;
    if (op === "-" && b < 0) q = `What is ${a} - (${b})?`;
    else q = `What is ${a} ${opSym} ${b}?`;
    let hints, explain;
    if (op === "+") {
      if (a < 0 && b < 0) {
        hints = [
          { text: `Step 1: Start at ${a} on the number line.` },
          { text: `Step 2: Adding ${b} means ${-b} more steps to the left.` },
          { text: `Final step: How far left of the start do you land? Add the sizes and keep the minus sign!` },
        ];
        explain = `${a} + ${b} = ${value.n}. Adding two negatives gives a bigger negative.`;
      } else {
        const neg = a < 0 ? a : b;
        const pos = a < 0 ? b : a;
        hints = [
          { text: `Step 1: Start at ${neg} on the number line.` },
          { text: `Step 2: Adding ${pos} means ${pos} steps to the right.` },
          { text: `Final step: Count the steps to the right — where do you land?` },
        ];
        explain = `${a} + ${b} = ${value.n}. Start at the negative number and hop to the right.`;
      }
    } else if (op === "-") {
      if (b < 0) {
        hints = [
          { text: `Step 1: ${a} - (${b}) — you are subtracting a negative!` },
          { text: `Step 2: Subtracting a negative is the same as adding: ${a} + ${-b}.` },
          { text: `Final step: Add them up — that's your answer!` },
        ];
        explain = `${a} - (${b}) = ${a} + ${-b} = ${value.n}. Subtracting a negative is the same as adding!`;
      } else {
        hints = [
          { text: `Step 1: Start at ${a} on the number line.` },
          { text: `Step 2: Subtracting ${b} means ${b} steps to the left.` },
          { text: `Final step: Count the steps to the left — where do you land?` },
        ];
        explain = `${a} - ${b} = ${value.n}. Start at ${a} and hop ${b} steps to the left.`;
      }
    } else {
      if (a < 0 && b < 0) {
        hints = [
          { text: `Step 1: ${a} × ${b} — two negatives!` },
          { text: `Step 2: First find ${-a} × ${-b} = ${(-a) * (-b)}.` },
          { text: `Final step: Two negatives make a positive — what sign does your answer get?` },
        ];
        explain = `${a} × ${b} = ${value.n}. Two negatives make a positive.`;
      } else {
        hints = [
          { text: `Step 1: ${a} × ${b} — one negative and one positive.` },
          { text: `Step 2: First find ${Math.abs(a)} × ${Math.abs(b)} = ${Math.abs(a * b)}.` },
          { text: `Final step: One negative means the answer is negative — put the minus sign in front!` },
        ];
        explain = `${a} × ${b} = ${value.n}. One negative makes the answer negative.`;
      }
    }
    const pool = [];
    if (op === "+") {
      pool.push(rat(a - b, 1), rat(-(a + b), 1), rat(b - a, 1), rat(Math.abs(a) + Math.abs(b), 1), rat(Math.abs(a) - Math.abs(b), 1));
    } else if (op === "-") {
      pool.push(rat(a + b, 1), rat(b - a, 1), rat(-(a - b), 1), rat(Math.abs(a) + Math.abs(b), 1), rat(Math.abs(a) - Math.abs(b), 1));
    } else {
      pool.push(rat(Math.abs(a) * Math.abs(b), 1), rat(-Math.abs(a) * Math.abs(b), 1), rat(Math.abs(a) + Math.abs(b), 1), rat(Math.abs(a) - Math.abs(b), 1));
    }
    const candidates = pool.concat(intFill(value.n));
    return {
      q: q,
      value: value,
      operands: { op: op === "x" ? "*" : op, a: rat(a, 1), b: rat(b, 1) },
      hints: hints,
      explain: explain,
      candidates: candidates,
      fmt: formatFraction,
      bounds: {},
    };
  }

  /* ---- hard: order of operations ---- */
  function genOrder(rng) {
    const kind = randInt(rng, 0, 3);
    let a, b, c, expr, qText, value, hints, explain, wrong;
    if (kind === 0) {
      a = randInt(rng, 1, 9);
      b = randInt(rng, 2, 9);
      c = randInt(rng, 2, 9);
      expr = `${a} + ${b} * ${c}`;
      qText = `What is ${a} + ${b} × ${c}?`;
      value = rat(a + b * c, 1);
      hints = [
        { text: `Step 1: No brackets — multiply first! ${b} × ${c} = ${b * c}.` },
        { text: `Step 2: Now add: ${a} + ${b * c}.` },
        { text: `Final step: Finish the addition — that's your answer!` },
      ];
      wrong = rat((a + b) * c, 1); // worked left-to-right
      explain = `${a} + ${b} × ${c} = ${a} + ${b * c} = ${value.n}. Multiply before you add!`;
    } else if (kind === 1) {
      a = randInt(rng, 3, 12);
      b = randInt(rng, 1, a - 1);
      c = randInt(rng, 2, 9);
      expr = `(${a} - ${b}) * ${c}`;
      qText = `What is (${a} - ${b}) × ${c}?`;
      value = rat((a - b) * c, 1);
      hints = [
        { text: `Step 1: Brackets first! (${a} - ${b}) = ${a - b}.` },
        { text: `Step 2: Then multiply: ${a - b} × ${c}.` },
        { text: `Final step: Finish the multiplication — that's your answer!` },
      ];
      wrong = rat(a - b * c, 1); // ignored the brackets
      explain = `(${a} - ${b}) × ${c} = ${a - b} × ${c} = ${value.n}. Brackets first!`;
    } else if (kind === 2) {
      a = randInt(rng, 2, 9);
      b = randInt(rng, 2, 9);
      c = randInt(rng, 1, 9);
      expr = `${a} * ${b} + ${c}`;
      qText = `What is ${a} × ${b} + ${c}?`;
      value = rat(a * b + c, 1);
      hints = [
        { text: `Step 1: No brackets — multiply first! ${a} × ${b} = ${a * b}.` },
        { text: `Step 2: Now add: ${a * b} + ${c}.` },
        { text: `Final step: Finish the addition — that's your answer!` },
      ];
      wrong = rat(a * (b + c), 1); // worked left-to-right
      explain = `${a} × ${b} + ${c} = ${a * b} + ${c} = ${value.n}. Multiply before you add!`;
    } else {
      c = randInt(rng, 2, 9);
      const qq = randInt(rng, 1, 9);
      b = c * qq;
      a = randInt(rng, qq + 1, 20);
      expr = `${a} - ${b} / ${c}`;
      qText = `What is ${a} - ${b} ÷ ${c}?`;
      value = rat(a - qq, 1);
      hints = [
        { text: `Step 1: No brackets — divide first! ${b} ÷ ${c} = ${qq}.` },
        { text: `Step 2: Now subtract: ${a} - ${qq}.` },
        { text: `Final step: Finish the subtraction — that's your answer!` },
      ];
      wrong = rat(a - b, c); // worked left-to-right
      explain = `${a} - ${b} ÷ ${c} = ${a} - ${qq} = ${value.n}. Divide before you subtract!`;
    }
    const candidates = [wrong, rat(value.n + 1, 1), rat(value.n - 1, 1)];
    if (kind === 0 || kind === 2) candidates.push(rat(a + b + c, 1));
    candidates.push.apply(candidates, intFill(value.n));
    return {
      q: qText,
      value: value,
      operands: { op: "order", a: rat(a, 1), b: rat(b, 1), c: rat(c, 1), expr: expr },
      hints: hints,
      explain: explain,
      candidates: candidates,
      fmt: formatFraction,
      bounds: { noZero: true },
    };
  }

  /* ================= public API ================= */

  const GENERATORS = {
    add: genAdd, sub: genSub, mul: genMul, div: genDiv,
    mul2: genMul2, div2: genDiv2, dec: genDec, fracsame: genFracSame, simplify: genSimplify,
    fracdiff: genFracDiff, fracmul: genFracMul, fracdiv: genFracDiv, mixed: genMixed,
    neg: genNeg, order: genOrder,
  };

  function makeQuestion(rng, tier, skill, gen) {
    const b = gen(rng);
    const built = buildOptions(rng, b.value, b.candidates, b.fmt, b.bounds);
    let suffix = "";
    for (let i = 0; i < 6; i++) suffix += Math.floor(rng() * 36).toString(36);
    return {
      id: "MATH-" + skill + "-" + suffix,
      type: "math",
      category: "math",
      tier: tier,
      skill: skill,
      q: b.q,
      options: built.options,
      answer: built.answer,
      value: b.value,
      operands: b.operands,
      hints: b.hints,
      explain: b.explain,
    };
  }

  function generate(tier, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const skills = GeoMath.SKILLS[tier];
    if (!skills) throw new Error("GeoMath.generate: unknown tier '" + tier + "'");
    const skill = opts.skill || skills[Math.floor(rng() * skills.length)];
    const gen = GENERATORS[skill];
    if (!gen) throw new Error("GeoMath.generate: unknown skill '" + skill + "'");
    return makeQuestion(rng, tier, skill, gen);
  }

  const GeoMath = {
    SKILLS: {
      easy: ["add", "sub", "mul", "div"],
      medium: ["mul2", "div2", "dec", "fracsame", "simplify"],
      hard: ["fracdiff", "fracmul", "fracdiv", "mixed", "neg", "order"],
    },
    generate: generate,
    formatFraction: formatFraction,
  };

  if (typeof module !== "undefined") module.exports = GeoMath;
  global.GeoMath = GeoMath;
})(typeof window !== "undefined" ? window : globalThis);
