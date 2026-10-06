// Fails if product code mentions Football Manager / Sports Interactive / SEGA (BUILD §2.4, §18).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps", "packages", "evals", "e2e"];
const BANNED = [/football\s*manager/i, /sports\s*interactive/i, /\bSEGA\b/, /\bFM2[0-9]\b/, /\bFM\s?21\b/];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "storybook-static", "coverage", ".turbo"]);
const EXT = /\.(tsx?|jsx?|mjs|cjs|css|md|json|cedar|sql|html)$/;
let hits = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(name)) {
      const text = readFileSync(p, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const re of BANNED) {
          if (re.test(line)) {
            hits++;
            console.log(`${p}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
        }
      });
    }
  }
}
for (const r of ROOTS) {
  try { statSync(r); walk(r); } catch {}
}
if (hits) { console.error(`\n${hits} banned-term hit(s).`); process.exit(1); }
console.log("No banned terms found.");
