#!/usr/bin/env node
// Design-token guard (WP-10 T13; DESIGN §2 "Tokens only", packages/dugout/CLAUDE.md). Product code takes its colors and
// sizes from packages/dugout/src/tokens.css. This fails on two leaks in `.ts` / `.tsx` under apps/web and
// packages/{dugout,modules,widgets}/src (tests, stories and fixtures excluded):
//   - a hex color literal (`#1b4fd8`, `#fff`);
//   - an arbitrary Tailwind length (`text-[17px]`, `max-w-[85vw]`, `w-[42%]`): add a token instead.
// Files that already had leaks when the gate landed are listed in scripts/design-tokens.allow.json with their count and
// a reason. A listed file may not grow; a file that is not listed may have none. A count that has shrunk is reported so
// the entry can be lowered (or removed) in the same change.
//
// Usage:
//   node scripts/design-tokens.mjs            scan the default roots
//   node scripts/design-tokens.mjs --write    rewrite the allowlist counts to today's hits (keeps reasons)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps/web", "packages/dugout/src", "packages/modules/src", "packages/widgets/src"];
const ALLOW_FILE = join(REPO_ROOT, "scripts/design-tokens.allow.json");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "storybook-static", "coverage", ".turbo", "test-results", "playwright-report", ".pglite", "public"]);
const SKIP_PATH = /(^|\/)(__tests__|e2e|test|tests|__fixtures__|__mocks__)(\/|$)|\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$|(^|\/)fixtures?\.[jt]sx?$/;
const CODE_EXT = new Set([".ts", ".tsx"]);

/** A hex color: 3, 4, 6 or 8 digits, not part of a word, an id (`#add-skill`) or an HTML entity (`&#039;`). */
const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
/** An arbitrary Tailwind length: `-[17px]`, `-[0.5rem]`, `-[85vw]`, `-[42%]`. */
const ARBITRARY = /-\[-?[0-9.]+(?:px|rem|em|vh|vw|dvh|svh|%)\]/g;

/** Every leak in a source text: `{ line, kind, text }`, lines 1-based. Comments are scanned too: a hex in a comment is cheap to keep honest. */
export function scanSource(text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((src, i) => {
    for (const m of src.matchAll(HEX)) out.push({ line: i + 1, kind: "hex", text: m[0] });
    for (const m of src.matchAll(ARBITRARY)) out.push({ line: i + 1, kind: "arbitrary", text: m[0] });
  });
  return out;
}

/** Compare per-file hit counts with the allowlist: `{ failures: string[], shrunk: string[] }`. */
export function judge(counts, allow) {
  const failures = [];
  const shrunk = [];
  for (const [file, n] of counts) {
    const allowed = allow[file]?.count ?? 0;
    if (n > allowed) failures.push(`${file}: ${n} hex or arbitrary value${n === 1 ? "" : "s"}, ${allowed} allowed`);
    else if (n < allowed) shrunk.push(`${file}: ${n} now, ${allowed} allowed: lower its count in scripts/design-tokens.allow.json`);
  }
  for (const file of Object.keys(allow)) if (!counts.has(file)) shrunk.push(`${file}: none now: remove it from scripts/design-tokens.allow.json`);
  return { failures, shrunk };
}

function* walk(path) {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isFile()) {
    if (CODE_EXT.has(extname(path))) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(path, name));
  }
}

function main() {
  const write = process.argv.includes("--write");
  const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, "utf8")) : {};
  const counts = new Map();
  const detail = new Map();
  for (const root of ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (SKIP_PATH.test(rel)) continue;
      const hits = scanSource(readFileSync(file, "utf8"));
      if (!hits.length) continue;
      counts.set(rel, hits.length);
      detail.set(rel, hits);
    }
  }
  if (write) {
    const next = {};
    for (const file of [...counts.keys()].sort()) next[file] = { count: counts.get(file), reason: allow[file]?.reason ?? "Owed when the file is next changed (WP-10 T13 baseline)." };
    writeFileSync(ALLOW_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote ${counts.size} entries to scripts/design-tokens.allow.json.`);
    return;
  }
  const { failures, shrunk } = judge(counts, allow);
  for (const s of shrunk) console.warn(`note: ${s}`);
  if (failures.length) {
    for (const f of failures) {
      console.error(f);
      for (const h of detail.get(f.split(":")[0]) ?? []) console.error(`  ${f.split(":")[0]}:${h.line}: ${h.kind} ${h.text}`);
    }
    console.error(`\nUse a token from packages/dugout/src/tokens.css (add one if none fits) instead of a hex color or an arbitrary Tailwind value.`);
    process.exit(1);
  }
  console.log("Design tokens: no new hex colors or arbitrary values.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
