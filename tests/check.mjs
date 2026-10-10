// tests/check.mjs — the one gate: `node tests/check.mjs`
// 1) node --check every JS file  2) validate question data  3) math unit tests (if present)
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function run(label, cmd, args) {
  try {
    const out = execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(`✔ ${label}` + (out.trim() ? "\n  " + out.trim().split("\n").slice(-6).join("\n  ") : ""));
  } catch (e) {
    failed++;
    console.log(`✘ ${label}\n${(e.stdout || "") + (e.stderr || "")}`.trim());
  }
}
for (const f of readdirSync(join(root, "js")).filter((f) => f.endsWith(".js")))
  run(`node --check js/${f}`, "node", ["--check", `js/${f}`]);
// Full country coverage is required once segment 4 lands; COVERAGE=0 relaxes it for earlier segments.
const cov = process.env.COVERAGE === "0" ? [] : ["--require-coverage"];
run("question data (tools/validate.py)", "python3", ["tools/validate.py", ...cov]);
if (existsSync(join(root, "tests/math.test.js"))) run("math generator tests", "node", ["tests/math.test.js"]);
console.log(failed ? `\nCHECK FAILED (${failed})` : "\nCHECK PASSED");
process.exit(failed ? 1 : 0);
