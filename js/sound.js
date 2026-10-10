/* ============================================================
   sound.js — tiny sound effects for Geo Conquest, built with
   the Web Audio API only (oscillators, no audio files).

   Sounds: correct (happy two-note chime), wrong (soft low
   "bwomp"), conquer (short fanfare arpeggio), steal (sneaky
   descending villain sting), click (tiny tick), hint (soft
   sparkle), victory (longer fanfare, ~2 s).

   The AudioContext is created lazily on the first sound call —
   which always happens inside a user gesture — and resumed when
   suspended (iOS-safe). The master volume is quiet (~0.25).
   Every call is a no-op while muted; the mute state persists in
   localStorage under "geoConquestMuted" (separate from the save).
   ============================================================ */
"use strict";

const GeoSound = {
  /** localStorage key for the mute toggle (separate from the save) */
  KEY: "geoConquestMuted",
  /** Quiet master volume */
  MASTER: 0.25,

  _ctx: null,    // AudioContext, created lazily
  _master: null, // master gain node

  /* ---- mute state ---- */
  isMuted() {
    try {
      return localStorage.getItem(this.KEY) === "true";
    } catch (e) {
      return false;
    }
  },

  setMuted(muted) {
    try {
      localStorage.setItem(this.KEY, muted ? "true" : "false");
    } catch (e) {
      /* storage unavailable — the mute just won't persist */
    }
  },

  /** Flip the mute state; returns the new state. */
  toggle() {
    this.setMuted(!this.isMuted());
    return this.isMuted();
  },

  /* ---- plumbing ---- */
  /**
   * Lazily create the AudioContext (the first call happens inside a
   * user gesture, so the autoplay policy is satisfied) and resume it
   * when suspended. Returns null when Web Audio is unavailable.
   */
  _ensure() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
      this._master = this._ctx.createGain();
      this._master.gain.value = this.MASTER;
      this._master.connect(this._ctx.destination);
    }
    if (this._ctx.state === "suspended" && this._ctx.resume) {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  },

  /** Schedule a sound unless muted. Never throws. */
  _play(schedule) {
    if (this.isMuted()) return;
    const ctx = this._ensure();
    if (!ctx) return;
    try {
      schedule(ctx, this._master, ctx.currentTime);
    } catch (e) {
      /* a broken sound must never break the game */
    }
  },

  /**
   * One note: oscillator -> gain envelope -> out (optionally through
   * a filter). freqEnd gives a pitch drop (the "bwomp").
   */
  _note(ctx, out, t0, o) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + (o.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    if (o.filter) {
      g.connect(o.filter);
      o.filter.connect(out);
    } else {
      g.connect(out);
    }
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  },

  /* ---- sound effects ---- */

  /** Happy two-note chime (E5 -> G5). */
  correct() {
    this._play((ctx, out, t) => {
      this._note(ctx, out, t, { freq: 659.25, dur: 0.18, vol: 0.5 });
      this._note(ctx, out, t + 0.09, { freq: 783.99, dur: 0.3, vol: 0.5 });
    });
  },

  /** Soft low "bwomp" (filtered sawtooth pitch drop). */
  wrong() {
    this._play((ctx, out, t) => {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      this._note(ctx, out, t, {
        type: "sawtooth", freq: 160, freqEnd: 85,
        dur: 0.28, vol: 0.35, filter: f,
      });
    });
  },

  /** Short fanfare arpeggio (C5 E5 G5 C6). */
  conquer() {
    this._play((ctx, out, t) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        this._note(ctx, out, t + i * 0.09, { type: "triangle", freq, dur: 0.22, vol: 0.45 });
      });
    });
  },

  /** Sneaky descending villain sting (G4 F#4 F4 D#4). */
  steal() {
    this._play((ctx, out, t) => {
      [392.0, 369.99, 349.23, 311.13].forEach((freq, i) => {
        this._note(ctx, out, t + i * 0.11, { type: "triangle", freq, dur: 0.22, vol: 0.4 });
      });
    });
  },

  /** Tiny tick for button taps. */
  click() {
    this._play((ctx, out, t) => {
      this._note(ctx, out, t, { freq: 1800, dur: 0.04, vol: 0.18, attack: 0.003 });
    });
  },

  /** Soft sparkle (two quick high notes). */
  hint() {
    this._play((ctx, out, t) => {
      this._note(ctx, out, t, { freq: 1318.5, dur: 0.12, vol: 0.3 });
      this._note(ctx, out, t + 0.07, { freq: 1975.5, dur: 0.18, vol: 0.3 });
    });
  },

  /** Longer victory fanfare (~2 s): arpeggio, then a held chord. */
  victory() {
    this._play((ctx, out, t) => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
        this._note(ctx, out, t + i * 0.11, { type: "triangle", freq, dur: 0.3, vol: 0.45 });
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
        this._note(ctx, out, t + 0.55, { freq, dur: 1.6, vol: 0.28, attack: 0.03 });
      });
    });
  },
};
