/* ============================================================
   map.js — renders the Natural Earth GeoJSON world map as SVG
   and handles territory coloring, zoom controls, and clicks.

   Projection: simple equirectangular (plate carree) onto a
   1000 x 500 viewBox. Good enough for a game map, zero deps.
   ============================================================ */
"use strict";

const GeoMap = {
  svg: null,
  onTerritoryClick: null, // callback(iso3)
  paths: [],              // [{ el, feature }]
  view: { x: 0, y: 0, w: 1000, h: 500 },
  ZOOM_MIN: 180,          // smallest viewBox width (max zoom)
  ZOOM_MAX_W: 1000,

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

  /**
   * Build every country path once.
   * styleFor(feature) -> { cls, clickable, title } is applied per path.
   */
  render(svgEl, features, styleFor) {
    this.svg = svgEl;
    this.paths = [];
    const NS = "http://www.w3.org/2000/svg";
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
      this.paths.push({ el: path, titleEl: title, feature });
    }
    svgEl.innerHTML = "";
    svgEl.appendChild(frag);
    this.refresh(styleFor);

    // Single delegated click listener for the whole map.
    svgEl.addEventListener("click", (ev) => {
      const t = ev.target.closest("path");
      if (!t || t.dataset.clickable !== "1" || !t.dataset.iso) return;
      if (typeof this.onTerritoryClick === "function") this.onTerritoryClick(t.dataset.iso);
    });
  },

  /** Re-color / re-label every path without rebuilding geometry. */
  refresh(styleFor) {
    for (const { el, titleEl, feature } of this.paths) {
      const s = styleFor(feature);
      el.setAttribute("class", s.cls + (s.clickable ? " clickable" : ""));
      el.dataset.clickable = s.clickable ? "1" : "0";
      titleEl.textContent = s.title || "";
    }
  },

  /** Briefly flash a territory (used when ownership changes). */
  flash(iso3) {
    for (const { el } of this.paths) {
      if (el.dataset.iso === iso3) {
        el.classList.remove("t-flash");
        void el.getBoundingClientRect(); // restart the animation
        el.classList.add("t-flash");
      }
    }
  },

  /* ---- zoom controls (buttons; viewBox-based, mobile friendly) ---- */
  applyView() {
    const v = this.view;
    this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  },
  zoom(factor) {
    const v = this.view;
    const nw = Math.min(this.ZOOM_MAX_W, Math.max(this.ZOOM_MIN, v.w * factor));
    const nh = nw * 0.5;
    // zoom toward the centre of the current view
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    v.w = nw; v.h = nh;
    v.x = Math.min(1000 - nw, Math.max(0, cx - nw / 2));
    v.y = Math.min(500 - nh, Math.max(0, cy - nh / 2));
    this.applyView();
  },
  reset() {
    this.view = { x: 0, y: 0, w: 1000, h: 500 };
    this.applyView();
  },
};
