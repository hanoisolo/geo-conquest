// tests/e2e-ws.mjs — "My worksheets" headless run with a mocked Mistral provider (dev only).
// Usage: node tests/e2e-ws.mjs [siteDir] [shotDir]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire("/workspace/tools/package.json");
const { chromium } = require("playwright-core");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), ".."));
const shots = resolve(process.argv[3] || "/workspace/geo-ws-w5");
mkdirSync(shots, { recursive: true });
const PORT = 8300 + Math.floor(Math.random() * 500);
const server = spawn("python3", ["-m", "http.server", String(PORT), "-d", site], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL = `http://localhost:${PORT}/`;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name} ${extra}`); };
const KEY = "sk-test-KEY-123456";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

// Mocked Mistral: OCR echoes a sheet marker; chat returns 12 questions per sheet as reasoning chunks.
function mockMistral(page, state) {
  return page.route("https://api.mistral.ai/**", async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || "{}");
    state.auth.add(req.headers()["authorization"] || "");
    if (req.url().endsWith("/v1/ocr")) {
      const data = (body.document && (body.document.image_url || body.document.document_url)) || "";
      const b64 = data.split(",")[1] || "";
      const text = Buffer.from(b64, "base64").toString("utf8");
      if (text.includes("FAILSHEET") && state.failOnce) { state.failOnce = false; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "upstream" } }) }); }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pages: [{ markdown: "MARK:" + text }] }) });
    }
    const user = (body.messages || []).find((m) => m.role === "user");
    const mark = /MARK:(\S+)/.exec(user ? user.content : "");
    const s = mark ? mark[1] : "X";
    const questions = [];
    for (let i = 1; i <= 12; i++) questions.push({ q: `${s} question ${i}: what is ${i} plus ${s.length}?`, options: [String(i + s.length), String(i + 100), String(i + 200), String(i + 300)], correctAnswer: String(i + s.length), tier: ["easy", "medium", "hard"][i % 3], explain: "Add them.", hints: ["Count up."], category: "adding " + (i % 3) });
    questions.push({ q: "What colour is the sky on a clear day?", options: ["Blue", "Green", "Red", "Purple"], correctAnswer: "Blue", tier: "easy", explain: "Sunlight scatters.", hints: [], category: "science" });
    const content = [{ type: "thinking", thinking: [{ type: "text", text: "planning" }] }, { type: "text", text: JSON.stringify({ meta: { title: "Adding practice", subject: "Math", grade: "Grade 3" }, questions }) }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }) });
  });
}

async function run(vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: tag === "phone", isMobile: tag === "phone", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const cspHits = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 500")) errors.push(m.text()); if (m.text().includes("Content Security Policy")) cspHits.push(m.text()); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
  const state = { failOnce: true, auth: new Set() };
  await mockMistral(page, state);
  const shot = (n) => page.screenshot({ path: join(shots, `${tag}-${n}.png`), fullPage: n !== "contest" });
  const wait = (ms = 400) => page.waitForTimeout(ms);
  const vis = (sel) => page.locator(sel).first().isVisible();
  page.on("dialog", (d) => d.accept(state.nextPrompt || undefined));

  await page.goto(URL);
  await wait(1200);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await wait(1200);

  ok(`${tag}: start shows the My worksheets card`, await vis("#btn-worksheets"));
  ok(`${tag}: the 3 default cards still visible`, (await vis("#btn-quest")) && (await vis("#btn-world")) && (await vis("#btn-multi")));
  await shot("ws-01-start");

  await page.click("#btn-worksheets");
  await wait();
  ok(`${tag}: worksheets screen visible`, await vis("#screen-worksheets"));
  ok(`${tag}: #ws-make disabled with no files`, await page.isDisabled("#ws-make"));

  await page.setInputFiles("#ws-file-input", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") }]);
  ok(`${tag}: file msg mentions notes.txt`, (await vis("#ws-file-msg")) && (((await page.textContent("#ws-file-msg")) || "").includes("notes.txt")));
  ok(`${tag}: rejected file not listed`, (await page.locator("#ws-file-list li").count()) === 0);

  const sheetTwo = { name: "sheet-two.pdf", mimeType: "application/pdf", buffer: Buffer.from("SHEETTWO") };
  await page.setInputFiles("#ws-file-input", [
    { name: "sheet-one.png", mimeType: "image/png", buffer: Buffer.from("SHEETONE") },
    sheetTwo,
    { name: "sheet-three.png", mimeType: "image/png", buffer: Buffer.from("FAILSHEET") },
  ]);
  ok(`${tag}: 3 sheets listed`, (await page.locator("#ws-file-list li").count()) === 3);
  await page.click("#ws-file-list li:nth-child(2) button");
  ok(`${tag}: 2 sheets after remove`, (await page.locator("#ws-file-list li").count()) === 2);
  await page.setInputFiles("#ws-file-input", [sheetTwo]);
  ok(`${tag}: 3 sheets after re-add`, (await page.locator("#ws-file-list li").count()) === 3);

  await page.fill("#ws-key", KEY);
  ok(`${tag}: make enabled with sheets and key`, await page.isEnabled("#ws-make"));
  await page.click("#ws-make");
  await page.waitForSelector("#ws-failed:not(.hidden)", { timeout: 15000 });
  const failedCount = await page.locator("#ws-failed li").count();
  ok(`${tag}: failed list has sheet-three`, failedCount === 1 && (((await page.textContent("#ws-failed")) || "").includes("sheet-three")));
  ok(`${tag}: skip visible`, await vis("#ws-skip"));
  await shot("ws-02-failed");

  await page.click("#ws-retry");
  await page.waitForSelector("#ws-result:not(.hidden)", { timeout: 15000 });
  const text = (await page.textContent("#ws-result-text")) || "";
  ok(`${tag}: 37 questions from 3 sheets, 2 repeats removed`, text.includes("37 questions from 3 sheets") && text.includes("2 repeats removed"));
  ok(`${tag}: title prefilled Adding practice`, (await page.inputValue("#ws-title")) === "Adding practice");
  await shot("ws-03-result");

  const keyStores = await page.evaluate(() => ({ s: sessionStorage.getItem("geoConquestWsKey.mistral"), l: localStorage.getItem("geoConquestWsKey.mistral") }));
  ok(`${tag}: key stored session-only`, keyStores.s === KEY && keyStores.l === null);
  ok(`${tag}: every mocked request used Bearer key`, [...state.auth].every((a) => a === "Bearer " + KEY));

  await page.fill("#ws-title", "My adding deck");
  await page.click("#ws-save");
  await wait();
  const deckCount = await page.locator("#ws-deck-list li").count();
  const deckTitle = deckCount === 1 ? ((await page.locator("#ws-deck-list li .ws-deck-title").first().textContent()) || "").trim() : "";
  ok(`${tag}: deck list has 1 deck titled My adding deck`, deckCount === 1 && deckTitle === "My adding deck");
  ok(`${tag}: play visible`, await vis("#ws-play"));
  ok(`${tag}: topup and math unchecked`, !(await page.isChecked("#ws-topup")) && !(await page.isChecked("#ws-math")));
  ok(`${tag}: deck storage has no key`, !String(await page.evaluate(() => localStorage.getItem("geoConquestDecksV1"))).includes(KEY));

  await page.check("#ws-remember");
  await wait();
  ok(`${tag}: remember warns and stores key`, (await vis("#ws-remember-warn")) && (await page.evaluate(() => localStorage.getItem("geoConquestWsKey.mistral"))) === KEY);
  await page.click("#ws-forget");
  await wait();
  const cleared = await page.evaluate(() => ({ s: sessionStorage.getItem("geoConquestWsKey.mistral"), l: localStorage.getItem("geoConquestWsKey.mistral") }));
  ok(`${tag}: forget clears both stores and input`, cleared.s === null && cleared.l === null && (await page.inputValue("#ws-key")) === "");

  await page.evaluate(AXE);
  const v = await page.evaluate(async () => (await axe.run(document.getElementById("screen-worksheets"), { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => x.id));
  ok(`${tag}: axe: no serious violations`, v.length === 0, v.join(","));

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ws-deck-list li:first-child button:nth-child(3)")]);
  const json = readFileSync(await dl.path(), "utf8");
  ok(`${tag}: export is a deck file without key`, JSON.parse(json).format === "geo-conquest-deck" && !json.includes(KEY) && dl.suggestedFilename().endsWith(".geodeck.json"));

  const evil = JSON.stringify({ format: "geo-conquest-deck", version: 1, deck: { title: "<img src=x onerror=window.__xss=1>", subject: "Math", questions: [ { q: "<b>2+2</b>?", options: ["4","5","6","7"], answer: 0, tier: "easy" } ] } });
  await page.setInputFiles("#ws-import-input", [{ name: "evil.json", mimeType: "application/json", buffer: Buffer.from(evil) }]);
  await wait(600);
  ok(`${tag}: imported deck listed`, (await page.locator("#ws-deck-list li").count()) === 2);
  ok(`${tag}: import title not executed as HTML`, await page.evaluate(() => window.__xss === undefined && !document.querySelector("#ws-deck-list img")));
  ok(`${tag}: import title shown as text`, await page.locator(".ws-deck-title").evaluateAll((els) => els.some((el) => (el.textContent || "").trim() === "<img src=x onerror=window.__xss=1>")));

  state.nextPrompt = "Renamed deck";
  await page.locator("#ws-deck-list li", { hasText: "My adding deck" }).locator("button").nth(1).click();
  await wait(600);
  ok(`${tag}: renamed deck exists`, await page.locator(".ws-deck-title").evaluateAll((els) => els.some((el) => (el.textContent || "").trim() === "Renamed deck")));
  state.nextPrompt = null;

  await page.locator("#ws-deck-list li", { hasText: "<img" }).locator("button").nth(3).click();
  await wait(600);
  ok(`${tag}: evil deck deleted`, (await page.locator("#ws-deck-list li").count()) === 1);

  // solo + multiplayer on the worksheet deck
  await page.locator("#ws-deck-list li", { hasText: "Renamed deck" }).locator("button").nth(0).click();
  ok(`${tag}: #ws-play visible and #ws-play-title text "Renamed deck"`, (await vis("#ws-play")) && (((await page.textContent("#ws-play-title")) || "").trim() === "Renamed deck"));
  await shot("ws-04-play");
  await page.click("#ws-play-quest");
  await wait(400);
  await page.locator("#continent-cards button", { hasText: "Oceania" }).click();
  await wait(900);
  await page.evaluate(() => GeoGame.onTerritoryClick("AUS"));
  await wait(900);
  ok(`${tag}: home planted`, await page.evaluate(() => GeoGame.state.ownership.AUS === "player"));
  ok(`${tag}: save records the deck`, await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("geoConquestSaveV1")); return !!s.ws && s.ws.deckId === GeoWSUI.selected && s.ws.topUp === false && s.ws.includeMath === false; }));

  async function wsContest(iso) {
    await page.evaluate((i) => GeoGame.onTerritoryClick(i), iso);
    await wait(250);
    const mathHidden = await page.evaluate(() => { const b = document.querySelector('.subject-btn[data-subject="math"]'); return !b || b.classList.contains("hidden"); });
    await page.click('.diff-btn[data-tier="medium"]');
    await wait(450);
    const info = await page.evaluate(() => { const c = GeoGame.currentContest; return { id: c.question.id, q: c.question.q, idx: c.answerIdx, shown: document.getElementById("q-text").textContent }; });
    return { mathHidden, info };
  }

  for (const iso of ["NZL", "PNG", "FJI"]) {
    if (!(await page.evaluate((i) => GeoGame.playableIsos.has(i), iso))) continue;
    const r = await wsContest(iso);
    ok(`${tag}: worksheet question on ${iso}`, r.info.id.startsWith("WS-") && r.info.shown === r.info.q);
    ok(`${tag}: math button hidden`, r.mathHidden);
    if (iso === "NZL") await shot("contest");
    await page.locator("#q-options button").nth(r.info.idx).click();
    await wait(300);
    await page.click("#btn-q-continue");
    await wait(600);
  }

  await page.reload();
  await wait(1200);
  ok(`${tag}: #btn-continue visible`, await vis("#btn-continue"));
  await page.click("#btn-continue");
  await wait(900);
  ok(`${tag}: reload restores the worksheet deck`, await page.evaluate(() => !!GeoGame.wsDeck && GeoGame.wsDeck.length > 0 && GeoGame.wsSettings.deckId === JSON.parse(localStorage.getItem("geoConquestSaveV1")).ws.deckId));

  await page.goto(URL);
  await wait(1200);
  await page.click("#btn-worksheets");
  await page.locator("#ws-deck-list li", { hasText: "Renamed deck" }).locator("button").nth(0).click();
  await page.check("#ws-topup");
  await page.click("#ws-play-multi");
  await wait(400);
  ok(`${tag}: #screen-mp-setup visible`, await vis("#screen-mp-setup"));
  await page.click('#mp-count [data-count="2"]');
  await page.click("#btn-mp-start");
  await wait(900);
  for (const iso of ["CAN", "BRA"]) { await page.evaluate((i) => GeoMap.onTerritoryClick(i), iso); await wait(300); }
  ok(`${tag}: mp state records the deck`, await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("geoConquestMultiV1")); return !!s.ws && s.ws.topUp === true && GeoGame.wsDeck && GeoGame.wsDeck.length > 0; }));
  if (await vis("#mp-handoff")) { await page.click("#btn-mp-ready"); await wait(300); }
  await page.evaluate(() => GeoMap.onTerritoryClick("USA"));
  await wait(250);
  await page.click('.diff-btn[data-tier="medium"]');
  await wait(450);
  ok(`${tag}: multiplayer asks a worksheet question`, await page.evaluate(() => GeoGame.currentContest.question.id.startsWith("WS-")));
  await shot("ws-05-multi");
  const idx = await page.evaluate(() => GeoGame.currentContest.answerIdx);
  await page.locator("#q-options button").nth(idx).click();
  await wait(300);
  await page.click("#btn-q-continue");
  await wait(500);

  await page.goto(URL);
  await wait(1200);
  await page.click("#btn-multi");
  await wait(300);
  await page.click('#mp-count [data-count="2"]');
  await page.click("#btn-mp-start");
  await wait(900);
  ok(`${tag}: default multiplayer stays default`, await page.evaluate(() => !("ws" in GeoMulti.state) && GeoGame.wsDeck === null));

  await page.goto(URL);
  await wait(1200);
  await page.click("#btn-quest");
  await wait(300);
  ok(`${tag}: default solo stays default`, await page.evaluate(() => !("ws" in GeoGame.state) && GeoGame.wsDeck === null && !document.querySelector('.subject-btn[data-subject="math"]').classList.contains("hidden")));

  await page.goto(URL);
  await wait(1200);
  await page.click("#btn-worksheets");
  ok(`${tag}: no horizontal scroll on the worksheets screen`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  const csp = await page.evaluate(() => window.__csp);
  ok(`${tag}: no CSP violations`, csp.length === 0 && cspHits.length === 0, [...csp, ...cspHits].join(" | "));
  ok(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
}

try { await run({ width: 1280, height: 800 }, "desktop"); await run({ width: 390, height: 844 }, "phone"); } finally { await browser.close(); server.kill(); }
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} worksheet e2e checks passed`);
process.exit(failed.length ? 1 : 0);
