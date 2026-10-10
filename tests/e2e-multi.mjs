// tests/e2e-multi.mjs — headless multiplayer playthrough + screenshots (dev only).
// Usage: node tests/e2e-multi.mjs [siteDir] [shotDir]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), ".."));
const shots = resolve(process.argv[3] || "/workspace/geo-conquest-shots");
mkdirSync(shots, { recursive: true });
const require = createRequire("/workspace/tools/");
const { chromium } = require("playwright-core");
const PORT = 8300 + Math.floor(Math.random() * 500);
const server = spawn("python3", ["-m", "http.server", String(PORT), "-d", site], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("✔ " + name); } else { fail++; console.log("✘ " + name); } };

async function run(vp, tag) {
  const page = await browser.newPage({ viewport: vp });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const wait = (ms = 400) => page.waitForTimeout(ms);
  const shot = (n) => page.screenshot({ path: join(shots, `mp-${tag}-${n}.png`) });
  const vis = (sel) => page.locator(sel).isVisible();
  await page.goto(`http://localhost:${PORT}/`); await wait(1200);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("geoConquestSaveV1", JSON.stringify({ marker: "solo-save" })); });
  await page.reload(); await wait(1200);
  ok(`${tag}: multiplayer card`, await vis("#btn-multi"));
  await shot("01-start");
  await page.click("#btn-multi"); await wait(300);
  await page.click('#mp-count [data-count="4"]'); await wait(200);
  await shot("02-setup");
  ok(`${tag}: 4 player rows`, (await page.locator("#mp-players input").count()) === 4);
  ok(`${tag}: setup has no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click('#mp-count [data-count="2"]'); await wait(200);
  await page.click("#btn-mp-start"); await wait(900);
  for (const iso of ["CAN", "BRA"]) { await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(300); }
  const st = await page.evaluate(() => ({ phase: GeoMulti.state.phase, own: GeoMulti.state.ownership }));
  ok(`${tag}: both homes planted`, st.phase === "turn" && st.own.CAN === 0 && st.own.BRA === 1);
  ok(`${tag}: banner shows player 1`, /Player 1/.test(await page.locator("#mp-banner").textContent()));
  ok(`${tag}: Baron hidden`, !(await vis("#baron-card")));
  await wait(600); await shot("03-homes");
  // ---- M2a: turns and attacks ----
  const ready = async () => { if (await vis("#mp-handoff")) { await page.click("#btn-mp-ready"); await wait(300); } };
  async function answer(correct) {
    const info = await page.evaluate(() => { const c = GeoGame.currentContest; return { type: c.question.type || "text", idx: c.answerIdx, target: c.question.target, n: c.options.length }; });
    if (info.type === "map") {
      await page.click("#q-options button"); await wait(300);
      await page.evaluate(([t, ok]) => GeoGame.onFindTap(ok ? t : (t === "AUS" ? "NZL" : "AUS")), [info.target, correct]); await wait(correct ? 100 : 1600);
    } else {
      await page.locator("#q-options button").nth(correct ? info.idx : (info.idx + 1) % info.n).click();
    }
    await wait(250);
    await page.click("#btn-q-continue"); await wait(500);
  }
  async function attack(iso, tier, correct, subject = "geo") {
    await ready();
    await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(250);
    await page.click(`[data-subject="${subject}"]`);
    await page.click(`.diff-btn[data-tier="${tier}"]`); await wait(450);
    await answer(correct);
  }
  const own = (iso) => page.evaluate((i) => GeoMulti.state.ownership[i], iso);
  const turn = () => page.evaluate(() => GeoMulti.state.turn);
  ok(`${tag}: hand-off shown before first turn`, await vis("#mp-handoff"));
  await shot("04-handoff");
  await attack("USA", "medium", true);
  ok(`${tag}: right answer takes an unclaimed country`, (await own("USA")) === 0);
  ok(`${tag}: turn passes to player 2`, (await turn()) === 1 && await vis("#mp-handoff"));
  await attack("ARG", "medium", false);
  ok(`${tag}: miss on unclaimed changes nothing`, (await own("ARG")) === undefined && (await turn()) === 0);
  await ready();
  await page.evaluate(() => GeoMap.onTerritoryClick("BRA")); await wait(250);
  ok(`${tag}: Easy disabled on an enemy home`, await page.locator('.diff-btn[data-tier="easy"]').isDisabled());
  await shot("05-attack-card");
  await page.click('[data-subject="math"]'); await page.click('.diff-btn[data-tier="hard"]'); await wait(450);
  ok(`${tag}: math attack question`, await page.evaluate(() => GeoGame.currentContest.question.type === "math"));
  await answer(true);
  ok(`${tag}: enemy home captured`, (await own("BRA")) === 0);
  ok(`${tag}: player with no countries is out and skipped`, await page.evaluate(() => !GeoMulti.state.players[1].alive && GeoMulti.state.turn === 0));
  await wait(300); await shot("06-eliminated");
  ok(`${tag}: solo save untouched`, await page.evaluate(() => JSON.parse(localStorage.getItem("geoConquestSaveV1")).marker === "solo-save"));
  ok(`${tag}: no console errors`, errs.length === 0);
  if (errs.length) console.log(errs);
  await page.close();
}
// Strike-backs + reload mid strike-back (2 players, state seeded after homes).
async function runStrike(vp, tag) {
  const page = await browser.newPage({ viewport: vp });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const wait = (ms = 400) => page.waitForTimeout(ms);
  const shot = (n) => page.screenshot({ path: join(shots, `mp-${tag}-${n}.png`) });
  const vis = (sel) => page.locator(sel).isVisible();
  const ready = async () => { if (await vis("#mp-handoff")) { await page.click("#btn-mp-ready"); await wait(300); } };
  async function answer(correct) {
    const info = await page.evaluate(() => { const c = GeoGame.currentContest; return { type: c.question.type || "text", idx: c.answerIdx, target: c.question.target, n: c.options.length }; });
    if (info.type === "map") {
      await page.click("#q-options button"); await wait(300);
      await page.evaluate(([t, ok]) => GeoGame.onFindTap(ok ? t : (t === "AUS" ? "NZL" : "AUS")), [info.target, correct]); await wait(correct ? 100 : 1600);
    } else await page.locator("#q-options button").nth(correct ? info.idx : (info.idx + 1) % info.n).click();
    await wait(250); await page.click("#btn-q-continue"); await wait(500);
  }
  async function attack(iso, tier, correct) {
    await ready();
    await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(250);
    await page.click('[data-subject="geo"]'); await page.click(`.diff-btn[data-tier="${tier}"]`); await wait(450);
    await answer(correct);
  }
  const own = (iso) => page.evaluate((i) => GeoMulti.state.ownership[i], iso);
  await page.goto(`http://localhost:${PORT}/`); await wait(1200);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(1200);
  await page.click("#btn-multi"); await wait(300);
  await page.locator("#mp-players input").nth(0).fill("Mia");
  await page.locator("#mp-players input").nth(1).fill("Leo");
  await page.click("#btn-mp-start"); await wait(800);
  for (const iso of ["CAN", "BRA"]) { await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(300); }
  // Seed: Leo holds Argentina; Mia holds Bolivia (borders Argentina) and Spain (far away).
  await page.evaluate(() => { const o = GeoMulti.state.ownership; o.ARG = 1; o.BOL = 0; o.ESP = 0; GeoMulti.save(); GeoMulti.refresh(); });
  await attack("ARG", "medium", false);
  ok(`${tag}: miss on an enemy country starts a strike-back hand-off`, await vis("#mp-handoff") && /Strike-back/.test(await page.locator("#mp-handoff-text").textContent()));
  await shot("07-strike-handoff");
  await ready();
  ok(`${tag}: defender gets a question`, await vis("#question-modal"));
  await answer(true);
  ok(`${tag}: strike-back takes the attacker's adjacent country`, (await own("BOL")) === 1 && (await own("ESP")) === 0 && (await own("CAN")) === 0);
  ok(`${tag}: turn passes from the attacker to the defender`, await page.evaluate(() => GeoMulti.state.turn === 1));
  // Leo attacks Mia's Spain and misses; reload during the strike-back hand-off.
  await attack("ESP", "medium", false);
  ok(`${tag}: strike-back pending is saved`, await page.evaluate(() => JSON.parse(localStorage.getItem("geoConquestMultiV1")).pending.kind === "strike"));
  await page.reload(); await wait(1200);
  await page.click("#btn-mp-continue"); await wait(900);
  ok(`${tag}: reload resumes the strike-back hand-off`, await vis("#mp-handoff") && /Mia/.test(await page.locator("#btn-mp-ready").textContent()));
  await ready(); await answer(false);
  ok(`${tag}: failed strike-back changes nothing`, (await own("ESP")) === 0 && (await own("ARG")) === 1 && await page.evaluate(() => GeoMulti.state.turn === 0 && !GeoMulti.state.pending));
  ok(`${tag}: no page errors (strike-back run)`, errs.length === 0);
  if (errs.length) console.log(errs);
  await page.close();
}
// M3: timer end (2 players), one-continent 4-player domination with eliminations, standings.
async function runWin(vp, tag) {
  const page = await browser.newPage({ viewport: vp });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const wait = (ms = 400) => page.waitForTimeout(ms);
  const shot = (n) => page.screenshot({ path: join(shots, `mp-${tag}-${n}.png`) });
  const vis = (sel) => page.locator(sel).isVisible();
  const ready = async () => { if (await vis("#mp-handoff")) { await page.click("#btn-mp-ready"); await wait(300); } };
  async function answer(correct) {
    const info = await page.evaluate(() => { const c = GeoGame.currentContest; return { type: c.question.type || "text", idx: c.answerIdx, target: c.question.target, n: c.options.length }; });
    if (info.type === "map") {
      await page.click("#q-options button"); await wait(300);
      await page.evaluate(([t, ok]) => GeoGame.onFindTap(ok ? t : (t === "AUS" ? "NZL" : "AUS")), [info.target, correct]); await wait(correct ? 100 : 1600);
    } else await page.locator("#q-options button").nth(correct ? info.idx : (info.idx + 1) % info.n).click();
    await wait(250); await page.click("#btn-q-continue"); await wait(500);
  }
  async function attack(iso, tier, correct) {
    await ready();
    await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(250);
    await page.click('[data-subject="geo"]'); await page.click(`.diff-btn[data-tier="${tier}"]`); await wait(450);
    await answer(correct);
  }
  await page.goto(`http://localhost:${PORT}/`); await wait(1200);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("geoConquestSaveV1", JSON.stringify({ marker: "solo-save" })); });
  await page.reload(); await wait(1200);
  // --- timed 2-player game ends when the clock runs out ---
  await page.click("#btn-multi"); await wait(300);
  await page.click('#mp-win [data-mode="timed"]'); await page.click('#mp-minutes [data-min="10"]');
  await page.click("#btn-mp-start"); await wait(800);
  for (const iso of ["CAN", "BRA"]) { await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(300); }
  await ready();
  await page.waitForTimeout(1300);
  ok(`${tag}: timer shows in the banner`, /⏱ \d+:\d\d/.test(await page.locator("#mp-timer").textContent()));
  await page.evaluate(() => { GeoMulti.state.ownership.USA = 0; GeoMulti.state.timeLeftMs = 2000; GeoMulti.refresh(); });
  await page.waitForTimeout(3200);
  ok(`${tag}: timer end shows final standings`, await vis("#mp-standings"));
  ok(`${tag}: most countries wins`, /Player 1 wins/.test(await page.locator("#mp-standings-title").textContent()));
  await wait(800); await shot("08-standings-timed");
  await page.click("#btn-mp-home"); await wait(500);
  ok(`${tag}: back to start clears the multiplayer save`, await page.evaluate(() => !localStorage.getItem("geoConquestMultiV1")));
  // --- 4-player one-continent domination (Oceania) ---
  await page.click("#btn-multi"); await wait(300);
  await page.click('#mp-count [data-count="4"]'); await page.click('#mp-win [data-mode="domination"]');
  await page.click('#mp-map [data-scope="oceania"]'); await wait(200);
  await shot("09-setup-continent");
  await page.click("#btn-mp-start"); await wait(1000);
  await page.evaluate(() => GeoMap.onTerritoryClick("CAN")); await wait(200);
  ok(`${tag}: countries outside the chosen continent are not playable`, await page.evaluate(() => GeoMulti.state.ownership.CAN === undefined && !GeoMulti.inScope("CAN")));
  for (const iso of ["AUS", "NZL", "FJI", "PNG"]) { await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(250); }
  await ready(); await wait(300); await shot("10-continent-map");
  // P1 takes NZL (P2's home, P2's only country) -> P2 eliminated, next turn skips to P3.
  await attack("NZL", "hard", true);
  ok(`${tag}: eliminated player is out`, await page.evaluate(() => !GeoMulti.state.players[1].alive));
  ok(`${tag}: turn order skips the eliminated player`, await page.evaluate(() => GeoMulti.state.turn === 2));
  // Seed: P4 out, P1 holds everything except FJI (P3); P1's turn.
  await page.evaluate(() => { const s = GeoMulti.state; for (const t of GeoMulti.scopeIsos()) s.ownership[t] = 0; s.ownership.FJI = 2; s.players[3].alive = false; s.turn = 0; GeoMulti.save(); GeoMulti.refresh(); });
  await page.click("#btn-mp-ready").catch(() => {}); await wait(300);
  await attack("FJI", "hard", true);
  ok(`${tag}: holding the whole continent wins domination`, await vis("#mp-standings") && /Player 1 wins/.test(await page.locator("#mp-standings-title").textContent()));
  await wait(800); await shot("11-standings-domination");
  ok(`${tag}: solo save survives multiplayer games`, await page.evaluate(() => JSON.parse(localStorage.getItem("geoConquestSaveV1")).marker === "solo-save"));
  ok(`${tag}: no page errors (win run)`, errs.length === 0);
  if (errs.length) console.log(errs);
  await page.close();
}
await run({ width: 1280, height: 800 }, "desktop");
await runWin({ width: 1280, height: 800 }, "desktop");
await runWin({ width: 390, height: 844 }, "phone");
await runStrike({ width: 1280, height: 800 }, "desktop");
await runStrike({ width: 390, height: 844 }, "phone");
await run({ width: 390, height: 844 }, "phone");
await browser.close(); server.kill();
console.log(`\n${pass}/${pass + fail} multiplayer e2e checks passed`);
process.exit(fail ? 1 : 0);
