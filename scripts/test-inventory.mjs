#!/usr/bin/env node
// What never runs, and what passed only on retry (WP-01 T7; audit a10 EH-14 and §1.4).
//   node scripts/test-inventory.mjs --skips              counts conditional skips by reason; exits 1 on an unconditional
//                                                        skip, .only, .fixme or .todo
//   node scripts/test-inventory.mjs --flaky <report.json>...   lists every Playwright test whose final status is flaky
// Both write Markdown to the file named by GITHUB_STEP_SUMMARY when it is set, else to stdout. Missing reports are skipped.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REASONS = [
  ["Live model needed", /^!?\s*live\b/],
  ["Vendor keys needed", /envKeysPresent|_TEST_|TEST_LIVE|GITHUB_TEST_REPO/],
  ["Real Postgres, pooler or Redis needed", /\b(DIRECT|POOLER|url|onPostgres|base|REDIS)\b/],
];
const CONDITIONAL = /\.(skipIf|runIf)\(([^)]*)\)|\b(?:test|it|describe)\.skip\(\s*([^"'`)\s][^,)]*)/g;
const UNCONDITIONAL = /\b(?:test|it|describe)\.skip\(\s*(?:["'`]|\))|\b(?:test|it|describe)\.(?:only|fixme|todo)\(/;

/** Lines are `{ file, text }`. Returns the counts per reason and every refused line. */
export function classifySkips(lines) {
  const counts = Object.fromEntries([...REASONS.map(([r]) => [r, 0]), ["Seed or stack state", 0]]);
  const banned = [];
  for (const { file, text } of lines) {
    if (UNCONDITIONAL.test(text)) {
      banned.push({ file, text: text.trim() });
      continue;
    }
    for (const m of text.matchAll(CONDITIONAL)) {
      const condition = (m[2] ?? m[3] ?? "").trim();
      const reason = REASONS.find(([, re]) => re.test(condition))?.[0] ?? "Seed or stack state";
      counts[reason] += 1;
    }
  }
  return { counts, banned };
}

/** Every spec of a Playwright JSON report whose test ended flaky (passed on a retry). */
export function flakyTests(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      if ((spec.tests ?? []).some((t) => t.status === "flaky")) out.push({ file: spec.file ?? suite.file, line: spec.line, title: spec.title });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

function write(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.warn(markdown);
}

function trackedLines() {
  const files = execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx", "*.spec.ts"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  return files.flatMap((file) =>
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .filter((text) => /\.(skip|skipIf|runIf|only|fixme|todo)\(/.test(text))
      .map((text) => ({ file, text })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--skips") {
    const { counts, banned } = classifySkips(trackedLines());
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    write(["### Skipped test sites by reason", "", "| Reason | Sites |", "| --- | --- |", ...Object.entries(counts).map(([r, n]) => `| ${r} | ${n} |`), `| Total | ${total} |`].join("\n"));
    if (banned.length) {
      write(["", "### Refused: an unconditional skip, .only, .fixme or .todo", "", ...banned.map((b) => `- \`${b.file}\`: \`${b.text.slice(0, 120)}\``)].join("\n"));
      process.exit(1);
    }
  } else if (args[0] === "--flaky") {
    const flaky = args
      .slice(1)
      .filter((f) => existsSync(f))
      .flatMap((f) => flakyTests(JSON.parse(readFileSync(f, "utf8"))));
    write(flaky.length ? ["### Passed only on retry", "", ...flaky.map((t) => `- \`${t.file}:${t.line}\` ${t.title}`)].join("\n") : "### Passed only on retry\n\n0 flaky");
  } else {
    console.error("usage: node scripts/test-inventory.mjs --skips | --flaky <report.json>...");
    process.exit(2);
  }
}
