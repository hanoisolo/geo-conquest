/* ============================================================
   game.js — Geo Conquest game engine.

   Owns the campaign state, question selection, contest
   resolution, the Baron von Blunder rival AI, continent
   unlocking, win conditions, and all screen/modal rendering.

   Screens:  start -> pick-continent -> game (+ modals)
   Save shape (localStorage, see storage.js):
     { version, mode, activeContinent, unlocked[], conquered[],
       ownership{iso3:'player'|'rival'}, points, streak, bestStreak,
       contests, correct, asked[], homeBase }
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

  /* ---- mutable campaign state ---- */
  state: null,
  pickingHome: false,   // true while the player plants their first flag
  currentContest: null, // { iso3, tier, question, options, answerIdx }

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
      }
    }
    // Also index every rendered country name for tooltips.
    for (const f of this.geojson.features) {
      const iso = f.properties.iso3;
      if (iso && !this.nameOf[iso]) this.nameOf[iso] = f.properties.name;
    }
    GeoMap.onTerritoryClick = (iso3) => this.onTerritoryClick(iso3);
  },

  /* ================= campaign setup ================= */
  newCampaign(mode) {
    this.state = {
      version: 1, mode,
      activeContinent: null, unlocked: [], conquered: [],
      ownership: {}, points: 0, streak: 0, bestStreak: 0,
      contests: 0, correct: 0, asked: [], homeBase: null,
    };
    this.persist();
    this.showContinentPicker("start");
  },

  continueCampaign() {
    const s = GeoStorage.load();
    if (!s) return;
    this.state = s;
    this.enterGame(this.state.homeBase == null);
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
      this.toast(`🗝️ New frontier: ${this.contNameOf[contId]}! Plant your flag! 🚩`);
    }
  },

  enterGame(needHomeBase) {
    this.showScreen("screen-game");
    GeoMap.render(
      document.getElementById("map-svg"),
      this.geojson.features,
      (f) => this.styleFor(f)
    );
    GeoMap.reset();
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
    card.classList.remove("hidden");
    card.dataset.iso3 = iso3;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  /* ================= contests & questions ================= */
  startContest(iso3, tier) {
    const q = this.pickQuestion(iso3, tier);
    if (!q) { this.toast("😅 Out of questions! Try another difficulty."); return; }
    // Shuffle options so replaying stays fresh; track the new answer index.
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    this.currentContest = {
      iso3, tier, question: q,
      options: order.map((i) => q.options[i]),
      answerIdx: order.indexOf(q.answer),
    };
    document.getElementById("q-territory").textContent = this.nameOf[iso3];
    const badge = document.getElementById("q-tier-badge");
    badge.textContent = this.TIER_LABEL[tier];
    badge.className = "tier-badge " + tier;
    document.getElementById("q-text").textContent = q.q;
    const box = document.getElementById("q-options");
    box.innerHTML = "";
    this.currentContest.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn q-option";
      b.textContent = opt;
      b.addEventListener("click", () => this.answerQuestion(i, b));
      box.appendChild(b);
    });
    document.getElementById("q-feedback").classList.add("hidden");
    document.getElementById("btn-q-continue").classList.add("hidden");
    document.getElementById("question-modal").classList.remove("hidden");
  },

  /**
   * Question picker: prefers questions about the contested territory,
   * then its continent, then anywhere; prefers the chosen tier; avoids
   * repeats until the pool is exhausted. Never returns undefined.
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
      const pool = this.questions.filter(f);
      if (pool.length) {
        const q = pool[Math.floor(Math.random() * pool.length)];
        this.state.asked.push(q.id);
        if (this.state.asked.length > 600) this.state.asked.splice(0, 200);
        return q;
      }
    }
    return null;
  },

  answerQuestion(idx, btnEl) {
    const c = this.currentContest;
    if (!c || btnEl.disabled) return;
    const buttons = [...document.getElementById("q-options").children];
    buttons.forEach((b) => (b.disabled = true));
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
    this.currentContest = null;
    this.state.contests++;

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
    this.persist();
    const cname = this.contNameOf[this.state.activeContinent];
    const allDone = this.state.conquered.length === this.continents.length;

    const modal = document.getElementById("victory-modal");
    const btn = document.getElementById("btn-victory-continue");

    if (this.state.mode === "quest" && !allDone) {
      // Quest mode: one continent = victory, with an offer to go further.
      document.getElementById("victory-emoji").textContent = "🏆";
      document.getElementById("victory-title").textContent = `${cname} Conquered!`;
      document.getElementById("victory-text").innerHTML =
        `You did it, Commander! Every country in <strong>${cname}</strong> flies your flag.<br /><br />` +
        `⭐ Score: <strong>${this.state.points}</strong> &nbsp;·&nbsp; 🔥 Best streak: <strong>${this.state.bestStreak}</strong><br /><br />` +
        `Feeling brave? Continue into <strong>World Conquest</strong> and take all six continents!`;
      btn.textContent = "🌐 Continue to World Conquest →";
      btn.onclick = () => {
        modal.classList.add("hidden");
        this.state.mode = "world";
        this.persist();
        this.showContinentPicker("unlock");
      };
    } else if (allDone) {
      // Ultimate victory: every continent conquered.
      document.getElementById("victory-emoji").textContent = "🌍";
      document.getElementById("victory-title").textContent = "WORLD CONQUERED!";
      document.getElementById("victory-text").innerHTML =
        `LEGENDARY! You have conquered <strong>all six continents</strong> and outsmarted ${this.RIVAL_NAME} once and for all!<br /><br />` +
        `⭐ Final score: <strong>${this.state.points}</strong> &nbsp;·&nbsp; ✅ Correct: <strong>${this.state.correct}/${this.state.contests}</strong> &nbsp;·&nbsp; 🔥 Best streak: <strong>${this.state.bestStreak}</strong><br /><br />` +
        `You are officially the greatest geography explorer in history! 🎓`;
      btn.textContent = "↺ Start a new campaign";
      btn.onclick = () => this.resetToStart();
    } else {
      // World mode: continent conquered, pick the next frontier.
      document.getElementById("victory-emoji").textContent = "🎉";
      document.getElementById("victory-title").textContent = `${cname} Conquered!`;
      document.getElementById("victory-text").innerHTML =
        `All of <strong>${cname}</strong> is yours! ${this.RIVAL_NAME} is furious! 😤<br /><br />` +
        `Progress: <strong>${this.state.conquered.length} / ${this.continents.length}</strong> continents.`;
      btn.textContent = "🗝️ Choose next continent →";
      btn.onclick = () => {
        modal.classList.add("hidden");
        this.showContinentPicker("unlock");
      };
    }
    modal.classList.remove("hidden");
    this.refreshAll();
  },

  resetToStart() {
    GeoStorage.clear();
    this.state = null;
    this.pickingHome = false;
    this.currentContest = null;
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

  showScreen(id) {
    for (const s of ["screen-start", "screen-pick-continent", "screen-game"]) {
      document.getElementById(s).classList.toggle("hidden", s !== id);
    }
    window.scrollTo(0, 0);
  },

  toast(msg, ms = 2600) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  },

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },
};
