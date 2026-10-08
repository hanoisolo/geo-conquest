/* ============================================================
   app.js — boot the game: load all data files, inject them into
   the engine, and wire up every button on the page.
   ============================================================ */
"use strict";

window.addEventListener("DOMContentLoaded", () => {
  const QUESTION_FILES = [
    "data/questions-na.json",
    "data/questions-sa.json",
    "data/questions-eu.json",
    "data/questions-af.json",
    "data/questions-as.json",
    "data/questions-oc.json",
  ];

  const loads = [
    fetch("data/countries.geojson").then((r) => {
      if (!r.ok) throw new Error("countries.geojson");
      return r.json();
    }),
    fetch("data/territories.json").then((r) => {
      if (!r.ok) throw new Error("territories.json");
      return r.json();
    }),
    ...QUESTION_FILES.map((f) =>
      fetch(f).then((r) => {
        if (!r.ok) throw new Error(f);
        return r.json();
      })
    ),
  ];

  Promise.all(loads)
    .then(([geojson, territories, ...qBanks]) => {
      const questions = qBanks.flat();
      GeoGame.init({ geojson, territories, questions });
      wireUI();
      // Offer "Continue" when a save exists.
      const save = GeoStorage.load();
      if (save && save.activeContinent) {
        const btn = document.getElementById("btn-continue");
        btn.classList.remove("hidden");
        btn.textContent = `▶ Continue your journey (${save.points} pts)`;
      }
    })
    .catch((err) => {
      document.querySelector(".hero .tagline").innerHTML =
        "😢 Oops! The game data couldn't load.<br />" +
        "Please serve this folder with a local web server (see README) — " +
        "opening index.html directly from disk blocks data loading.<br />" +
        `<small>(${GeoGame.escapeHtml ? GeoGame.escapeHtml(err.message) : err.message})</small>`;
    });
});

function wireUI() {
  const $ = (id) => document.getElementById(id);

  // ---- start screen ----
  $("btn-quest").addEventListener("click", () => GeoGame.newCampaign("quest"));
  $("btn-world").addEventListener("click", () => GeoGame.newCampaign("world"));
  $("btn-continue").addEventListener("click", () => GeoGame.continueCampaign());
  $("btn-how").addEventListener("click", () => $("how-modal").classList.remove("hidden"));
  $("btn-how-close").addEventListener("click", () => $("how-modal").classList.add("hidden"));
  $("how-modal").addEventListener("click", (e) => {
    if (e.target === $("how-modal")) $("how-modal").classList.add("hidden");
  });

  // ---- continent picker ----
  $("btn-pick-back").addEventListener("click", () => GeoGame.showScreen("screen-start"));

  // ---- map zoom ----
  $("zoom-in").addEventListener("click", () => GeoMap.zoom(0.7));
  $("zoom-out").addEventListener("click", () => GeoMap.zoom(1.4));
  $("zoom-reset").addEventListener("click", () => GeoMap.reset());

  // ---- territory card: difficulty buttons start a contest ----
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const iso3 = $("territory-card").dataset.iso3;
      if (iso3) GeoGame.startContest(iso3, btn.dataset.tier);
    });
  });

  // ---- question modal ----
  $("btn-q-continue").addEventListener("click", () => GeoGame.resolveContest());

  // ---- victory modal ----
  $("btn-victory-restart").addEventListener("click", () => {
    if (confirm("Start a brand-new campaign? Your current progress will be erased.")) {
      GeoGame.resetToStart();
    }
  });

  // ---- new campaign (top bar) ----
  $("btn-restart").addEventListener("click", () => {
    if (confirm("Start a brand-new campaign? Your current progress will be erased.")) {
      GeoStorage.clear();
      location.reload();
    }
  });
}
