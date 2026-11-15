// Run: node --test scripts/vercel-ignore.test.mjs
// The web app's Ignored Build Step (scripts/vercel-ignore.sh) skips a preview only when nothing the app is built from
// changed. A workspace package the app reaches but the script does not name would let a real change skip its build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const deps = (dir) => Object.keys(json(`${dir}/package.json`).dependencies ?? {}).filter((d) => d.startsWith("@foundmill/")).map((d) => d.slice("@foundmill/".length));

/** The directories apps/web reaches through dependencies, transitively; the api counts as its source (types only). */
function reached() {
  const dirs = new Set();
  const queue = deps("apps/web");
  while (queue.length) {
    const name = queue.shift();
    if (name === "api") {
      dirs.add("apps/api/src");
      continue;
    }
    if (dirs.has(`packages/${name}`)) continue;
    dirs.add(`packages/${name}`);
    queue.push(...deps(`packages/${name}`));
  }
  return [...dirs].sort();
}

test("the script names every directory the web app is built from", () => {
  const script = readFileSync(join(root, "scripts/vercel-ignore.sh"), "utf8");
  for (const dir of reached()) assert.ok(script.includes(`../../${dir} `) || script.includes(`../../${dir}\n`), `scripts/vercel-ignore.sh does not name ${dir}`);
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) assert.ok(script.includes(`../../${f}`), f);
});

test("apps/web/vercel.json runs the script and builds no agent branch", () => {
  const config = json("apps/web/vercel.json");
  assert.equal(config.ignoreCommand, "bash ../../scripts/vercel-ignore.sh");
  assert.deepEqual(config.git?.deploymentEnabled, { "agent/**": false });
});
