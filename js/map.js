/* ============================================================
   map.js — renders the Natural Earth GeoJSON world map as SVG
   and handles territory coloring, pan & zoom, tiny-country
   markers, zoom labels, and clicks.

   Projection: simple equirectangular (plate carree) onto a
   1000 x 500 world. The viewBox aspect follows the svg's real
   box (2:1 on desktop, taller on phones). Zero deps.

   Gestures (Pointer Events — mouse and touch share one code path):
     - drag with the mouse or one finger to pan (clamped to the map)
     - mouse wheel zooms toward the cursor; a two-finger pinch zooms
       toward the pinch centre; the +/- buttons zoom toward the view
       centre; "Reset view" restores the whole world
     - a press that moves more than ~6 px is a drag, never a click
   ============================================================ */
"use strict";

const GeoMap = {
  svg: null,
  onTerritoryClick: null, // callback(iso3)
  paths: [],              // [{ el, titleEl, feature, base, bb, cen }]
  markers: [],            // tiny-country dots: [{ el, titleEl, feature, base }]
  labels: [],             // country name labels: [{ el, feature }]
  view: { x: 0, y: 0, w: 1000, h: 500 },
  _aspect: 0.5,           // viewBox height / width — follows the svg's real box
  ZOOM_MIN: 90,           // smallest viewBox width (max zoom)
  ZOOM_MAX_W: 1000,
  LABEL_ZOOM_W: 450,      // show country labels below this viewBox width
  MARKER_PX: 12,          // marker radius on screen, CSS px (~24 px dot)
  LABEL_PX: 12,           // label font size on screen, CSS px
  DRAG_THRESHOLD: 6,      // px of movement before a press stops being a click
  TINY_W: 8,              // main-polygon bbox smaller than this -> marker
  findMode: false,        // "find it on the map" questions: every path clickable
  onFindPick: null,       // callback(iso3) while findMode is on
  labelsHidden: false,    // set by the game while a find-mode question is open
  _styleFor: null,        // last styleFor, used to restore styles after find mode
  _playable: null,        // Set of playable iso3 codes (markers + labels)
  _nameFor: null,         // feature -> display name (labels)
  _markersG: null,
  _labelsG: null,
  _listenersBound: false,
  _pointers: new Map(),   // pointerId -> { x, y } in client coords
  _pinch: null,           // { dist, cx, cy } while two pointers are down
  _downAt: null,          // where the first pointer went down
  _dragged: false,        // the current press moved past DRAG_THRESHOLD
  _suppressClick: false,  // swallow the click that follows a drag
  _anim: null,            // requestAnimationFrame id while animating the view
  _ro: null,              // ResizeObserver following the svg's box
  _labelTimer: null,      // debounce timer for label placement

  /* lon/lat -> SVG coordinates */
  project(lon, lat) {
    return [(lon + 180) / 360 * 1000, (90 - lat) / 180 * 500];
  },

  /* One linear ring of [lon,lat] pairs -> SVG path fragment */
  ringPath(ring) {
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const p = this.project(ring[i][0], ring[i][1]);
      d += (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1);
    }
    return d + "Z";
  },

  /* Polygon or MultiPolygon geometry -> full path "d" string */
  geomPath(geom) {
    if (!geom) return "";
    let d = "";
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) d += this.ringPath(ring);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates)
        for (const ring of poly) d += this.ringPath(ring);
    }
    return d;
  },

  /* Geometry -> list of polygons (each polygon = list of rings) */
  polygonsOf(geom) {
    if (!geom) return [];
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return [];
  },

  /**
   * The feature's main polygon: the one with the largest bounding box.
   * Using only the main polygon keeps antimeridian countries (Fiji)
   * from smearing their bbox across the whole map.
   */
  mainPolygon(feature) {
    let best = null, bestArea = -1;
    for (const poly of this.polygonsOf(feature.geometry)) {
      const ring = poly && poly[0];
      if (!ring || ring.length < 3) continue;
      const bb = this.ringBBox(ring);
      const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
      if (area > bestArea) { bestArea = area; best = poly; }
    }
    return best;
  },

  /* Ring -> bounding box in viewBox units */
  ringBBox(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pt of ring) {
      const x = (pt[0] + 180) / 360 * 1000;
      const y = (90 - pt[1]) / 180 * 500;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  },

  /* Ring -> centroid in viewBox units (shoelace; vertex mean if degenerate) */
  ringCentroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = (ring[i][0] + 180) / 360 * 1000, yi = (90 - ring[i][1]) / 180 * 500;
      const xj = (ring[j][0] + 180) / 360 * 1000, yj = (90 - ring[j][1]) / 180 * 500;
      const f = xi * yj - xj * yi;
      a += f;
      cx += (xi + xj) * f;
      cy += (yi + yj) * f;
    }
    if (Math.abs(a) < 1e-6) {
      let sx = 0, sy = 0;
      for (const pt of ring) {
        sx += (pt[0] + 180) / 360 * 1000;
        sy += (90 - pt[1]) / 180 * 500;
      }
      return [sx / ring.length, sy / ring.length];
    }
    a *= 3;
    return [cx / a, cy / a];
  },

  /**
   * Build every country path once, plus the ocean background,
   * tiny-country markers and name labels.
   * styleFor(feature) -> { cls, clickable, title } is applied per path.
   * opts: { playable: Set<iso3>, nameFor: (feature) -> string }
   */
  render(svgEl, features, styleFor, opts = {}) {
    this.svg = svgEl;
    this.paths = [];
    this.markers = [];
    this.labels = [];
    this._playable = opts.playable || null;
    this._nameFor = opts.nameFor || null;
    this._pointers.clear();
    this._pinch = null;
    this._downAt = null;
    this._dragged = false;
    this._suppressClick = false;
    this.cancelAnim();
    const NS = "http://www.w3.org/2000/svg";
    svgEl.innerHTML = "";
    svgEl.appendChild(this._buildBackground(NS));

    // Document fragment keeps 177 path insertions to a single reflow.
    const frag = document.createDocumentFragment();
    for (const feature of features) {
      const d = this.geomPath(feature.geometry);
      if (!d) continue;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      const title = document.createElementNS(NS, "title");
      path.appendChild(title);
      path.dataset.iso = feature.properties.iso3 || "";
      frag.appendChild(path);
      const poly = this.mainPolygon(feature);
      this.paths.push({
        el: path,
        titleEl: title,
        feature,
        base: "",
        bb: poly ? this.ringBBox(poly[0]) : null,
        cen: poly ? this.ringCentroid(poly[0]) : null,
      });
    }
    svgEl.appendChild(frag);
    this._buildMarkers(NS);
    this._buildLabels(NS);
    this.refresh(styleFor);
    this.bindListeners();
    this._syncAspect();
    this.applyView();
  },

  /* Ocean gradient rect + faint 30° graticule, behind everything. */
  _buildBackground(NS) {
    const g = document.createElementNS(NS, "g");
    const defs = document.createElementNS(NS, "defs");
    // userSpaceOnUse keeps the gradient pinned to the world even though
    // the rect extends far beyond it (tall phone maps show extra ocean).
    const grad = document.createElementNS(NS, "radialGradient");
    grad.id = "ocean-grad";
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("cx", "500");
    grad.setAttribute("cy", "200");
    grad.setAttribute("r", "632");
    for (const [off, col] of [["0%", "#e9f5ff"], ["55%", "#cfe9fb"], ["100%", "#b2dcf6"]]) {
      const stop = document.createElementNS(NS, "stop");
      stop.setAttribute("offset", off);
      stop.setAttribute("stop-color", col);
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    g.appendChild(defs);

    const ocean = document.createElementNS(NS, "rect");
    ocean.setAttribute("x", "-500");
    ocean.setAttribute("y", "-2500");
    ocean.setAttribute("width", "2000");
    ocean.setAttribute("height", "5500");
    ocean.setAttribute("fill", "url(#ocean-grad)");
    g.appendChild(ocean);

    const grat = document.createElementNS(NS, "g");
    grat.setAttribute("class", "graticule");
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360 * 1000).toFixed(1);
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", x); l.setAttribute("y1", "0");
      l.setAttribute("x2", x); l.setAttribute("y2", "500");
      grat.appendChild(l);
    }
    for (let lat = -90; lat <= 90; lat += 30) {
      const y = ((90 - lat) / 180 * 500).toFixed(1);
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", "0"); l.setAttribute("y1", y);
      l.setAttribute("x2", "1000"); l.setAttribute("y2", y);
      grat.appendChild(l);
    }
    g.appendChild(grat);
    return g;
  },

  /**
   * Round markers for playable territories whose main polygon renders
   * smaller than ~8x8 viewBox units (Jamaica, El Salvador, Haiti,
   * Fiji, Vanuatu, Solomon Islands, ...). Computed, never hard-coded.
   * Markers carry the same data-iso / colour class as the country path
   * and are appended after the paths so they stay on top.
   */
  _buildMarkers(NS) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "markers");
    for (const entry of this.paths) {
      const iso = entry.feature.properties.iso3;
      if (!iso || !this._playable || !this._playable.has(iso)) continue;
      const bb = entry.bb;
      if (!bb || !entry.cen) continue;
      if (bb.x1 - bb.x0 >= this.TINY_W || bb.y1 - bb.y0 >= this.TINY_W) continue;
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "marker");
      c.setAttribute("cx", entry.cen[0].toFixed(1));
      c.setAttribute("cy", entry.cen[1].toFixed(1));
      c.setAttribute("r", "4");
      c.dataset.iso = iso;
      const title = document.createElementNS(NS, "title");
      c.appendChild(title);
      g.appendChild(c);
      this.markers.push({ el: c, titleEl: title, feature: entry.feature, base: "marker" });
    }
    this._markersG = g;
    this.svg.appendChild(g);
  },

  /* Country name labels, one per playable territory, at its centroid. */
  _buildLabels(NS) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "labels");
    for (const entry of this.paths) {
      const iso = entry.feature.properties.iso3;
      if (!iso || !this._playable || !this._playable.has(iso) || !entry.cen) continue;
      const t = document.createElementNS(NS, "text");
      t.setAttribute("class", "map-label");
      t.setAttribute("x", entry.cen[0].toFixed(1));
      t.setAttribute("y", entry.cen[1].toFixed(1));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dy", "0.35em");
      t.textContent = this._labelText(entry.feature);
      g.appendChild(t);
      this.labels.push({
        el: t,
        feature: entry.feature,
        src: entry, // path entry — its class tells us if the continent is unlocked
        area: entry.bb ? (entry.bb.x1 - entry.bb.x0) * (entry.bb.y1 - entry.bb.y0) : 0,
      });
    }
    this._labelsG = g;
    this.svg.appendChild(g);
  },

  _labelText(feature) {
    if (this._nameFor) {
      const n = this._nameFor(feature);
      if (n) return n;
    }
    return feature.properties.name || feature.properties.iso3 || "";
  },

  /** Apply one styleFor result to a path or marker entry. */
  _styleOne(entry, styleFor) {
    const s = styleFor(entry.feature);
    let cls = s.cls;
    if (entry.base) cls = entry.base + " " + cls;
    if (s.clickable) cls += " clickable";
    entry.el.setAttribute("class", cls);
    entry.el.dataset.clickable = s.clickable ? "1" : "0";
    entry.titleEl.textContent = s.title || "";
  },

  /** Re-color / re-label every path and marker without rebuilding geometry. */
  refresh(styleFor) {
    this._styleFor = styleFor;
    for (const entry of this.paths) this._styleOne(entry, styleFor);
    for (const entry of this.markers) this._styleOne(entry, styleFor);
  },

  /** Briefly flash a territory (used when ownership changes). */
  flash(iso3) {
    for (const entry of [...this.paths, ...this.markers]) {
      if (entry.el.dataset.iso === iso3) {
        entry.el.classList.remove("t-flash");
        void entry.el.getBoundingClientRect(); // restart the animation
        entry.el.classList.add("t-flash");
      }
    }
  },

  /**
   * Find mode for "find it on the map" questions: every country path
   * and marker (locked and backdrop ones included) becomes clickable
   * and all tooltips are blanked so hovering can't reveal country
   * names. Turning it off restores the normal styles.
   */
  setFindMode(on, onPick) {
    this.findMode = !!on;
    this.onFindPick = onPick || null;
    if (on) {
      for (const entry of [...this.paths, ...this.markers]) {
        entry.el.dataset.clickable = "1";
        entry.el.classList.add("clickable");
        entry.titleEl.textContent = "";
      }
    } else if (this._styleFor) {
      this.refresh(this._styleFor);
    }
  },

  /** Show/hide the country name labels (hidden during find mode). */
  setLabelsHidden(hidden) {
    this.labelsHidden = !!hidden;
    this._updateLabels();
  },

  /* ================= view (viewBox) management ================= */

  applyView() {
    const v = this.view;
    this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    this._updateDynamic();
    this._scheduleLabelPlacement();
  },

  /** Keep the view inside the map and the zoom inside its limits. */
  clampView() {
    const v = this.view;
    v.w = Math.min(this.ZOOM_MAX_W, Math.max(this.ZOOM_MIN, v.w));
    v.h = v.w * this._aspect;
    v.x = this._clampX(v.x, v.w);
    v.y = this._clampY(v.y, v.h);
  },

  /** Horizontal clamp: the world (x 0..1000) always stays reachable. */
  _clampX(x, w) {
    return Math.min(Math.max(0, 1000 - w), Math.max(0, x));
  },

  /**
   * Vertical clamp: when the view is shorter than the world (y 0..500)
   * it slides over it; when it is taller (tall phone map) the whole
   * world stays visible, floating in the extra ocean.
   */
  _clampY(y, h) {
    const lo = Math.min(0, 500 - h);
    const hi = Math.max(0, 500 - h);
    return Math.min(hi, Math.max(lo, y));
  },

  /**
   * The viewBox aspect follows the svg's real box (2:1 on desktop, the
   * taller map area on phones). Keeps the view centre on aspect changes.
   */
  _syncAspect() {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const aspect = rect.height / rect.width;
    if (Math.abs(aspect - this._aspect) < 0.001) return;
    const cx = this.view.x + this.view.w / 2;
    const cy = this.view.y + this.view.h / 2;
    this._aspect = aspect;
    this.view.h = this.view.w * aspect;
    this.view.x = cx - this.view.w / 2;
    this.view.y = cy - this.view.h / 2;
    this.clampView();
  },

  /** viewBox units per CSS pixel (uniform: the viewBox aspect matches the svg's box) */
  _cssK() {
    const rect = this.svg.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : 1000;
    return this.view.w / cssW;
  },

  /** Client (page) coordinates -> viewBox coordinates */
  clientToView(cx, cy) {
    const rect = this.svg.getBoundingClientRect();
    const scale = Math.min(rect.width / this.view.w, rect.height / this.view.h) || 1;
    const ox = (rect.width - this.view.w * scale) / 2;
    const oy = (rect.height - this.view.h * scale) / 2;
    return {
      x: this.view.x + (cx - rect.left - ox) / scale,
      y: this.view.y + (cy - rect.top - oy) / scale,
    };
  },

  /** Zoom by factor, keeping the viewBox point (vx, vy) stationary. */
  zoomAt(factor, vx, vy) {
    const v = this.view;
    const nw = Math.min(this.ZOOM_MAX_W, Math.max(this.ZOOM_MIN, v.w * factor));
    if (nw !== v.w) {
      const rx = (vx - v.x) / v.w;
      const ry = (vy - v.y) / v.h;
      v.w = nw;
      v.h = nw * this._aspect;
      v.x = vx - rx * nw;
      v.y = vy - ry * v.h;
    }
    this.clampView();
    this.applyView();
  },

  /** Zoom by factor toward the centre of the current view (buttons). */
  zoom(factor) {
    this.cancelAnim();
    const v = this.view;
    this.zoomAt(factor, v.x + v.w / 2, v.y + v.h / 2);
  },

  /** Pan the view by a client-pixel delta (the map follows the pointer). */
  panBy(clientDx, clientDy) {
    const k = this._cssK();
    const v = this.view;
    v.x -= clientDx * k;
    v.y -= clientDy * k;
    this.clampView();
    this.applyView();
  },

  reset() {
    this.cancelAnim();
    const h = this.ZOOM_MAX_W * this._aspect;
    // Centre the world vertically (matters on tall phone maps).
    this.view = { x: 0, y: (500 - h) / 2, w: this.ZOOM_MAX_W, h };
    this.clampView();
    this.applyView();
  },

  /** Animate the viewBox to a target over ~400 ms (ease-out). */
  animateView(to, ms = 400) {
    this.cancelAnim();
    const from = { x: this.view.x, y: this.view.y, w: this.view.w };
    const same = from.x === to.x && from.y === to.y && from.w === to.w;
    if (ms <= 0 || same) {
      this.view = { x: to.x, y: to.y, w: to.w, h: to.w * this._aspect };
      this.applyView();
      return;
    }
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      this.view.x = from.x + (to.x - from.x) * e;
      this.view.y = from.y + (to.y - from.y) * e;
      this.view.w = from.w + (to.w - from.w) * e;
      this.view.h = this.view.w * this._aspect;
      this.applyView();
      this._anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    this._anim = requestAnimationFrame(step);
  },

  cancelAnim() {
    if (this._anim) {
      cancelAnimationFrame(this._anim);
      this._anim = null;
    }
  },

  /**
   * Smoothly zoom to the bounding box of the given territories
   * (computed from the GeoJSON features of their playable countries,
   * main polygon only, with padding). Used when a continent becomes
   * active. Antimeridian-safe: Fiji's wrapped sliver is ignored.
   */
  focusIsos(isoList, animate = true) {
    const wanted = new Set(isoList);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const entry of this.paths) {
      const iso = entry.feature.properties.iso3;
      if (!iso || !wanted.has(iso) || !entry.bb) continue;
      x0 = Math.min(x0, entry.bb.x0);
      y0 = Math.min(y0, entry.bb.y0);
      x1 = Math.max(x1, entry.bb.x1);
      y1 = Math.max(y1, entry.bb.y1);
    }
    if (x0 === Infinity) return;
    // Padding; the viewBox aspect follows the svg's box, so the height
    // budget is (y1 - y0) / aspect worth of width.
    let w = Math.max(x1 - x0, (y1 - y0) / this._aspect) * 1.25 + 30;
    w = Math.min(this.ZOOM_MAX_W, Math.max(this.ZOOM_MIN, w));
    const h = w * this._aspect;
    const target = {
      x: this._clampX((x0 + x1) / 2 - w / 2, w),
      y: this._clampY((y0 + y1) / 2 - h / 2, h),
      w,
      h,
    };
    if (animate) this.animateView(target, 400);
    else {
      this.view = target;
      this.applyView();
    }
  },

  /* ================= dynamic sizing (markers & labels) ================= */

  /**
   * Marker radii and label font sizes are set in viewBox units so they
   * stay ~constant on screen (~24 px dots, ~12 px text) at any zoom.
   */
  _updateDynamic() {
    const k = this._cssK();
    for (const m of this.markers) {
      const r = Math.max(0.5, this.MARKER_PX * k);
      m.el.setAttribute("r", r.toFixed(2));
      m.el.setAttribute("stroke-width", (r * 0.15).toFixed(2));
    }
    const fs = this.LABEL_PX * k;
    for (const l of this.labels) {
      l.el.setAttribute("font-size", fs.toFixed(2));
      l.el.setAttribute("stroke-width", (fs * 0.28).toFixed(2));
    }
    this._updateLabels();
  },

  _updateLabels() {
    if (!this._labelsG) return;
    const show = !this.labelsHidden && this.view.w < this.LABEL_ZOOM_W;
    this._labelsG.style.display = show ? "" : "none";
  },

  /**
   * Debounced label placement: runs ~120 ms after the last view change
   * (zoom / pan / focus animation settled), never on every frame.
   */
  _scheduleLabelPlacement() {
    if (this._labelTimer) clearTimeout(this._labelTimer);
    this._labelTimer = setTimeout(() => {
      this._labelTimer = null;
      this._placeLabels();
    }, 120);
  },

  /**
   * One label per unlocked territory, largest territories first; a
   * label whose box would overlap an already-placed one is skipped
   * (Haiti vs Dominican Rep. and friends stay readable).
   */
  _placeLabels() {
    if (!this._labelsG) return;
    const show = !this.labelsHidden && this.view.w < this.LABEL_ZOOM_W;
    this._labelsG.style.display = show ? "" : "none";
    if (!show) return;
    const fs = this.LABEL_PX * this._cssK();
    const pad = fs * 0.2;
    const order = this.labels.slice().sort((a, b) => b.area - a.area);
    // Only unlocked continents get labels; make the rest measurable first.
    for (const l of order) {
      l.el.style.display = l.src.el.classList.contains("t-locked") ? "none" : "";
    }
    const placed = [];
    for (const l of order) {
      if (l.el.style.display === "none") continue;
      const bb = l.el.getBBox();
      if (!bb.width || !bb.height) { l.el.style.display = "none"; continue; }
      const box = {
        x0: bb.x - pad, y0: bb.y - pad,
        x1: bb.x + bb.width + pad, y1: bb.y + bb.height + pad,
      };
      let clash = false;
      for (const p of placed) {
        if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) {
          clash = true;
          break;
        }
      }
      if (clash) l.el.style.display = "none";
      else placed.push(box);
    }
  },

  /* ================= gestures & listeners ================= */

  bindListeners() {
    if (this._listenersBound) return;
    this._listenersBound = true;
    const svg = this.svg;

    // Single delegated click handler for the whole map (paths + markers).
    svg.addEventListener("click", (ev) => {
      if (this._suppressClick) {
        this._suppressClick = false; // this click belonged to a drag
        return;
      }
      const t = ev.target.closest("[data-iso]");
      if (!t || !t.dataset.iso) return;
      if (this.findMode) {
        // Find mode: every country counts as an answer, playable or not.
        if (typeof this.onFindPick === "function") this.onFindPick(t.dataset.iso);
        return;
      }
      if (t.dataset.clickable !== "1") return;
      if (typeof this.onTerritoryClick === "function") this.onTerritoryClick(t.dataset.iso);
    });

    // ---- pan (mouse drag / one finger) and pinch (two fingers) ----
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      this.cancelAnim();
      this._suppressClick = false;
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this._pointers.size === 1) {
        this._downAt = { x: ev.clientX, y: ev.clientY };
        this._dragged = false;
      } else if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        this._pinch = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
        };
      }
    });

    window.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse" && ev.buttons === 0) {
        this._endPointer(ev.pointerId); // mouse released outside the window
        return;
      }
      const prev = this._pointers.get(ev.pointerId);
      if (!prev) return;
      const p = { x: ev.clientX, y: ev.clientY };
      this._pointers.set(ev.pointerId, p);
      if (this._pointers.size === 1) {
        if (this._downAt &&
            Math.hypot(p.x - this._downAt.x, p.y - this._downAt.y) > this.DRAG_THRESHOLD) {
          this._dragged = true;
        }
        this.panBy(p.x - prev.x, p.y - prev.y);
      } else if (this._pointers.size >= 2 && this._pinch) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        // Pan with the pinch centre first, then zoom toward it.
        this.panBy(cx - this._pinch.cx, cy - this._pinch.cy);
        if (dist > 0 && this._pinch.dist > 0) {
          const vb = this.clientToView(cx, cy);
          this.zoomAt(this._pinch.dist / dist, vb.x, vb.y);
        }
        this._pinch = { dist, cx, cy };
        this._dragged = true;
      }
    });

    window.addEventListener("pointerup", (ev) => this._endPointer(ev.pointerId));
    window.addEventListener("pointercancel", (ev) => this._endPointer(ev.pointerId));

    // ---- wheel: zoom toward the cursor (wheel up = zoom in) ----
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.cancelAnim();
      const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
      const factor = Math.min(2, Math.max(0.5, Math.exp(dy * 0.0015)));
      const vb = this.clientToView(ev.clientX, ev.clientY);
      this.zoomAt(factor, vb.x, vb.y);
    }, { passive: false });

    // Follow the svg's real aspect ratio (tall map area on phones);
    // keeps marker/label sizes right on any resize too.
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        this._syncAspect();
        this.applyView();
      });
      this._ro.observe(this.svg);
    }
  },

  _endPointer(pointerId) {
    if (!this._pointers.delete(pointerId)) return;
    if (this._pointers.size < 2) this._pinch = null;
    if (this._pointers.size === 0) {
      this._suppressClick = this._dragged; // a real drag never clicks
      this._downAt = null;
    }
  },
};
