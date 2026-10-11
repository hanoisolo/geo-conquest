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
  ok(`${tag}: explorer picker shows 10 characters`, (await page.locator("#solo-avatars .av-pick").count()) === 10);
  await page.locator('#solo-avatars .av-pick[aria-label="Robot"]').click(); await wait(150);
  ok(`${tag}: picked character is selected`, (await page.locator('#solo-avatars .av-pick.selected').getAttribute("aria-label")) === "Robot");
  await page.click("#btn-quest"); await wait(300);
  ok(`${tag}: new campaign saves the picked character`, await page.evaluate(() => GeoGame.state.avatar === "robot" && JSON.parse(localStorage.getItem("geoConquestSaveV1")).avatar === "robot"));
  await page.locator("#continent-cards button", { hasText: "Oceania" }).click(); await wait(900);
  await page.evaluate(() => GeoGame.onTerritoryClick("AUS")); await wait(900);
  await shot("02-map");
  ok(`${tag}: home base planted`, await page.evaluate(() => GeoGame.state.ownership.AUS === "player"));

  // geography question
  await force("OC-E-005" ); // may not exist -> falls back
  await page.evaluate(() => { const h = GeoMap.hop.bind(GeoMap); window.__hops = []; GeoMap.hop = (f, t, a, c, cb) => { window.__hops.push([f, t, a]); return h(f, t, a, c, cb); }; });
  await attack("NZL", "medium", "geo");
  await shot("03-geo-question");
  await answer(true); await shot("04-geo-answered");
  ok(`${tag}: right answer shows the explorer's happy face`, await page.evaluate(() => { const i = document.querySelector("#q-feedback .q-avatar"); return !!i && i.dataset.expr === "happy" && i.src === new URL(GeoAvatars.artUrl("robot", "happy"), location.href).href && i.complete && i.naturalWidth > 0; }));
  await cont();
  ok(`${tag}: NZ conquered`, await page.evaluate(() => GeoGame.state.ownership.NZL === "player"));
  ok(`${tag}: conquest hops the token from home (AUS) to NZ`, await page.evaluate(() => JSON.stringify(window.__hops[0]) === JSON.stringify(["AUS", "NZL", "robot"])));
  {
    const mid = await page.evaluate(async () => { GeoMap.hop("AUS", "NZL", "robot", "#2563eb"); await new Promise((r) => setTimeout(r, 250)); return { hop: !!document.querySelector("#map-svg .av-hop"), hidden: !document.querySelector('#map-svg .badges image.av-badge[data-iso="NZL"]') }; });
    ok(`${tag}: token in flight, target badge waits`, mid.hop && mid.hidden);
    await page.evaluate(() => GeoGame.refreshAll()); // a redraw mid-flight must not kill the hop
    await wait(250);
    ok(`${tag}: redraw keeps the flying token`, await page.evaluate(() => !!document.querySelector("#map-svg .av-hop")));
    await wait(500);
    ok(`${tag}: lands: flag planted, badge back`, await page.evaluate(() => !document.querySelector("#map-svg .av-hop") && !!document.querySelector("#map-svg .av-flag") && !!document.querySelector('#map-svg .badges image.av-badge[data-iso="NZL"]')));
    await page.emulateMedia({ reducedMotion: "reduce" });
    ok(`${tag}: reduced motion skips the hop`, await page.evaluate(() => { let landed = false; GeoMap.hop("AUS", "NZL", "robot", "#2563eb", () => { landed = true; }); return landed && !document.querySelector("#map-svg .av-hop"); }));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await wait(1500);
  }
  // Passport: home + NZ stamped, pages show flag/capital/continent/fact, fresh stamp animates once.
  ok(`${tag}: passport stamps home and conquest`, await page.evaluate(() => !!GeoGame.state.passport.AUS && !!GeoGame.state.passport.NZL && JSON.parse(localStorage.getItem("geoConquestSaveV1")).passport.NZL));
  ok(`${tag}: passport button counts stamps`, /^2\/68$/.test(await page.locator("#passport-count").textContent()));
  await page.locator("#btn-passport").scrollIntoViewIfNeeded(); await page.click("#btn-passport"); await wait(700);
  ok(`${tag}: passport opens with collected vs total`, await vis("#passport-modal") && /2 \/ 68 stamps/.test(await page.locator("#passport-body .pp-sub").textContent()));
  ok(`${tag}: passport grouped by continent`, (await page.locator("#passport-body .pp-section").count()) === 6);
  ok(`${tag}: NZ page has flag, capital, continent and fact`, await page.evaluate(() => { const pg = [...document.querySelectorAll(".pp-page.pp-got")].find((x) => /New Zealand/.test(x.textContent)); const f = pg && pg.querySelector(".pp-flag"); return !!pg && f.complete && f.naturalWidth > 0 && /Wellington/.test(pg.textContent) && /Oceania/.test(pg.textContent) && pg.textContent.includes(GeoPassport.facts.NZL); }));
  ok(`${tag}: new stamps animate`, (await page.locator(".pp-page.pp-new").count()) >= 1);
  ok(`${tag}: no horizontal scroll with passport open`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".passport-modal").scrollWidth <= document.querySelector(".passport-modal").clientWidth + 1));
  await page.screenshot({ path: `/workspace/geo-conquest-shots/pp-${tag}-01-passport.png` });
  await page.keyboard.press("Escape"); await wait(300);
  ok(`${tag}: Escape closes the passport`, !(await vis("#passport-modal")));
  await page.click("#btn-passport"); await wait(400);
  ok(`${tag}: stamp animation plays only once`, (await page.locator(".pp-page.pp-new").count()) === 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  ok(`${tag}: reduced motion: no stamp animation`, await page.evaluate(() => { const el = document.createElement("div"); el.className = "pp-page pp-new"; el.innerHTML = '<div class="pp-stamp">x</div>'; document.getElementById("passport-body").appendChild(el); const a = getComputedStyle(el.firstChild).animationName; el.remove(); return a === "none"; }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.click("#btn-passport-close"); await wait(300);
  ok(`${tag}: start country shows the full token`, await page.evaluate(() => !!document.querySelector('#map-svg .badges image.av-token[data-iso="AUS"]')));
  ok(`${tag}: conquered country gets a face badge`, await page.evaluate(() => !!document.querySelector('#map-svg .badges image.av-badge[data-iso="NZL"]')));
  ok(`${tag}: badges never block clicks`, await page.evaluate(() => { document.getElementById("map-svg").scrollIntoView({ block: "center" }); const b = document.querySelector('#map-svg .badges image[data-iso="AUS"]').getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return getComputedStyle(document.querySelector("#map-svg .badges")).pointerEvents === "none" && el && el.tagName !== "image"; }));
  ok(`${tag}: badges grow when zoomed in`, await page.evaluate(async () => { const el = document.querySelector('#map-svg .badges image[data-iso="NZL"]'); const w0 = el.getBoundingClientRect().width; GeoMap.zoom(0.4); await new Promise((r) => setTimeout(r, 600)); const w1 = el.getBoundingClientRect().width; GeoMap.zoom(2.5); await new Promise((r) => setTimeout(r, 600)); window.__bw = [w0, w1, GeoMap.view.w]; return w1 > w0 * 1.15; }), await page.evaluate(() => JSON.stringify(window.__bw)));

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
    await attack(target, "medium", "geo"); await answer(false);
    await shot("art-oops");
    ok(`${tag}: wrong answer shows the oops face`, await page.evaluate(() => { const i = document.querySelector("#q-feedback .q-avatar"); return !!i && i.dataset.expr === "oops"; }));
    await cont();
    ok(`${tag}: Baron looks smug after stealing`, await page.evaluate(() => [...document.querySelectorAll(".baron-portrait")].every((i) => i.src === new URL(GeoAvatars.baronUrl("smug"), location.href).href)));
    await shot("art-baron-smug");
    ok(`${tag}: Baron stole ${target}`, await page.evaluate((t) => GeoGame.state.ownership[t] === "rival", target));
    await page.evaluate((t) => GeoGame.onTerritoryClick(t), target); await wait(200);
    ok(`${tag}: Easy disabled on Baron country`, await page.locator('.diff-btn[data-tier="easy"]').isDisabled());
    await shot("09-baron");
  }
  // math: subject choice (6a), hints (6b), worked solution + similar (6c). MATH_STAGE=a|b|c (default c)
  const stage = process.env.MATH_STAGE || "c";
  const hasMath = await page.evaluate(() => !!window.GeoMath);
  if (hasMath) {
    const t2 = await page.evaluate(() => ["PNG", "FJI", "VUT", "SLB"].find((i) => GeoGame.state.ownership[i] !== "player"));
    if (t2) {
      await page.evaluate(() => { GeoGame.state.geoSinceMath = 2; });
      await page.evaluate((t) => GeoGame.onTerritoryClick(t), t2); await wait(200);
      ok(`${tag}: math nudged after 2 geography questions`, await vis("#terr-math-nudge"));
      ok(`${tag}: math subject preselected`, await page.locator('[data-subject="math"].active').count());
      await page.evaluate(() => { const o = GeoMath.generate.bind(GeoMath); GeoMath.generate = (tier, opts = {}) => { GeoMath.generate = o; return o(tier, { ...opts, skill: "fracdiff" }); }; });
      await page.click('.diff-btn[data-tier="hard"]'); await wait(450);
      ok(`${tag}: math question shown`, await page.evaluate(() => GeoGame.currentContest && GeoGame.currentContest.question.type === "math"));
      await shot("10-math-question");
      ok(`${tag}: no toast over the question card`, !(await vis("#toast")));
      await page.keyboard.press("h"); await wait(200);
      ok(`${tag}: keyboard H shows a hint`, stage < "b" || (await page.locator("#q-hints li").count()) === 1);
      if (stage >= "b") {
        const hint = page.locator("#btn-hint");
        ok(`${tag}: hint button`, await hint.isVisible());
        for (let i = 0; i < 1 && (await hint.isVisible()) && (await hint.isEnabled()); i++) { await hint.click(); await wait(300); }
        ok(`${tag}: two hint steps shown`, (await page.locator("#q-hints li").count()) === 2);
        ok(`${tag}: fraction bars drawn`, await page.locator("#q-hints svg").count());
        await shot("10b-math-hints");
      }
      if (stage >= "c") {
        await answer(false); await wait(300); await shot("11-math-wrong-solution");
        ok(`${tag}: worked solution shown`, (await page.locator("#q-feedback li, #q-feedback .solution-step").count()) >= 2);
        ok(`${tag}: try-a-similar-one button`, await vis("#btn-similar"));
        ok(`${tag}: points tag shows 0 after a miss`, (await page.locator("#q-points").textContent()) === "0 pts");
        if (tag === "desktop") ok(`${tag}: pinned buttons side by side`, await page.evaluate(() => { const a = document.getElementById("btn-similar").getBoundingClientRect(), b = document.getElementById("btn-q-continue").getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && a.right <= b.left; }));
        ok(`${tag}: similar button in view without scrolling`, await page.evaluate(() => { const r = document.getElementById("btn-similar").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
        await page.click("#btn-similar"); await wait(500);
        ok(`${tag}: math miss lets the Baron steal`, await page.evaluate((t) => GeoGame.state.ownership[t] === "rival", t2));
        ok(`${tag}: similar practice question opens`, await vis("#q-practice-note") && await page.evaluate(() => GeoGame.currentContest && GeoGame.currentContest.practice && GeoGame.currentContest.question.skill === "fracdiff"));
        await shot("11b-math-practice");
        const pts0 = await page.evaluate(() => GeoGame.state.points);
        await answer(true); await cont();
        { const tt = await page.evaluate(() => { const t = document.getElementById("toast"); return [t.classList.contains("hidden") ? "" : t.textContent, ...GeoGame._toastQueue.map((x) => x.msg)].join("|"); });
          const name = await page.evaluate((t) => GeoGame.nameOf[t], t2);
          const iSteal = tt.lastIndexOf(`seized ${name}`), iPrac = tt.indexOf("Nice practice");
          ok(`${tag}: toast held during the card shows after it closes`, iSteal >= 0 && iPrac > iSteal); }
        ok(`${tag}: practice changes nothing`, await page.evaluate(([t, p]) => GeoGame.state.ownership[t] === "rival" && GeoGame.state.points === p, [t2, pts0]));
      } else {
        await answer(true); await cont();
        ok(`${tag}: math win conquers`, await page.evaluate((t) => GeoGame.state.ownership[t] === "player", t2));
        ok(`${tag}: math resets the every-3rd counter`, await page.evaluate(() => GeoGame.state.geoSinceMath === 0));
      }
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
  // Old save without a character (and one with a bogus id) loads with the default, no crash.
  for (const bad of [undefined, "dragon-9000"]) {
    await page.evaluate((b) => { const s = JSON.parse(localStorage.getItem("geoConquestSaveV1")); if (b === undefined) { delete s.avatar; delete s.passport; } else s.avatar = b; localStorage.setItem("geoConquestSaveV1", JSON.stringify(s)); }, bad);
    await page.reload(); await wait(1200);
    ok(`${tag}: old save (${bad || "no avatar"}) preselects the default explorer`, (await page.locator('#solo-avatars .av-pick.selected').getAttribute("aria-label")) === "Fox Explorer");
    await page.click("#btn-continue"); await wait(1200);
    ok(`${tag}: old save (${bad || "no avatar"}) continues with fox`, await page.evaluate(() => GeoGame.state.avatar === "fox"));
    if (bad === undefined) ok(`${tag}: old save without passport back-fills a stamp for every owned country`, await page.evaluate(() => { const s = GeoGame.state; const own = Object.keys(s.ownership).filter((k) => s.ownership[k] === "player"); return own.length > 0 && own.every((k) => s.passport[k]); }));
  }
  // Raster art drop-in: when the manifest lists files they are used, everything else stays placeholder.
  {
    const p2 = await ctx.newPage();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    await p2.route("**/assets/avatars/manifest.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ files: ["fox/happy.webp", "baron/mischievous.webp"] }) }));
    await p2.route("**/assets/avatars/**/*.webp", (r) => r.fulfill({ contentType: "image/png", body: png }));
    await p2.goto(URL); await p2.waitForTimeout(1500);
    ok(`${tag}: listed art replaces the placeholder`, await p2.evaluate(() => GeoAvatars.artUrl("fox", "happy") === "assets/avatars/fox/happy.webp" && GeoAvatars.artUrl("fox", "oops").startsWith("data:")));
    ok(`${tag}: listed Baron art is shown`, await p2.evaluate(() => [...document.querySelectorAll(".baron-portrait")].every((i) => i.getAttribute("src") === "assets/avatars/baron/mischievous.webp")));
    await p2.close();
  }
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
