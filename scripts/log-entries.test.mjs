// Run: node --test scripts/log-entries.test.mjs
// Every file under docs/log/ is one change's entry (WP-01 T6; docs/log/README.md): front matter with date, branch,
// title and areas; the date is the file name's and the folder's month; the three sections; no line over 400 characters.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const entries = walk(join(root, "docs/log")).filter((f) => f.endsWith(".md") && !f.endsWith("README.md"));

test("there is at least one entry", () => assert.ok(entries.length >= 1));

for (const file of entries) {
  const rel = relative(root, file);
  test(`${rel} has the entry's shape`, () => {
    const text = readFileSync(file, "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, "front matter between --- lines at the top");
    const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1])?.[1]?.trim();
    for (const k of ["date", "branch", "title", "areas"]) assert.ok(field(k), `front matter has ${k}`);
    const date = field("date");
    assert.match(rel, new RegExp(`^docs/log/${date.slice(0, 7)}/${date}-[a-z0-9.-]+\\.md$`), "file name and folder follow the date");
    for (const h of ["## What changed", "## Decisions", "## Not done"]) assert.ok(text.includes(`\n${h}\n`), `has "${h}"`);
    for (const [i, line] of text.split("\n").entries()) assert.ok(line.length <= 400, `line ${i + 1} is ${line.length} characters`);
  });
}
