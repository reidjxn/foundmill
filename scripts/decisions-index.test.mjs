import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sections, filter, render } from "./decisions-index.mjs";

const sample = [
  "# DECISIONS.md",
  "",
  "## 2026-10-05 — Model ids",
  "Model ids live in routing.ts.",
  "### Why",
  "One place to change.",
  "```",
  "## not a heading inside a fence",
  "```",
  "## 2026-11-13 — The Terms",
  "The postal address is set.",
].join("\n");

test("splits on level-two headings, ignores fenced code, keeps line ranges and parts", () => {
  const s = sections(sample);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].title, s[0].start, s[0].end], ["2026-10-05 — Model ids", 3, 9]);
  assert.deepEqual(s[0].subs, [{ title: "Why", line: 5 }]);
  assert.equal(s[1].start, 10);
});

test("filters on every word, in the heading or the text, ignoring case", () => {
  const s = sections(sample);
  assert.deepEqual(filter(s, ["POSTAL"]).map((x) => x.title), ["2026-11-13 — The Terms"]);
  assert.deepEqual(filter(s, ["model", "postal"]), []);
  assert.equal(filter(s, []).length, 2);
});

test("renders one line per section and the parts on request", () => {
  const s = sections(sample);
  assert.match(render(s), /^ {4}3–9 {5}2026-10-05 — Model ids$/m);
  assert.match(render(s, { sub: true }), /· Why/);
});

test("indexes the real DECISIONS.md", () => {
  const s = sections(readFileSync(new URL("../docs/DECISIONS.md", import.meta.url), "utf8"));
  assert.ok(s.length > 100);
  for (const x of s) assert.ok(x.end >= x.start);
});
