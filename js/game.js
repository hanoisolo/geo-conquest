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
  pickingHome: false,   // true while the player plants their first flag
  currentContest: null, // { iso3, tier, question, options, answerIdx, ... }
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
    GeoMap.onTerritoryClick = (iso3) => this.onTerritoryClick(iso3);
  },

  /* ================= campaign setup ================= */
  newCampaign(mode) {
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

  showTerritoryCard(iso3, owner) {
    const card = document.getElementById("territory-card");
    document.getElementById("terr-name").textContent =
      `${this.CONT_EMOJI[this.contOf[iso3]] || "🌍"} ${this.nameOf[iso3]}`;
    document.getElementById("terr-owner").textContent = owner === "rival"
      ? `😈 Held by ${this.RIVAL_NAME} — take it back!`
      : "⚪ Unclaimed — ripe for conquest!";
    // Easy is too gentle for the Baron's fortresses — those need Medium or Hard.
    document.querySelector('.diff-btn[data-tier="easy"]').disabled = owner === "rival";
    document.getElementById("terr-easy-note").classList.toggle("hidden", owner !== "rival");
    card.classList.remove("hidden");
    card.dataset.iso3 = iso3;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  /* ================= contests & questions ================= */
  /**
   * Open the question modal for a contest on iso3 at the given tier.
   * subject is a hook for later work: "math" (default "geo") uses
   * window.GeoMath.generate(tier) when that module is present.
   */
  startContest(iso3, tier, subject = "geo") {
    let q;
    if (subject === "math" && window.GeoMath) {
      q = window.GeoMath.generate(tier);
    } else {
      q = this.pickQuestion(iso3, tier);
    }
    if (!q) { this.toast("😅 Out of questions! Try another difficulty."); return; }
    this.leaveFindMode(); // never start a contest while a map search is open
    const type = q.type || "text";
    // Shuffle options so replaying stays fresh; track the new answer index.
    const order = this.shuffle(q.options.map((_, i) => i));
    this.currentContest = {
      iso3, tier, question: q, type,
      options: order.map((i) => q.options[i]),
      answerIdx: order.indexOf(q.answer),
      optionFlags: type === "flag-pick" ? order.map((i) => q.optionFlags[i]) : null,
    };
    document.getElementById("q-territory").textContent = this.nameOf[iso3];
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
    // flag-pick: reveal the country names under the flags.
    document.querySelectorAll("#q-options .flag-name").forEach((s) => s.classList.remove("hidden"));
    const correct = idx === c.answerIdx;
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
    document.getElementById("btn-q-continue").classList.remove("hidden");
    c.wasCorrect = correct;
  },

  /** Apply the contest result once the player taps Continue. */
  resolveContest() {
    const c = this.currentContest;
    if (!c) return;
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

    if (c.wasCorrect) {
      this.state.ownership[c.iso3] = "player";
      this.state.correct++;
      this.state.streak++;
      this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
      let pts = this.TIER_POINTS[c.tier];
      if (this.state.streak >= 3) pts += 5; // streak bonus
      this.state.points += pts;
      this.toast(`🎉 +${pts} pts! ${this.nameOf[c.iso3]} is yours!`);
    } else {
      this.state.ownership[c.iso3] = "rival";
      this.state.streak = 0;
      this.toast(`😈 Oh no! ${this.RIVAL_NAME} seized ${this.nameOf[c.iso3]}!`);
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
    this.persist();
    GeoMap.flash(pick.iso3);
    this.refreshAll();
    this.toast(`😈 ${this.RIVAL_NAME} swooped in and seized ${pick.name}!`);
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
    this.showMapResult(c, correct, tappedName, targetName);
    if (!correct) GeoMap.flash(target); // show where the target really is
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
      `⭐ Score: <strong>${this.state.points}</strong> &nbsp;·&nbsp; 🔥 Best streak: <strong>${this.state.bestStreak}</strong><br /><br />` +
      `Feeling brave? Continue into <strong>World Conquest</strong> and take all six continents!`;
    btn.textContent = "🌐 Continue to World Conquest →";
    btn.onclick = () => {
      modal.classList.add("hidden");
      this.state.mode = "world";
      this.persist();
      this.showContinentPicker("unlock");
    };
    modal.classList.remove("hidden");
  },

  /** Ultimate victory: every continent conquered. */
  showWorldVictory() {
    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");
    document.getElementById("victory-emoji").textContent = "🌍";
    document.getElementById("victory-title").textContent = "WORLD CONQUERED!";
    document.getElementById("victory-text").innerHTML =
      `LEGENDARY! You have conquered <strong>all six continents</strong> and outsmarted ${this.RIVAL_NAME} once and for all!<br /><br />` +
      `⭐ Final score: <strong>${this.state.points}</strong> &nbsp;·&nbsp; ✅ Correct: <strong>${this.state.correct}/${this.state.contests}</strong> &nbsp;·&nbsp; 🔥 Best streak: <strong>${this.state.bestStreak}</strong><br /><br />` +
      `You are officially the greatest geography explorer in history! 🎓`;
    btn.textContent = "↺ Start a new campaign";
    btn.onclick = () => this.resetToStart();
    modal.classList.remove("hidden");
  },

  /** World mode: continent conquered, pick the next frontier. */
  showContinentVictory(cname) {
    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");
    document.getElementById("victory-emoji").textContent = "🎉";
    document.getElementById("victory-title").textContent = `${cname} Conquered!`;
    document.getElementById("victory-text").innerHTML =
      `All of <strong>${this.escapeHtml(cname)}</strong> is yours! ${this.RIVAL_NAME} is furious! 😤<br /><br />` +
      `Progress: <strong>${this.state.conquered.length} / ${this.continents.length}</strong> continents.`;
    btn.textContent = "🗝️ Choose next continent →";
    btn.onclick = () => {
      modal.classList.add("hidden");
      this.showContinentPicker("unlock");
    };
    modal.classList.remove("hidden");
  },

  resetToStart() {
    GeoStorage.clear();
    this.state = null;
    this.pickingHome = false;
    this.currentContest = null;
    this.leaveFindMode();
    this._toastQueue = [];
    clearTimeout(this._toastTimer);
    this._toastBusy = false;
    document.getElementById("toast").classList.add("hidden");
    document.getElementById("victory-modal").classList.add("hidden");
    document.getElementById("question-modal").classList.add("hidden");
    document.getElementById("unlock-modal").classList.add("hidden");
    document.getElementById("territory-card").classList.add("hidden");
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
  persist() { GeoStorage.save(this.state); },

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
    this._toastQueue.push({ msg, ms });
    if (!this._toastBusy) this._nextToast();
  },

  _nextToast() {
    const t = document.getElementById("toast");
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
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._nextToast(), item.ms);
  },

  /** Tap-to-dismiss: skip the current toast, show the next one (if any). */
  dismissToast() {
    clearTimeout(this._toastTimer);
    this._nextToast();
  },

  showScreen(id) {
    for (const s of ["screen-start", "screen-pick-continent", "screen-game"]) {
      document.getElementById(s).classList.toggle("hidden", s !== id);
    }
    window.scrollTo(0, 0);
  },

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },
};
