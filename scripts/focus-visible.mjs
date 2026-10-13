#!/usr/bin/env node
// Focus ring guard (audit A11Y-02). In Tailwind v4 `outline-none` (and `outline-hidden`) set --tw-outline-style: none,
// and `focus-visible:outline-2` / `focus-visible:outline-link` only add a width or a color that REUSE that variable. A
// class list that has both therefore draws nothing on keyboard focus: the 2 px accent outline DESIGN §3 promises never
// shows. The app's own base layer already clears the outline for mouse focus (`:focus { outline: none }`) and draws the
// ring on `:focus-visible`, so such a list just drops `outline-none` (or adds `focus-visible:outline-solid`).
//
// Fails (exit 1, file:line per hit) on a string literal in product code that carries a bare `outline-none` or
// `outline-hidden` token together with a `focus:` / `focus-visible:` outline width, color or offset and no
// `focus-visible:outline-solid`. `focus-visible:outline-none` (a deliberate "no outline, a ring or shadow is drawn
// instead") and the `focus-ring` utility are fine.
//
// Usage:
//   node scripts/focus-visible.mjs            scan apps/ and packages/
//   node scripts/focus-visible.mjs <dir|file>  scan only the given roots
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "storybook-static", "coverage", ".turbo", "test-results", "playwright-report", ".pglite"]);
const TEST_PATH = /(^|\/)(__tests__|e2e|test|tests|__fixtures__|__mocks__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const STYLE_WORD = /^(none|hidden|solid|dashed|dotted|double|offset|inherit)/;

/** True for a class list whose focus outline is drawn with a width/color/offset that inherits `outline-style: none`. */
export function hasInvisibleFocusOutline(classList) {
  const tokens = classList.split(/\s+/).filter(Boolean);
  const killsStyle = tokens.some((t) => t === "outline-none" || t === "outline-hidden");
  if (!killsStyle) return false;
  const restoresStyle = tokens.some((t) => /^(focus|focus-visible):outline-(solid|dashed|dotted|double)$/.test(t));
  if (restoresStyle) return false;
  return tokens.some((t) => {
    const m = /^(?:focus|focus-visible):-?outline-(.+)$/.exec(t);
    return m !== null && !STYLE_WORD.test(m[1]);
  });
}

/** Every string literal ("…", '…', `…`) in a source text, with its 1-based start line. */
export function stringLiterals(text) {
  const out = [];
  // Quoted strings stay on one line (an apostrophe in a comment must not swallow the lines after it); templates may span lines.
  const re = /"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\[\s\S]|[^`\\])*)`/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ value: m[1] ?? m[2] ?? m[3] ?? "", line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Lines (1-based) with an invisible focus outline: inside one string, or across the strings of one line (`cn("outline-none", on && "focus-visible:outline-2")`). */
export function scanSource(text) {
  const hits = new Set();
  const byLine = new Map();
  for (const lit of stringLiterals(text)) {
    if (!lit.value.includes("outline-")) continue;
    if (hasInvisibleFocusOutline(lit.value)) hits.add(lit.line);
    byLine.set(lit.line, `${byLine.get(lit.line) ?? ""} ${lit.value}`);
  }
  for (const [line, joined] of byLine) if (hasInvisibleFocusOutline(joined)) hits.add(line);
  return [...hits].sort((a, b) => a - b);
}

function* walk(path) {
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
  const roots = process.argv.slice(2).length ? process.argv.slice(2).map((p) => resolve(p)) : [join(REPO_ROOT, "apps"), join(REPO_ROOT, "packages")];
  let failures = 0;
  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(REPO_ROOT, file);
      if (TEST_PATH.test(rel)) continue;
      for (const line of scanSource(readFileSync(file, "utf8"))) {
        failures += 1;
        console.error(`${rel}:${line}: outline-none with a focus outline width/color: the focus ring is invisible (Tailwind v4). Drop outline-none or add focus-visible:outline-solid.`);
      }
    }
  }
  if (failures) {
    console.error(`\n${failures} invisible focus ring${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log("Focus rings: every focus outline is visible.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
