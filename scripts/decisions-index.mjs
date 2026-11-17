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
 *   node scripts/decisions-index.mjs --since 2026-11-15 --area ci   entries under docs/log/ only, by date or area
 *
 * docs/DECISIONS.md and docs/PROGRESS.md are frozen (Nov 15, 2026, WP-01 T6): every change since adds one file under
 * docs/log/ (the `log-entry` skill). With no --file the index reads the frozen DECISIONS.md, then every docs/log file,
 * oldest first, so the two read as one log at query time; nothing folds the files back.
 *
 * Nothing is written to disk: a committed index would conflict every time two branches add a decision.
 * Then read just the matching range, e.g. with `sed -n '3838,3860p' docs/DECISIONS.md`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? listFiles(join(dir, f)) : [join(dir, f)])) : []);

/** One section per log file under `dir` (README.md aside): `<date> — <title>`, its path, its "### " parts and areas. */
export function fragments(dir) {
  return listFiles(dir)
    .filter((f) => f.endsWith(".md") && !f.endsWith("README.md"))
    .sort()
    .map((f) => {
      const text = readFileSync(f, "utf8");
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
      const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim() ?? "";
      const lines = text.split("\n");
      const subs = lines.flatMap((line, i) => (line.startsWith("### ") ? [{ title: line.slice(4).trim(), line: i + 1 }] : []));
      const areas = field("areas").replace(/^\[|\]$/g, "").split(",").map((a) => a.trim()).filter(Boolean);
      return { title: `${field("date")} — ${field("title")}`, date: field("date"), areas, file: relative(ROOT, f), start: 1, end: lines.length, subs, body: lines };
    });
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
    rows.push(s.file ? `${s.file}  ${s.title}` : `${String(s.start).padStart(5)}–${String(s.end).padEnd(5)} ${s.title}`);
    if (sub) for (const p of s.subs) rows.push(`${String(p.line).padStart(13)}   · ${p.title}`);
  }
  return rows.join("\n");
}

function main(argv) {
  const args = [...argv];
  const sub = args.includes("--sub");
  const fileAt = args.indexOf("--file");
  const valueOf = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined);
  const since = valueOf("--since");
  const area = valueOf("--area");
  const file = fileAt >= 0 ? args[fileAt + 1] : "docs/DECISIONS.md";
  const flagValues = new Set(["--file", "--since", "--area"].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const words = args.filter((a, i) => !a.startsWith("--") && !flagValues.has(i));
  const frozen = since || area ? [] : sections(readFileSync(resolve(ROOT, file), "utf8"));
  const logs = fileAt >= 0 ? [] : fragments(join(ROOT, "docs/log")).filter((f) => (!since || f.date >= since) && (!area || f.areas.includes(area)));
  const all = [...frozen, ...logs];
  const hits = filter(all, words);
  process.stdout.write(`${render(hits, { sub })}\n`);
  process.stderr.write(`${hits.length} of ${all.length} sections in ${fileAt >= 0 ? file : `${file} and docs/log/`}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
