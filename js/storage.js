/* ============================================================
   storage.js — save / load / clear game progress in localStorage
   The whole campaign state is one small JSON blob, so the
   player can close the tab and resume exactly where they left off.
   ============================================================ */
"use strict";

const GeoStorage = {
  /** localStorage key (versioned so future formats don't collide) */
  KEY: "geoConquestSaveV1",

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
      if (!state || typeof state !== "object" || !state.ownership) return null;
      return state;
    } catch (e) {
      return null;
    }
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
