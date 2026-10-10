/* ============================================================
   multi.js — local multiplayer: 2-4 players, pass-and-play on
   one device. No Baron — players take turns conquering the
   whole world.

   Owns the multiplayer state and its own save (localStorage key
   geoConquestMultiV1 — the solo save is never read, written or
   cleared by this module), the setup screen, the turn banner
   and the scoreboard.

   Segment M1: mode card, setup screen, home flags, banner,
   scoreboard. Segment M2a: turns, attacks, hand-offs. Segment M2b:
   strike-backs. Segment M3: map choice, timer, winning, standings.

   State shape:
     { v: 1,
       players: [{ name, color (COLORS index), home: null,
                   points: 0, geoSinceMath: 0, hintsUsed: 0,
                   alive: true }],
       ownership: { iso3: playerIndex },
       turn: 0,
       phase: "homes" | "turn" | "over",
       win: { mode: "timed" | "domination", minutes },
       mapScope: "world" | continent id,
       timeLeftMs, timeUp, asked: [], pending: null }
   ============================================================ */
"use strict";

const GeoMulti = {
  /* Player colours (one per player, each used at most once). */
  COLORS: [
    { id: "blue", hex: "#2563eb" },
    { id: "red", hex: "#dc2626" },
    { id: "green", hex: "#16a34a" },
    { id: "orange", hex: "#ea580c" },
  ],

  /* localStorage key — multiplayer's own save, separate from solo. */
  KEY: "geoConquestMultiV1",

  /* Land borders (iso3 -> [neighbour iso3]), injected by app.js. Used by M2 strike-backs. */
  adjacency: {},

  /* Mutable multiplayer state (see the header for the shape). */
  state: null,

  /* Setup-screen scratch state (rebuilt by openSetup). */
  _setup: null,

  /* The attack whose contest is in flight: { iso3, attacker, defender }. */
  _attack: null,

  /* Callback for the hand-off screen's "ready" button (wired once in init). */
  _onReady: null,

  /* Countdown interval for timed games (1 s tick) and its tick counter. */
  _timer: null,
  _ticks: 0,

  /* ================= boot ================= */
  init({ adjacency }) {
    this.adjacency = adjacency || {};
    // Multiplayer contests resolve through GeoMulti, not the solo campaign.
    GeoGame.contestHook = (c) => this.onContestDone(c);
    // The hand-off button is wired once; the callback is swapped per turn.
    document.getElementById("btn-mp-ready").addEventListener("click", () => {
      document.getElementById("mp-handoff").classList.add("hidden");
      const onReady = this._onReady;
      this._onReady = null;
      if (onReady) onReady();
    });
    // Final standings: play again with the same players, or back to start.
    document.getElementById("btn-mp-again").addEventListener("click", () => {
      document.getElementById("mp-standings").classList.add("hidden");
      const s = this.state;
      this.start({
        players: s.players.map((p) => ({ name: p.name, color: p.color })),
        win: { mode: s.win.mode, minutes: s.win.minutes },
        mapScope: s.mapScope,
      });
    });
    document.getElementById("btn-mp-home").addEventListener("click", () => {
      document.getElementById("mp-standings").classList.add("hidden");
      this.clear();
      this.quit();
    });
  },

  /* ================= save / load ================= */
  /** Persist the multiplayer state. Never throws (private-mode safe). */
  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.state));
    } catch (e) {
      /* storage unavailable — the game still works for this session */
    }
  },

  /** Load the saved state, or null when there is no save (or it's corrupt). */
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object" || Array.isArray(s)) return null;
      if (s.v !== 1 || !Array.isArray(s.players) || !s.players.length) return null;
      if (!s.ownership || typeof s.ownership !== "object") s.ownership = {};
      if (!Array.isArray(s.asked)) s.asked = [];
      if (!s.mapScope) s.mapScope = "world"; // M1 saves predate the scope choice
      return s;
    } catch (e) {
      return null;
    }
  },

  /** Wipe the multiplayer save. */
  clear() {
    try {
      localStorage.removeItem(this.KEY);
    } catch (e) {
      /* ignore */
    }
  },

  /** True when a multiplayer game can be continued (a save exists, not finished). */
  hasSave() {
    const s = this.load();
    return !!s && s.phase !== "over";
  },

  /* ================= setup screen ================= */
  /** Open the multiplayer setup screen with fresh defaults. */
  openSetup() {
    this._setup = {
      count: 2,
      winMode: "timed",
      minutes: 10,
      mapScope: "world",
      players: [
        { name: "Player 1", color: 0 },
        { name: "Player 2", color: 1 },
      ],
    };
    document.getElementById("mp-setup-error").classList.add("hidden");
    this.syncSetupButtons();
    this.renderSetupRows();
    document.body.classList.add("mp-mode"); // hides solo-only bits (Baron, points pills) on the setup screen
    GeoGame.showScreen("screen-mp-setup");
  },

  /** Wire the setup screen's buttons once (called from app.js). */
  wireSetup() {
    document.querySelectorAll("#mp-count [data-count]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.count);
        this._setup.count = n;
        const players = this._setup.players;
        while (players.length < n) {
          // First colour not used by any current player.
          const used = new Set(players.map((p) => p.color));
          let ci = 0;
          while (used.has(ci)) ci++;
          players.push({ name: `Player ${players.length + 1}`, color: ci });
        }
        players.length = Math.min(players.length, n);
        this.syncSetupButtons();
        this.renderSetupRows();
      });
    });
    document.querySelectorAll("#mp-win [data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._setup.winMode = btn.dataset.mode;
        this.syncSetupButtons();
      });
    });
    document.querySelectorAll("#mp-minutes [data-min]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._setup.minutes = Number(btn.dataset.min);
        this.syncSetupButtons();
      });
    });
    document.querySelectorAll("#mp-map [data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._setup.mapScope = btn.dataset.scope;
        this.syncSetupButtons();
      });
    });
    document.getElementById("btn-mp-start").addEventListener("click", () => this.onStart());
  },

  /** Reflect the current setup choices on the toggle buttons. */
  syncSetupButtons() {
    document.querySelectorAll("#mp-count [data-count]").forEach((btn) => {
      const on = Number(btn.dataset.count) === this._setup.count;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll("#mp-win [data-mode]").forEach((btn) => {
      const on = btn.dataset.mode === this._setup.winMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll("#mp-minutes [data-min]").forEach((btn) => {
      const on = Number(btn.dataset.min) === this._setup.minutes;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll("#mp-map [data-scope]").forEach((btn) => {
      const on = btn.dataset.scope === this._setup.mapScope;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    document.getElementById("mp-minutes").classList.toggle("hidden", this._setup.winMode !== "timed");
  },

  /** Render one row per player: name input + 4 colour swatches. */
  renderSetupRows() {
    const box = document.getElementById("mp-players");
    box.innerHTML = "";
    this._setup.players.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "mp-player-row";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "mp-name";
      input.maxLength = 12;
      input.value = p.name;
      input.setAttribute("aria-label", `Player ${i + 1} name`);
      input.addEventListener("input", () => { p.name = input.value; });
      row.appendChild(input);

      const swatches = document.createElement("div");
      swatches.className = "mp-swatches";
      this.COLORS.forEach((c, ci) => {
        const usedByOther = this._setup.players.some((q, qi) => qi !== i && q.color === ci);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mp-swatch" + (p.color === ci ? " selected" : "") + (usedByOther ? " used" : "");
        b.style.background = c.hex;
        b.setAttribute("aria-label", c.id);
        b.disabled = usedByOther;
        b.addEventListener("click", () => {
          p.color = ci;
          this.renderSetupRows();
        });
        swatches.appendChild(b);
      });
      row.appendChild(swatches);
      box.appendChild(row);
    });
  },

  /** Validate the setup and start the game. */
  onStart() {
    const err = document.getElementById("mp-setup-error");
    const names = this._setup.players.map((p) => (p.name || "").trim());
    if (names.some((n) => !n)) {
      err.textContent = "😅 Every player needs a name!";
      err.classList.remove("hidden");
      return;
    }
    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      err.textContent = "😅 Names must be different — no two players with the same name!";
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    this.start({
      players: this._setup.players.map((p, i) => ({ name: names[i], color: p.color })),
      win: { mode: this._setup.winMode, minutes: this._setup.minutes },
      mapScope: this._setup.mapScope,
    });
  },

  /* ================= game flow ================= */
  /** Build the state from the setup, save it and enter the game screen. */
  start(setup) {
    this.clearToasts(); // messages from a previous game must not replay in a new one
    this.state = {
      v: 1,
      players: setup.players.map((p) => ({
        name: p.name,
        color: p.color,
        home: null,
        points: 0,
        geoSinceMath: 0,
        hintsUsed: 0,
        alive: true,
      })),
      ownership: {},
      turn: 0,
      phase: "homes",
      win: {
        mode: setup.win.mode,
        minutes: setup.win.mode === "timed" ? setup.win.minutes : null,
      },
      mapScope: setup.mapScope || "world",
      timeLeftMs: setup.win.mode === "timed" ? setup.win.minutes * 60000 : null,
      asked: [],
    };
    this.save();
    this.enterGame();
  },

  /** Switch the page into multiplayer mode and render the world map. */
  enterGame() {
    GeoGame.mode = "multi";
    document.body.classList.add("mp-mode");
    GeoGame.showScreen("screen-game");
    // Solo-only UI from a previous campaign must not leak into multiplayer.
    document.getElementById("home-banner").classList.add("hidden");
    document.getElementById("territory-card").classList.add("hidden");
    GeoMap.render(
      document.getElementById("map-svg"),
      GeoGame.geojson.features,
      (f) => this.styleFor(f),
      {
        playable: GeoGame.playableIsos,
        nameFor: (f) => GeoGame.nameOf[f.properties.iso3] || f.properties.name,
      }
    );
    GeoMap.reset();
    // A one-continent game zooms straight to its continent.
    if (this.state.mapScope && this.state.mapScope !== "world") {
      GeoMap.focusIsos(this.scopeIsos(), false);
    }
    this.refresh();
    // Resuming a finished game goes straight to the standings (no hand-off).
    if (this.state.phase === "over") {
      this.showStandings();
      return;
    }
    // Resuming mid-game: hand the device to the player whose turn it is —
    // or to the defender when a strike-back is still waiting.
    if (this.state.phase === "turn") {
      if (this.state.pending && this.state.pending.kind === "strike") {
        this.strikeHandoff();
      } else {
        const p = this.state.players[this.state.turn];
        this.showHandoff(this.state.turn, `Pass to ${p.name}`, () => this.refresh());
      }
    }
    // Timed games count down from here (ticks only run during turns).
    if (this.state.win.mode === "timed") this.startTimer();
  },

  /** Resume a saved multiplayer game (reload / "Continue multiplayer game"). */
  resume() {
    const s = this.load();
    if (!s) return;
    this.state = s;
    this.enterGame();
  },

  /** Leave multiplayer back to the start screen. The save is kept. */
  quit() {
    this.clearToasts();
    this.stopTimer(); // the countdown pauses while the game is not on screen
    GeoGame.mode = "solo";
    document.body.classList.remove("mp-mode");
    document.getElementById("mp-banner").classList.add("hidden");
    GeoGame.showScreen("screen-start");
  },

  /** Drop queued toasts (start of a new game, leaving multiplayer). */
  clearToasts() {
    GeoGame._toastQueue.length = 0;
    if (GeoGame._toastShowing) GeoGame._toastShowing.hiddenByCard = false;
    GeoGame.dismissToast();
  },

  /* ================= map interaction ================= */
  /** Map clicks route here while GeoGame.mode === "multi". */
  onTerritoryClick(iso3) {
    const s = this.state;
    if (!s || s.phase === "over") return;
    if (!this.inScope(iso3)) return; // backdrop or out-of-scope country

    if (s.phase === "homes") {
      if (s.ownership[iso3] !== undefined) {
        GeoGame.toast("🚫 That country is already claimed — pick another one!");
        return;
      }
      const p = s.players[s.turn];
      s.ownership[iso3] = s.turn;
      p.home = iso3;
      GeoGame.toast(`🏠 ${p.name} planted their home flag in ${GeoGame.nameOf[iso3]}!`);
      GeoMap.flash(iso3);
      if (s.players.every((pl) => pl.home !== null)) {
        s.phase = "turn";
        s.turn = 0;
        this.save();
        this.refresh();
        const first = s.players[0];
        this.showHandoff(0, `Pass to ${first.name}`, () => this.refresh());
        return;
      }
      s.turn = (s.turn + 1) % s.players.length;
      this.save();
      this.refresh();
      return;
    }

    if (s.phase === "turn") {
      this.onAttackClick(iso3);
    }
  },

  /* ================= turns & attacks (M2a) ================= */
  /** True when iso3 is playable in this game (map scope). */
  inScope(iso3) {
    if (!GeoGame.playableIsos.has(iso3)) return false;
    const scope = (this.state && this.state.mapScope) || "world";
    return scope === "world" || GeoGame.contOf[iso3] === scope;
  },

  /** Every playable iso3 in this game's map scope. */
  scopeIsos() {
    const scope = (this.state && this.state.mapScope) || "world";
    if (scope === "world") return Array.from(GeoGame.playableIsos);
    const cont = GeoGame.continents.find((c) => c.id === scope);
    return cont ? cont.territories.map((t) => t.iso3) : [];
  },

  /**
   * Point GeoGame's question machinery at player i: the shared `asked`
   * list (questions never repeat across players) and their math-nudge
   * streak. GeoGame.persist is a no-op in multiplayer.
   */
  playerView(i) {
    const s = this.state;
    const p = s.players[i];
    GeoGame.state = {
      asked: s.asked,
      geoSinceMath: p.geoSinceMath,
      hintsUsed: 0,
      stats: { byCategory: {} },
    };
  },

  /** Number of countries player i owns. */
  countOf(i) {
    const s = this.state;
    if (!s) return 0;
    return Object.keys(s.ownership).filter((k) => s.ownership[k] === i).length;
  },

  /** Indices of the players still in the game. */
  alivePlayers() {
    const out = [];
    this.state.players.forEach((p, i) => { if (p.alive) out.push(i); });
    return out;
  },

  /**
   * One attack per turn: open the territory card for iso3. The subject
   * and difficulty buttons start the contest (GeoGame.startContest);
   * the result comes back through onContestDone.
   */
  onAttackClick(iso3) {
    const s = this.state;
    if (!s || s.phase !== "turn" || s.pending) return;
    const owner = s.ownership[iso3];
    if (owner === s.turn) {
      GeoGame.toast("✅ That's already yours!");
      return;
    }
    this.playerView(s.turn);
    GeoGame.showTerritoryCard(iso3, "neutral");
    const ownerEl = document.getElementById("terr-owner");
    const easyBtn = document.querySelector('.diff-btn[data-tier="easy"]');
    const easyNote = document.getElementById("terr-easy-note");
    if (owner === undefined || owner === null) {
      ownerEl.textContent = "⚪ Unclaimed — a right answer takes it!";
    } else {
      const defender = s.players[owner];
      ownerEl.textContent = `⚔️ Held by ${defender.name} — miss and ${defender.name} gets a strike-back!`;
    }
    // Enemy home countries need Medium or Hard (same rule as the Baron's fortresses).
    const isHome = owner !== undefined && owner !== null && s.players[owner].home === iso3;
    easyBtn.disabled = isHome;
    easyNote.classList.toggle("hidden", !isHome);
    if (isHome) easyNote.textContent = `🏠 ${s.players[owner].name}'s home needs Medium or Hard!`;
    this._attack = { iso3, attacker: s.turn, defender: owner === undefined ? null : owner };
  },

  /** The contest hook (GeoGame.contestHook) lands here with the result. */
  onContestDone(c) {
    const s = this.state;
    // A strike-back contest resolves through finishStrike, not the attack flow.
    if (s && s.pending && s.pending.kind === "strike") {
      this.finishStrike(c);
      return;
    }
    const atk = this._attack;
    if (!s || !atk) return;
    const attacker = s.players[atk.attacker];
    // Math resets the geo streak; geography extends it (per player).
    if (c.question.type === "math") attacker.geoSinceMath = 0;
    else attacker.geoSinceMath = (attacker.geoSinceMath || 0) + 1;
    const country = GeoGame.nameOf[atk.iso3];
    if (c.wasCorrect) {
      s.ownership[atk.iso3] = atk.attacker;
      const pts = GeoGame.contestPoints(c) + (c.nudged ? 5 : 0);
      attacker.points += pts;
      GeoSound.conquer();
      GeoConfetti.burst({ at: atk.iso3, count: 60, power: 420 });
      GeoGame.toast(`🎉 ${attacker.name} took ${country}! +${pts} pts`);
      this.checkEliminated();
      this.endTurn();
    } else if (atk.defender === null) {
      GeoGame.toast(`😅 Missed — ${country} stays unclaimed.`);
      this.endTurn();
    } else {
      const defender = s.players[atk.defender];
      GeoGame.toast(`😅 Missed — ${defender.name} keeps ${country}.`);
      this.onEnemyMiss(c);
    }
  },

  /**
   * The attacker missed an enemy country: the defender earns a
   * strike-back — a question of the same subject and tier, answered
   * right after the hand-off (startStrike / finishStrike).
   */
  onEnemyMiss(c) {
    const a = this._attack;
    const s = this.state;
    s.pending = {
      kind: "strike",
      iso3: a.iso3,
      attacker: a.attacker,
      defender: a.defender,
      tier: c.tier,
      subject: c.subject || "geo",
    };
    this.save();
    this.strikeHandoff();
  },

  /** Hand the device to the defender for their strike-back question. */
  strikeHandoff() {
    const p = this.state.pending;
    const defName = this.state.players[p.defender].name;
    const atkName = this.state.players[p.attacker].name;
    this.showHandoff(
      p.defender,
      "🛡️ Strike-back! " + defName + ", answer right to grab one of " + atkName + "'s countries!",
      () => this.startStrike()
    );
  },

  /** The defender answers their strike-back question (same subject & tier). */
  startStrike() {
    const p = this.state.pending;
    this.playerView(p.defender);
    GeoGame.startContest(p.iso3, p.tier, p.subject);
  },

  /**
   * The country a successful strike-back takes from the attacker: one
   * of their in-scope countries, preferring ones adjacent to the
   * contested country; their home only when it is their last country.
   */
  strikePrize(p) {
    const s = this.state;
    const home = s.players[p.attacker].home;
    const mine = Object.keys(s.ownership).filter(
      (k) => s.ownership[k] === p.attacker && this.inScope(k)
    );
    const neighbours = this.adjacency[p.iso3] || [];
    const adjacent = mine.filter((k) => k !== home && neighbours.includes(k));
    const nonHome = mine.filter((k) => k !== home);
    const group = adjacent.length ? adjacent : nonHome.length ? nonHome : mine;
    if (!group.length) return null;
    return group[Math.floor(Math.random() * group.length)];
  },

  /** Resolve the defender's strike-back, then end the attacker's turn. */
  finishStrike(c) {
    const s = this.state;
    const p = s.pending;
    const defender = s.players[p.defender];
    const attacker = s.players[p.attacker];
    // Math resets the geo streak; geography extends it (per player).
    if (c.question.type === "math") defender.geoSinceMath = 0;
    else defender.geoSinceMath = (defender.geoSinceMath || 0) + 1;
    const prize = c.wasCorrect ? this.strikePrize(p) : null;
    if (prize) {
      s.ownership[prize] = p.defender;
      defender.points += 10;
      if (attacker.home === prize) attacker.home = null;
      GeoSound.steal();
      GeoMap.flash(prize);
      GeoGame.toast(`🛡️ ${defender.name} struck back and took ${GeoGame.nameOf[prize]} from ${attacker.name}! +10 pts`);
    } else {
      GeoGame.toast("🛡️ Strike-back missed — nothing changes.");
    }
    this.state.pending = null;
    this._attack = null;
    this.checkEliminated();
    this.endTurn(); // s.turn is still the attacker — the turn passes from them
  },

  /** Players with no countries left are out of the game. */
  checkEliminated() {
    const s = this.state;
    s.players.forEach((p, i) => {
      if (p.alive && this.countOf(i) === 0) {
        p.alive = false;
        GeoGame.toast(`💥 ${p.name} is out of the game!`);
      }
    });
  },

  /** End the turn: save, maybe finish, then hand over to the next alive player. */
  endTurn() {
    const s = this.state;
    this.save();
    if (this.isOver()) { this.finish(); return; }
    const alive = this.alivePlayers();
    s.turn = alive[(alive.indexOf(s.turn) + 1) % alive.length];
    this.save();
    this.refresh();
    const p = s.players[s.turn];
    this.showHandoff(s.turn, `Pass to ${p.name}`, () => this.refresh());
  },

  /* ================= timer (M3) ================= */
  /** Start the 1-second countdown for a timed game (idempotent). */
  startTimer() {
    this.stopTimer();
    this._ticks = 0;
    this._timer = setInterval(() => this.tickTimer(), 1000);
  },

  /** Stop the countdown (game over, quit, or a fresh game). */
  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  /** "⏱ m:ss" for the banner countdown. */
  timerText(ms) {
    const t = Math.max(0, ms || 0);
    const m = Math.floor(t / 60000);
    const sec = Math.floor((t % 60000) / 1000);
    return "⏱ " + m + ":" + String(sec).padStart(2, "0");
  },

  /**
   * One countdown tick. The clock only runs down while a turn is in
   * progress and the page is visible; the save is written every 5
   * ticks. At 0 the game ends right away when nothing is in flight —
   * otherwise the next endTurn() sees timeLeftMs <= 0 in isOver().
   */
  tickTimer() {
    const s = this.state;
    if (!s || s.phase !== "turn" || document.hidden) return;
    s.timeLeftMs = Math.max(0, (s.timeLeftMs || 0) - 1000);
    const timer = document.getElementById("mp-timer");
    if (timer) timer.textContent = this.timerText(s.timeLeftMs);
    this._ticks++;
    if (this._ticks % 5 === 0) this.save();
    if (s.timeLeftMs <= 0 && !s.timeUp) {
      s.timeUp = true;
      this.save();
      // No question open and no strike-back waiting: end now. The
      // hand-off overlay — hidden or showing — does not hold the game
      // up; finish() hides it.
      if (!GeoGame.currentContest && !s.pending) this.finish();
    }
  },

  /**
   * Timed: the clock ran out or only one player is left. Domination:
   * last player standing — or, on a one-continent map, one player
   * holding every in-scope country (the last player standing only
   * wins once no in-scope country is unclaimed).
   */
  isOver() {
    const s = this.state;
    if (!s || !s.win) return false;
    const alive = this.alivePlayers();
    if (s.win.mode === "timed") {
      return s.timeLeftMs <= 0 || alive.length <= 1;
    }
    // Domination.
    const scope = s.mapScope || "world";
    if (scope === "world") return alive.length <= 1;
    // One continent: over when no in-scope country is unclaimed and a
    // single player owns them all (or is the last one standing).
    const inScope = this.scopeIsos();
    if (!inScope.length) return alive.length <= 1;
    let unclaimed = 0;
    const owners = new Set();
    for (const iso of inScope) {
      const o = s.ownership[iso];
      if (o === undefined || o === null) unclaimed++;
      else owners.add(o);
    }
    return unclaimed === 0 && (owners.size === 1 || alive.length <= 1);
  },

  /** End the game: freeze the state and show the final standings. */
  finish() {
    const s = this.state;
    this.stopTimer();
    s.phase = "over";
    document.getElementById("mp-handoff").classList.add("hidden");
    document.getElementById("question-modal").classList.add("hidden");
    document.getElementById("territory-card").classList.add("hidden");
    this.save();
    this.refresh();
    this.showStandings();
  },

  /**
   * Final standings: one row per player (countries = countOf(i),
   * points), sorted by countries desc then points desc; players equal
   * on both share a rank.
   */
  standings() {
    const s = this.state;
    const rows = s.players.map((p, i) => ({
      i,
      name: p.name,
      color: p.color,
      countries: this.countOf(i),
      points: p.points,
      alive: p.alive,
      rank: 0,
    }));
    rows.sort((a, b) => b.countries - a.countries || b.points - a.points);
    rows.forEach((r, idx) => {
      const prev = rows[idx - 1];
      r.rank = prev && prev.countries === r.countries && prev.points === r.points
        ? prev.rank
        : idx + 1;
    });
    return rows;
  },

  /** Fill and show the final standings modal (medals, confetti, fanfare). */
  showStandings() {
    const rows = this.standings();
    const MEDALS = ["🥇", "🥈", "🥉"];
    const title = document.getElementById("mp-standings-title");
    const winners = rows.filter((r) => r.rank === 1);
    title.textContent = winners.length > 1
      ? "🤝 It's a tie: " + winners.map((w) => w.name).join(" & ") + "!"
      : "🏆 " + winners[0].name + " wins!";
    const list = document.getElementById("mp-standings-list");
    list.innerHTML = "";
    rows.forEach((r) => {
      const li = document.createElement("li");
      li.className = "mp-standing" + (r.alive ? "" : " out");

      const medal = document.createElement("span");
      medal.className = "mp-medal";
      medal.textContent = r.rank <= 3 ? MEDALS[r.rank - 1] : String(r.rank);
      li.appendChild(medal);

      const dot = document.createElement("span");
      dot.className = "mp-dot";
      dot.style.background = this.COLORS[r.color].hex;
      li.appendChild(dot);

      const name = document.createElement("span");
      name.className = "mp-name";
      name.textContent = r.name;
      li.appendChild(name);

      const stats = document.createElement("span");
      stats.className = "mp-stats";
      stats.textContent = `🗺️ ${r.countries} · ⭐ ${r.points}`;
      li.appendChild(stats);

      list.appendChild(li);
    });
    document.getElementById("mp-standings").classList.remove("hidden");
    GeoConfetti.burst({ count: 160, power: 520 });
    GeoSound.victory();
  },

  /** Full-screen "pass the device" overlay in the next player's colour. */
  showHandoff(playerIdx, message, onReady) {
    const p = this.state.players[playerIdx];
    const el = document.getElementById("mp-handoff");
    el.style.background = this.COLORS[p.color].hex;
    document.getElementById("mp-handoff-text").textContent = message;
    const btn = document.getElementById("btn-mp-ready");
    btn.textContent = `I'm ${p.name} — ready!`;
    this._onReady = onReady;
    el.classList.remove("hidden");
    btn.focus();
  },

  /* ================= rendering ================= */
  /** Style one map feature: backdrop, a player's colour, or unclaimed. */
  styleFor(feature) {
    const iso3 = feature.properties.iso3;
    const name = GeoGame.nameOf[iso3] || feature.properties.name || "Unknown";
    if (!this.inScope(iso3)) {
      return { cls: "t-backdrop", clickable: false, title: name };
    }
    const ownerIdx = this.state ? this.state.ownership[iso3] : undefined;
    if (ownerIdx !== undefined && this.state.players[ownerIdx]) {
      const p = this.state.players[ownerIdx];
      const isHome = p.home === iso3;
      return {
        cls: "t-mp t-mpc-" + this.COLORS[p.color].id,
        clickable: true,
        title: name + " — " + p.name + (isHome ? " 🏠" : ""),
      };
    }
    return { cls: "t-neutral", clickable: true, title: name };
  },

  /** Re-colour the map and update the banner + scoreboard. */
  refresh() {
    if (!this.state) return;
    GeoMap.refresh((f) => this.styleFor(f));
    this.renderBanner();
    this.renderScoreboard();
  },

  /** Turn banner at the top of the map card, in the current player's colour. */
  renderBanner() {
    const s = this.state;
    const banner = document.getElementById("mp-banner");
    const timer = document.getElementById("mp-timer");
    const p = s.players[s.turn];
    let text;
    if (s.phase === "homes") {
      text = `🏠 ${p.name}, tap a country to plant your home flag!`;
    } else if (s.phase === "turn") {
      text = `🎯 ${p.name}'s turn — tap a country to attack!`;
    } else {
      text = "🏁 Game over!";
    }
    banner.style.background = this.COLORS[p.color].hex;
    banner.textContent = text + " ";
    if (timer) {
      // Timed games show the countdown; domination leaves it empty.
      timer.textContent = s.win.mode === "timed" ? this.timerText(s.timeLeftMs) : "";
      banner.appendChild(timer); // keep the timer span at the end
    }
    banner.classList.remove("hidden");
  },

  /** Scoreboard card: one row per player (dot, name, countries, points). */
  renderScoreboard() {
    const s = this.state;
    const sb = document.getElementById("mp-scoreboard");
    sb.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = "👥 Players";
    sb.appendChild(h);
    s.players.forEach((p, i) => {
      const countries = this.countOf(i);
      const row = document.createElement("div");
      row.className =
        "mp-row" +
        (i === s.turn && s.phase !== "over" ? " current" : "") +
        (p.alive ? "" : " out");

      const dot = document.createElement("span");
      dot.className = "mp-dot";
      dot.style.background = this.COLORS[p.color].hex;
      row.appendChild(dot);

      const name = document.createElement("span");
      name.className = "mp-name";
      name.textContent = p.name + (p.home ? " 🏠" : "");
      row.appendChild(name);

      const stats = document.createElement("span");
      stats.className = "mp-stats";
      stats.textContent = `🗺️ ${countries} · ⭐ ${p.points}`;
      row.appendChild(stats);

      sb.appendChild(row);
    });
  },
};
