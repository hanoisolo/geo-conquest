/* ============================================================
   multi.js — local multiplayer: 2-4 players, pass-and-play on
   one device. No Baron — players take turns conquering the
   whole world.

   Owns the multiplayer state and its own save (localStorage key
   geoConquestMultiV1 — the solo save is never read, written or
   cleared by this module), the setup screen, the turn banner
   and the scoreboard.

   Segment M1: mode card, setup screen, home flags, banner,
   scoreboard. Attacks land in M2, the timer and standings in M3.

   State shape:
     { v: 1,
       players: [{ name, color (COLORS index), home: null,
                   points: 0, geoSinceMath: 0, hintsUsed: 0,
                   alive: true }],
       ownership: { iso3: playerIndex },
       turn: 0,
       phase: "homes" | "turn" | "over",
       win: { mode: "timed" | "domination", minutes },
       timeLeftMs, asked: [] }
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

  /* ================= boot ================= */
  init({ adjacency }) {
    this.adjacency = adjacency || {};
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
    });
  },

  /* ================= game flow ================= */
  /** Build the state from the setup, save it and enter the game screen. */
  start(setup) {
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
    this.refresh();
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
    GeoGame.mode = "solo";
    document.body.classList.remove("mp-mode");
    document.getElementById("mp-banner").classList.add("hidden");
    GeoGame.showScreen("screen-start");
  },

  /* ================= map interaction ================= */
  /** Map clicks route here while GeoGame.mode === "multi". */
  onTerritoryClick(iso3) {
    const s = this.state;
    if (!s || s.phase === "over") return;
    if (!GeoGame.playableIsos.has(iso3)) return; // backdrop country

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
      } else {
        s.turn = (s.turn + 1) % s.players.length;
      }
      this.save();
      this.refresh();
      return;
    }

    if (s.phase === "turn") {
      this.onAttackClick(iso3);
    }
  },

  /** M2 replaces this stub with the real attack flow. */
  onAttackClick(iso3) {
    GeoGame.toast("⚔️ Attacks arrive in the next update");
  },

  /* ================= rendering ================= */
  /** Style one map feature: backdrop, a player's colour, or unclaimed. */
  styleFor(feature) {
    const iso3 = feature.properties.iso3;
    const name = GeoGame.nameOf[iso3] || feature.properties.name || "Unknown";
    if (!GeoGame.playableIsos.has(iso3)) {
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
    if (timer) banner.appendChild(timer); // keep the (empty) timer span at the end
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
      const countries = Object.keys(s.ownership).filter((k) => s.ownership[k] === i).length;
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
