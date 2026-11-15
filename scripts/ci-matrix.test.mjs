// The CI unit lane is a matrix of filters (docs/holistic-plan/WP-01-fast-lane.md T1). A workspace package with a
// `test` script that no matrix entry names would silently stop being tested, so this fails when one is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Names of workspace packages that have a `test` script, from the globs in pnpm-workspace.yaml. */
export function testedPackages(root = ROOT) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const globs = [...block.matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  const dirs = globs.flatMap((g) => {
    if (!g.endsWith("/*")) return [g];
    const parent = g.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${parent}/${d.name}`);
  });
  return dirs
    .map((d) => join(root, d, "package.json"))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, "utf8")))
    .filter((p) => p.scripts?.test && p.name !== "@foundmill/e2e")
    .map((p) => p.name)
    .sort();
}

/** The text of the `unit:` job in a workflow file: from its key to the next job key at the same indent. */
export function unitJob(workflow) {
  const m = workflow.match(/^ {2}unit:\n([\s\S]*?)(?=^ {2}[A-Za-z0-9_-]+:\s*$|(?![\s\S]))/m);
  return m ? m[1] : "";
}

/** Packages that no `--filter @foundmill/<x>` or `--filter=@foundmill/<x>` in the unit job names. */
export function missingFromMatrix(packages, workflow) {
  const job = unitJob(workflow);
  const named = new Set([...job.matchAll(/--filter[ =](@foundmill\/[a-z0-9-]+)/g)].map((m) => m[1]));
  return packages.filter((p) => !named.has(p));
}

test("every workspace package with a test script is in a unit matrix entry", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const packages = testedPackages();
  assert.ok(packages.length >= 20, `expected the workspace's packages, found ${packages.length}`);
  assert.ok(unitJob(workflow), "ci.yml has no unit: job");
  assert.deepEqual(missingFromMatrix(packages, workflow), []);
});

test("a package left out of the matrix is reported by name", () => {
  const workflow = [
    "jobs:",
    "  unit:",
    "    strategy:",
    "      matrix:",
    "        include:",
    '          - { name: "a", run: "pnpm --filter @foundmill/api exec vitest run" }',
    '          - { name: "b", run: "pnpm exec turbo run test --filter=@foundmill/db" }',
    "  checks:",
    '    run: "pnpm --filter @foundmill/web test"',
  ].join("\n");
  assert.deepEqual(missingFromMatrix(["@foundmill/api", "@foundmill/db", "@foundmill/web"], workflow), ["@foundmill/web"]);
});
