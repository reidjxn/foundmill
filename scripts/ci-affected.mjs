#!/usr/bin/env node
// What a pull request can reach, for CI's "Changed areas" job (founder's yes, Nov 16, 2026). It reads the workspace
// dependency graph pnpm and turbo use: every workspace package's package.json and the `@foundmill/*` packages it depends
// on. A change inside a package affects that package and every package that depends on it, transitively, which is what
// turbo's `--filter=...[<base>]` selects (scripts/ci-affected.test.mjs checks the two agree). On top of the graph:
//   - ROOT_CONFIG: root config (package.json, the lockfile, turbo.json, a root tsconfig or vitest config, the workflows,
//     patches/, this script) affects every package; turbo alone does not count these;
//   - TEST_READS: packages whose tests read another package by a relative path, or files outside their package (the copy
//     linters' scripts, whole-repo scans). Those tests run when what they read changes; their dependents do not.
// The self-test fails when a source file reaches outside its package by a relative path that neither covers.
// `screens` is true when a change reaches apps/web, apps/api or e2e/ through the graph (the Playwright stack: anything
// they import at build or run time), or the scripts the Playwright job runs. No hand list says what the screens import.
//   git diff --name-only <base> HEAD | node scripts/ci-affected.mjs    prints `unit=<all|names>` and `screens=<bool>`
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "../..");

export const ROOT_CONFIG =
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig[^/]*\.json|vitest\.[^/]+|eslint\.config\.mjs|\.npmrc|\.github\/|patches\/|scripts\/ci-affected\.mjs$)/;

/** Reads the graph does not show: a package's tests import `packages` by relative path, or read files matching `paths`. */
export const TEST_READS = {
  // gateway-token-contract.test.ts and grants-contract.test.ts import apps/gateway/src/tokens.ts.
  "@foundmill/orchestrator": { packages: ["@foundmill/gateway"] },
  // seed/__tests__/seed.test.ts imports packages/entity-linker/src.
  "@foundmill/db": { packages: ["@foundmill/entity-linker"] },
  // post-draft.test.ts runs scripts/banned-terms.mjs on a draft.
  "@foundmill/agents": { paths: /^scripts\/banned-terms\.mjs$/ },
  // terms.test.ts runs scripts/us-english.mjs on the vocabulary.
  "@foundmill/shared": { paths: /^scripts\/us-english\.mjs$/ },
  // model-ids.test.ts scans every source file under apps/, packages/ and scripts/ for a model id outside routing.ts.
  "@foundmill/models": { paths: /^(apps|packages|scripts)\// },
  // content/legal/__tests__/legal-content.test.ts scans apps/ and packages/ for the legal entity's name and address.
  "@foundmill/web": { paths: /^(apps|packages)\// },
};

/** The packages the Playwright job runs: apps/web and apps/api as servers, e2e/ as the golden path. */
export const SCREEN_ROOTS = ["@foundmill/web", "@foundmill/api", "@foundmill/e2e"];
/** Scripts the Playwright job itself runs (shard dealing, the flaky-test report). */
export const SCREEN_PATHS = /^scripts\/(e2e-shard|test-inventory)\.mjs$/;

/** Workspace packages from the globs in pnpm-workspace.yaml: { name, dir, deps } with deps the workspace ones only. */
export function workspace(root = ROOT) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const globs = [...block.matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  const dirs = globs.flatMap((g) =>
    g.endsWith("/*")
      ? readdirSync(join(root, g.slice(0, -2)), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => `${g.slice(0, -2)}/${d.name}`)
      : [g],
  );
  const pkgs = dirs
    .filter((d) => existsSync(join(root, d, "package.json")))
    .map((dir) => {
      const p = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      const all = { ...p.dependencies, ...p.devDependencies, ...p.peerDependencies, ...p.optionalDependencies };
      return { name: p.name, dir, deps: Object.keys(all) };
    });
  const names = new Set(pkgs.map((p) => p.name));
  for (const p of pkgs) p.deps = p.deps.filter((d) => names.has(d)).sort();
  return pkgs.sort((a, b) => a.name.localeCompare(b.name));
}

/** The package that owns a repository path, or undefined for a path outside every package. */
export function owner(pkgs, file) {
  return pkgs.filter((p) => file.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0]?.name;
}

/** `names` and every package that depends on one of them, transitively. */
export function withDependents(pkgs, names) {
  const out = new Set(names);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pkgs) {
      if (!out.has(p.name) && p.deps.some((d) => out.has(d))) {
        out.add(p.name);
        grew = true;
      }
    }
  }
  return [...out].sort();
}

/** `names` and every package they depend on, transitively. */
export function withDependencies(pkgs, names) {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const out = new Set();
  const visit = (n) => {
    if (out.has(n)) return;
    out.add(n);
    for (const d of byName.get(n)?.deps ?? []) visit(d);
  };
  names.forEach(visit);
  return [...out].sort();
}

/**
 * { all, packages, screens } for a list of changed paths. `all`: root config changed, every package runs. `packages`:
 * the packages whose unit tests run. `screens`: the Playwright stack can see the change.
 */
export function affected(files, pkgs = workspace()) {
  const all = files.some((f) => ROOT_CONFIG.test(f));
  const changed = [...new Set(files.map((f) => owner(pkgs, f)).filter(Boolean))];
  const reached = withDependents(pkgs, changed);
  const readers = Object.entries(TEST_READS)
    .filter(([, r]) => (r.packages ?? []).some((p) => reached.includes(p)) || (r.paths && files.some((f) => r.paths.test(f))))
    .map(([name]) => name);
  const packages = all ? pkgs.map((p) => p.name) : [...new Set([...reached, ...readers])].sort();
  const screens = all || files.some((f) => SCREEN_PATHS.test(f)) || reached.some((p) => SCREEN_ROOTS.includes(p));
  return { all, packages, screens };
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", ".pglite", "coverage", "storybook-static", "test-results", "playwright-report"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Every relative path literal ("../…") in a package's source that lands outside the package: { from, file, target }. */
export function reachesOutside(pkgs = workspace(), root = ROOT) {
  const out = [];
  const walk = (pkg, dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(pkg, path);
      } else if (SOURCE.test(e.name)) {
        for (const m of readFileSync(join(root, path), "utf8").matchAll(/["'`](\.\.\/[^"'`\s$]*)["'`]/g)) {
          const target = relative(root, resolve(root, dir, m[1]));
          if (target.startsWith("..") || target.startsWith(`${pkg.dir}/`) || target === pkg.dir) continue;
          out.push({ from: pkg.name, file: path, target });
        }
      }
    }
  };
  for (const p of pkgs) walk(p, p.dir);
  return out;
}

/** The reaches neither the graph nor TEST_READS covers. A reach to the repository root needs a TEST_READS `paths` scan. */
export function uncoveredReaches(pkgs = workspace(), root = ROOT) {
  return reachesOutside(pkgs, root).filter(({ from, target }) => {
    const reads = TEST_READS[from] ?? {};
    const o = owner(pkgs, target);
    if (o) return !withDependencies(pkgs, [from]).includes(o) && !(reads.packages ?? []).includes(o);
    if (target === "") return !reads.paths;
    return !reads.paths?.test(target);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const { all, packages, screens } = affected(files);
  console.log(`unit=${all ? "all" : packages.join(" ")}`);
  console.log(`screens=${screens}`);
}
