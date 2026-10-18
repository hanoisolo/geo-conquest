/* ============================================================
   ws-validate.js — pure helpers for the worksheet import flow:
   LaTeX cleanup, text normalization, AI JSON extraction,
   sheet normalization, question repair, near-duplicate
   detection and deck merging. Never throws, no DOM.
   ============================================================ */
"use strict";

const GeoWSValidate = {
  cfg() {
    return typeof GeoWSConfig !== "undefined" ? GeoWSConfig : require("./ws-config.js");
  },

  cleanLatex(s) {
    let out = String(s);
    for (let i = 0; i < 5; i++) {
      const next = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2");
      if (next === out) break;
      out = next;
    }
    return out
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√$1")
      .replace(/\^2/g, "²")
      .replace(/\^3/g, "³")
      .replace(/\\times\b/g, "×")
      .replace(/\\div\b/g, "÷")
      .replace(/\$/g, "");
  },

  toText(v) {
    if (typeof v === "string") return v;
    if (typeof v === "number" && isFinite(v)) return String(v);
    if (typeof v === "boolean") return String(v);
    return "";
  },

  clean(v, cap) {
    return GeoWSValidate.cleanLatex(GeoWSValidate.toText(v))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, cap);
  },

  extractJsonText(text) {
    const noFences = String(text).replace(/```[a-zA-Z0-9]*\s*/g, "");
    const start = noFences.indexOf("{");
    const end = noFences.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return noFences;
    return noFences.slice(start, end + 1);
  },

  normalizeSheet(raw) {
    const warnings = [];
    let obj = raw;
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(GeoWSValidate.extractJsonText(raw));
      } catch (e) {
        return {
          ok: false,
          error: { kind: "bad_output", message: "The AI response was not valid JSON." },
          warnings
        };
      }
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return {
        ok: false,
        error: { kind: "bad_output", message: "The AI response was not a JSON object." },
        warnings
      };
    }

    const metaRaw = (typeof obj.meta === "object" && obj.meta !== null) ? obj.meta : {};
    const meta = {
      title: GeoWSValidate.clean(metaRaw.title, GeoWSValidate.cfg().CAPS.title) || "",
      subject: GeoWSValidate.clean(metaRaw.subject, GeoWSValidate.cfg().CAPS.subject) || "General",
      grade: GeoWSValidate.clean(metaRaw.grade !== undefined ? metaRaw.grade : metaRaw.targetGrade, GeoWSValidate.cfg().CAPS.grade) || ""
    };

    let list = Array.isArray(obj.questions) ? obj.questions
      : (Array.isArray(obj.levels) ? obj.levels : []);

    const questions = [];
    list.forEach((item, index) => {
      const repaired = GeoWSValidate.repairQuestion(item, index, warnings);
      if (repaired) questions.push(repaired);
    });

    if (questions.length > GeoWSValidate.cfg().MAX_PER_SHEET) {
      warnings.push("Sheet has more than " + GeoWSValidate.cfg().MAX_PER_SHEET + " questions; keeping the first " + GeoWSValidate.cfg().MAX_PER_SHEET + ".");
      questions.length = GeoWSValidate.cfg().MAX_PER_SHEET;
    }

    if (questions.length === 0) {
      return {
        ok: false,
        error: { kind: "bad_output", message: "No usable questions found on this sheet." },
        warnings
      };
    }

    return { ok: true, value: { meta, questions }, warnings };
  },

  repairQuestion(item, index, warnings) {
    const n = index + 1;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      warnings.push("Dropped question " + n + ": not an object.");
      return null;
    }

    const q = GeoWSValidate.clean(item.q !== undefined ? item.q : item.question, GeoWSValidate.cfg().CAPS.q);

    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options = [];
    const seen = new Set();
    rawOptions.forEach((o) => {
      const text = GeoWSValidate.clean(o, GeoWSValidate.cfg().CAPS.option);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      options.push(text);
    });

    let correct;
    if (Number.isInteger(item.answer) && item.answer >= 0 && item.answer < rawOptions.length) {
      correct = GeoWSValidate.clean(rawOptions[item.answer], GeoWSValidate.cfg().CAPS.option);
    } else {
      correct = GeoWSValidate.clean(item.correctAnswer !== undefined ? item.correctAnswer : item.answer, GeoWSValidate.cfg().CAPS.option);
    }

    if (!q || !correct) {
      warnings.push("Dropped question " + n + ": missing question or answer.");
      return null;
    }

    let correctIndex = -1;
    for (let i = 0; i < options.length; i++) {
      if (options[i].toLowerCase() === correct.toLowerCase()) {
        correctIndex = i;
        break;
      }
    }

    if (correctIndex === -1) {
      if (options.length >= 3) {
        options[options.length - 1] = correct;
        correctIndex = options.length - 1;
        warnings.push("Question " + n + ": correct answer was not among the options; replaced the last option.");
      } else {
        warnings.push("Dropped question " + n + ": fewer than 4 options.");
        return null;
      }
    } else {
      correct = options[correctIndex];
    }

    if (options.length < 4) {
      warnings.push("Dropped question " + n + ": fewer than 4 options.");
      return null;
    }
    if (options.length > 4) {
      const others = options.filter((_, i) => i !== correctIndex).slice(0, 3);
      const kept = [correct].concat(others);
      options.length = 0;
      kept.forEach((o) => options.push(o));
      correctIndex = 0;
      warnings.push("Question " + n + ": more than 4 options; kept the correct answer and the first 3 others.");
    }

    const rawTier = String(item.tier !== undefined ? item.tier : item.difficulty).toLowerCase();
    const tier = (rawTier === "easy" || rawTier === "medium" || rawTier === "hard") ? rawTier : "medium";

    const explain = GeoWSValidate.clean(item.explain !== undefined ? item.explain : item.explanation, GeoWSValidate.cfg().CAPS.explain);

    let hints = [];
    if (Array.isArray(item.hints)) {
      hints = item.hints.map((h) => GeoWSValidate.clean(h, GeoWSValidate.cfg().CAPS.hint)).filter(Boolean).slice(0, 2);
    } else if (typeof item.hint === "string") {
      const h = GeoWSValidate.clean(item.hint, GeoWSValidate.cfg().CAPS.hint);
      if (h) hints = [h];
    }

    const category = GeoWSValidate.clean(item.category, GeoWSValidate.cfg().CAPS.category) || "worksheet";

    return {
      tier,
      q,
      options,
      answer: correctIndex,
      explain,
      hints,
      category
    };
  },

  normKey(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  },

  tokens(s) {
    return new Set(GeoWSValidate.normKey(s).split(" ").filter(Boolean));
  },

  jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    a.forEach((t) => { if (b.has(t)) inter++; });
    const union = a.size + b.size - inter;
    return union === 0 ? 1 : inter / union;
  },

  isDuplicate(a, b) {
    const aCorrect = a.options[a.answer];
    const bCorrect = b.options[b.answer];
    if (GeoWSValidate.normKey(aCorrect) !== GeoWSValidate.normKey(bCorrect)) return false;
    if (GeoWSValidate.normKey(a.q) === GeoWSValidate.normKey(b.q)) return true;
    return GeoWSValidate.jaccard(GeoWSValidate.tokens(a.q), GeoWSValidate.tokens(b.q)) >= GeoWSValidate.cfg().NEAR_DUP_JACCARD;
  },

  mergeSheets(sheets, deckId) {
    const warnings = [];
    const kept = [];
    let duplicates = 0;
    let capWarned = false;

    sheets.forEach((sheet) => {
      if (!sheet || !Array.isArray(sheet.questions)) return;
      sheet.questions.forEach((question) => {
        if (kept.length >= GeoWSValidate.cfg().MAX_PER_DECK) {
          if (!capWarned) {
            warnings.push("Deck reached the maximum of " + GeoWSValidate.cfg().MAX_PER_DECK + " questions; extra questions were dropped.");
            capWarned = true;
          }
          return;
        }
        let dup = null;
        for (let i = 0; i < kept.length; i++) {
          if (GeoWSValidate.isDuplicate(kept[i], question)) {
            dup = kept[i];
            break;
          }
        }
        if (dup) {
          duplicates++;
          if (!dup.explain && question.explain) {
            dup.explain = question.explain;
            if ((!dup.hints || dup.hints.length === 0) && question.hints && question.hints.length) {
              dup.hints = question.hints;
            }
          }
          return;
        }
        kept.push(question);
      });
    });

    const questions = kept.map((question, i) => ({
      id: "WS-" + deckId + "-" + (i + 1),
      source: "worksheet",
      continent: null,
      territory: null,
      type: "text",
      tier: question.tier,
      q: question.q,
      options: question.options,
      answer: question.answer,
      explain: question.explain,
      hints: question.hints,
      category: question.category
    }));

    return { questions, duplicates, warnings };
  },

  deckTitle(sheets, fileNames) {
    for (let i = 0; i < sheets.length; i++) {
      const t = sheets[i] && sheets[i].meta && sheets[i].meta.title;
      if (t) return t;
    }
    if (Array.isArray(fileNames) && fileNames.length) {
      const joined = fileNames
        .map((name) => String(name).replace(/\.[^.]+$/, ""))
        .join(", ");
      const title = GeoWSValidate.clean(joined, GeoWSValidate.cfg().CAPS.title);
      if (title) return title;
    }
    return "My worksheets";
  },

  newDeckId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = GeoWSValidate;
