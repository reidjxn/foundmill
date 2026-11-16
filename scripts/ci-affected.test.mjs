// Run: node --test scripts/ci-affected.test.mjs
// The rules CI's "Changed areas" job uses to skip unit entries and Playwright shards on a pull request
// (scripts/ci-affected.mjs), and the parts of .github/workflows/ci.yml that depend on them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { affected, reachesOutside, SCREEN_ROOTS, uncoveredReaches, withDependencies, withDependents, workspace } from "./ci-affected.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const pkgs = workspace();
const names = (list) => list.map((p) => p.replace("@foundmill/", "")).sort();

test("the graph is the workspace's: every package, each with its declared workspace dependencies", () => {
  assert.ok(pkgs.length >= 20, `expected the workspace's packages, found ${pkgs.length}`);
  const web = pkgs.find((p) => p.name === "@foundmill/web");
  assert.ok(web.deps.includes("@foundmill/api") && web.deps.includes("@foundmill/dugout"));
});

test("a package's dependents are the ones turbo's --filter=...<package> selects", () => {
  const bin = process.env.TURBO_BIN ?? join(ROOT, "node_modules/.bin/turbo");
  assert.ok(existsSync(bin), `turbo not found at ${bin} (pnpm install first, or set TURBO_BIN)`);
  for (const p of pkgs) {
    const out = execFileSync(bin, ["ls", `--filter=...${p.name}`, "--output=json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const turbo = JSON.parse(out.slice(out.indexOf("{"))).packages.items.map((i) => i.name).sort();
    assert.deepEqual(withDependents(pkgs, [p.name]), turbo, p.name);
  }
});

// Relative paths outside a package that are not reads its unit tests depend on.
const NOT_READS = [
  { file: /^packages\/shared\/src\/people\.test\.ts$/, target: "packages/etc" }, // a rejected token literal, "../../etc"
  { file: /^apps\/web\/e2e\/[^/]+\.spec\.ts$/, target: "docs/ux-audit" }, // Playwright screenshots are written there
];

test("every relative path that leaves a package is a declared dependency or in TEST_READS", () => {
  assert.ok(reachesOutside().length > 0, "the scan found no relative path at all: it is broken");
  const left = uncoveredReaches().filter((r) => !NOT_READS.some((n) => n.file.test(r.file) && n.target === r.target));
  assert.deepEqual(left, [], "add the edge to TEST_READS in scripts/ci-affected.mjs (or declare the dependency)");
});

test("root config, the workflows and this script run every unit entry and the shards", () => {
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", "tsconfig.base.json", "vitest.config.ts", "eslint.config.mjs", ".github/workflows/ci.yml", "patches/postgres@3.4.9.patch", "scripts/ci-affected.mjs"]) {
    const a = affected([f]);
    assert.ok(a.all && a.screens && a.packages.length === pkgs.length, f);
  }
  assert.equal(affected(["apps/web/package.json"]).all, false, "a package's own package.json is that package's change");
});

test("a docs-only change affects nothing", () => {
  assert.deepEqual(affected(["docs/ARCHITECTURE.md", "docs/log/2026-11/x.md", "README.md", "infra/x.tf"]), { all: false, packages: [], screens: false });
});

test("a change runs its package, its dependents and the tests that read it, and no more", () => {
  assert.deepEqual(names(affected(["apps/orchestrator/src/loop.ts"]).packages), ["evals", "models", "orchestrator", "web"]);
  assert.deepEqual(names(affected(["evals/src/cases.ts"]).packages), ["evals"]);
  // gateway's tokens are imported by orchestrator's contract tests: orchestrator runs, its dependents do not gain.
  assert.ok(affected(["apps/gateway/src/tokens.ts"]).packages.includes("@foundmill/orchestrator"));
  assert.deepEqual(names(affected(["scripts/banned-terms.mjs"]).packages), ["agents", "models"]);
  assert.deepEqual(names(affected(["scripts/us-english.mjs"]).packages), ["models", "shared"]);
});

test("screens: true for anything apps/web, apps/api or e2e/ import, false for what they do not", () => {
  const reach = withDependencies(pkgs, SCREEN_ROOTS);
  for (const p of pkgs) {
    const file = `${p.dir}/src/x.ts`;
    assert.equal(affected([file]).screens, reach.includes(p.name), `${p.name}: in the screens' dependency closure = ${reach.includes(p.name)}`);
  }
  // Every direct workspace dependency of the two servers counts, whatever it is.
  for (const root of ["@foundmill/web", "@foundmill/api"]) {
    for (const d of pkgs.find((p) => p.name === root).deps) assert.ok(reach.includes(d), `${root} depends on ${d}`);
  }
  for (const f of ["apps/web/app/page.tsx", "apps/api/src/index.ts", "packages/db/src/seed/index.ts", "packages/dugout/src/x.tsx", "packages/shared/src/x.ts", "packages/connectors/src/x.ts", "packages/agents/src/prompts/x.md", "e2e/tests/golden-path.spec.ts", "scripts/e2e-shard.mjs", "scripts/test-inventory.mjs", "apps/web/e2e/shard-weights.json"]) {
    assert.equal(affected([f]).screens, true, f);
  }
  for (const f of ["apps/orchestrator/src/loop.ts", "apps/composer/src/x.ts", "apps/stream/src/x.ts", "packages/sandbox/src/x.ts", "evals/src/x.ts", "scripts/banned-terms.mjs", "docs/DEPLOY.md"]) {
    assert.equal(affected([f]).screens, false, f);
  }
});

test("the command prints the two outputs the workflow reads", () => {
  const out = execFileSync("node", [join(ROOT, "scripts/ci-affected.mjs")], { input: "evals/src/x.ts\ndocs/a.md\n", encoding: "utf8" });
  assert.equal(out, "unit=@foundmill/evals\nscreens=false\n");
  assert.equal(execFileSync("node", [join(ROOT, "scripts/ci-affected.mjs")], { input: "turbo.json\n", encoding: "utf8" }), "unit=all\nscreens=true\n");
});

/** The text of one job in a workflow file: from its key to the next job key at the same indent. */
function job(workflow, key) {
  const m = workflow.match(new RegExp(`^ {2}${key}:\\n([\\s\\S]*?)(?=^ {2}[A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
}

test("ci.yml: the filters feed the jobs, and the required gates cannot pass on a skipped Changed areas", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const changes = job(ci, "changes");
  assert.match(changes, /node scripts\/ci-affected\.mjs/);
  assert.match(changes, /fetch-depth: 0/);
  for (const o of ["code", "unit", "screens", "shards", "image", "stories"]) assert.match(changes, new RegExp(`^ {6}${o}: \\$\\{\\{ steps\\.f\\.outputs\\.${o} \\}\\}`, "m"), o);
  // A push to main: the smoke set. Anything else that is not a pull request: everything.
  assert.match(changes, /"\$EVENT" = "push"[\s\S]*unit=all screens=true 'shards=\["smoke"\]' image=false stories=false/);
  assert.match(changes, /"\$EVENT" != "pull_request"[\s\S]*unit=all screens=true "shards=\$ALL_SHARDS" image=true stories=true/);

  const shard = job(ci, "e2e-shard");
  assert.match(shard, /if: \$\{\{ needs\.changes\.outputs\.screens == 'true' \}\}/);
  assert.match(shard, /shard: \$\{\{ fromJSON\(needs\.changes\.outputs\.shards\) \}\}/);
  assert.match(shard, /- name: Playwright \(apps\/web screens, this shard's files\)\n {8}if: \$\{\{ matrix\.shard != 'smoke' \}\}/);
  assert.match(shard, /if: \$\{\{ !cancelled\(\) && \(matrix\.shard == 1 \|\| matrix\.shard == 'smoke'\) \}\}/);

  const unit = job(ci, "unit");
  const steps = unit.split(/\n {6}- /).slice(1);
  assert.match(steps[0], /id: need/);
  for (const s of steps.slice(1)) assert.match(s, /if: \$\{\{ steps\.need\.outputs\.run == 'true' \}\}/, `unit step without the gate: ${s.split("\n")[0]}`);

  for (const [key, name] of [["checks", "Typecheck, lint, unit tests"], ["e2e", "Playwright (web screens + golden path)"]]) {
    const gate = job(ci, key);
    assert.match(gate, new RegExp(`name: ${name.replace(/[()+]/g, "\\$&")}\\n`), `${key} keeps the required check's name`);
    assert.match(gate, /if: \$\{\{ always\(\) \}\}/, key);
    assert.match(gate, /needs: \[changes, /, key);
    assert.match(gate, /\[ "\$CHANGES" = "success" \] \|\| \{/, key);
  }
});

test("ci.yml: the full suite runs nightly in a concurrency group of its own, and main's alert covers it", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /^ {2}schedule:\n {4}(#.*\n {4})?- cron: "[^"]+"/m);
  assert.match(ci, /^ {2}workflow_dispatch:/m);
  assert.match(ci, /group: ci-\$\{\{ github\.event_name == 'schedule' && 'nightly' \|\|/);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  const alert = readFileSync(join(ROOT, ".github/workflows/ci-alert.yml"), "utf8");
  assert.match(alert, /workflows: \[CI\]\n\s+branches: \[main\]/);
  assert.doesNotMatch(alert, /^\s+event:/m, "the alert must not be narrowed to push events");
});
