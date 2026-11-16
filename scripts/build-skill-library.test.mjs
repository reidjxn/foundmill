import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADER, categoriesFrom, renderCatalog } from "./build-skill-library.mjs";

const CATEGORIES = ["product", "finance"];

const skill = (over = {}, body = "# Pricing analysis\n\n1. State the decision.") => {
  const f = {
    key: "pricing_analysis",
    name: "Pricing analysis",
    description: "Compares pricing options.",
    category: "finance",
    attribute_name: "Pricing judgment",
    attribute_group: "judgement # us-english-allow",
    version: "1",
    ...over,
  };
  const lines = Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
};

/** A temporary skills folder from { "finance/pricing_analysis.md": text }; returns its path and a cleanup. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const refuses = (files, reason) => {
  const f = fixture(files);
  try {
    assert.throws(() => renderCatalog(f.dir, CATEGORIES), reason);
  } finally {
    f.done();
  }
};

test("renders the header, the fields and the body, in category order then key, and strips the allow marker", () => {
  const f = fixture({
    "finance/pricing_analysis.md": skill(),
    "finance/month_end_close.md": skill({ key: "month_end_close", name: "Month-end close", version: "2" }, "# Month-end close"),
    "product/release_notes.md": skill({ key: "release_notes", name: "Release notes", category: "product" }, "# Release notes"),
    "README.md": "Not a skill.\n",
  });
  try {
    const out = renderCatalog(f.dir, CATEGORIES);
    assert.ok(out.startsWith(`${HEADER}\n`));
    const keys = [...out.matchAll(/^ {4}key: "([a-z_]+)",$/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ["release_notes", "month_end_close", "pricing_analysis"]);
    assert.match(out, /attribute: \{ name: "Pricing judgment", group: "judgement" \},/);
    assert.match(out, /version: 2,/);
    assert.match(out, /instructionsMd: "# Pricing analysis\\n\\n1. State the decision.",/);
    assert.equal(renderCatalog(f.dir, CATEGORIES), out);
  } finally {
    f.done();
  }
});

test("refuses a file whose folder is not its category", () => {
  refuses({ "product/pricing_analysis.md": skill() }, /category finance is not its folder product/);
});

test("refuses an unknown category", () => {
  refuses({ "design/pricing_analysis.md": skill({ category: "design" }) }, /unknown category design/);
});

test("refuses a file not named after its key", () => {
  refuses({ "finance/pricing.md": skill() }, /file name is not pricing_analysis\.md/);
});

test("refuses a repeated key", () => {
  refuses(
    { "finance/pricing_analysis.md": skill(), "product/pricing_analysis.md": skill({ category: "product" }) },
    /key pricing_analysis repeats/,
  );
});

test("refuses a missing field", () => {
  refuses({ "finance/pricing_analysis.md": skill({ attribute_name: undefined }) }, /missing field attribute_name/);
});

test("refuses CRLF", () => {
  refuses({ "finance/pricing_analysis.md": skill().replace(/\n/g, "\r\n") }, /CRLF/);
});

test("refuses a front matter line that is not key: value", () => {
  refuses({ "finance/pricing_analysis.md": skill().replace("version: 1", "version: 1\n# a comment") }, /not `key: value`/);
  refuses({ "finance/pricing_analysis.md": skill().replace("version: 1", "version: 1\nroles:\n  - finance_lead") }, /not `key: value`/);
});

test("refuses a version that is not a whole number, and an unclosed front matter", () => {
  refuses({ "finance/pricing_analysis.md": skill({ version: "two" }) }, /version is not a whole number/);
  refuses({ "finance/pricing_analysis.md": "---\nkey: pricing_analysis\n# body" }, /not closed/);
});

test("reads the categories from the library's types file", () => {
  const c = categoriesFrom();
  assert.ok(c.includes("product") && c.includes("operations"));
});
