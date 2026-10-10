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
await run({ width: 1280, height: 800 }, "desktop");
await run({ width: 390, height: 844 }, "phone");
await browser.close(); server.kill();
console.log(`\n${pass}/${pass + fail} multiplayer e2e checks passed`);
process.exit(fail ? 1 : 0);
