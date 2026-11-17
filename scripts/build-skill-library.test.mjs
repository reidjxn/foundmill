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
    when_to_use: "Use when a project needs a first price.",
    roles: "finance_lead, product_lead",
    default_for: "finance_lead",
    stage: "idea, building, page_live",
    needs: "web_research, payments, search_console",
    adapted_from: "marketing-skills:pricing",
    license_note: "MIT, Copyright (c) 2025 Corey Haines",
    improves: "financial_modelling, prioritisation # us-english-allow",
    version: "1",
    ...over,
  };
  const lines = Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === "" ? `${k}:` : `${k}: ${v}`));
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
    assert.match(out, /whenToUse: "Use when a project needs a first price.",/);
    assert.match(out, /roles: \["finance_lead","product_lead"\],/);
    assert.match(out, /defaultFor: \["finance_lead"\],/);
    assert.match(out, /defaultSince: 1,/);
    assert.match(out, /improves: \["financial_modelling","prioritisation"\],/);
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

/** The one skill's entry in the rendered catalog, for the field-mapping tests. */
const entryFor = (over) => {
  const f = fixture({ "finance/pricing_analysis.md": skill(over) });
  try {
    return renderCatalog(f.dir, CATEGORIES);
  } finally {
    f.done();
  }
};

test("maps the authoring stages onto the product's stages, deduplicated and in the product's order", () => {
  assert.match(entryFor({}), /stages: \["drafting","awaiting_signoff","building","selling"\],/);
  assert.match(entryFor({ stage: "first_sale, growing, first_followers" }), /stages: \["selling"\],/);
  assert.match(entryFor({ stage: "building" }), /stages: \["building"\],/);
  refuses({ "finance/pricing_analysis.md": skill({ stage: "launch" }) }, /unknown stage launch/);
});

test("maps needs onto connectors (all better_with) and Search Console onto not yet on Foundmill", () => {
  const out = entryFor({});
  assert.match(out, /requires: \[\{ connectorKey: "web", mode: "better_with" \}, \{ connectorKey: "stripe", mode: "better_with" \}\],/);
  assert.match(out, /notYetOnFoundmill: \["Search Console"\],/);
  const none = entryFor({ needs: "none" });
  assert.match(none, /requires: \[\],/);
  assert.match(none, /notYetOnFoundmill: \[\],/);
  assert.match(entryFor({ needs: "page_publish, repo, analytics, email_send, social_publish" }), /requires: \[\{ connectorKey: "github".*"posthog".*"platform_mail".*"buffer".*\],/);
  refuses({ "finance/pricing_analysis.md": skill({ needs: "fax" }) }, /unknown need fax/);
});

test("maps adapted_from and license_note onto provenance", () => {
  assert.match(entryFor({}), /provenance: \{ origin: "adapted", sources: \["marketing-skills:pricing"\], license: "MIT", note: "MIT, Copyright \(c\) 2025 Corey Haines" \},/);
  assert.match(entryFor({ adapted_from: "original", license_note: "original" }), /provenance: \{ origin: "foundmill", sources: \[\], license: null, note: null \},/);
  assert.match(
    entryFor({ adapted_from: "original, after one person's public notes", license_note: "original" }),
    /provenance: \{ origin: "foundmill", sources: \[\], license: null, note: "after one person's public notes" \},/,
  );
  // Partly original, partly adapted: adapted, with the adapted source and the license named in the note.
  assert.match(
    entryFor({ adapted_from: "original, marketing-skills:churn-prevention", license_note: "original; the reason table is adapted under MIT, Copyright (c) 2025 Corey Haines" }),
    /origin: "adapted", sources: \["marketing-skills:churn-prevention"\], license: "MIT",/,
  );
  assert.match(entryFor({ license_note: "Apache-2.0, Anthropic; MIT, Copyright (c) 2026 Leonxlnx" }), /license: "Apache-2.0",/);
  refuses({ "finance/pricing_analysis.md": skill({ license_note: "original" }) }, /adapted skill names no license/);
  refuses({ "finance/pricing_analysis.md": skill({ adapted_from: "a blog post" }) }, /adapted_from is not/);
});

test("an empty default_for is no defaults; an empty roles or a missing improves is refused", () => {
  assert.match(entryFor({ default_for: "" }), /defaultFor: \[\],/);
  refuses({ "finance/pricing_analysis.md": skill({ roles: "" }) }, /missing field roles/);
  refuses({ "finance/pricing_analysis.md": skill({ improves: undefined }) }, /missing field improves/);
});

test("refuses a key outside 3 to 48 characters, a bad attribute group and a when_to_use that does not start with Use when", () => {
  refuses({ "finance/ab.md": skill({ key: "ab" }) }, /key is not 3 to 48/);
  refuses({ "finance/pricing_analysis.md": skill({ attribute_group: "taste" }) }, /attribute_group is not/);
  refuses({ "finance/pricing_analysis.md": skill({ when_to_use: "When pricing." }) }, /when_to_use does not start with "Use when"/);
});
