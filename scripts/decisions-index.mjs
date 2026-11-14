#!/usr/bin/env node
/**
 * Print an index of docs/DECISIONS.md: one line per decision (its "## " heading), with the line number to read from
 * and, with --sub, the "### " parts under it. Filter by words to find the decisions on a topic without reading the
 * whole file (about 4,000 lines):
 *
 *   node scripts/decisions-index.mjs                 every decision
 *   node scripts/decisions-index.mjs email address   decisions whose heading or text mention every word
 *   node scripts/decisions-index.mjs --sub billing   with their "### " parts
 *   node scripts/decisions-index.mjs --file docs/PROGRESS.md retention   the same for another dated log
 *
 * Nothing is written to disk: a committed index would conflict every time two branches add a decision.
 * Then read just the matching range, e.g. with `sed -n '3838,3860p' docs/DECISIONS.md`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Split a markdown log into its "## " sections: heading, first line, last line, body, and its "### " parts. */
export function sections(text) {
  const lines = text.split("\n");
  const out = [];
  let current = null;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      if (current) current.end = i;
      current = { title: line.slice(3).trim(), start: i + 1, end: lines.length, subs: [], body: [] };
      out.push(current);
      return;
    }
    if (!current) return;
    if (!inFence && line.startsWith("### ")) current.subs.push({ title: line.slice(4).trim(), line: i + 1 });
    current.body.push(line);
  });
  return out;
}

/** The sections whose heading or text contains every word (case-insensitive). No words: every section. */
export function filter(all, words) {
  const ws = words.map((w) => w.toLowerCase());
  if (ws.length === 0) return all;
  return all.filter((s) => {
    const hay = `${s.title}\n${s.body.join("\n")}`.toLowerCase();
    return ws.every((w) => hay.includes(w));
  });
}

export function render(list, { sub = false } = {}) {
  const rows = [];
  for (const s of list) {
    rows.push(`${String(s.start).padStart(5)}–${String(s.end).padEnd(5)} ${s.title}`);
    if (sub) for (const p of s.subs) rows.push(`${String(p.line).padStart(13)}   · ${p.title}`);
  }
  return rows.join("\n");
}

function main(argv) {
  const args = [...argv];
  const sub = args.includes("--sub");
  const fileAt = args.indexOf("--file");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = fileAt >= 0 ? args[fileAt + 1] : "docs/DECISIONS.md";
  const words = args.filter((a, i) => !a.startsWith("--") && !(fileAt >= 0 && i === fileAt + 1));
  const all = sections(readFileSync(resolve(root, file), "utf8"));
  const hits = filter(all, words);
  process.stdout.write(`${render(hits, { sub })}\n`);
  process.stderr.write(`${hits.length} of ${all.length} sections in ${file}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
