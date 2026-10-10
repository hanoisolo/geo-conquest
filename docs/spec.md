# Geo Conquest — Big Release spec (approved by Don, Oct 2026)

Audience: Don's son, 12, grade 7. Loves geography; math is not his strong point.
Stack: static site, plain HTML/CSS/vanilla JS, no build step, GitHub Pages (hanoisolo/geo-conquest, `main`, root) at conquest.inguyen.ca.
"Done" = all sections below meet their acceptance criteria, `node tests/check.mjs` passes, and the e2e
playthrough passes at 1280x800 and 390x844. Nothing is pushed until Don approves.

## 1. Engine fixes and save migration
- 1.1 Reloading after winning a continent (before picking the next) re-opens the correct screen: unlock picker (world), victory modal (quest), world victory (all done). Uses `state.pendingChoice` and detects old saves from data.
- 1.2 Toasts queue (player result first, then the Baron's move); tap to dismiss.
- 1.3 Answer options shuffled with Fisher-Yates (`GeoGame.shuffle`).
- 1.4 Save format v2 (`pendingChoice`, `geoSinceMath`, `hintsUsed`, `stats.byCategory`); v1 saves migrate in place under key `geoConquestSaveV1`; never crash on partial saves.
- 1.5 Easy is less of a shortcut: Baron-held countries can only be attacked with Medium or Hard.
- 1.6 Giveaway rule: a question whose answer is the contested country (`answerIsTerritory`, or correct option = its name) is never asked on that country; map questions never target the contested country.
- Acceptance: e2e reloads mid-game and after a continent win and lands on a playable screen; Easy disabled on a Baron country.

## 2. Map UX
- Drag to pan (mouse + touch, >6px drag is not a click), wheel zoom at pointer, pinch zoom, ＋/－/reset.
- Auto-focus (animated) on the active continent.
- Tiny countries get round clickable markers; country labels appear when zoomed in (hidden in find mode).
- Nicer style: ocean gradient + faint graticule, smooth fill transitions, hover state; owner colours clearly distinct from the ocean and from each other.
- Acceptance: Oceania/Caribbean small countries tappable on a 390px phone; screenshot review.

## 3. Sound, confetti, Baron, victory, polish
- Web Audio sounds (no files): correct, wrong, conquer, steal, click, hint, victory; mute toggle persisted in `geoConquestMuted`.
- Canvas confetti on conquest/victory; respects `prefers-reduced-motion`.
- Animated Baron von Blunder with ~25 kid-friendly taunts in a speech bubble.
- Upgraded continent victory screen (stats, the continent's flags, confetti, fanfare).
- Design tokens, button/card polish, flag on the territory card, focus-visible styles, no horizontal scroll at 390px.

## 4. Geography question bank (hand-written)
- `data/questions-xtra-{na,sa,eu,af,as,oc}.json`: landmarks, rivers, mountains, deserts, islands, oceans/seas, neighbours, climate/animals, cities, culture.
- Every country has >= 3 usable (non-giveaway) questions at each tier, counted over all files. Total bank >= ~1,000.
- Grade-7 difficulty; stable, textbook facts only; reviewed by Forge.

## 5. Generated geography: capitals, flags, map-tap
- `data/capitals.json` (68 countries) -> `tools/build_questions.py` -> `data/questions-generated.json`:
  capitals both directions, "whose flag is this?" (`type: flag`), "pick the flag of X" (`type: flag-pick`), "find X on the map" (`type: map`).
- Flags: local SVGs in `assets/flags/<ISO3>.svg` from the MIT-licensed flag-icons project (licence file alongside).
- Map-tap flow: modal -> "Go find it!" -> find mode (no tooltips/labels) -> tap -> feedback in modal.

## 6. Math module and hint UI
- `js/math.js` (`GeoMath.generate(tier, {skill, rng})`): procedurally generated, grade 7.
  - Easy: add/subtract to 1000, times tables to 12x12, exact division.
  - Medium: 2-digit x 2-digit, long division, decimals, same-denominator fractions, simplifying.
  - Hard: unlike-denominator fractions, multiply/divide fractions, mixed numbers, negatives, order of operations.
- Distractors from common mistakes; all options numerically distinct. Each question carries 2-5 step hints (with fraction bars).
- Territory card offers 🌍 Geography / 🧮 Math next to difficulty; roughly every 3rd question is nudged to math (pre-selected with a small bonus badge).
- 💡 Hint reveals one step at a time; fraction bars drawn in code; each hint reduces points (full -> 3/4 -> 1/2 floor) but the country can still be won.
- Wrong answer shows the full worked solution plus "Try a similar one" (same skill, practice — no conquest change).
- Same win/steal rules as geography. Cheap adaptive difficulty: after 2 math misses in a row, the next math question drops a tier; after 3 right, it may go up.
- Acceptance: `node tests/math.test.js` (thousands of samples, independent recomputation) passes; e2e answers a math question with hints open.
