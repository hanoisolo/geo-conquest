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

## 8. Multiplayer: local pass-and-play (approved by Don, Oct 2026)
One device, 2-4 players taking turns. No Baron. Solo stays exactly as it is.

### 8.1 Mode select and setup (segment M1)
- The start screen keeps the two solo cards (Continent Quest, World Conquest — vs the Baron) under a "Solo" label and adds a third card **👥 Multiplayer — 2-4 players on one device** (`#btn-multi`).
- Multiplayer setup screen (`#screen-mp-setup`): number of players 2/3/4; per player a name (default "Player 1"..; max 12 chars) and a colour from 4 presets (blue `#2563eb`, red `#dc2626`, green `#16a34a`, orange `#ea580c`; each colour used once); win mode **⏱ Timed** (10 / 20 / 30 min) or **👑 Total domination**; Start button. Validation: names non-empty and unique.
- **Map choice** (Don, Oct 2026), shown next to the win-mode choice on the setup screen: **🌍 Whole world** or **one continent** (North America, South America, Europe, Africa, Asia, Oceania). In a one-continent game only that continent's countries are playable (the rest is grey backdrop, not clickable, homes too), the map zooms to it, strike-back neighbours are limited to that continent (random attacker country when none borders the target), and **total domination means holding every country of that continent**. In a whole-world game, total domination = last player standing. Saved as `mapScope` ("world" or a continent id).
- Home flags: players plant in turn order ("<name>, tap a country to plant your home flag"); each picks a different, unclaimed country. Homes show a 🏠 marker/badge in the scoreboard.
- Acceptance: setup works at 390px; the map colours each player's countries in their colour; the Baron panel and phone avatar are hidden in multiplayer.

### 8.2 Turns, attacks and strike-backs (segment M2)
- A turn banner at the top of the game area in the current player's colour: "🎯 <name>'s turn". The scoreboard lists every player (colour, name, countries, points; eliminated players struck through).
- One attack per turn: tap an unclaimed country or an enemy's country (not your own). The territory card shows the owner, the Geography/Math choice and difficulty (math nudge every 3rd question per player and hints unchanged). Enemy **home** countries need Medium or Hard (Easy disabled, same note as the Baron's fortresses).
- Unclaimed: right answer takes it (points as solo: tier points, −20% per hint, min 5, +5 math nudge); a miss changes nothing.
- Enemy: right answer takes it. A miss gives the defender a **strike-back**: hand-off screen "🔄 Pass to <defender>" (full-screen, the defender's colour, a "I'm <defender> — ready!" button), then the defender answers a question of the same subject and tier. Right → the defender takes one of the attacker's countries adjacent to the target (data/adjacency.json, land borders), picked at random; if none is adjacent, a random attacker country. The attacker's home is only taken when it is their last country. Wrong → nothing changes. The defender earns +10 for a successful strike-back.
- After each turn: hand-off screen "🔄 Pass to <next player>", then that player's turn. Eliminated players (0 countries) are skipped.
- No turn passes with a modal still open; "Try a similar one" practice stays available and never changes the game.

### 8.3 Winning, timer, standings, saves (segment M3)
- Timed: a countdown in the banner (mm:ss). When it reaches 0 the current question finishes, then the game ends. Most countries wins; ties broken by points; then shared.
- Total domination: last player with countries wins.
- Final standings screen (`#mp-standings`): ranked list with colour, name, countries, points, medals 🥇🥈🥉; buttons "Play again (same players)" and "Back to start".
- Saves: multiplayer has its own key `geoConquestMultiV1` (players, ownership, homes, turn, phase, win mode, time left, asked ids). Reload resumes at the same turn (timer pauses while the page is closed). Solo save (`geoConquestSaveV1`) is never read, written or cleared by multiplayer. "Continue" on the start screen offers the right mode.

### 8.4 Tests (segment M4)
- e2e (`tests/e2e-multi.mjs`, desktop + phone): 2-player timed game (home flags, unclaimed capture, miss on unclaimed changes nothing, timer end → standings); 4-player domination game (strike-back success takes an adjacent attacker country, failed strike-back, Easy disabled on an enemy home, an elimination is skipped in turn order, last player standing wins); solo save survives a multiplayer game; reload mid-turn resumes.

### 8.5 Fortify — Easy only on unclaimed (Oct 2026)
- Easy can only take **unclaimed** countries. A country owned by another player needs Medium or Hard.
- Every owned country remembers the tier it was won at (`levels`; a missing entry counts as easy — old saves and home flags). Attacking an owned country needs that tier or higher, with a minimum of Medium: easy/medium-won → Medium or Hard; hard-won → only Hard. Enemy homes keep their Medium minimum (the requirement is the higher of Medium and the level).
- A successful strike-back fortifies the taken country at the tier the defender answered at.
- The territory card shows the fortify level (🛡️ pips + "won on Easy/Medium/Hard"); map tooltips append it (e.g. "Brazil — Mia 🏠 · 🛡️ Hard").
