#!/usr/bin/env node
// The watch paths of each Railway service (WP-01 T4; docs/DEPLOY.md §3 "Watch patterns"): a service redeploys only when
// its own app, a workspace package it imports (through `dependencies`, transitively) or the image's inputs change.
// railway/<service>.toml mirrors these lists (scripts/railway-config.test.mjs keeps them equal); the lists that count
// live in each service's settings (Settings, Build, Watch Paths), because Railway stops reading config files on Dec 1, 2026.
//
//   node scripts/railway-watch.mjs --print [--with-negation]          one block per service, one pattern per line
//   node scripts/railway-watch.mjs --replay <git range> [--with-negation]   per commit, the services it would redeploy
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SERVICES = ["api", "gateway", "orchestrator", "composer", "stream", "ingest", "sites"];
/** What the Dockerfile copies and installs from, besides apps and packages. */
const IMAGE_INPUTS = ["/patches/**", "/Dockerfile", "/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/.npmrc"];
/** The orchestrator's pre-deploy command builds the E2B template from infra/e2b. */
const OWN_EXTRA = { orchestrator: ["/infra/**"] };
/** Not applied until proven on one service (whether Railway accepts `!` is unverified; WP-00 S4 tries ingest first). */
export const NEGATIONS = ["!**/*.md", "!**/__tests__/**", "!**/*.test.ts"];

const manifest = (dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
const workspaceDeps = (dir) => Object.keys(manifest(dir).dependencies ?? {}).filter((d) => d.startsWith("@foundmill/"));

/** Workspace package directories a service reaches through `dependencies`, transitively, sorted. */
export function closure(service) {
  const seen = new Set();
  const queue = workspaceDeps(`apps/${service}`);
  while (queue.length) {
    const name = queue.shift().replace("@foundmill/", "");
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...workspaceDeps(`packages/${name}`));
  }
  return [...seen].sort().map((name) => `packages/${name}`);
}

/** The watch paths for one service, one pattern per entry, no braces. */
export function watchPaths(service, { withNegation = false } = {}) {
  return [`/apps/${service}/**`, ...(OWN_EXTRA[service] ?? []), ...closure(service).map((d) => `/${d}/**`), ...IMAGE_INPUTS, ...(withNegation ? NEGATIONS : [])];
}

/** Railway's watch patterns are gitignore-style globs; the ones here use a trailing `/**`, an exact path, or the three negations. */
export function matches(pattern, path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (pattern.startsWith("!**/")) {
    const rest = pattern.slice(4);
    if (rest.endsWith("/**")) return p.split("/").includes(rest.slice(0, -3));
    if (rest.startsWith("*.")) return p.endsWith(rest.slice(1));
    return false;
  }
  return pattern.endsWith("/**") ? p.startsWith(pattern.slice(0, -2)) : p === pattern;
}

/** Whether a list of patterns (positives, then negations that exclude) selects a path. */
function selects(patterns, path) {
  const positives = patterns.filter((x) => !x.startsWith("!"));
  const negations = patterns.filter((x) => x.startsWith("!"));
  return positives.some((x) => matches(x, path)) && !negations.some((x) => matches(x, path));
}

/** The services whose watch paths select any of the changed paths. */
export function redeploys(paths, options = {}) {
  return SERVICES.filter((service) => {
    const patterns = watchPaths(service, options);
    return paths.some((path) => selects(patterns, path));
  });
}

function replay(range, options) {
  const out = execFileSync("git", ["log", "--first-parent", "--format=@%h %s", "--name-only", range], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  const commits = out.split("\n@").map((block) => block.replace(/^@/, "").split("\n").filter(Boolean)).filter((b) => b.length);
  const totals = Object.fromEntries(SERVICES.map((s) => [s, 0]));
  for (const [head, ...files] of commits) {
    const hit = redeploys(files, options);
    for (const s of hit) totals[s] += 1;
    console.log(`${head.slice(0, 90)}\n    ${hit.length ? hit.join(", ") : "(nothing)"}`);
  }
  console.log(`\n${commits.length} commits. Redeploys per service (today: ${commits.length} each):`);
  for (const s of SERVICES) console.log(`  ${s.padEnd(13)} ${totals[s]}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { withNegation: args.includes("--with-negation") };
  if (args.includes("--print")) {
    for (const s of SERVICES) console.log(`# ${s}\n${watchPaths(s, options).join("\n")}\n`);
  } else if (args.includes("--replay")) {
    replay(args[args.indexOf("--replay") + 1], options);
  } else {
    console.error("usage: node scripts/railway-watch.mjs --print | --replay <git range> [--with-negation]");
    process.exit(2);
  }
}
