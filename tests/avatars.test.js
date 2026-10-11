// Unit test for js/avatars.js (runs in Node without a browser).
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = { console, window: {} }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/avatars.js"), "utf8") + "\nthis.GeoAvatars = GeoAvatars;", ctx);
const A = ctx.GeoAvatars; let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("✘ " + m); } };
const ids = ["pirate", "astronaut", "fox", "robot", "knight", "scientist", "diver", "ninjacat", "ranger", "polar"];
ok(A.CHARACTERS.map((c) => c.id).join() === ids.join(), "10 characters in order");
ok(A.DEFAULT === "fox", "default fox");
for (const c of A.CHARACTERS) {
  ok(c.name && c.colors && c.colors.bg && c.colors.main, "fields for " + c.id);
  for (const e of A.EXPRESSIONS) {
    const s = A.faceSvg(c.id, e);
    ok(/^<svg[^>]*viewBox="0 0 100 100"/.test(s) && s.endsWith("</svg>"), `svg ${c.id}/${e}`);
    ok(A.faceUrl(c.id, e).startsWith("data:image/svg+xml"), `url ${c.id}/${e}`);
  }
}
ok(A.EXPRESSIONS.join() === "happy,cheer,oops", "expressions");
ok(A.normalize("nope") === "fox" && A.normalize(undefined) === "fox" && A.normalize("robot") === "robot", "normalize");
ok(A.normalize("nope", ["fox"]) !== "fox", "normalize skips taken");
ok(A.pickFree(["fox", "astronaut"]) === "pirate", "pickFree first unused");
ok(typeof A.faceSvg("bogus", "bogus") === "string", "bogus input never throws");
ok(A.BARON_EXPRESSIONS.join() === "mischievous,smug,grumpy", "baron expressions");
// Art: placeholders until the manifest lists a raster file.
for (const e of A.BARON_EXPRESSIONS) ok(/^<svg[^>]*viewBox="0 0 100 100"/.test(A.baronSvg(e)), "baron svg " + e);
ok(A.artUrl("fox", "happy") === A.faceUrl("fox", "happy"), "artUrl placeholder without manifest");
ok(A.baronUrl("smug").startsWith("data:image/svg+xml"), "baronUrl placeholder");
A.setManifest(["fox/happy.webp", "baron/smug.webp"]);
ok(A.artUrl("fox", "happy") === "assets/avatars/fox/happy.webp", "artUrl raster when listed");
ok(A.artUrl("fox", "oops") === A.faceUrl("fox", "oops"), "artUrl placeholder for unlisted expr");
ok(A.baronUrl("smug") === "assets/avatars/baron/smug.webp", "baronUrl raster when listed");
ok(A.baronUrl("grumpy").startsWith("data:"), "baronUrl placeholder when unlisted");
A.setManifest(null); ok(A.artUrl("fox", "happy").startsWith("data:"), "bad manifest -> placeholders");
console.log(fail ? `avatars tests FAILED (${fail})` : "avatars tests passed");
process.exit(fail ? 1 : 0);
