# Conventions

## Stack
Plain HTML + CSS + vanilla JS (ES2019+, `"use strict"`), no frameworks, no npm runtime deps, no CDNs, no build step.
Runs from any static server (`python3 -m http.server`). Data is JSON fetched at boot.

## Layout
- `index.html` — all screens and modals.
- `css/style.css` — one stylesheet; design tokens as CSS variables in `:root`.
- `js/` — one global object per file: `GeoStorage` (storage.js), `GeoMap` (map.js), `GeoSound` (sound.js), `GeoConfetti` (confetti.js), `GeoMath` (math.js), `GeoGame` (game.js), boot/wiring in app.js. Script order: storage, map, sound, confetti, math, game, app.
- `data/` — `territories.json`, `countries.geojson`, `capitals.json`, `manifest.json` (list of question files), `questions-*.json`.
- `assets/flags/` — `<ISO3>.svg` flags.
- `tools/` — Python helpers run by developers only (`build_questions.py`, `validate.py`).
- `tests/` — `check.mjs` (the gate), `math.test.js`, `e2e.mjs` (Playwright via /workspace/tools, dev only).
- `docs/` — spec, conventions, segments, decisions.

## Question format
`{id, continent, territory|null, tier: easy|medium|hard, type: text|flag|flag-pick|map|math, category, q, options[4], answer, explain}`
plus `image` (flag), `optionFlags` (flag-pick), `target` (map), `answerIsTerritory` (giveaway flag), `hints` (math).
IDs are unique and prefixed by source (NA-E-001, XNA-M-004, CAP-F-CAN, FLAG-N-CAN, MAP-CAN, MATH-...).

## Style
- Comment header at the top of each JS file; small methods; no innerHTML with untrusted/question text (use textContent or `escapeHtml`).
- Mobile first: no horizontal scroll at 390px, tap targets >= 44px, `:focus-visible` styles, respect `prefers-reduced-motion`.
- Kid-friendly copy: short sentences, encouraging, emoji in moderation.

## Don't
- Don't add libraries, trackers, external fonts or remote images.
- Don't edit `CNAME`. Don't commit generated junk (screenshots go to /workspace/geo-conquest-shots/, not the repo).
- Vibe never commits or pushes. Forge commits locally per clean segment; pushing only after Don approves.

## Gate
`node tests/check.mjs` = `node --check` on every JS file + `python3 tools/validate.py` + `node tests/math.test.js` (when present).
Visual gate: `node tests/e2e.mjs` screenshots at 1280x800 and 390x844 into /workspace/geo-conquest-shots/ with zero console errors.
