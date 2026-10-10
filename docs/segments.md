# Segments (big-release)

Gate per segment: `node tests/check.mjs` (COVERAGE=0 before segment 4) + `node tests/e2e.mjs <tree>` visual review at 1280x800 and 390x844.
Max one fix round per segment. One local commit per clean segment. Nothing pushed until Don approves.

| # | Segment | Spec | Status | Commit |
|---|---------|------|--------|--------|
| 0 | Blueprint docs + check/e2e/validator tooling | — | done | 4b07b6d |
| 1 | Engine fixes, save v2, Easy rule, giveaway rule, question-type plumbing | §1 (+ §5 rendering) | done — check + e2e 22/22 | 9715de2 |
| 2 | Map UX: pan, pointer/pinch zoom, focus, markers, labels, style | §2 | done — 1 fix round (phone map height, label collisions); check + e2e 22/22 + map gesture test | 62b98cf |
| 3 | Sound, confetti, Baron, victory screen, visual polish (+ vendored flag SVGs used by the victory/territory cards) | §3 | done — run as 2 Vibe tasks + 1 fix round (compact phone header, Baron placement); check + e2e 22/22 | 5a0269b |
| 4 | Hand-written geography bank (xtra files, full coverage) | §4 | done — 7 xtra files by Vibe (NA/SA/EU/AF/AS×2/OC), fact-checked by Forge (1 reworded: Koro Sea); last 4 empty slots (CUB hard, SLV hard, ECU easy, SEN easy) written by Forge in questions-xtra-forge.json after fill task stalled; 1,086 questions after fill round 1a (17 by Vibe, 3 dropped: 2 duplicates + 1 inaccurate, 2 reworded, 1 added by Forge), every country×tier covered; 31 slots still <3 (thin, not empty); check + e2e 28/28 | seg 4 commit |
| 5 | Flags + capitals + map-tap generated questions | §5 | done (committed before 4 while data generation ran) — fix round by Forge: phone find-mode scrolls map into view, wrong taps flash the target before feedback; check + e2e 28/28 | seg 5 commit |
| 6 | Math module + subject choice + hint UI | §6 | done — 6a subject choice done (e2e 38/38); 6b hints + fraction bars + −20% points per hint (min 5) done (e2e 44/44); 6c worked solution + "Try a similar one" practice (no stakes) done (e2e 50/50) | 6a 00462dd, 6b 8218031, 6c a050c58 |
| 7 | Hardening pass (a11y, mobile, copy) + final screenshots | all | done — toasts wait while a card is open (replayed if covered within 1 s), phone toast under the header (clear of the Baron bubble), sticky Continue/Try-a-similar bar, no-op fraction steps skipped, a11y pass by Vibe (aria labels, dialog roles, live regions, focus rings, reduced motion, keys 1-4/H/Enter); e2e 58/58 | cbf17a7 + seg 7b commit |

## Multiplayer (spec §8) — branch `multiplayer`
| # | Segment | Spec | Status | Commit |
|---|---------|------|--------|--------|
| M0 | Blueprint: spec §8, segments, decisions, land adjacency data (tools/build_adjacency.py → data/adjacency.json) | §8 | done | M0 commit |
| M1 | Mode card, setup screen, multi.js state + separate save, home flags, turn banner, scoreboard | §8.1 | done — Vibe M1 stalled after multi.js + HTML (Forge fixed a comment syntax error, added game.js/app.js hooks); retry M1b (CSS) clean; Forge fix round: hide legend/empty timer, setup counts as mp-mode; check, solo e2e 61/61, e2e-multi 16/16 | M1 commit |
| M2 | Turns, attacks, home Medium/Hard rule, strike-back hand-off, elimination skip | §8.2 | done — M2a (first run stalled, smaller retry clean) + M2b strike-backs (clean, 3 min); e2e-multi 48/48 incl. adjacent prize, failed strike-back, reload mid strike-back; solo 61/61 | 52fb168, M2b commit |
| M3 | Timer, domination win, final standings, resume | §8.3 | pending | |
| M4 | e2e-multi tests (2p timed, 4p domination, strike-back, elimination, timer end, solo save intact) + screenshots | §8.4 | pending | |
