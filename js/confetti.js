/* ============================================================
   confetti.js — canvas confetti bursts (no libraries).

   GeoConfetti.burst(opts) fires confetti pieces from a point onto
   a fixed, full-screen, pointer-events-none canvas:
     { at: iso3 }  burst from a country's on-screen map position
     { x, y }      CSS-pixel origin (default: top centre of screen)
     { count }     pieces (default ~120; small bursts ~60, victory ~360)
     { power }     launch speed in px/s (default 520)
     { spread }    launch cone in radians (default: upward fan)

   Pieces get gravity, air drag, a little side-to-side wobble and
   fade out over ~2.5 s; the canvas removes itself once the last
   piece is gone. prefers-reduced-motion: fewer pieces and no
   wobble or spinning (no shaking animations).
   ============================================================ */
"use strict";

const GeoConfetti = {
  canvas: null,
  ctx: null,
  pieces: [],
  raf: null,

  COLORS: ["#3b82f6", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#ec4899", "#facc15", "#38bdf8"],
  GRAVITY: 1500, // px/s^2
  DRAG: 0.6,     // air drag per second

  /** True when the player prefers reduced motion. */
  _reduced() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  },

  burst(opts = {}) {
    const reduced = this._reduced();
    let count = opts.count == null ? 120 : opts.count;
    if (reduced) count = Math.max(8, Math.round(count / 4));
    if (count <= 0) return;

    // Origin: the country's on-screen position, else the given point.
    let x = opts.x, y = opts.y;
    if (opts.at) {
      const el = document.querySelector(`#map-svg [data-iso="${opts.at}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      }
    }
    if (x == null) x = window.innerWidth / 2;
    if (y == null) y = window.innerHeight * 0.25;
    // Keep the burst on screen even if the country is scrolled away.
    x = Math.max(20, Math.min(window.innerWidth - 20, x));
    y = Math.max(20, Math.min(window.innerHeight - 20, y));

    const power = opts.power == null ? 520 : opts.power;
    const spread = opts.spread == null ? Math.PI * 0.95 : opts.spread;
    const now = performance.now();

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = power * (0.55 + Math.random() * 0.65);
      this.pieces.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        color: this.COLORS[(Math.random() * this.COLORS.length) | 0],
        rot: reduced ? 0 : Math.random() * Math.PI * 2,
        rotSpeed: reduced ? 0 : (Math.random() - 0.5) * 12,
        wobble: reduced ? 0 : 1 + Math.random() * 2, // side-to-side shake
        wobbleFreq: 4 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        round: Math.random() < 0.25,
        born: now,
        life: (reduced ? 1.4 : 1.8) + Math.random() * 0.7, // seconds
      });
    }
    this._ensureCanvas();
    if (!this.raf) this._start();
  },

  /* ---- canvas lifecycle ---- */
  _ensureCanvas() {
    if (this.canvas) return;
    const c = document.createElement("canvas");
    c.id = "confetti-canvas";
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(window.innerWidth * dpr));
    c.height = Math.max(1, Math.round(window.innerHeight * dpr));
    c.style.width = window.innerWidth + "px";
    c.style.height = window.innerHeight + "px";
    document.body.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d");
    this.ctx.scale(dpr, dpr);
  },

  /** Remove the canvas once the last piece is gone. */
  _removeCanvas() {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
    }
  },

  /* ---- animation loop ---- */
  _start() {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this._tick(dt, now);
      if (this.pieces.length) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = null;
        this._removeCanvas(); // done — remove the canvas
      }
    };
    this.raf = requestAnimationFrame(step);
  },

  _tick(dt, now) {
    const ctx = this.ctx;
    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);
    const drag = Math.pow(this.DRAG, dt);
    const alive = [];
    for (const p of this.pieces) {
      const age = (now - p.born) / 1000;
      if (age >= p.life) continue; // faded out
      p.vy += this.GRAVITY * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt + Math.sin(age * p.wobbleFreq + p.phase) * p.wobble * 14 * dt;
      p.y += p.vy * dt;
      p.rot += p.rotSpeed * dt;
      if (p.y > H + 40) continue; // fell off the screen
      // Fade over the last ~45% of the piece's life.
      const fadeStart = p.life * 0.55;
      const alpha = age < fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / (p.life - fadeStart));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
      }
      ctx.restore();
      alive.push(p);
    }
    this.pieces = alive;
  },
};
