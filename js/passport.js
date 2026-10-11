/* ============================================================
   passport.js — the passport book (avatars + passport release).

   A collect-them-all album of the countries a player has
   conquered. The side-panel button (#btn-passport) carries the
   stamp count (#passport-count); GeoPassport.open() renders
   the book into #passport-body inside #passport-modal.

   The game state owns the book: { stamps: { ISO3: { at,
   fresh } } }. GeoPassport.stamp(book, iso3) adds a stamp
   (flagged `fresh`, so the next open() slams it in with the
   ink "thunk") and bumps the button; updateButton(book, total)
   refreshes the count.

   Pages are grouped per continent in GeoGame.continents order.
   A collected page shows the flag, capital, continent and fun
   fact (data/facts.json + data/capitals.json, fetched once by
   load()); missing facts/capitals just skip that line — this
   module never throws on missing data.
   ============================================================ */
"use strict";

// `var` (not `const`) so the object also lands on `window` —
// same pattern as GeoBaron / GeoAvatars.
var GeoPassport = {
  /** ISO3 -> fun fact text (from data/facts.json). */
  facts: null,
  /** ISO3 -> capital name (from data/capitals.json). */
  capitals: null,

  _bumpTimer: null,
  _wired: false,

  /**
   * Fetch the fun facts and the capitals. Always resolves — a
   * missing file just leaves those lines off the passport pages.
   */
  load() {
    const get = (url) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    return Promise.all([get("data/facts.json"), get("data/capitals.json")]).then(
      ([factsJson, capsJson]) => {
        this.facts = (factsJson && factsJson.facts) || {};
        const caps = {};
        if (capsJson && Array.isArray(capsJson.countries)) {
          for (const c of capsJson.countries) {
            if (c && c.iso3) caps[c.iso3] = c.capital;
          }
        }
        this.capitals = caps;
      }
    );
  },

  /**
   * Stamp `iso3` into the book. New stamps are flagged `fresh`
   * (the next open() plays the ink thunk) and bump the side
   * panel button for 900 ms. Returns true when a stamp was
   * added, false when the country was already stamped.
   */
  stamp(book, iso3) {
    if (!book || !book.stamps || book.stamps[iso3]) return false;
    book.stamps[iso3] = { at: Date.now(), fresh: true };
    const btn = document.getElementById("btn-passport");
    if (btn) {
      btn.classList.remove("pp-bump");
      void btn.offsetWidth; // restart the pulse on back-to-back stamps
      btn.classList.add("pp-bump");
      clearTimeout(this._bumpTimer);
      this._bumpTimer = setTimeout(() => btn.classList.remove("pp-bump"), 900);
    }
    return true;
  },

  /** Refresh the stamp count on the side panel button. */
  updateButton(book, total) {
    const el = document.getElementById("passport-count");
    if (!el) return;
    const n = book && book.stamps ? Object.keys(book.stamps).length : 0;
    el.textContent = `${n}/${total}`;
  },

  /**
   * Render the passport book into #passport-body and show
   * #passport-modal. `opts`: { name, avatar, stamps, isos } —
   * `isos` are the countries in play (default: every country).
   */
  open(opts) {
    const body = document.getElementById("passport-body");
    const modal = document.getElementById("passport-modal");
    if (!body || !modal) return;

    const o = opts || {};
    const stamps = o.stamps || {};
    const name = o.name || "Explorer";
    const continents = ((typeof GeoGame !== "undefined") && GeoGame.continents) || [];

    // Countries in play — default: all of them.
    const isos = Array.isArray(o.isos) ? o.isos.slice() : [];
    if (!isos.length) {
      for (const cont of continents) {
        for (const t of cont.territories || []) isos.push(t.iso3);
      }
    }
    const inPlay = new Set(isos);

    const esc = (s) =>
      (typeof GeoGame !== "undefined") && typeof GeoGame.escapeHtml === "function"
        ? GeoGame.escapeHtml(String(s))
        : String(s);

    const collected = isos.filter((iso) => stamps[iso]).length;

    // Header: the explorer's happy face on the navy cover.
    let face = "";
    if (o.avatar && (typeof GeoAvatars !== "undefined") && typeof GeoAvatars.faceUrl === "function") {
      try {
        face = GeoAvatars.faceUrl(o.avatar, "happy");
      } catch (e) {
        face = "";
      }
    }

    let html = '<div class="pp-header">';
    if (face) {
      html += `<img class="pp-avatar" src="${esc(face)}" alt="" width="48" height="48" />`;
    }
    html += '<div class="pp-head-text">';
    html += `<div class="pp-title">${esc(name)}'s passport</div>`;
    html += `<div class="pp-sub">🛂 ${collected} / ${isos.length} stamps</div>`;
    html += "</div></div>";

    // One section per continent that has countries in play,
    // in GeoGame.continents order.
    // Continents with stamps first (most stamps first), so collected pages are on top.
    const gotIn = (c) => (c.territories || []).filter((t) => t && inPlay.has(t.iso3) && stamps[t.iso3]).length;
    const ordered = continents.slice().sort((a, b) => gotIn(b) - gotIn(a));
    for (const cont of ordered) {
      const terrs = (cont.territories || []).filter((t) => t && inPlay.has(t.iso3));
      if (!terrs.length) continue;
      const emoji =
        ((typeof GeoGame !== "undefined") && GeoGame.CONT_EMOJI && GeoGame.CONT_EMOJI[cont.id]) || "🌐";
      const got = terrs.filter((t) => stamps[t.iso3]).length;

      html += '<section class="pp-section">';
      html += `<h4>${emoji} ${esc(cont.name)} <span class="pp-count">${got}/${terrs.length}</span></h4>`;
      html += '<div class="pp-grid">';

      // Collected pages first, then the compact "not yet" tiles in their own grid.
      const sorted = terrs.filter((t) => stamps[t.iso3]).concat(terrs.filter((t) => !stamps[t.iso3]));
      let emptyOpen = false;
      for (const t of sorted) {
        const st = stamps[t.iso3];
        if (st) {
          const fresh = st.fresh === true;
          if (fresh) delete st.fresh; // the thunk plays once
          html += `<div class="pp-page pp-got${fresh ? " pp-new" : ""}">`;
          html += `<img class="pp-flag" src="assets/flags/${esc(t.iso3)}.svg" alt="${esc(t.name)} flag" loading="lazy" />`;
          html += `<div class="pp-name">${esc(t.name)}</div>`;
          const capital = this.capitals && this.capitals[t.iso3];
          if (capital) {
            html += `<div class="pp-line">🏛️ Capital: ${esc(capital)}</div>`;
          }
          html += `<div class="pp-line pp-cont">${emoji} ${esc(cont.name)}</div>`;
          const fact = this.facts && this.facts[t.iso3];
          if (fact) {
            html += `<div class="pp-fact">💡 ${esc(fact)}</div>`;
          }
          html += '<div class="pp-stamp">✔ VISITED</div>';
          html += "</div>";
        } else {
          if (!emptyOpen) { html += '</div><div class="pp-grid pp-grid-empty">'; emptyOpen = true; }
          html += '<div class="pp-page pp-empty">';
          html += `<div class="pp-name">${esc(t.name)}</div>`;
          html += '<div class="pp-line">Not stamped yet</div>';
          html += "</div>";
        }
      }

      html += "</div></section>";
    }

    body.innerHTML = html;
    this._wire();
    modal.classList.remove("hidden");
    const closeBtn = document.getElementById("btn-passport-close");
    if (closeBtn) closeBtn.focus();
  },

  /** Close handlers — wired once, on the first open(). */
  _wire() {
    if (this._wired) return;
    const modal = document.getElementById("passport-modal");
    if (!modal) return;
    this._wired = true;

    const close = () => modal.classList.add("hidden");
    const btn = document.getElementById("btn-passport-close");
    if (btn) btn.addEventListener("click", close);
    // Backdrop click — not a click inside the book itself.
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
    });
  },
};
