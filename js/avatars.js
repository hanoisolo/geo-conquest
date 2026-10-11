"use strict";

// Geo Conquest — avatars: the 10 playable characters and their placeholder SVG faces
// (spec: docs/spec-avatars-passport.md). Plain browser JS: a single global, GeoAvatars
// (a var, so it lands on window); no modules, no DOM access at load time.
//
// API:
//   GeoAvatars.CHARACTERS         roster in pick order; each entry
//                                 { id, name, emoji, colors: { bg, main, accent, skin } } (hex strings)
//   GeoAvatars.DEFAULT            fallback avatar id ("fox")
//   GeoAvatars.selected           the solo picker's current character ("fox" until picked)
//   GeoAvatars.EXPRESSIONS        face moods faceSvg() can draw: "happy", "cheer", "oops"
//   GeoAvatars.BARON_EXPRESSIONS  Baron mood names (drawn by baronSvg; consumed by js/baron.js)
//   GeoAvatars.byId(id)           character object, or null for unknown ids
//   GeoAvatars.normalize(id, taken = [])  a free avatar id: id if valid and not taken,
//                                        else DEFAULT if not taken, else pickFree(taken)
//   GeoAvatars.pickFree(taken = [])       first roster id not in taken, or null if all taken
//   GeoAvatars.faceSvg(id, expr = "happy")  placeholder face as an SVG string (100x100
//                                        viewBox, flat shapes only, under 2 KB). Unknown
//                                        id -> DEFAULT, unknown expression -> "happy";
//                                        never throws.
//   GeoAvatars.faceUrl(id, expr)  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(faceSvg)
//   GeoAvatars.setManifest(files)  remember the raster art manifest: an array of relative
//                                  paths ("fox/happy.webp"); a non-array empties it
//   GeoAvatars.loadManifest()      fetch("assets/avatars/manifest.json") -> setManifest(json.files);
//                                  the returned promise always resolves (any error -> empty
//                                  manifest) and never throws
//   GeoAvatars.hasArt(id, expr)    true when the manifest lists "<id>/<expr>.webp"
//   GeoAvatars.artUrl(id, expr)    "assets/avatars/<id>/<expr>.webp" when listed, else faceUrl
//   GeoAvatars.baronSvg(expr)      placeholder Baron face as an SVG string — the same 100x100
//                                  frame as the roster (lavender bg, white rim); unknown
//                                  expression -> "mischievous"; never throws
//   GeoAvatars.baronUrl(expr)      "assets/avatars/baron/<expr>.webp" when listed, else a data
//                                  URL of baronSvg(expr)
//   GeoAvatars.renderPicker(box, { selected, taken = [], size = 48, onPick })
//                                 fill `box` with one round face button per character
//                                 (the only DOM-facing entry point — called, never at load):
//                                 the selected id gets .selected + aria-pressed, ids in
//                                 `taken` render disabled + .used, a click calls onPick(id)
//
// Every face shares one frame: white rim, bg circle, flat head-and-shoulders bust, one
// signature feature per character, and eyes/brows/mouth driven by the expression.

