// tests/e2e.mjs — headless playthrough + screenshots (dev only).
// Usage: node tests/e2e.mjs [siteDir] [shotDir]
// Needs playwright-core in /workspace/tools (npm i playwright-core) and /usr/bin/google-chrome.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire("/workspace/tools/package.json");
const { chromium } = require("playwright-core");
const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), ".."));
const shots = resolve(process.argv[3] || "/workspace/geo-conquest-shots");
mkdirSync(shots, { recursive: true });
const PORT = 8300 + Math.floor(Math.random() * 500);
const server = spawn("python3", ["-m", "http.server", String(PORT), "-d", site], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL = `http://localhost:${PORT}/`;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name} ${extra}`); };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function run(vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: tag === "phone", isMobile: tag === "phone" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (n) => page.screenshot({ path: join(shots, `${tag}-${n}.png`) });
  const wait = (ms = 450) => page.waitForTimeout(ms);
  const vis = (sel) => page.locator(sel).isVisible();
  // Answer the open contest. correct=true/false. Handles text/flag/flag-pick/map/math.
  async function answer(correct) {
    const info = await page.evaluate(() => { const c = GeoGame.currentContest; return { type: c.question.type || "text", idx: c.answerIdx, target: c.question.target, n: c.options.length }; });
    if (info.type === "map") {
      await page.click("#q-options button");
      await wait(300);
      await page.evaluate(([t, ok]) => GeoGame.onFindTap(ok ? t : (t === "AUS" ? "NZL" : "AUS")), [info.target, correct]); await wait(correct ? 100 : 1600);
    } else {
      const i = correct ? info.idx : (info.idx + 1) % info.n;
      await page.locator("#q-options button").nth(i).click();
    }
    await wait(250);
  }
  async function cont() { await page.click("#btn-q-continue"); await wait(500); }
  async function closeOverlays() {
    for (const id of ["#victory-modal", "#unlock-modal"]) if (await vis(id)) return true;
    return false;
  }
  async function attack(iso, tier, subject) {
    await page.evaluate((iso) => GeoGame.onTerritoryClick(iso), iso);
    await wait(200);
    if (subject) {
      const s = page.locator(`[data-subject="${subject}"]`);
      if (await s.count()) await s.first().click();
    }
    await page.click(`.diff-btn[data-tier="${tier}"]`);
    await wait(450);
  }
  const force = (q) => page.evaluate((id) => { const orig = GeoGame.pickQuestion.bind(GeoGame); GeoGame.pickQuestion = function (...a) { GeoGame.pickQuestion = orig; return GeoGame.questions.find((x) => x.id === id) || orig(...a); }; }, q);

  await page.goto(URL); await wait(1200);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(1200);
  await shot("01-start");
  ok(`${tag}: no horizontal scroll on start`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.click("#btn-quest"); await wait(300);
  await page.locator("#continent-cards button", { hasText: "Oceania" }).click(); await wait(900);
  await page.evaluate(() => GeoGame.onTerritoryClick("AUS")); await wait(900);
  await shot("02-map");
  ok(`${tag}: home base planted`, await page.evaluate(() => GeoGame.state.ownership.AUS === "player"));

  // geography question
  await force("OC-E-005" ); // may not exist -> falls back
  await attack("NZL", "medium", "geo");
  await shot("03-geo-question");
  await answer(true); await shot("04-geo-answered"); await cont();
  ok(`${tag}: NZ conquered`, await page.evaluate(() => GeoGame.state.ownership.NZL === "player"));

  // flag question
  const hasFlags = await page.evaluate(() => GeoGame.questions.some((q) => q.type === "flag"));
  if (hasFlags) {
    await force("FLAG-N-PNG"); await attack("FJI", "medium", "geo");
    await wait(600); await shot("05-flag-question");
    ok(`${tag}: flag image shown`, await page.evaluate(() => { const i = document.getElementById("q-flag-img"); return i && !i.classList.contains("hidden") && i.complete && i.naturalWidth > 0; }));
    await answer(true); await cont();
    await force("FLAG-P-FJI"); await attack("VUT", "easy", "geo"); await wait(600); await shot("06-flag-pick");
    await answer(true); await cont();
  }
  // map-tap question
  const hasMap = await page.evaluate(() => GeoGame.questions.some((q) => q.type === "map"));
  if (hasMap) {
    await force("MAP-FJI"); await attack("SLB", "medium", "geo");
    await page.click("#q-options button"); await wait(700);
    await shot("07-map-find-mode");
    ok(`${tag}: find mode banner`, await vis("#find-banner"));
    ok(`${tag}: no tooltips in find mode`, await page.evaluate(() => [...document.querySelectorAll("#map-svg title")].every((t) => !t.textContent)));
    await page.evaluate(() => GeoGame.onFindTap("FJI")); await wait(1600);
    await shot("08-map-find-result"); await cont();
  }
  // Baron steal on a wrong Medium answer
  const target = await page.evaluate(() => ["PNG", "FJI", "VUT", "SLB"].find((i) => GeoGame.state.ownership[i] !== "player"));
  if (target) {
    await attack(target, "medium", "geo"); await answer(false); await cont();
    ok(`${tag}: Baron stole ${target}`, await page.evaluate((t) => GeoGame.state.ownership[t] === "rival", target));
    await page.evaluate((t) => GeoGame.onTerritoryClick(t), target); await wait(200);
    ok(`${tag}: Easy disabled on Baron country`, await page.locator('.diff-btn[data-tier="easy"]').isDisabled());
    await shot("09-baron");
  }
  // math with hints
  const hasMath = await page.evaluate(() => !!window.GeoMath);
  if (hasMath) {
    const t2 = await page.evaluate(() => ["PNG", "FJI", "VUT", "SLB"].find((i) => GeoGame.state.ownership[i] !== "player"));
    if (t2) {
      await page.evaluate((t) => GeoGame.onTerritoryClick(t), t2); await wait(200);
      const subj = page.locator('[data-subject="math"]');
      ok(`${tag}: math subject button`, await subj.count());
      if (await subj.count()) await subj.first().click();
      await page.evaluate(() => { const o = GeoMath.generate.bind(GeoMath); GeoMath.generate = (tier, opts = {}) => { GeoMath.generate = o; return o(tier, { ...opts, skill: "fracdiff" }); }; });
      await page.click('.diff-btn[data-tier="hard"]'); await wait(450);
      const hint = page.locator("#btn-hint");
      ok(`${tag}: hint button`, await hint.count());
      for (let i = 0; i < 3 && (await hint.count()) && (await hint.isEnabled()); i++) { await hint.click(); await wait(300); }
      await shot("10-math-hints");
      ok(`${tag}: fraction bars drawn`, await page.locator("#q-hints svg, #q-hints canvas, #q-hints .frac-bar").count());
      await answer(false); await wait(300); await shot("11-math-wrong-solution");
      const sim = page.locator("#btn-similar");
      ok(`${tag}: try-a-similar-one button`, await sim.count() && await sim.isVisible());
      await cont();
    }
  }
  // reload mid-game
  await page.reload(); await wait(1200);
  ok(`${tag}: continue button after reload`, await vis("#btn-continue"));
  await page.click("#btn-continue"); await wait(900);
  ok(`${tag}: back in game after reload`, await vis("#screen-game"));
  // conquer the rest of Oceania
  for (let guard = 0; guard < 30; guard++) {
    if (await closeOverlays()) break;
    const left = await page.evaluate(() => GeoGame.continents.find((c) => c.id === GeoGame.state.activeContinent).territories.map((t) => t.iso3).find((i) => GeoGame.state.ownership[i] !== "player"));
    if (!left) break;
    const owner = await page.evaluate((i) => GeoGame.state.ownership[i], left);
    await attack(left, owner === "rival" ? "hard" : "medium", "geo"); await answer(true); await cont();
    await wait(400);
  }
  await wait(1200);
  await shot("12-victory");
  ok(`${tag}: victory modal`, await vis("#victory-modal"));
  await page.reload(); await wait(1200); await page.click("#btn-continue"); await wait(1200);
  ok(`${tag}: victory/next-choice re-shown after reload`, (await vis("#victory-modal")) || (await vis("#unlock-modal")));
  await shot("13-after-reload-victory");
  ok(`${tag}: no horizontal scroll in game`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
}
try {
  await run({ width: 1280, height: 800 }, "desktop");
  await run({ width: 390, height: 844 }, "phone");
} finally { await browser.close(); server.kill(); }
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
process.exit(failed.length ? 1 : 0);
