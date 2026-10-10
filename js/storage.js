/* ============================================================
   storage.js — save / load / clear game progress in localStorage
   The whole campaign state is one small JSON blob, so the
   player can close the tab and resume exactly where they left off.

   Save format v2 adds: pendingChoice, geoSinceMath, hintsUsed and
   stats{byCategory}. load() accepts older/partial saves, migrates
   them in memory (filling defaults) and re-saves under the same key.
   ============================================================ */
"use strict";

const GeoStorage = {
  /** localStorage key (versioned so future formats don't collide) */
  KEY: "geoConquestSaveV1",
  /** Current save-format version (bumped when the shape changes) */
  SAVE_VERSION: 2,

  /** Persist the given state object. Never throws (private-mode safe). */
  save(state) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable — game still works for this session */
    }
  },

  /** Load the saved state, or null when there is no save (or it's corrupt). */
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      // Basic sanity check so a corrupt blob can't break the game.
      if (!state || typeof state !== "object" || Array.isArray(state)) return null;
      const migrated = this.migrate(state);
      // Persist the migrated save under the same key.
      this.save(migrated);
      return migrated;
    } catch (e) {
      return null;
    }
  },

  /**
   * Fill defaults for any missing field so version-1 and partial
   * saves load safely. Mutates and returns the given state.
   */
  migrate(s) {
    if (typeof s.mode !== "string") s.mode = "quest";
    if (typeof s.activeContinent !== "string") s.activeContinent = null;
    if (!Array.isArray(s.unlocked)) s.unlocked = [];
    if (!Array.isArray(s.conquered)) s.conquered = [];
    if (!s.ownership || typeof s.ownership !== "object" || Array.isArray(s.ownership)) {
      s.ownership = {};
    }
    for (const k of ["points", "streak", "bestStreak", "contests", "correct", "geoSinceMath", "hintsUsed"]) {
      if (typeof s[k] !== "number" || !isFinite(s[k])) s[k] = 0;
    }
    if (!Array.isArray(s.asked)) s.asked = [];
    if (typeof s.homeBase !== "string") s.homeBase = null;
    if (typeof s.pendingChoice !== "boolean") s.pendingChoice = false;
    if (
      !s.stats || typeof s.stats !== "object" || Array.isArray(s.stats) ||
      !s.stats.byCategory || typeof s.stats.byCategory !== "object" || Array.isArray(s.stats.byCategory)
    ) {
      s.stats = { byCategory: {} };
    }
    s.version = this.SAVE_VERSION;
    return s;
  },

  /** Wipe the save (used by "New campaign"). */
  clear() {
    try {
      localStorage.removeItem(this.KEY);
    } catch (e) {
      /* ignore */
    }
  },
};