var GeoAvatars = (function () {
  var INK = "#20242e";
  var SPARK = '<path d="M78 19 L80 24 L85 26 L80 28 L78 33 L76 28 L71 26 L76 24 Z" fill="#fff"/>';

  var CHARACTERS = [
    { id: "pirate", name: "Pirate Captain", emoji: "🏴‍☠️", colors: { bg: "#e63946", main: "#2b2d42", accent: "#ffd166", skin: "#8d5524" } },
    { id: "astronaut", name: "Astronaut", emoji: "🚀", colors: { bg: "#118ab2", main: "#e8eef2", accent: "#ff9f1c", skin: "#c68642" } },
    { id: "fox", name: "Fox Explorer", emoji: "🦊", colors: { bg: "#06d6a0", main: "#f77f00", accent: "#ffffff", skin: "#ffffff" } },
    { id: "robot", name: "Robot", emoji: "🤖", colors: { bg: "#8338ec", main: "#adb5bd", accent: "#4cc9f0", skin: "#495057" } },
    { id: "knight", name: "Knight", emoji: "🛡️", colors: { bg: "#ffb703", main: "#8d99ae", accent: "#d62828", skin: "#e0ac69" } },
    { id: "scientist", name: "Scientist", emoji: "🔬", colors: { bg: "#3a86ff", main: "#457b9d", accent: "#ffd166", skin: "#ffe0bd" } },
    { id: "diver", name: "Deep-Sea Diver", emoji: "🤿", colors: { bg: "#22d3ee", main: "#d4a017", accent: "#e63946", skin: "#a26a42" } },
    { id: "ninjacat", name: "Ninja Cat", emoji: "🐱", colors: { bg: "#f72585", main: "#20242e", accent: "#ffd166", skin: "#f4a261" } },
    { id: "ranger", name: "Safari Ranger", emoji: "🧭", colors: { bg: "#8ac926", main: "#c9a227", accent: "#bc4749", skin: "#6b4226" } },
    { id: "polar", name: "Polar Explorer", emoji: "🐧", colors: { bg: "#ff6b35", main: "#2a6f97", accent: "#f1faee", skin: "#f5d0a9" } }
  ];

  var DEFAULT = "fox";
  var EXPRESSIONS = ["happy", "cheer", "oops"];
  var BARON_EXPRESSIONS = ["mischievous", "smug", "grumpy"];

  function byId(id) {
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (CHARACTERS[i].id === id) return CHARACTERS[i];
    }
    return null;
  }

  function pickFree(taken = []) {
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (taken.indexOf(CHARACTERS[i].id) === -1) return CHARACTERS[i].id;
    }
    return null;
  }

  function normalize(id, taken = []) {
    if (byId(id) && taken.indexOf(id) === -1) return id;
    if (taken.indexOf(DEFAULT) === -1) return DEFAULT;
    return pickFree(taken);
  }

  // ---------- SVG helpers (shapes only: no text, no external refs) ----------

  function dot(x, y, r, fill) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"/>';
  }

  // Shoulders whose bottom edge follows the bg circle, so nothing pokes past the rim.
  function bust(fill) {
    return '<path d="M15 75 Q15 68 50 68 Q85 68 85 75 A43 43 0 0 1 15 75 Z" fill="' + fill + '"/>';
  }

  function neck(fill) {
    return '<rect x="44" y="52" width="12" height="20" fill="' + fill + '"/>';
  }

  function browArc(x, y, c) {
    return '<path d="M' + (x - 5) + ' ' + (y - 7) + ' Q' + x + ' ' + (y - 12) + ' ' + (x + 5) + ' ' + (y - 7)
      + '" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linecap="round"/>';
  }

  // Eyes, brows and mouth for one expression.
  // p: { dx, ey, my, grin, eyeC, browC, mouthC, left } — dx/ey place the eyes, my the mouth,
  // grin is the cheer grin width, left:false skips the left eye+brow (pirate eye patch).
  function exprBits(e, p) {
    var x1 = 50 - p.dx, x2 = 50 + p.dx, y = p.ey, s = "", L = p.left !== false;
    if (e === "cheer") {
      if (L) s += browArc(x1, y, p.browC);
      s += browArc(x2, y, p.browC);
      if (L) s += dot(x1, y, 3.6, p.eyeC);
      s += dot(x2, y, 3.6, p.eyeC);
      s += '<path d="M' + (50 - p.grin) + ' ' + (p.my - 3) + ' Q50 ' + (p.my + p.grin) + ' ' + (50 + p.grin)
        + ' ' + (p.my - 3) + ' Z" fill="' + p.mouthC + '"/>' + SPARK;
    } else if (e === "oops") {
      if (L) s += '<path d="M' + (x1 - 6) + ' ' + (y - 10) + ' L' + (x1 + 3) + ' ' + (y - 6)
        + '" fill="none" stroke="' + p.browC + '" stroke-width="2.5" stroke-linecap="round"/>';
      s += '<path d="M' + (x2 + 6) + ' ' + (y - 10) + ' L' + (x2 - 3) + ' ' + (y - 6)
        + '" fill="none" stroke="' + p.browC + '" stroke-width="2.5" stroke-linecap="round"/>';
      if (L) s += dot(x1, y, 2.6, p.eyeC);
      s += dot(x2, y, 2.6, p.eyeC);
      s += '<circle cx="50" cy="' + p.my + '" r="3.4" fill="none" stroke="' + p.mouthC + '" stroke-width="2.6"/>';
    } else { // happy
      if (L) s += dot(x1, y, 3, p.eyeC);
      s += dot(x2, y, 3, p.eyeC);
      s += '<path d="M' + (50 - 8) + ' ' + p.my + ' Q50 ' + (p.my + 7) + ' ' + (50 + 8) + ' ' + p.my
        + '" fill="none" stroke="' + p.mouthC + '" stroke-width="3" stroke-linecap="round"/>';
    }
    return s;
  }

  // One builder per character: (colors, expression) -> markup inside the shared frame.
  var BUILDERS = {
    pirate: function (k, e) { // tricorn hat + eye patch over the viewer's left eye
      return neck(k.skin) + bust(k.main)
        + '<ellipse cx="50" cy="45" rx="15" ry="17" fill="' + k.skin + '"/>'
        + '<path d="M24 42 Q50 4 76 42 Q63 33 50 33 Q37 33 24 42 Z" fill="' + k.main + '"/>'
        + '<path d="M28 38 Q50 25 72 38" fill="none" stroke="' + k.accent + '" stroke-width="2"/>'
        + '<path d="M33 41 L67 34" fill="none" stroke="' + k.main + '" stroke-width="2.5"/>'
        + dot(40, 45, 5.5, k.main)
        + exprBits(e, { dx: 10, ey: 45, my: 57, grin: 9, eyeC: INK, browC: INK, mouthC: INK, left: false });
    },

    astronaut: function (k, e) { // white helmet + accent visor ring (ring drawn over the face)
      return neck(k.main) + bust(k.main)
        + '<rect x="42" y="76" width="16" height="9" rx="2" fill="' + k.accent + '"/>'
        + '<rect x="26" y="38" width="7" height="12" rx="3.5" fill="' + k.main + '"/>'
        + '<rect x="67" y="38" width="7" height="12" rx="3.5" fill="' + k.main + '"/>'
        + '<circle cx="50" cy="44" r="21" fill="' + k.main + '"/>'
        + '<circle cx="50" cy="45" r="15" fill="' + k.skin + '"/>'
        + exprBits(e, { dx: 7, ey: 47, my: 53, grin: 8, eyeC: INK, browC: INK, mouthC: INK })
        + '<circle cx="50" cy="45" r="15" fill="none" stroke="' + k.accent + '" stroke-width="3"/>';
    },

    fox: function (k, e) { // pointed ears + white muzzle + white chest
      return neck(k.main) + bust(k.main)
        + '<ellipse cx="50" cy="76" rx="13" ry="11" fill="' + k.accent + '"/>'
        + '<path d="M30 32 L35 14 L46 27 Z" fill="' + k.main + '"/>'
        + '<path d="M70 32 L65 14 L54 27 Z" fill="' + k.main + '"/>'
        + '<path d="M34 28 L36 18 L43 25 Z" fill="' + k.accent + '"/>'
        + '<path d="M66 28 L64 18 L57 25 Z" fill="' + k.accent + '"/>'
        + '<ellipse cx="50" cy="46" rx="17" ry="16" fill="' + k.main + '"/>'
        + '<ellipse cx="50" cy="54" rx="10" ry="8" fill="' + k.accent + '"/>'
        + '<ellipse cx="50" cy="49" rx="3.5" ry="2.5" fill="' + INK + '"/>'
        + exprBits(e, { dx: 9, ey: 44, my: 55, grin: 8, eyeC: INK, browC: INK, mouthC: INK });
    },

    robot: function (k, e) { // square head + antenna + LED eyes (accent)
      return neck(k.main) + bust(k.main)
        + '<rect x="41" y="79" width="18" height="5" rx="2.5" fill="' + k.skin + '"/>'
        + '<path d="M50 24 V13" stroke="' + k.main + '" stroke-width="3"/>'
        + dot(50, 11, 4, k.accent)
        + '<rect x="29" y="24" width="42" height="38" rx="7" fill="' + k.main + '"/>'
        + '<rect x="24" y="38" width="6" height="11" rx="3" fill="' + k.main + '"/>'
        + '<rect x="70" y="38" width="6" height="11" rx="3" fill="' + k.main + '"/>'
        + '<rect x="34" y="30" width="32" height="26" rx="5" fill="' + k.skin + '"/>'
        + exprBits(e, { dx: 9, ey: 42, my: 50, grin: 7, eyeC: k.accent, browC: k.accent, mouthC: k.accent });
    },

    knight: function (k, e) { // steel dome + visor slit + plume
      return neck(k.main) + bust(k.main)
        + '<path d="M29 57 V40 A21 21 0 0 1 71 40 V57 Z" fill="' + k.main + '"/>'
        + '<path d="M50 17 Q69 7 73 27 Q61 23 50 29 Z" fill="' + k.accent + '"/>'
        + '<rect x="35" y="36" width="30" height="22" rx="5" fill="' + k.skin + '"/>'
        + dot(33, 50, 2, k.accent) + dot(67, 50, 2, k.accent)
        + exprBits(e, { dx: 8, ey: 47, my: 53, grin: 7, eyeC: INK, browC: INK, mouthC: INK });
    },

    scientist: function (k, e) { // goggles pushed up on the forehead + lab-coat collar
      return neck(k.skin) + bust(k.main)
        + '<path d="M39 68 L50 84 L61 68 Z" fill="#fff"/>'
        + '<ellipse cx="50" cy="46" rx="14" ry="16" fill="' + k.skin + '"/>'
        + '<circle cx="41" cy="30" r="5.5" fill="#d8f3fa" stroke="' + k.accent + '" stroke-width="3"/>'
        + '<circle cx="59" cy="30" r="5.5" fill="#d8f3fa" stroke="' + k.accent + '" stroke-width="3"/>'
        + '<path d="M46.5 29 Q50 27 53.5 29" fill="none" stroke="' + k.accent + '" stroke-width="3"/>'
        + '<path d="M35.5 31 L27 35" fill="none" stroke="' + k.accent + '" stroke-width="3"/>'
        + '<path d="M64.5 31 L73 35" fill="none" stroke="' + k.accent + '" stroke-width="3"/>'
        + exprBits(e, { dx: 9, ey: 48, my: 56, grin: 8, eyeC: INK, browC: INK, mouthC: INK });
    },

    diver: function (k, e) { // round brass helmet + porthole (ring drawn over the face)
      return neck(k.main) + bust(k.accent)
        + '<rect x="38" y="72" width="24" height="14" rx="4" fill="' + k.main + '"/>'
        + '<rect x="24" y="36" width="8" height="15" rx="4" fill="' + k.main + '"/>'
        + '<rect x="68" y="36" width="8" height="15" rx="4" fill="' + k.main + '"/>'
        + '<circle cx="50" cy="43" r="22" fill="' + k.main + '"/>'
        + dot(50, 20, 3.5, "#8a6410")
        + '<circle cx="50" cy="44" r="15" fill="' + k.skin + '"/>'
        + exprBits(e, { dx: 7, ey: 47, my: 52, grin: 6, eyeC: INK, browC: INK, mouthC: INK })
        + '<circle cx="50" cy="44" r="15" fill="none" stroke="#8a6410" stroke-width="3"/>';
    },

    ninjacat: function (k, e) { // cat ears + black mask band (white eyes on the band)
      return neck(k.skin) + bust(k.main)
        + '<rect x="41" y="69" width="18" height="5" rx="2.5" fill="' + k.accent + '"/>'
        + dot(50, 78, 4, k.accent)
        + '<path d="M30 33 L35 13 L47 27 Z" fill="' + k.skin + '"/>'
        + '<path d="M70 33 L65 13 L53 27 Z" fill="' + k.skin + '"/>'
        + '<path d="M34 28 L36 17 L43 25 Z" fill="' + k.main + '"/>'
        + '<path d="M66 28 L64 17 L57 25 Z" fill="' + k.main + '"/>'
        + '<ellipse cx="50" cy="46" rx="17" ry="16" fill="' + k.skin + '"/>'
        + '<rect x="31" y="40" width="38" height="11" rx="5.5" fill="' + k.main + '"/>'
        + '<ellipse cx="50" cy="54" rx="2.5" ry="2" fill="' + INK + '"/>'
        + '<path d="M28 52 L35 53 M72 52 L65 53" fill="none" stroke="' + INK + '" stroke-width="2"/>'
        + exprBits(e, { dx: 9, ey: 45.5, my: 58, grin: 8, eyeC: "#fff", browC: INK, mouthC: INK });
    },

    ranger: function (k, e) { // wide safari hat + bag strap
      return neck(k.skin) + bust(k.main)
        + '<path d="M32 70 Q44 80 58 90" fill="none" stroke="' + k.accent + '" stroke-width="5"/>'
        + '<ellipse cx="50" cy="45" rx="14" ry="15" fill="' + k.skin + '"/>'
        + '<ellipse cx="50" cy="31" rx="26" ry="5.5" fill="' + k.main + '"/>'
        + '<path d="M37 31 Q37 13 50 13 Q63 13 63 31 Z" fill="' + k.main + '"/>'
        + '<rect x="37" y="26" width="26" height="4" fill="' + k.accent + '"/>'
        + exprBits(e, { dx: 9, ey: 48, my: 57, grin: 8, eyeC: INK, browC: INK, mouthC: INK });
    },

    polar: function (k, e) { // fur-trimmed hood + tiny penguin on the shoulder
      return neck(k.main) + bust(k.main)
        + '<ellipse cx="50" cy="70" rx="19" ry="7" fill="' + k.accent + '"/>'
        + '<circle cx="50" cy="45" r="21" fill="' + k.main + '"/>'
        + '<circle cx="50" cy="45" r="17" fill="' + k.accent + '"/>'
        + '<ellipse cx="50" cy="46" rx="13" ry="14" fill="' + k.skin + '"/>'
        + exprBits(e, { dx: 7, ey: 45, my: 54, grin: 7, eyeC: INK, browC: INK, mouthC: INK })
        + '<ellipse cx="75" cy="77" rx="6" ry="7.5" fill="' + INK + '"/>'
        + '<ellipse cx="75" cy="79" rx="4" ry="5" fill="#fff"/>'
        + '<path d="M75 72 L79 73.5 L75 75 Z" fill="#ff9f1c"/>'
        + dot(77, 70.5, 1.2, "#fff");
    }
  };

  function frame(c, inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
      + '<circle cx="50" cy="50" r="47" fill="#fff"/>'
      + '<circle cx="50" cy="50" r="43" fill="' + c.colors.bg + '"/>'
      + inner + '</svg>';
  }

  function faceSvg(id, expr = "happy") {
    try {
      var c = byId(id) || byId(DEFAULT);
      var e = EXPRESSIONS.indexOf(expr) === -1 ? "happy" : expr;
      return frame(c, BUILDERS[c.id](c.colors, e));
    } catch (err) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<circle cx="50" cy="50" r="47" fill="#fff"/><circle cx="50" cy="50" r="43" fill="#8d99ae"/></svg>';
    }
  }

  function faceUrl(id, expr) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(faceSvg(id, expr));
  }

  // ---------- raster art manifest (assets/avatars/*.webp) ----------

  var manifest = new Set();

  // Remember the raster art manifest: an array of relative paths such as
  // "fox/happy.webp". Anything that is not an array empties the manifest.
  function setManifest(files) {
    manifest = new Set();
    if (Array.isArray(files)) {
      for (var i = 0; i < files.length; i++) manifest.add(files[i]);
    }
  }

  // True when the manifest lists "<id>/<expr>.webp".
  function hasArt(id, expr) {
    if (typeof id !== "string" || typeof expr !== "string") return false;
    return manifest.has(id + "/" + expr + ".webp");
  }

  // Fetch "assets/avatars/manifest.json" and hand json.files to setManifest.
  // The returned promise always resolves — any error (missing file, bad JSON,
  // no fetch) leaves the manifest empty. Never throws.
  function loadManifest() {
    return new Promise(function (resolve) {
      try {
        fetch("assets/avatars/manifest.json")
          .then(function (r) { return r.json(); })
          .then(function (json) { setManifest(json && json.files); resolve(); })
          .catch(function () { setManifest(null); resolve(); });
      } catch (err) {
        setManifest(null);
        resolve();
      }
    });
  }

  // Raster art when the manifest lists it, the placeholder face otherwise.
  function artUrl(id, expr) {
    if (hasArt(id, expr)) return "assets/avatars/" + id + "/" + expr + ".webp";
    return faceUrl(id, expr);
  }

  // ---------- Baron von Blunder (placeholder face, same frame as the roster) ----------

  // Hat, head, monocle and moustache shared by every mood; the moustache
  // droops for "grumpy". Shapes only, like the character faces.
  function baronBase(droopy) {
    return neck("#fcd9b8") + bust("#7c3aed")
      + '<ellipse cx="50" cy="50" rx="16" ry="16" fill="#fcd9b8"/>'
      + '<rect x="37" y="4" width="26" height="28" rx="3" fill="#4c1d95"/>'
      + '<rect x="37" y="25" width="26" height="5" fill="#f59e0b"/>'
      + '<rect x="29" y="31" width="42" height="6" rx="3" fill="#312e81"/>'
      + '<circle cx="50" cy="52.5" r="2.8" fill="#f0a878"/>'
      + (droopy
        ? '<path d="M50 55.5C46.5 53 41 53.5 39 56.5C37.5 60.5 39.5 63.5 42.5 62C45 60.7 47 58.9 50 59.5C53 58.9 55 60.7 57.5 62C60.5 63.5 62.5 60.5 61 56.5C59 53.5 53.5 53 50 55.5Z" fill="#312e81"/>'
        : '<path d="M50 55.5C46.5 53 41 53.5 39 56.5C37.5 59 39.5 61.5 42 60.5C44.5 59.3 47 58.6 50 58.2C53 58.6 55.5 59.3 58 60.5C60.5 61.5 62.5 59 61 56.5C59 53.5 53.5 53 50 55.5Z" fill="#312e81"/>')
      + '<circle cx="57" cy="48" r="7" fill="rgba(255,255,255,.2)" stroke="#f59e0b" stroke-width="2"/>'
      + '<path d="M63 53.5 L68.5 59.5" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/>';
  }

  // Eyes, brows and mouth for one mood (mischievous / smug / grumpy).
  function baronBits(e) {
    var B = "#312e81", E = "#1e293b", M = "#b45309";
    if (e === "smug") { // closed satisfied eyes, wide smile, monocle glint
      return '<path d="M38.5 42.5 Q43 40 47.5 42.5" fill="none" stroke="' + B + '" stroke-width="2.2" stroke-linecap="round"/>'
        + '<path d="M52.5 42.5 Q57 40 61.5 42.5" fill="none" stroke="' + B + '" stroke-width="2.2" stroke-linecap="round"/>'
        + '<path d="M39.5 48.5 Q43 45.5 46.5 48.5" fill="none" stroke="' + E + '" stroke-width="2.4" stroke-linecap="round"/>'
        + '<path d="M53.5 48.5 Q57 45.5 60.5 48.5" fill="none" stroke="' + E + '" stroke-width="2.4" stroke-linecap="round"/>'
        + '<path d="M44.5 60.5 Q50 66 55.5 60.5" fill="none" stroke="' + M + '" stroke-width="2.4" stroke-linecap="round"/>'
        + '<path d="M60 43.5 L63 46.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';
    }
    if (e === "grumpy") { // lowered brows, small eyes, frown
      return '<path d="M38.5 42.5 L47.5 46.5" fill="none" stroke="' + B + '" stroke-width="2.5" stroke-linecap="round"/>'
        + '<path d="M61.5 42.5 L52.5 46.5" fill="none" stroke="' + B + '" stroke-width="2.5" stroke-linecap="round"/>'
        + dot(43, 49, 2.3, E) + dot(57, 49, 2.3, E)
        + '<path d="M45 63.5 Q50 60 55 63.5" fill="none" stroke="' + M + '" stroke-width="2.4" stroke-linecap="round"/>';
    }
    // mischievous: one raised brow + sly half-smile
    return '<path d="M38.5 43.5 Q43 39 47.5 43" fill="none" stroke="' + B + '" stroke-width="2.2" stroke-linecap="round"/>'
      + '<path d="M52.5 44.5 Q57 46 61.5 44.5" fill="none" stroke="' + B + '" stroke-width="2.2" stroke-linecap="round"/>'
      + dot(43, 48, 2.6, E) + dot(57, 48, 2.6, E)
      + '<path d="M45 62.5 Q50 63.5 55 60.5" fill="none" stroke="' + M + '" stroke-width="2.4" stroke-linecap="round"/>';
  }

  function baronSvg(expr) {
    try {
      var e = BARON_EXPRESSIONS.indexOf(expr) === -1 ? "mischievous" : expr;
      return frame({ colors: { bg: "#ddd6fe" } }, baronBase(e === "grumpy") + baronBits(e));
    } catch (err) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<circle cx="50" cy="50" r="47" fill="#fff"/><circle cx="50" cy="50" r="43" fill="#ddd6fe"/></svg>';
    }
  }

  // Raster Baron art when the manifest lists it, the placeholder data URL otherwise.
  function baronUrl(expr) {
    if (hasArt("baron", expr)) return "assets/avatars/baron/" + expr + ".webp";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(baronSvg(expr));
  }

  // ---------- character picker (the only DOM-facing entry point) ----------

  // Fill `box` with one round face button per character: the selected id
  // gets the .selected class + aria-pressed, ids in `taken` render disabled
  // with .used, and a click calls onPick(id). No state is kept here.
  function renderPicker(box, { selected, taken = [], size = 48, onPick }) {
    box.innerHTML = "";
    CHARACTERS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "av-pick";
      var img = document.createElement("img");
      img.alt = "";
      img.src = artUrl(c.id, "happy"); // final art when listed, placeholder otherwise
      img.width = size;
      img.height = size;
      b.appendChild(img);
      b.setAttribute("aria-label", c.name);
      b.setAttribute("aria-pressed", c.id === selected ? "true" : "false");
      if (c.id === selected) b.classList.add("selected");
      if (taken.indexOf(c.id) !== -1) {
        b.disabled = true;
        b.classList.add("used");
      }
      b.addEventListener("click", function () {
        if (onPick) onPick(c.id);
      });
      box.appendChild(b);
    });
  }

  return {
    CHARACTERS: CHARACTERS,
    DEFAULT: DEFAULT,
    selected: "fox",
    EXPRESSIONS: EXPRESSIONS,
    BARON_EXPRESSIONS: BARON_EXPRESSIONS,
    byId: byId,
    normalize: normalize,
    pickFree: pickFree,
    faceSvg: faceSvg,
    faceUrl: faceUrl,
    setManifest: setManifest,
    loadManifest: loadManifest,
    hasArt: hasArt,
    artUrl: artUrl,
    baronSvg: baronSvg,
    baronUrl: baronUrl,
    renderPicker: renderPicker
  };
})();
