/* ============================================================
   game.js — Geo Conquest game engine.

   Owns the campaign state, question selection, contest
   resolution, the Baron von Blunder rival AI, continent
   unlocking, win conditions, and all screen/modal rendering.

   Screens:  start -> pick-continent -> game (+ modals)
   Save shape (localStorage, see storage.js):
     { version, mode, activeContinent, unlocked[], conquered[],
       ownership{iso3:'player'|'rival'}, points, streak, bestStreak,
       contests, correct, asked[], homeBase, pendingChoice,
       geoSinceMath, hintsUsed, stats{byCategory{cat:{asked,correct}}} }
   ============================================================ */
"use strict";

const GeoGame = {
  /* ---- static data (injected by app.js at boot) ---- */
  geojson: null,        // FeatureCollection of countries
  continents: [],       // [{id,name,territories:[{iso3,name}]}]
  questions: [],        // question bank
  nameOf: {},           // iso3 -> display name
  contOf: {},           // iso3 -> continent id
  contNameOf: {},       // continent id -> display name
  playableIsos: new Set(), // every playable territory iso3 (map markers + labels)

  /* ---- mutable campaign state ---- */
  state: null,
  mode: "solo",         // "solo" | "multi" (GeoMulti owns multiplayer state)
  pickingHome: false,   // true while the player plants their first flag
  currentContest: null, // { iso3, tier, subject, nudged, question, options, answerIdx, ... }
  contestHook: null,    // multiplayer: GeoMulti.onContestDone receives the resolved contest
  selectedSubject: "geo", // "geo" | "math" — chosen on the territory card
  nameVariantsOf: {},   // iso3 -> Set of normalized name spellings (giveaway check)
  _toastQueue: [],      // pending toast messages (shown one after another)
  _toastBusy: false,

  TIER_POINTS: { easy: 10, medium: 20, hard: 30 },
  TIER_LABEL: { easy: "Easy", medium: "Medium", hard: "Hard" },
  CONT_EMOJI: {
    "north-america": "🦅", "south-america": "🦜", "europe": "🏰",
    "africa": "🦁", "asia": "🐉", "oceania": "🦘",
  },
  PRAISE: [
    "Brilliant! 🎉", "You nailed it! 🌟", "Superb — your empire grows! 🗺️",
    "Geography genius! 🧠", "Exactly right! Onward! ⚔️", "Magnificent! 🏆",
  ],
  COMFORT: [
    "Good try! Every explorer misses sometimes. 🧭",
    "So close! You'll conquer the next one. 💪",
    "No worries — even great conquerors learn from mistakes. 📚",
    "Tough one! Here's the scoop: 👇",
  ],
  RIVAL_NAME: "Baron von Blunder",

  /* ================= boot ================= */
  init(data) {
    this.geojson = data.geojson;
    this.continents = data.territories.continents;
    this.questions = data.questions;
    for (const c of this.continents) {
      this.contNameOf[c.id] = c.name;
      for (const t of c.territories) {
        this.nameOf[t.iso3] = t.name;
        this.contOf[t.iso3] = c.id;
        this.playableIsos.add(t.iso3);
      }
    }
    // Also index every rendered country name for tooltips.
    for (const f of this.geojson.features) {
      const iso = f.properties.iso3;
      if (iso && !this.nameOf[iso]) this.nameOf[iso] = f.properties.name;
    }
    // Name spellings per country (territory names + capital-table names),
    // used to spot "giveaway" questions whose answer is the country itself.
    this.nameVariantsOf = {};
    const addVariant = (iso3, name) => {
      if (!iso3 || !name) return;
      if (!this.nameVariantsOf[iso3]) this.nameVariantsOf[iso3] = new Set();
      this.nameVariantsOf[iso3].add(this.normName(name));
    };
    for (const c of this.continents)
      for (const t of c.territories) addVariant(t.iso3, t.name);
    if (data.capitals && Array.isArray(data.capitals.countries)) {
      for (const c of data.capitals.countries) addVariant(c.iso3, c.name);
    }
    GeoMap.onTerritoryClick = (iso3) => (this.mode === "multi" ? GeoMulti.onTerritoryClick(iso3) : this.onTerritoryClick(iso3));
  },

  /* ================= campaign setup ================= */
  newCampaign(mode) {
    this.mode = "solo"; document.body.classList.remove("mp-mode");
    this.state = {
      version: GeoStorage.SAVE_VERSION, mode,
      activeContinent: null, unlocked: [], conquered: [],
      ownership: {}, points: 0, streak: 0, bestStreak: 0,
      contests: 0, correct: 0, asked: [], homeBase: null,
      pendingChoice: false, geoSinceMath: 0, hintsUsed: 0,
      stats: { byCategory: {} },
    };
    this.persist();
    this.showContinentPicker("start");
  },

  continueCampaign() {
    this.mode = "solo"; document.body.classList.remove("mp-mode");
    const s = GeoStorage.load();
    if (!s) return;
    this.state = s;
    this.enterGame(this.state.homeBase == null);
    this.resumePendingChoice();
  },

  showContinentPicker(purpose) {
    // purpose: "start" (choose first continent) or "unlock" (choose next)
    const grid = purpose === "start"
      ? document.getElementById("continent-cards")
      : document.getElementById("unlock-cards");
    grid.innerHTML = "";
    for (const c of this.continents) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "continent-card";
      const locked = purpose === "unlock" && this.state.unlocked.includes(c.id);
      btn.disabled = locked;
      btn.innerHTML =
        `<div class="c-emoji">${this.CONT_EMOJI[c.id] || "🌍"}</div>` +
        `<h3>${c.name}</h3><small>${c.territories.length} countries</small>`;
      if (!locked) btn.addEventListener("click", () => this.chooseContinent(c.id, purpose));
      grid.appendChild(btn);
    }
    if (purpose === "start") {
      this.showScreen("screen-pick-continent");
    } else {
      document.getElementById("unlock-modal").classList.remove("hidden");
      this.focusModal("unlock-modal");
    }
  },

  chooseContinent(contId, purpose) {
    this.state.pendingChoice = false; // the "what's next" choice has been made
    if (purpose === "start") {
      this.state.activeContinent = contId;
      this.state.unlocked = [contId];
      this.persist();
      this.enterGame(true);
    } else {
      document.getElementById("unlock-modal").classList.add("hidden");
      this.state.activeContinent = contId;
      this.state.unlocked.push(contId);
      this.persist();
      this.refreshAll();
      this.focusActiveContinent();
      this.toast(`🗝️ New frontier: ${this.contNameOf[contId]}! Plant your flag! 🚩`);
    }
  },

  enterGame(needHomeBase) {
    this.showScreen("screen-game");
    GeoMap.render(
      document.getElementById("map-svg"),
      this.geojson.features,
      (f) => this.styleFor(f),
      {
        playable: this.playableIsos,
        nameFor: (f) => this.nameOf[f.properties.iso3] || f.properties.name,
      }
    );
    GeoMap.reset();
    this.focusActiveContinent();
    this.pickingHome = needHomeBase;
    const banner = document.getElementById("home-banner");
    if (needHomeBase) {
      document.getElementById("home-continent-name").textContent =
        this.contNameOf[this.state.activeContinent];
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
    this.refreshAll();
  },

  /** Smoothly zoom the map to the active continent's bounding box. */
  focusActiveContinent() {
    const cont = this.continents.find((c) => c.id === this.state.activeContinent);
    if (!cont) return;
    GeoMap.focusIsos(cont.territories.map((t) => t.iso3), true);
  },

  /* ================= map interaction ================= */
  onTerritoryClick(iso3) {
    const contId = this.contOf[iso3];
    if (!contId) return; // backdrop country — not playable

    if (this.pickingHome) {
      if (contId !== this.state.activeContinent) {
        this.toast(`🚩 Plant your flag inside ${this.contNameOf[this.state.activeContinent]}!`);
        return;
      }
      this.state.homeBase = iso3;
      this.state.ownership[iso3] = "player";
      this.pickingHome = false;
      document.getElementById("home-banner").classList.add("hidden");
      this.persist();
      this.refreshAll();
      GeoMap.flash(iso3);
      this.toast(`🚩 ${this.nameOf[iso3]} is your capital! Now conquer ${this.contNameOf[contId]}!`);
      return;
    }

    if (contId !== this.state.activeContinent) {
      this.toast(`🔒 Finish conquering ${this.contNameOf[this.state.activeContinent]} first!`);
      return;
    }
    const owner = this.state.ownership[iso3];
    if (owner === "player") {
      this.toast(`✅ ${this.nameOf[iso3]} is already yours, Commander!`);
      return;
    }
    this.showTerritoryCard(iso3, owner);
  },

  /** Set the active subject and reflect it on the subject toggle buttons. */
  setSubject(s) {
    this.selectedSubject = s;
    document.querySelectorAll(".subject-btn").forEach((btn) => {
      const on = btn.dataset.subject === s;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  },

  showTerritoryCard(iso3, owner) {
    const card = document.getElementById("territory-card");
    document.getElementById("terr-name").textContent =
      `${this.CONT_EMOJI[this.contOf[iso3]] || "🌍"} ${this.nameOf[iso3]}`;
    const flag = document.getElementById("terr-flag");
    flag.src = `assets/flags/${iso3}.svg`;
    flag.alt = `Flag of ${this.nameOf[iso3]}`;
    flag.classList.remove("hidden");
    document.getElementById("terr-owner").textContent = owner === "rival"
      ? `😈 Held by ${this.RIVAL_NAME} — take it back!`
      : "⚪ Unclaimed — ripe for conquest!";
    // Easy is too gentle for the Baron's fortresses — those need Medium or Hard.
    document.querySelector('.diff-btn[data-tier="easy"]').disabled = owner === "rival";
    // Multiplayer may have locked Medium (fortified countries); solo never does.
    document.querySelector('.diff-btn[data-tier="medium"]').disabled = false;
    document.querySelector('.diff-btn[data-tier="hard"]').disabled = false;
    const fort = document.getElementById("terr-fort");
    if (fort) fort.classList.add("hidden");
    document.getElementById("terr-easy-note").classList.toggle("hidden", owner !== "rival");
    // Nudge a math question roughly every 3rd question.
    const nudge = document.getElementById("terr-math-nudge");
    if ((this.state.geoSinceMath || 0) >= 2) {
      this.setSubject("math");
      nudge.classList.remove("hidden");
    } else {
      this.setSubject("geo");
      nudge.classList.add("hidden");
    }
    card.classList.remove("hidden");
    card.dataset.iso3 = iso3;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  /* ================= contests & questions ================= */
  /**
   * Open the question modal for a contest on iso3 at the given tier.
   * subject "math" (default "geo") uses window.GeoMath.generate(tier)
   * when that module is present; opts.skill pins the math skill and
   * opts.practice marks a no-stakes practice round.
   */
  startContest(iso3, tier, subject = "geo", opts = {}) {
    let q;
    if (subject === "math" && window.GeoMath) {
      q = window.GeoMath.generate(tier, opts.skill ? { skill: opts.skill } : {});
    } else {
      q = this.pickQuestion(iso3, tier);
    }
    if (!q) { this.toast("😅 Out of questions! Try another difficulty."); return; }
    this.leaveFindMode(); // never start a contest while a map search is open
    const type = q.type || "text";
    // Shuffle options so replaying stays fresh; track the new answer index.
    const order = this.shuffle(q.options.map((_, i) => i));
    this.currentContest = {
      iso3, tier, subject,
      nudged: subject === "math" && (this.state.geoSinceMath || 0) >= 2,
      practice: !!opts.practice,
      question: q, type,
      options: order.map((i) => q.options[i]),
      answerIdx: order.indexOf(q.answer),
      optionFlags: type === "flag-pick" ? order.map((i) => q.optionFlags[i]) : null,
      hintsShown: 0,
    };
    document.getElementById("q-territory").textContent = subject === "math"
      ? "🧮 " + this.nameOf[iso3]
      : this.nameOf[iso3];
    const badge = document.getElementById("q-tier-badge");
    badge.textContent = this.TIER_LABEL[tier];
    badge.className = "tier-badge " + tier;
    document.getElementById("q-text").textContent = q.q;
    const box = document.getElementById("q-options");
    box.innerHTML = "";
    box.classList.remove("flag-grid");
    const flagImg = document.getElementById("q-flag-img");
    flagImg.classList.add("hidden");
    flagImg.removeAttribute("src");
    document.getElementById("q-feedback").classList.add("hidden");
    document.getElementById("btn-q-continue").classList.add("hidden");
    document.getElementById("btn-similar").classList.add("hidden");
    document.getElementById("q-practice-note").classList.toggle("hidden", !opts.practice);
    // Hints: math questions carry step-by-step hints. Reset the list and
    // show the hint button only when there is something to reveal.
    const hintsList = document.getElementById("q-hints");
    hintsList.innerHTML = "";
    hintsList.classList.add("hidden");
    const hintBtn = document.getElementById("btn-hint");
    if (q.type === "math" && q.hints && q.hints.length) {
      hintBtn.disabled = false;
      hintBtn.textContent = "💡 Hint (" + q.hints.length + " steps)";
      hintBtn.classList.remove("hidden");
    } else {
      hintBtn.classList.add("hidden");
    }
    this.updatePointsLabel();
    if (opts.practice) document.getElementById("q-points").textContent = "Practice";

    if (type === "map") {
      // "Find it on the map" question: one big button enters find mode.
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-big q-option";
      b.textContent = "🗺️ Go find it!";
      b.addEventListener("click", () => this.beginFindMode());
      box.appendChild(b);
    } else if (type === "flag") {
      // Big flag image above the (text) options.
      flagImg.src = q.image;
      flagImg.classList.remove("hidden");
      this.renderTextOptions(box);
    } else if (type === "flag-pick") {
      // Each option is a flag image; the country names stay hidden.
      box.classList.add("flag-grid");
      this.renderFlagOptions(box);
    } else {
      this.renderTextOptions(box); // text — and math, rendered like text for now
    }
    document.getElementById("question-modal").classList.remove("hidden");
    this.focusModal("question-modal");
  },

  /** Plain text option buttons (text and math questions). */
  renderTextOptions(box) {
    this.currentContest.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn q-option";
      b.textContent = opt;
      b.addEventListener("click", () => this.answerQuestion(i, b));
      box.appendChild(b);
    });
  },

  /** Flag-pick option buttons: flag image + hidden country name. */
  renderFlagOptions(box) {
    const c = this.currentContest;
    c.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn q-option q-flag-option";
      b.setAttribute("aria-label", opt);
      const img = document.createElement("img");
      img.src = `assets/flags/${c.optionFlags[i]}.svg`;
      img.alt = ""; // the country name stays hidden until after answering
      const name = document.createElement("span");
      name.className = "flag-name hidden";
      name.textContent = opt;
      b.appendChild(img);
      b.appendChild(name);
      b.addEventListener("click", () => this.answerQuestion(i, b));
      box.appendChild(b);
    });
  },

  /* ================= hints (math questions) ================= */
  /**
   * Points a correct answer earns: each hint shown takes 20% of the
   * tier's base points (rounded) off, but never below 5. Geography
   * contests have no hintsShown, so they always earn the full base.
   */
  contestPoints(c) {
    const base = this.TIER_POINTS[c.tier];
    const shown = c.hintsShown || 0;
    return Math.max(5, base - Math.round(base * 0.2) * shown);
  },

  /** Refresh the "+N pts" pill in the question modal's meta row. */
  updatePointsLabel() {
    const c = this.currentContest;
    const el = document.getElementById("q-points");
    if (!c || !el) return;
    if (c.practice) { el.textContent = "Practice"; return; }
    const base = this.TIER_POINTS[c.tier];
    const points = this.contestPoints(c);
    const shown = c.hintsShown || 0;
    el.textContent = "+" + points + " pts" + (shown > 0 ? ` (💡−${base - points})` : "");
  },

  /** Reveal the next hint for the current math question, if any remain. */
  showHint() {
    const c = this.currentContest;
    if (!c) return;
    const hints = c.question && c.question.hints;
    if (!hints || !hints.length || c.hintsShown >= hints.length) return;
    const hint = hints[c.hintsShown];
    const list = document.getElementById("q-hints");
    list.classList.remove("hidden");
    const li = document.createElement("li");
    li.textContent = hint.text;
    list.appendChild(li);
    if (hint.bars) {
      for (const bar of hint.bars) li.appendChild(this.fractionBarSvg(bar));
    }
    c.hintsShown++;
    this.state.hintsUsed = (this.state.hintsUsed || 0) + 1;
    GeoSound.hint();
    this.updatePointsLabel();
    const left = hints.length - c.hintsShown;
    if (left > 0) document.getElementById("btn-hint").textContent = `💡 Next hint (${left} left)`;
    if (c.hintsShown >= hints.length) {
      const btn = document.getElementById("btn-hint");
      btn.disabled = true;
      btn.textContent = "💡 No more hints";
    }
  },

  /**
   * A fraction bar: |n| of d equal parts filled, stacked over whole bars
   * when the fraction is improper (10/9 draws two bars). Denominators
   * wider than 24 get a plain text label instead of a drawing.
   */
  fractionBarSvg({ n, d, label }) {
    if (!d || d > 24) {
      const span = document.createElement("span");
      span.className = "frac-bar-label";
      span.textContent = label;
      return span;
    }
    const SVG = "http://www.w3.org/2000/svg";
    const num = Math.abs(n);
    const whole = Math.max(1, Math.ceil(num / d));
    const barW = 240, barH = 22, gap = 4;
    const height = whole * (barH + gap) - gap;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 300 ${height}`);
    svg.setAttribute("class", "frac-bar");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    let filled = 0;
    for (let b = 0; b < whole; b++) {
      for (let i = 0; i < d; i++) {
        const rect = document.createElementNS(SVG, "rect");
        rect.setAttribute("x", (i * barW) / d);
        rect.setAttribute("y", b * (barH + gap));
        rect.setAttribute("width", barW / d);
        rect.setAttribute("height", barH);
        rect.setAttribute("class", filled < num ? "fb-on" : "fb-off");
        svg.appendChild(rect);
        filled++;
      }
    }
    const text = document.createElementNS(SVG, "text");
    text.setAttribute("x", 250);
    text.setAttribute("y", Math.round(height / 2) + 5);
    text.textContent = label;
    svg.appendChild(text);
    return svg;
  },

  /**
   * Question picker: prefers questions about the contested territory,
   * then its continent, then anywhere; prefers the chosen tier; avoids
   * repeats until the pool is exhausted. Never returns a "giveaway"
   * question for the contested country (one whose correct answer is
   * that country itself) — those are only used for OTHER countries in
   * the same continent, where they act as continent-level questions.
   * Also avoids repeating the same category or type twice in a row
   * when alternatives exist. Returns null when nothing is left.
   */
  pickQuestion(iso3, tier) {
    const contName = this.contNameOf[this.contOf[iso3]];
    const asked = new Set(this.state.asked);
    const tiers = [
      (q) => q.tier === tier && q.territory === iso3 && !asked.has(q.id),
      (q) => q.tier === tier && q.continent === contName && !asked.has(q.id),
      (q) => q.tier === tier && !asked.has(q.id),
      (q) => q.territory === iso3 && !asked.has(q.id),
      (q) => !asked.has(q.id),
      (q) => q.tier === tier,
      () => true,
    ];
    for (const f of tiers) {
      const pool = this.questions.filter((q) => f(q) && !this.isGiveawayOn(q, iso3));
      if (pool.length) {
        const q = this.pickWithVariety(pool);
        this.state.asked.push(q.id);
        if (this.state.asked.length > 600) this.state.asked.splice(0, 200);
        return q;
      }
    }
    return null;
  },

  /**
   * True when q's correct answer IS the contested country itself, i.e.
   * the question would be a giveaway on iso3. flag-pick questions are
   * exempt (their country names are hidden behind flag images), and map
   * questions are giveaways on their target country.
   */
  isGiveawayOn(q, iso3) {
    if (!q) return false;
    const type = q.type || "text";
    if (q.answerIsTerritory && q.territory === iso3) return true;
    if (type === "map" && q.target === iso3) return true;
    if (type === "flag-pick") return false;
    const opts = q.options || [];
    if (!opts.length || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) {
      return false;
    }
    const variants = this.nameVariantsOf[iso3];
    return !!variants && variants.has(this.normName(opts[q.answer]));
  },

  /** Normalize a country/option name for giveaway comparison. */
  normName(s) {
    return String(s).toLowerCase().replace(/the /g, "").replace(/[^a-z]/g, "");
  },

  /**
   * Pick from a pool, avoiding the same category or type as the last
   * question asked when alternatives exist (prefers variety).
   */
  pickWithVariety(pool) {
    const lastId = this.state.asked[this.state.asked.length - 1];
    const last = lastId ? this.questions.find((q) => q.id === lastId) : null;
    if (!last) return pool[Math.floor(Math.random() * pool.length)];
    const cat = (q) => q.category || "general";
    const typ = (q) => q.type || "text";
    const lastCat = cat(last), lastType = typ(last);
    const both = pool.filter((q) => cat(q) !== lastCat && typ(q) !== lastType);
    const either = pool.filter((q) => cat(q) !== lastCat || typ(q) !== lastType);
    const preferred = both.length ? both : either.length ? either : pool;
    return preferred[Math.floor(Math.random() * preferred.length)];
  },

  answerQuestion(idx, btnEl) {
    const c = this.currentContest;
    if (!c || btnEl.disabled) return;
    const buttons = [...document.getElementById("q-options").children];
    buttons.forEach((b) => (b.disabled = true));
    // The question is answered — no more hints (shown ones stay visible).
    document.getElementById("btn-hint").classList.add("hidden");
    // flag-pick: reveal the country names under the flags.
    document.querySelectorAll("#q-options .flag-name").forEach((s) => s.classList.remove("hidden"));
    const correct = idx === c.answerIdx;
    if (correct) GeoSound.correct(); else GeoSound.wrong();
    buttons[c.answerIdx].classList.add("correct");
    if (!correct) btnEl.classList.add("wrong");

    const fb = document.getElementById("q-feedback");
    fb.classList.remove("hidden", "good", "bad");
    if (correct) {
      const praise = this.PRAISE[Math.floor(Math.random() * this.PRAISE.length)];
      fb.classList.add("good");
      fb.innerHTML = `<strong>${praise}</strong><br />${this.escapeHtml(c.question.explain)}`;
    } else {
      const comfort = this.COMFORT[Math.floor(Math.random() * this.COMFORT.length)];
      fb.classList.add("bad");
      fb.innerHTML = `<strong>${comfort}</strong><br />The answer was <strong>${this.escapeHtml(
        c.question.options[c.question.answer]
      )}</strong>. ${this.escapeHtml(c.question.explain)}`;
    }
    // A wrong math answer gets the full worked solution (the hints are
    // the steps) plus an offer to try a similar question for practice.
    // A miss earns nothing — don't keep showing the points that were on offer.
    if (!correct) {
      const pts = document.getElementById("q-points");
      if (pts && !c.practice) pts.textContent = "0 pts";
    }
    if (!correct && c.question.type === "math") {
      const title = document.createElement("p");
      title.className = "solution-title";
      title.textContent = "📝 Here's how to solve it:";
      fb.appendChild(title);
      const steps = document.createElement("ol");
      steps.className = "solution";
      for (const hint of c.question.hints || []) {
        const li = document.createElement("li");
        li.className = "solution-step";
        li.textContent = hint.text;
        if (hint.bars) {
          for (const bar of hint.bars) li.appendChild(this.fractionBarSvg(bar));
        }
        steps.appendChild(li);
      }
      fb.appendChild(steps);
      document.getElementById("q-hints").classList.add("hidden");
      document.getElementById("btn-similar").classList.remove("hidden");
    }
    document.getElementById("btn-q-continue").classList.remove("hidden");
    c.wasCorrect = correct;
  },

  /**
   * "Try a similar one": after a math question, resolve the real
   * contest (if any) exactly as Continue would, then open a fresh
   * practice question of the same skill — no country at stake.
   */
  trySimilar() {
    const c = this.currentContest;
    if (!c || c.question.type !== "math") return;
    const next = {
      iso3: c.iso3,
      tier: c.tier,
      skill: c.question.skill,
      practice: c.practice,
    };
    if (!next.practice) {
      this.resolveContest(); // apply the real result (e.g. the Baron's steal)
    } else {
      document.getElementById("question-modal").classList.add("hidden");
      this.currentContest = null;
    }
    this.startContest(next.iso3, next.tier, "math", { skill: next.skill, practice: true });
  },

  /** Apply the contest result once the player taps Continue. */
  resolveContest() {
    const c = this.currentContest;
    if (!c) return;
    // Practice rounds are no-stakes: close the modal and leave the
    // campaign (ownership, points, streak, stats, geoSinceMath) and
    // the territory card exactly as they were.
    if (c.practice) {
      document.getElementById("question-modal").classList.add("hidden");
      this.currentContest = null;
      this.toast(c.wasCorrect ? "🧮 Nice practice!" : "🧮 Keep practising — you've got this!");
      return;
    }
    // Multiplayer: GeoMulti owns the result (ownership, points, turns) —
    // the solo campaign bookkeeping below never runs.
    if (this.mode === "multi" && this.contestHook) {
      document.getElementById("question-modal").classList.add("hidden");
      document.getElementById("territory-card").classList.add("hidden");
      this.leaveFindMode();
      this.currentContest = null;
      this.contestHook(c);
      return;
    }
    document.getElementById("question-modal").classList.add("hidden");
    document.getElementById("territory-card").classList.add("hidden");
    this.leaveFindMode();
    this.currentContest = null;
    this.state.contests++;
    // Track per-category stats (for future progress screens).
    const cat = c.question.category || "general";
    const byCat = this.state.stats.byCategory;
    if (!byCat[cat]) byCat[cat] = { asked: 0, correct: 0 };
    byCat[cat].asked++;
    if (c.wasCorrect) byCat[cat].correct++;
    // Math questions reset the geo streak; geography questions extend it.
    if (c.question.type === "math") this.state.geoSinceMath = 0;
    else this.state.geoSinceMath = (this.state.geoSinceMath || 0) + 1;

    if (c.wasCorrect) {
      this.state.ownership[c.iso3] = "player";
      this.state.correct++;
      this.state.streak++;
      this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
      let pts = this.contestPoints(c);
      if (this.state.streak >= 3) pts += 5; // streak bonus
      if (c.nudged) pts += 5; // math nudge bonus
      this.state.points += pts;
      GeoSound.conquer();
      GeoConfetti.burst({ at: c.iso3, count: 60, power: 420 });
      this.toast(`🎉 +${pts} pts! ${this.nameOf[c.iso3]} is yours!`);
      // The Baron grudgingly admits it now and then.
      if (window.GeoBaron && Math.random() < 0.35) GeoBaron.say("playerWin");
    } else {
      GeoSound.steal();
      this.state.ownership[c.iso3] = "rival";
      this.state.streak = 0;
      this.toast(`😈 Oh no! ${this.RIVAL_NAME} seized ${this.nameOf[c.iso3]}!`);
      if (window.GeoBaron) GeoBaron.say("playerMiss");
    }

    // Rival AI automatic move: every 3rd contest, the Baron grabs a
    // random unclaimed country in the active continent (if any remain).
    if (this.state.contests % 3 === 0) this.rivalAutoMove();

    this.persist();
    GeoMap.flash(c.iso3);
    this.refreshAll();
    this.checkConquest();
  },

  rivalAutoMove() {
    const cont = this.continents.find((x) => x.id === this.state.activeContinent);
    const neutrals = cont.territories.filter((t) => !this.state.ownership[t.iso3]);
    if (!neutrals.length) return;
    const pick = neutrals[Math.floor(Math.random() * neutrals.length)];
    this.state.ownership[pick.iso3] = "rival";
    GeoSound.steal();
    this.persist();
    GeoMap.flash(pick.iso3);
    this.refreshAll();
    this.toast(`😈 ${this.RIVAL_NAME} swooped in and seized ${pick.name}!`);
    if (window.GeoBaron) GeoBaron.say("steal");
  },

  /* ================= map "find it" questions ================= */
  /** Hide the modal and let the player tap the target country on the map. */
  beginFindMode() {
    const c = this.currentContest;
    if (!c || (c.question.type || "text") !== "map") return;
    document.getElementById("question-modal").classList.add("hidden");
    const target = c.question.target;
    document.getElementById("find-country-name").textContent = this.nameOf[target] || target;
    document.getElementById("find-banner").classList.remove("hidden");
    GeoMap.setFindMode(true, (iso3) => this.onFindTap(iso3));
    GeoMap.setLabelsHidden(true); // no name labels while searching the map
    // Phones: the map may be scrolled off-screen behind the side panel.
    const wrap = document.querySelector(".map-wrap");
    if (wrap) {
      const bar = document.querySelector(".topbar");
      const top = wrap.getBoundingClientRect().top + window.scrollY - (bar ? bar.offsetHeight : 0) - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  },

  /** Leave find mode: restore tooltips/clickability and hide the banner. */
  leaveFindMode() {
    GeoMap.setFindMode(false, null);
    GeoMap.setLabelsHidden(false);
    document.getElementById("find-banner").classList.add("hidden");
  },

  /** The tapped country counts as the answer for a map question. */
  onFindTap(iso3) {
    const c = this.currentContest;
    if (!c || (c.question.type || "text") !== "map") return;
    this.leaveFindMode();
    const target = c.question.target;
    const tappedName = this.nameOf[iso3] || iso3;
    const targetName = this.nameOf[target] || target;
    const correct = iso3 === target;
    c.wasCorrect = correct;
    c.mapTapped = iso3;
    if (correct) {
      this.showMapResult(c, correct, tappedName, targetName);
    } else {
      // Show where the target really is for a moment before the feedback pops up.
      GeoMap.flash(target);
      setTimeout(() => this.showMapResult(c, correct, tappedName, targetName), 1400);
    }
  },

  /** "Give up" on a map question counts as a wrong answer. */
  giveUpFind() {
    const c = this.currentContest;
    if (!c || (c.question.type || "text") !== "map") return;
    this.leaveFindMode();
    const target = c.question.target;
    const targetName = this.nameOf[target] || target;
    c.wasCorrect = false;
    c.gaveUp = true;
    this.showMapResult(c, false, null, targetName);
    GeoMap.flash(target);
  },

  /** Re-open the modal with the map-question feedback and Continue button. */
  showMapResult(c, correct, tappedName, targetName) {
    if (correct) GeoSound.correct(); else GeoSound.wrong();
    if (!correct && !c.practice) document.getElementById("q-points").textContent = "0 pts";
    const box = document.getElementById("q-options");
    box.innerHTML = "";
    if (tappedName && !correct) this.addMapResultButton(box, `🗺️ ${tappedName}`, "wrong");
    this.addMapResultButton(box, `🗺️ ${targetName}`, "correct");
    const fb = document.getElementById("q-feedback");
    fb.classList.remove("hidden", "good", "bad");
    if (correct) {
      const praise = this.PRAISE[Math.floor(Math.random() * this.PRAISE.length)];
      fb.classList.add("good");
      fb.innerHTML = `<strong>${praise}</strong><br />${this.escapeHtml(c.question.explain)}`;
    } else if (tappedName) {
      fb.classList.add("bad");
      fb.innerHTML =
        `<strong>That was ${this.escapeHtml(tappedName)}!</strong> ` +
        `${this.escapeHtml(targetName)} is here.<br />${this.escapeHtml(c.question.explain)}`;
    } else {
      fb.classList.add("bad");
      fb.innerHTML =
        `<strong>That's okay — ${this.escapeHtml(targetName)} is here.</strong><br />` +
        `${this.escapeHtml(c.question.explain)}`;
    }
    document.getElementById("btn-q-continue").classList.remove("hidden");
    document.getElementById("question-modal").classList.remove("hidden");
    this.focusModal("question-modal");
  },

  addMapResultButton(box, label, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn q-option " + cls;
    b.disabled = true;
    b.textContent = label;
    box.appendChild(b);
  },

  /* ================= conquest & victory ================= */
  mastery(contId) {
    const cont = this.continents.find((x) => x.id === contId);
    const owned = cont.territories.filter((t) => this.state.ownership[t.iso3] === "player").length;
    return { owned, total: cont.territories.length, pct: Math.round((owned / cont.territories.length) * 100) };
  },

  checkConquest() {
    const m = this.mastery(this.state.activeContinent);
    if (m.owned < m.total) return; // not yet
    if (this.state.conquered.includes(this.state.activeContinent)) return;

    this.state.conquered.push(this.state.activeContinent);
    // The player has won a continent but not yet chosen what's next;
    // remember that so a reload can re-open the right screen.
    this.state.pendingChoice = true;
    this.persist();
    // Fanfare + a big confetti shower for the big moment.
    GeoSound.victory();
    GeoConfetti.burst({ count: 180, x: window.innerWidth * 0.25, y: window.innerHeight * 0.15, power: 620 });
    GeoConfetti.burst({ count: 180, x: window.innerWidth * 0.75, y: window.innerHeight * 0.15, power: 620 });
    // The Baron sulks when he loses a continent.
    if (window.GeoBaron) {
      GeoBaron.say("continentLost");
      GeoBaron.sulk();
    }
    const cname = this.contNameOf[this.state.activeContinent];
    const allDone = this.state.conquered.length === this.continents.length;

    if (this.state.mode === "quest" && !allDone) {
      this.showQuestVictory(cname);
    } else if (allDone) {
      this.showWorldVictory();
    } else {
      this.showContinentVictory(cname);
    }
    this.refreshAll();
  },

  /**
   * After a reload/continue: if the active continent is already fully
   * conquered (the player won it but never chose what's next), re-open
   * the right screen — the unlock picker in world mode, the victory
   * modal in quest mode, or the world victory modal when all is done.
   * pendingChoice is stored in the save; for old saves it is detected
   * from the data (whole continent owned + continent in conquered).
   */
  resumePendingChoice() {
    const s = this.state;
    if (!s || !s.activeContinent) return;
    if (s.conquered.length === this.continents.length) {
      this.showWorldVictory();
      return;
    }
    const m = this.mastery(s.activeContinent);
    const pending = s.pendingChoice === true ||
      (s.conquered.includes(s.activeContinent) && m.owned === m.total);
    if (!pending) return;
    if (s.mode === "quest") {
      this.showQuestVictory(this.contNameOf[s.activeContinent]);
    } else {
      this.showContinentPicker("unlock");
    }
  },

  /** Quest mode: one continent = victory, with an offer to go further. */
  showQuestVictory(cname) {
    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");
    document.getElementById("victory-emoji").textContent = "🏆";
    document.getElementById("victory-title").textContent = `${cname} Conquered!`;
    document.getElementById("victory-text").innerHTML =
      `You did it, Commander! Every country in <strong>${this.escapeHtml(cname)}</strong> flies your flag.<br /><br />` +
      `Feeling brave? Continue into <strong>World Conquest</strong> and take all six continents!`;
    this.renderVictoryExtras(this.state.activeContinent);
    btn.textContent = "🌐 Continue to World Conquest →";
    btn.onclick = () => {
      modal.classList.add("hidden");
      this.state.mode = "world";
      this.persist();
      this.showContinentPicker("unlock");
    };
    modal.classList.remove("hidden");
    this.focusModal("victory-modal");
  },

  /** Ultimate victory: every continent conquered. */
  showWorldVictory() {
    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");
    document.getElementById("victory-emoji").textContent = "🌍";
    document.getElementById("victory-title").textContent = "WORLD CONQUERED!";
    document.getElementById("victory-text").innerHTML =
      `LEGENDARY! You have conquered <strong>all six continents</strong> and outsmarted ${this.RIVAL_NAME} once and for all!<br /><br />` +
      `You are officially the greatest geography explorer in history! 🎓`;
    this.renderVictoryExtras(null); // every flag in the world
    btn.textContent = "↺ Start a new campaign";
    btn.onclick = () => this.resetToStart();
    modal.classList.remove("hidden");
    this.focusModal("victory-modal");
  },

  /** World mode: continent conquered, pick the next frontier. */
  showContinentVictory(cname) {
    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");
    document.getElementById("victory-emoji").textContent =
      this.CONT_EMOJI[this.state.activeContinent] || "🌍";
    document.getElementById("victory-title").textContent = `${cname} Conquered!`;
    document.getElementById("victory-text").innerHTML =
      `All of <strong>${this.escapeHtml(cname)}</strong> is yours! ${this.RIVAL_NAME} is furious! 😤<br /><br />` +
      `Progress: <strong>${this.state.conquered.length} / ${this.continents.length}</strong> continents.`;
    this.renderVictoryExtras(this.state.activeContinent);
    btn.textContent = "🗝️ Choose next continent →";
    btn.onclick = () => {
      modal.classList.add("hidden");
      this.showContinentPicker("unlock");
    };
    modal.classList.remove("hidden");
    this.focusModal("victory-modal");
  },

  /**
   * Fill the victory modal's stat chips (score, correct/asked, best
   * streak, hints used when tracked) and the row of flags — the given
   * continent's flags, or every flag in the world when contId is null.
   */
  renderVictoryExtras(contId) {
    const s = this.state;
    const stats = document.getElementById("victory-stats");
    stats.innerHTML = "";
    const items = [
      `⭐ Score: ${s.points}`,
      `✅ Correct: ${s.correct}/${s.contests}`,
      `🔥 Best streak: ${s.bestStreak}`,
    ];
    if (typeof s.hintsUsed === "number") items.push(`💡 Hints used: ${s.hintsUsed}`);
    for (const label of items) {
      const chip = document.createElement("span");
      chip.className = "victory-stat";
      chip.textContent = label;
      stats.appendChild(chip);
    }

    const flags = document.getElementById("victory-flags");
    flags.innerHTML = "";
    const conts = contId
      ? this.continents.filter((c) => c.id === contId)
      : this.continents;
    for (const c of conts) {
      for (const t of c.territories) {
        const img = document.createElement("img");
        img.src = `assets/flags/${t.iso3}.svg`;
        img.alt = t.name;
        img.title = t.name;
        img.loading = "lazy";
        flags.appendChild(img);
      }
    }
  },

  resetToStart() {
    GeoStorage.clear();
    this.state = null;
    this.pickingHome = false;
    this.currentContest = null;
    this.leaveFindMode();
    this._toastQueue = [];
    if (this._toastShowing && this._toastShowing.stop) this._toastShowing.stop();
    this._toastShowing = null;
    clearTimeout(this._toastTimer);
    this._toastBusy = false;
    document.getElementById("toast").classList.add("hidden");
    document.getElementById("victory-modal").classList.add("hidden");
    document.getElementById("question-modal").classList.add("hidden");
    document.getElementById("unlock-modal").classList.add("hidden");
    document.getElementById("territory-card").classList.add("hidden");
    const terrFlag = document.getElementById("terr-flag");
    if (terrFlag) terrFlag.classList.add("hidden");
    if (window.GeoBaron) GeoBaron.hide();
    document.getElementById("score-val").textContent = "0";
    document.getElementById("streak-val").textContent = "0";
    const cont = document.getElementById("btn-continue");
    cont.classList.add("hidden");
    this.showScreen("screen-start");
  },

  /* ================= rendering ================= */
  styleFor(feature) {
    const iso3 = feature.properties.iso3;
    const contId = this.contOf[iso3];
    const name = this.nameOf[iso3] || feature.properties.name || "Unknown";
    if (!contId) {
      return { cls: "t-backdrop", clickable: false, title: name };
    }
    const locked = !this.state.unlocked.includes(contId);
    if (locked) {
      return { cls: "t-locked", clickable: false, title: `${name} 🔒 (locked)` };
    }
    const owner = this.state.ownership[iso3];
    const cls = owner === "player" ? "t-player" : owner === "rival" ? "t-rival" : "t-neutral";
    const ownerLabel = owner === "player" ? "— yours! ⭐" : owner === "rival" ? `— ${this.RIVAL_NAME}'s 😈` : "— unclaimed ⚪";
    return { cls, clickable: true, title: `${name} ${ownerLabel}` };
  },

  refreshAll() {
    if (!this.state) return;
    GeoMap.refresh((f) => this.styleFor(f));
    document.getElementById("score-val").textContent = this.state.points;
    document.getElementById("streak-val").textContent = this.state.streak;
    // The streak chip pulses once the player is on a roll (3+).
    document.getElementById("streak-chip").classList.toggle("hot", this.state.streak >= 3);

    // Objective line
    const cname = this.contNameOf[this.state.activeContinent];
    const obj = this.state.mode === "quest"
      ? `Conquer every country in <strong>${cname}</strong> to win!`
      : `Conquer <strong>${cname}</strong> — ${this.state.conquered.length}/${this.continents.length} continents done`;
    document.getElementById("objective-text").innerHTML = this.state.activeContinent ? obj : "Choose a continent to begin!";

    // Continent mastery list
    const list = document.getElementById("continent-list");
    list.innerHTML = "";
    for (const c of this.continents) {
      const locked = !this.state.unlocked.includes(c.id);
      const done = this.state.conquered.includes(c.id);
      const m = this.mastery(c.id);
      const row = document.createElement("div");
      row.className = "cont-row" + (locked ? " locked" : "") + (done ? " done" : "");
      row.innerHTML =
        `<div class="cont-head"><span>${this.CONT_EMOJI[c.id] || "🌍"} ${locked ? "🔒 " : ""}${c.name}</span>` +
        `<span>${locked ? "locked" : m.pct + "%"}</span></div>` +
        `<div class="bar"><div style="width:${locked ? 0 : m.pct}%"></div></div>`;
      list.appendChild(row);
    }
  },

  /* ================= helpers ================= */
  persist() { if (this.mode === "multi") return; GeoStorage.save(this.state); }, // multiplayer never touches the solo save

  /** Move keyboard focus into a freshly opened modal (the dialog itself). */
  focusModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    const dialog = m.querySelector(".modal") || m;
    if (dialog.focus) dialog.focus({ preventScroll: true });
  },

  /** Fisher-Yates shuffle — returns a shuffled copy of arr. */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  /**
   * Toast queue: messages show one after another (~2.2 s each), so the
   * player's result is never clobbered by the Baron's move. Tapping the
   * toast dismisses the current message early.
   */
  toast(msg, ms = 2200) {
    if (this._handoffOpen()) {
      // Behind the multiplayer hand-off screen only the newest message counts:
      // it replaces anything waiting (or hidden on screen) so nothing shows up late.
      clearTimeout(this._toastTimer);
      if (this._toastShowing && this._toastShowing.stop) this._toastShowing.stop();
      this._toastShowing = null;
      this._toastQueue = [{ msg, ms }];
      this._nextToast();
      return;
    }
    this._toastQueue.push({ msg, ms });
    if (!this._toastBusy) this._nextToast();
  },

  /** True while the multiplayer pass-the-device screen is up. */
  _handoffOpen() {
    const h = document.getElementById("mp-handoff");
    return !!h && !h.classList.contains("hidden");
  },

  /** True while a question/victory/unlock/how-to card is open (toasts wait until it closes). */
  _cardOpen() {
    return !!document.querySelector(".modal-backdrop:not(.hidden)");
  },

  _nextToast() {
    const t = document.getElementById("toast");
    clearTimeout(this._toastTimer);
    // A toast that was on screen while a card covered it (CSS hides it) is shown again later.
    if (this._toastShowing && this._toastShowing.hiddenByCard) this._toastQueue.unshift(this._toastShowing.item);
    this._toastShowing = null;
    // Multiplayer hand-off screen: messages wait behind it, but only the
    // latest one is kept so nothing pops up a turn or two late.
    if (this._handoffOpen() && this._toastQueue.length > 1) {
      this._toastQueue = this._toastQueue.slice(-1);
    }
    if (this._toastQueue.length && this._cardOpen()) {
      // Hold the queue while a card is open; check again shortly.
      this._toastBusy = true;
      t.classList.add("hidden");
      this._toastTimer = setTimeout(() => this._nextToast(), 400);
      return;
    }
    const item = this._toastQueue.shift();
    if (!item) {
      this._toastBusy = false;
      t.classList.add("hidden");
      return;
    }
    this._toastBusy = true;
    t.textContent = item.msg;
    t.classList.remove("hidden");
    // Restart the slide-in animation for each queued message.
    t.style.animation = "none";
    void t.offsetWidth;
    t.style.animation = "";
    const showing = { item, hiddenByCard: false };
    this._toastShowing = showing;
    // Only replay a toast that a card covered before it was readable (under ~1 s on screen),
    // so finished messages never pile up and repeat after every question.
    const shownAt = Date.now();
    const watch = setInterval(() => {
      if (this._cardOpen() && Date.now() - shownAt < 1000) showing.hiddenByCard = true;
    }, 150);
    this._toastTimer = setTimeout(() => { clearInterval(watch); this._nextToast(); }, item.ms);
    showing.stop = () => clearInterval(watch);
  },

  /** Tap-to-dismiss: skip the current toast, show the next one (if any). */
  dismissToast() {
    clearTimeout(this._toastTimer);
    if (this._toastShowing) { this._toastShowing.stop && this._toastShowing.stop(); this._toastShowing.hiddenByCard = false; }
    this._nextToast();
  },

  showScreen(id) {
    for (const s of ["screen-start", "screen-pick-continent", "screen-mp-setup", "screen-game"]) {
      document.getElementById(s).classList.toggle("hidden", s !== id);
    }
    window.scrollTo(0, 0);
  },

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },
};
