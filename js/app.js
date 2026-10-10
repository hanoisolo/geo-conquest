/* ============================================================
   app.js — boot the game: load all data files, inject them into
   the engine, and wire up every button on the page.
   ============================================================ */
"use strict";

window.addEventListener("DOMContentLoaded", () => {
  const loadJson = (path) =>
    fetch(path).then((r) => {
      if (!r.ok) throw new Error(path);
      return r.json();
    });

  // The question-file list lives in data/manifest.json.
  Promise.all([
    loadJson("data/countries.geojson"),
    loadJson("data/territories.json"),
    loadJson("data/capitals.json"),
    loadJson("data/manifest.json"),
  ])
    .then(([geojson, territories, capitals, manifest]) => {
      const files = (manifest && manifest.questionFiles) || [];
      if (!files.length) throw new Error("manifest.json (empty questionFiles)");
      return Promise.all(files.map(loadJson)).then((qBanks) => ({
        geojson, territories, capitals,
        questions: qBanks.flat(),
      }));
    })
    .then((data) => {
      GeoGame.init(data);
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
  $("btn-how").addEventListener("click", () => {
    $("how-modal").classList.remove("hidden");
    $("btn-how-close").focus(); // move focus into the opened modal
  });
  $("btn-how-close").addEventListener("click", () => $("how-modal").classList.add("hidden"));
  $("how-modal").addEventListener("click", (e) => {
    if (e.target === $("how-modal")) $("how-modal").classList.add("hidden");
  });
  // Escape closes the How-to-play modal.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("how-modal").classList.contains("hidden")) {
      $("how-modal").classList.add("hidden");
    }
  });

  // ---- continent picker ----
  $("btn-pick-back").addEventListener("click", () => GeoGame.showScreen("screen-start"));

  // ---- map zoom ----
  $("zoom-in").addEventListener("click", () => GeoMap.zoom(0.7));
  $("zoom-out").addEventListener("click", () => GeoMap.zoom(1.4));
  $("zoom-reset").addEventListener("click", () => GeoMap.reset());

  // ---- territory card: subject toggle + difficulty buttons start a contest ----
  document.querySelectorAll(".subject-btn").forEach((btn) => {
    btn.addEventListener("click", () => GeoGame.setSubject(btn.dataset.subject));
  });
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const iso3 = $("territory-card").dataset.iso3;
      if (iso3) GeoGame.startContest(iso3, btn.dataset.tier, GeoGame.selectedSubject);
    });
  });

  // ---- question modal ----
  $("btn-q-continue").addEventListener("click", () => GeoGame.resolveContest());
  $("btn-hint").addEventListener("click", () => GeoGame.showHint());
  $("btn-similar").addEventListener("click", () => GeoGame.trySimilar());

  // ---- keyboard answers while the question modal is open ----
  // Keys 1-4 pick an option, H shows a hint, Enter continues (when no button has focus).
  document.addEventListener("keydown", (e) => {
    if ($("question-modal").classList.contains("hidden")) return;
    const active = document.activeElement;
    const tag = active ? active.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA") return; // typing stays typing
    if (["1", "2", "3", "4"].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const btn = document.querySelectorAll("#q-options button")[Number(e.key) - 1];
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (e.key === "h" || e.key === "H") {
      const hint = $("btn-hint");
      if (!hint.classList.contains("hidden") && !hint.disabled) hint.click();
      return;
    }
    if (e.key === "Enter" && tag !== "BUTTON") {
      const cont = $("btn-q-continue");
      if (!cont.classList.contains("hidden")) cont.click();
    }
  });

  // ---- map find mode ("find it on the map" questions) ----
  $("btn-find-giveup").addEventListener("click", () => GeoGame.giveUpFind());

  // ---- toast: tap to dismiss the current message early ----
  $("toast").addEventListener("click", () => GeoGame.dismissToast());

  // ---- sound: mute toggle (persisted) + tiny click ticks ----
  const muteBtn = $("btn-mute");
  const syncMuteBtn = () => {
    const muted = GeoSound.isMuted();
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", muted ? "Unmute sounds" : "Mute sounds");
  };
  syncMuteBtn();
  muteBtn.addEventListener("click", () => {
    GeoSound.toggle();
    syncMuteBtn();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn, .mode-card, .continent-card")) GeoSound.click();
  });

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
