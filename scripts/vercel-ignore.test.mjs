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

test("a previous deployment's commit the clone does not know (a rebased branch) builds instead of failing", async () => {
  // Vercel reads exit 1 as "build" and exit 0 as "skip"; any other code fails the deployment. A force-pushed branch
  // names a previous commit git no longer has, and `git diff` then exits 128 (seen on reidjxn/foundmill#250).
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync("bash", ["../../scripts/vercel-ignore.sh"], { cwd: join(root, "apps/web"), env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567" }, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
});
