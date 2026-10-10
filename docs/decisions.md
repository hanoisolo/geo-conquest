# Decisions log

- 2026-10-10 — Scope approved by Don: Phases 1-3 (fixes/map/polish, geography expansion, math with hints) as one release; built on branch `big-release`, local commits only until Don approves a push.
- Easy shortcut: Baron-held countries need Medium or Hard (simpler to explain than "no steal on Easy", and it keeps a real reason to try harder questions).
- Giveaways: questions whose answer is the contested country are only used on *other* countries of the same continent (the modal header names the country, so "Which country's flag is this?" would be free).
- Flags: vendored SVGs from flag-icons (MIT) instead of hand-drawn ones — accurate and small (~575 KB total, loaded on demand).
- Capitals: generated from one reviewed table (`data/capitals.json`) instead of hand-written, so both directions stay consistent. Special cases explained in the `note` (Bolivia = Sucre, South Africa = Pretoria, Netherlands = Amsterdam, Indonesia = Jakarta for now).
- Hand-written duplicates of the generated capital questions (63) were removed from the original banks.
- Math: procedural generator, not a fixed bank — endless variety and answers are computed, plus an independent test that recomputes every answer.
- Math word problems use generic wording rather than real city distances, so they never teach wrong facts.
- Hand-written bank generated per continent in smaller Vibe tasks after the single large task hit the 40-minute deadline (NA + SA salvaged from it).
- Model pinned: mistral-large-4 (wrapper fallback to GLM 5.3 accepted only if it triggers).
- Multiplayer (§8): one new module `js/multi.js` (`GeoMulti`) owns multiplayer state and its own save key; it reuses GeoMap (via the `onTerritoryClick` callback and `styleFor`) and GeoGame's question modal. GeoGame gets a `mode` flag; `persist()` is a no-op in multiplayer so the solo save can never be overwritten.
- Multiplayer map is the whole world (68 countries, all unlocked). Choosing a single continent is an option to raise with Don.
- Strike-back "adjacent" = shares a land border in Natural Earth outlines (56 borders). 17 island/isolated countries have none (e.g. AUS, JPN, KOR, EGY among playable ones) — they fall back to a random attacker country. France borders Brazil/Suriname through French Guiana (true, kept).
- Start screen keeps the two solo cards and adds a third Multiplayer card rather than a two-step Solo/Multiplayer chooser (one tap fewer, no change for solo players).
- Vibe retries after a mistral-large-4 stall/loop/error run on GLM 5.3 (`/workspace/tools/vt-glm.sh`, `--model glm-5-3`), per Don (Large 4 is in preview). The stall rule applies to the GLM retry too.
- Domination ends early when only one player is left, even on a one-continent map with unclaimed countries remaining (nobody can contest them; continuing alone would be busywork). Otherwise one-continent domination = owning every country of that continent.
- Players tied on countries and points share a rank (and medal) in the standings.
