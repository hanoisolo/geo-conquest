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
//   GeoAvatars.BARON_EXPRESSIONS  Baron mood names (consumed by js/baron.js; not drawn here)
//   GeoAvatars.byId(id)           character object, or null for unknown ids
//   GeoAvatars.normalize(id, taken = [])  a free avatar id: id if valid and not taken,
//                                        else DEFAULT if not taken, else pickFree(taken)
//   GeoAvatars.pickFree(taken = [])       first roster id not in taken, or null if all taken
//   GeoAvatars.faceSvg(id, expr = "happy")  placeholder face as an SVG string (100x100
//                                        viewBox, flat shapes only, under 2 KB). Unknown
//                                        id -> DEFAULT, unknown expression -> "happy";
//                                        never throws.
//   GeoAvatars.faceUrl(id, expr)  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(faceSvg)
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
      img.src = faceUrl(c.id, "happy");
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
    renderPicker: renderPicker
  };
})();
