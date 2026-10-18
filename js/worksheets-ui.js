/* ============================================================
   worksheets-ui.js — "My worksheets" screen: uploader, provider
   and key form, per-sheet processing with retry, My decks list,
   play options. All AI/imported text is shown with textContent.
   ============================================================ */
"use strict";

const GeoWSUI = {
  files: [],
  results: [],
  abort: null,
  busy: false,
  deckId: null,
  pending: null,
  KEY_PREFIX: "geoConquestWsKey.",
  PROVIDER_PREF: "geoConquestWsProvider",

  $(id) {
    return document.getElementById(id);
  },

  show(id, on) {
    GeoWSUI.$(id).classList.toggle("hidden", !on);
  },

  msg(id, text, ok) {
    const el = GeoWSUI.$(id);
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
    GeoWSUI.show(id, !!text);
  },

  safeGet(store, k) {
    try {
      return window[store].getItem(k);
    } catch (e) {
      return null;
    }
  },

  safeSet(store, k, v) {
    try {
      window[store].setItem(k, v);
    } catch (e) {}
  },

  safeRemove(store, k) {
    try {
      window[store].removeItem(k);
    } catch (e) {}
  },

  provider() {
    return GeoWSUI.$("ws-provider").value;
  },

  loadKey() {
    const k = GeoWSUI.KEY_PREFIX + GeoWSUI.provider();
    const remembered = GeoWSUI.safeGet("localStorage", k);
    const value = remembered || GeoWSUI.safeGet("sessionStorage", k) || "";
    GeoWSUI.$("ws-key").value = value;
    GeoWSUI.$("ws-remember").checked = !!remembered;
    GeoWSUI.show("ws-remember-warn", !!remembered);
  },

  storeKey() {
    const k = GeoWSUI.KEY_PREFIX + GeoWSUI.provider();
    const v = GeoWSUI.$("ws-key").value.trim();
    if (!v) {
      GeoWSUI.safeRemove("sessionStorage", k);
      GeoWSUI.safeRemove("localStorage", k);
      return;
    }
    GeoWSUI.safeSet("sessionStorage", k, v);
    if (GeoWSUI.$("ws-remember").checked) {
      GeoWSUI.safeSet("localStorage", k, v);
    } else {
      GeoWSUI.safeRemove("localStorage", k);
    }
  },

  forgetKey() {
    GeoWSConfig.PROVIDER_IDS.forEach((id) => {
      const k = GeoWSUI.KEY_PREFIX + id;
      GeoWSUI.safeRemove("localStorage", k);
      GeoWSUI.safeRemove("sessionStorage", k);
    });
    GeoWSUI.$("ws-key").value = "";
    GeoWSUI.$("ws-remember").checked = false;
    GeoWSUI.show("ws-remember-warn", false);
    GeoWSUI.msg("ws-file-msg", "🔑 Key forgotten on this device.", true);
    GeoWSUI.updateMake();
  },

  fillProviders() {
    const select = GeoWSUI.$("ws-provider");
    GeoWSConfig.PROVIDER_IDS.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = GeoWSConfig.PROVIDERS[id].label;
      select.appendChild(opt);
    });
    let pref = GeoWSUI.safeGet("localStorage", GeoWSUI.PROVIDER_PREF);
    if (GeoWSConfig.PROVIDER_IDS.indexOf(pref) === -1) {
      pref = "mistral";
    }
    select.value = pref;
    GeoWSUI.updateKeyLink();
  },

  updateKeyLink() {
    GeoWSUI.$("ws-key-link").href = GeoWSConfig.PROVIDERS[GeoWSUI.provider()].keyUrl;
  },

  sizeLabel(bytes) {
    if (bytes >= 1048576) {
      return (bytes / 1048576).toFixed(1) + " MB";
    }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  },

  addFiles(list) {
    const problems = [];
    const incoming = Array.from(list);
    for (const f of incoming) {
      if (GeoWSUI.files.length >= GeoWSConfig.MAX_FILES) {
        problems.push("Only " + GeoWSConfig.MAX_FILES + " sheets at a time.");
        break;
      }
      const dup = GeoWSUI.files.some((g) => g.name === f.name && g.size === f.size);
      if (GeoWSConfig.ACCEPT_MIME.indexOf(f.type) === -1) {
        problems.push(f.name + ": please use PDF, PNG, JPG or WEBP.");
      } else if (f.size > GeoWSConfig.MAX_FILE_MB * 1048576) {
        problems.push(f.name + ": bigger than 5 MB.");
      } else if (!dup) {
        GeoWSUI.files.push(f);
      }
    }
    GeoWSUI.results = [];
    GeoWSUI.deckId = null;
    GeoWSUI.show("ws-result", false);
    GeoWSUI.show("ws-failed", false);
    GeoWSUI.msg("ws-file-msg", problems.join(" "));
    GeoWSUI.renderFiles();
    GeoWSUI.updateMake();
  },

  removeFile(i) {
    GeoWSUI.files.splice(i, 1);
    GeoWSUI.results.splice(i, 1);
    GeoWSUI.renderFiles();
    GeoWSUI.updateMake();
  },

  renderFiles() {
    const list = GeoWSUI.$("ws-file-list");
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    GeoWSUI.files.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "ws-file";
      const name = document.createElement("span");
      name.className = "ws-file-name";
      name.textContent = f.name;
      const size = document.createElement("span");
      size.className = "ws-file-size";
      size.textContent = GeoWSUI.sizeLabel(f.size);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small";
      btn.textContent = "✕";
      btn.setAttribute("aria-label", "Remove " + f.name);
      btn.disabled = GeoWSUI.busy;
      btn.addEventListener("click", () => {
        GeoWSUI.removeFile(i);
      });
      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(btn);
      list.appendChild(li);
    });
  },

  updateMake() {
    GeoWSUI.$("ws-make").disabled = GeoWSUI.busy || GeoWSUI.files.length === 0 || !GeoWSUI.$("ws-key").value.trim();
  },

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        const comma = text.indexOf(",");
        resolve({
          name: file.name,
          mime: file.type,
          base64: comma === -1 ? text : text.slice(comma + 1)
        });
      };
      reader.onerror = () => {
        reject(new Error("Could not read this file."));
      };
      reader.readAsDataURL(file);
    });
  },

  async process(indexes) {
    if (GeoWSUI.busy) {
      return;
    }
    GeoWSUI.busy = true;
    GeoWSUI.updateMake();
    GeoWSUI.renderFiles();
    GeoWSUI.show("ws-failed", false);
    GeoWSUI.show("ws-result", false);
    GeoWSUI.msg("ws-file-msg", "");
    GeoWSUI.storeKey();
    GeoWSUI.safeSet("localStorage", GeoWSUI.PROVIDER_PREF, GeoWSUI.provider());
    GeoWSUI.abort = new AbortController();
    GeoWSUI.show("ws-progress", true);
    const key = GeoWSUI.$("ws-key").value.trim();
    const p = GeoWSUI.provider();
    const total = indexes.length;
    for (let n = 0; n < total; n++) {
      if (GeoWSUI.abort.signal.aborted) {
        break;
      }
      const i = indexes[n];
      const label = "sheet " + (n + 1) + " of " + total;
      GeoWSUI.setProgress("📖 Reading " + label + "…", n / total);
      let file = null;
      try {
        file = await GeoWSUI.readFile(GeoWSUI.files[i]);
      } catch (e) {
        GeoWSUI.results[i] = { ok: false, error: { kind: "bad_output", message: "Couldn't open this file." } };
        continue;
      }
      const r = await GeoWSProviders.processSheet(file, p, key, {
        signal: GeoWSUI.abort.signal,
        onProgress: (step) => {
          if (step === "building") {
            GeoWSUI.setProgress("✍️ Writing questions for " + label + "…", (n + 0.5) / total);
          }
        }
      });
      file = null;
      GeoWSUI.results[i] = r;
    }
    GeoWSUI.setProgress("", 1);
    GeoWSUI.show("ws-progress", false);
    const cancelled = GeoWSUI.abort.signal.aborted;
    GeoWSUI.abort = null;
    GeoWSUI.busy = false;
    GeoWSUI.renderFiles();
    GeoWSUI.updateMake();
    if (cancelled) {
      GeoWSUI.msg("ws-file-msg", "Stopped. Sheets that finished are kept.");
    }
    GeoWSUI.finish(false);
  },

  setProgress(text, frac) {
    if (text) {
      GeoWSUI.$("ws-progress-text").textContent = text;
    }
    GeoWSUI.$("ws-progress-bar").style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  },

  cancel() {
    if (GeoWSUI.abort) {
      GeoWSUI.abort.abort();
    }
  },

  failedIndexes() {
    const out = [];
    for (let i = 0; i < GeoWSUI.files.length; i++) {
      if (!GeoWSUI.results[i] || !GeoWSUI.results[i].ok) {
        out.push(i);
      }
    }
    return out;
  },

  finish(skipFailed) {
    const failed = GeoWSUI.failedIndexes();
    const okSheets = GeoWSUI.results.filter((r) => r && r.ok).map((r) => r.value);
    if (failed.length && !skipFailed) {
      const list = GeoWSUI.$("ws-failed-list");
      while (list.firstChild) {
        list.removeChild(list.firstChild);
      }
      failed.forEach((i) => {
        const li = document.createElement("li");
        li.textContent = GeoWSUI.files[i].name + " — " + (GeoWSUI.results[i] ? GeoWSUI.results[i].error.message : "Not processed yet.");
        list.appendChild(li);
      });
      GeoWSUI.show("ws-failed", true);
      GeoWSUI.show("ws-skip", okSheets.length > 0);
      return;
    }
    GeoWSUI.show("ws-failed", false);
    if (!okSheets.length) {
      GeoWSUI.msg("ws-file-msg", "No questions yet. Check your key and try again.");
      return;
    }
    if (!GeoWSUI.deckId) {
      GeoWSUI.deckId = GeoWSValidate.newDeckId();
    }
    const merged = GeoWSValidate.mergeSheets(okSheets, GeoWSUI.deckId);
    GeoWSUI.pending = {
      id: GeoWSUI.deckId,
      questions: merged.questions,
      subject: (okSheets[0].meta && okSheets[0].meta.subject) || "General",
      grade: (okSheets[0].meta && okSheets[0].meta.grade) || "",
      sources: GeoWSUI.files.filter((f, i) => GeoWSUI.results[i] && GeoWSUI.results[i].ok).map((f) => f.name)
    };
    GeoWSUI.$("ws-result-text").textContent = "🎉 " + merged.questions.length + " questions from " + okSheets.length + (okSheets.length === 1 ? " sheet" : " sheets") + (merged.duplicates ? " (" + merged.duplicates + " repeats removed)" : "") + ".";
    GeoWSUI.$("ws-title").value = GeoWSValidate.deckTitle(okSheets, GeoWSUI.pending.sources);
    GeoWSUI.show("ws-result", true);
  },

  saveDeck() {
    if (!GeoWSUI.pending) {
      return;
    }
    const r = GeoWSDecks.save(Object.assign({}, GeoWSUI.pending, { title: GeoWSUI.$("ws-title").value }));
    if (!r.ok) {
      GeoWSUI.msg("ws-file-msg", r.error.message);
      return;
    }
    GeoWSUI.pending = null;
    GeoWSUI.files = [];
    GeoWSUI.results = [];
    GeoWSUI.deckId = null;
    GeoWSUI.renderFiles();
    GeoWSUI.updateMake();
    GeoWSUI.show("ws-result", false);
    GeoWSUI.msg("ws-file-msg", "💾 Saved! Pick how to play below.", true);
    GeoWSUI.renderDecks();
    GeoWSUI.selectDeck(r.value.id);
  },

  wireUpload() {
    const drop = GeoWSUI.$("ws-drop");
    drop.addEventListener("click", () => {
      GeoWSUI.$("ws-file-input").click();
    });
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        GeoWSUI.$("ws-file-input").click();
      }
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => {
      drop.classList.remove("drag");
    });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      GeoWSUI.addFiles(e.dataTransfer.files);
    });
    const input = GeoWSUI.$("ws-file-input");
    input.addEventListener("change", () => {
      GeoWSUI.addFiles(input.files);
      input.value = "";
    });
    GeoWSUI.$("ws-provider").addEventListener("change", () => {
      GeoWSUI.loadKey();
      GeoWSUI.updateKeyLink();
      GeoWSUI.updateMake();
    });
    const key = GeoWSUI.$("ws-key");
    key.addEventListener("input", () => {
      GeoWSUI.updateMake();
    });
    key.addEventListener("change", () => {
      GeoWSUI.storeKey();
    });
    GeoWSUI.$("ws-remember").addEventListener("change", () => {
      GeoWSUI.show("ws-remember-warn", GeoWSUI.$("ws-remember").checked);
      GeoWSUI.storeKey();
    });
    GeoWSUI.$("ws-forget").addEventListener("click", () => {
      GeoWSUI.forgetKey();
    });
    GeoWSUI.$("ws-make").addEventListener("click", () => {
      GeoWSUI.process(GeoWSUI.files.map((_, i) => i));
    });
    GeoWSUI.$("ws-cancel").addEventListener("click", () => {
      GeoWSUI.cancel();
    });
    GeoWSUI.$("ws-retry").addEventListener("click", () => {
      GeoWSUI.process(GeoWSUI.failedIndexes());
    });
    GeoWSUI.$("ws-skip").addEventListener("click", () => {
      GeoWSUI.finish(true);
    });
    GeoWSUI.$("ws-save").addEventListener("click", () => {
      GeoWSUI.saveDeck();
    });
  },

  selected: null,

  renderDecks() {
    const list = GeoWSDecks.list();
    const el = GeoWSUI.$("ws-deck-list");
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    GeoWSUI.show("ws-no-decks", list.length === 0);
    let found = false;
    list.forEach((d) => {
      if (GeoWSUI.selected === d.id) {
        found = true;
      }
      const li = document.createElement("li");
      li.className = "ws-deck";
      if (d.id === GeoWSUI.selected) {
        li.classList.add("selected");
      }
      const title = document.createElement("span");
      title.className = "ws-deck-title";
      title.textContent = d.title;
      const actions = document.createElement("div");
      actions.className = "ws-deck-actions";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "btn btn-small";
      play.textContent = "▶ Play";
      play.setAttribute("aria-label", "Play " + d.title);
      play.addEventListener("click", () => {
        GeoWSUI.selectDeck(d.id);
      });
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "btn btn-small";
      rename.textContent = "✏️ Rename";
      rename.setAttribute("aria-label", "Rename " + d.title);
      rename.addEventListener("click", () => {
        GeoWSUI.renameDeck(d.id);
      });
      const exp = document.createElement("button");
      exp.type = "button";
      exp.className = "btn btn-small";
      exp.textContent = "📤 Export";
      exp.addEventListener("click", () => {
        GeoWSUI.exportDeck(d.id);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-small";
      del.textContent = "🗑️ Delete";
      del.addEventListener("click", () => {
        GeoWSUI.deleteDeck(d.id);
      });
      actions.appendChild(play);
      actions.appendChild(rename);
      actions.appendChild(exp);
      actions.appendChild(del);
      const meta = document.createElement("span");
      meta.className = "ws-deck-meta";
      meta.textContent = d.count + " questions · " + d.subject + (d.grade ? " · " + d.grade : "") + " · " + new Date(d.createdAt).toLocaleDateString();
      li.appendChild(title);
      li.appendChild(actions);
      li.appendChild(meta);
      el.appendChild(li);
    });
    if (GeoWSUI.selected && !found) {
      GeoWSUI.selected = null;
      GeoWSUI.show("ws-play", false);
    }
  },

  selectDeck(id) {
    const d = GeoWSDecks.get(id);
    if (!d) {
      return;
    }
    GeoWSUI.selected = id;
    GeoWSUI.$("ws-play-title").textContent = d.title;
    const small = d.count < GeoWSConfig.SMALL_DECK;
    GeoWSUI.$("ws-small-note").textContent = small ? "🔁 This deck has " + d.count + " questions, so they will repeat (shuffled). You can mix in geography questions below." : "";
    GeoWSUI.show("ws-small-note", small);
    GeoWSUI.$("ws-topup").checked = false;
    GeoWSUI.$("ws-math").checked = false;
    GeoWSUI.show("ws-play", true);
    GeoWSUI.renderDecks();
    GeoWSUI.$("ws-play").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  renameDeck(id) {
    const d = GeoWSDecks.get(id);
    if (!d) {
      return;
    }
    const t = window.prompt("New name for this deck:", d.title);
    if (t === null) {
      return;
    }
    const r = GeoWSDecks.rename(id, t);
    GeoWSUI.msg("ws-deck-msg", r.ok ? "✏️ Renamed." : r.error.message, r.ok);
    GeoWSUI.renderDecks();
    if (GeoWSUI.selected === id && r.ok) {
      GeoWSUI.$("ws-play-title").textContent = r.value.title;
    }
  },

  deleteDeck(id) {
    const d = GeoWSDecks.get(id);
    if (!d) {
      return;
    }
    if (!window.confirm("Delete \"" + d.title + "\"? This can't be undone.")) {
      return;
    }
    const r = GeoWSDecks.remove(id);
    if (GeoWSUI.selected === id) {
      GeoWSUI.selected = null;
      GeoWSUI.show("ws-play", false);
    }
    GeoWSUI.msg("ws-deck-msg", r.ok ? "🗑️ Deleted." : r.error.message, r.ok);
    GeoWSUI.renderDecks();
  },

  exportDeck(id) {
    const r = GeoWSDecks.exportJson(id);
    if (!r.ok) {
      GeoWSUI.msg("ws-deck-msg", r.error.message);
      return;
    }
    const blob = new Blob([r.value.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.value.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    GeoWSUI.msg("ws-deck-msg", "📤 Exported " + r.value.filename + ".", true);
  },

  importFile(file) {
    if (!file) {
      return;
    }
    if (file.size > GeoWSDecks.MAX_BYTES) {
      GeoWSUI.msg("ws-deck-msg", "That file is too big or not a deck file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = GeoWSDecks.importJson(String(reader.result));
      if (!r.ok) {
        GeoWSUI.msg("ws-deck-msg", r.error.message);
        return;
      }
      GeoWSUI.msg("ws-deck-msg", "📥 Imported \"" + r.value.title + "\".", true);
      GeoWSUI.renderDecks();
      GeoWSUI.selectDeck(r.value.id);
    };
    reader.onerror = () => {
      GeoWSUI.msg("ws-deck-msg", "Couldn't read that file.");
    };
    reader.readAsText(file);
  },

  wsSettings() {
    return {
      deckId: GeoWSUI.selected,
      topUp: GeoWSUI.$("ws-topup").checked,
      includeMath: GeoWSUI.$("ws-math").checked
    };
  },

  play(mode) {
    if (!GeoWSUI.selected) {
      return;
    }
    const ws = GeoWSUI.wsSettings();
    if (mode === "multi") {
      GeoMulti._setupWs = ws;
      GeoMulti.openSetup();
    } else {
      GeoGame.newCampaign(mode, ws);
    }
  },

  open() {
    GeoWSUI.renderDecks();
    GeoWSUI.show("ws-play", !!GeoWSUI.selected);
    GeoWSUI.loadKey();
    GeoWSUI.updateMake();
    GeoGame.showScreen("screen-worksheets");
  },

  init() {
    GeoWSUI.fillProviders();
    GeoWSUI.loadKey();
    GeoWSUI.wireUpload();
    GeoWSUI.renderFiles();
    GeoWSUI.updateMake();
    const input = GeoWSUI.$("ws-import-input");
    input.addEventListener("change", () => {
      GeoWSUI.importFile(input.files[0]);
      input.value = "";
    });
    GeoWSUI.$("ws-play-quest").addEventListener("click", () => {
      GeoWSUI.play("quest");
    });
    GeoWSUI.$("ws-play-world").addEventListener("click", () => {
      GeoWSUI.play("world");
    });
    GeoWSUI.$("ws-play-multi").addEventListener("click", () => {
      GeoWSUI.play("multi");
    });
    GeoWSUI.$("ws-back").addEventListener("click", () => {
      GeoGame.showScreen("screen-start");
    });
  }
};
