/**
 * Import a plan: the file parser and the Markdown-to-Tiptap conversion (packages/agents plan-import.ts). Good files,
 * every error case (each naming its line), the limits, and the Markdown subset.
 */
import { describe, expect, it } from "vitest";
import { PLAN_IMPORT_LIMITS, ParsedPlan, PlanDoc, inlineMarkdown, inlinePlain, markdownToPlanBlocks, markdownToPlanDoc, northStarLabel, parsePlanFile, roadmapItemDescription, type NumberedLine, type PlanImportError } from "../plan-import";

const VISION = `# Vision
## Statement
Every independent skincare brand runs its *refills* without a spreadsheet.
## For whom
Founders of small skincare brands
selling online.
## Problem
Refill orders are tracked by hand.
## Why now
Refill programs grew fast this year.
## Principles
- **Customers first**: every change starts with a customer.
- **Small steps:** ship weekly,
  and measure each step.
## North star
- Metric: Monthly refill orders
- Definition: Refill orders paid in a calendar month.
- Target: 400 refill orders by Mar 2027
`;

const SPEC = `# Specification
## Problem
Refills are *tracked* by hand in a **shared sheet**.

### What breaks
- Missed orders
- Double charges
## Pricing plans
1. Starter at $29 a month
2. Growth at $79 a month
`;

const ROADMAP = `# Roadmap
## Now
### Refill reminders
Send a reminder before a refill is due.

It uses the customer's own schedule.
Acceptance:
- A reminder goes out 3 days before the refill date
- The customer can skip a refill
### Skip a month
Customers skip one refill.
## Later
### Annual billing
`;

const FULL = `${VISION}\n${SPEC}\n${ROADMAP}`;

function parse(text: string) {
  const r = parsePlanFile(text);
  if (!r.ok) throw new Error(`expected a good file, got ${JSON.stringify(r.errors)}`);
  return r.plan;
}
function errorsOf(text: string): PlanImportError[] {
  const r = parsePlanFile(text);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}
const lines = (text: string, from = 1): NumberedLine[] => text.split("\n").map((t, i) => ({ n: from + i, text: t }));

describe("parsePlanFile: good files", () => {
  it("reads all three parts", () => {
    const plan = parse(FULL);
    expect(ParsedPlan.safeParse(plan).success).toBe(true);
    expect(plan.parts).toEqual({ vision: true, specification: true, roadmap: true });
    expect(plan.vision).toEqual({
      statement: "Every independent skincare brand runs its refills without a spreadsheet.",
      forWhom: "Founders of small skincare brands selling online.",
      problem: "Refill orders are tracked by hand.",
      whyNow: "Refill programs grew fast this year.",
      principles: [
        { title: "Customers first", detail: "every change starts with a customer." },
        { title: "Small steps", detail: "ship weekly, and measure each step." },
      ],
      northStar: { metric: "Monthly refill orders", definition: "Refill orders paid in a calendar month.", target: "400 refill orders by Mar 2027", label: "Estimate" },
    });
    expect(plan.sections.map((s) => [s.name, s.line])).toEqual([
      ["Problem", 21],
      ["Pricing plans", 27],
    ]);
    expect(plan.roadmap.map((i) => [i.horizon, i.title, i.line])).toEqual([
      ["now", "Refill reminders", 33],
      ["now", "Skip a month", 40],
      ["later", "Annual billing", 43],
    ]);
    const [reminders, skip, annual] = plan.roadmap;
    expect(reminders!.descriptionMd).toBe("Send a reminder before a refill is due.\n\nIt uses the customer's own schedule.");
    expect(reminders!.acceptance).toEqual(["A reminder goes out 3 days before the refill date", "The customer can skip a refill"]);
    expect(skip!.acceptance).toEqual([]);
    expect(annual!.descriptionMd).toBe("");
  });

  it("opens each section's document with a level-2 heading carrying its name", () => {
    const plan = parse(SPEC);
    const doc = plan.sections[0]!.content;
    expect(PlanDoc.safeParse(doc).success).toBe(true);
    expect(doc.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Problem" }] });
    expect(doc.content.slice(1)).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Refills are " }, { type: "text", text: "tracked", marks: [{ type: "italic" }] }, { type: "text", text: " by hand in a " }, { type: "text", text: "shared sheet", marks: [{ type: "bold" }] }, { type: "text", text: "." }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "What breaks" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Missed orders" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Double charges" }] }] }] },
    ]);
    expect(plan.sections[1]!.content.content[1]).toMatchObject({ type: "orderedList", content: [{ type: "listItem" }, { type: "listItem" }] });
    expect(plan.sections[1]!.content.content[1]).not.toHaveProperty("attrs");
  });

  it("takes any one part on its own", () => {
    expect(parse(SPEC)).toMatchObject({ vision: null, roadmap: [], parts: { vision: false, specification: true, roadmap: false } });
    expect(parse(VISION)).toMatchObject({ sections: [], roadmap: [], parts: { vision: true, specification: false, roadmap: false } });
    expect(parse(ROADMAP).roadmap).toHaveLength(3);
  });

  it("accepts Windows line endings, a byte-order mark, part names in any case and bold acceptance labels", () => {
    const text = `﻿# SPECIFICATION\r\n## Risks\r\nSupply.\r\n# roadmap\r\n## next\r\n### Second supplier\r\n**Acceptance criteria:**\r\n1. Two suppliers quote\r\n`;
    const plan = parse(text);
    expect(plan.sections[0]!.name).toBe("Risks");
    expect(plan.roadmap[0]).toMatchObject({ horizon: "next", title: "Second supplier", descriptionMd: "", acceptance: ["Two suppliers quote"] });
  });

  it("labels the north star Estimate unless the target says Forecast or Estimate", () => {
    expect(northStarLabel("400 orders by March")).toBe("Estimate");
    expect(northStarLabel("400 orders by March (Forecast)")).toBe("Forecast");
    expect(northStarLabel("about 400 orders, estimated")).toBe("Estimate");
    expect(parse(VISION.replace("by Mar 2027", "by Mar 2027 (Forecast)")).vision!.northStar.label).toBe("Forecast");
    // A bold key is read too.
    expect(parse(VISION.replace("- Metric:", "- **Metric**:")).vision!.northStar.metric).toBe("Monthly refill orders");
  });

  it("stores acceptance criteria under the description as an Acceptance: list", () => {
    expect(roadmapItemDescription({ descriptionMd: "Send reminders.", acceptance: ["One", "Two"] })).toBe("Send reminders.\n\nAcceptance:\n- One\n- Two");
    expect(roadmapItemDescription({ descriptionMd: "", acceptance: ["One"] })).toBe("Acceptance:\n- One");
    expect(roadmapItemDescription({ descriptionMd: "Only words.", acceptance: [] })).toBe("Only words.");
  });

  it("keeps a roadmap item's own Markdown (#### headings, lists) as written", () => {
    const plan = parse(`# Roadmap\n## Now\n### Billing\n#### Why\n- **Fast** checkout\n\nMore.\n`);
    expect(plan.roadmap[0]!.descriptionMd).toBe("#### Why\n- **Fast** checkout\n\nMore.");
  });
});

describe("parsePlanFile: errors name the line", () => {
  it("refuses an empty file and a file with no part", () => {
    expect(errorsOf("")).toEqual([{ line: null, message: "The file is empty." }]);
    expect(errorsOf("  \n\n")).toEqual([{ line: null, message: "The file is empty." }]);
    expect(errorsOf("Just some notes\n")).toEqual([{ line: 1, message: expect.stringContaining("starts with # Vision") }]);
  });

  it("refuses an unknown top-level heading, naming it and its line", () => {
    expect(errorsOf(`${SPEC}# Appendix\nNotes\n`)).toEqual([{ line: 11, message: '"# Appendix" is not a part of a plan file. Use # Vision, # Specification or # Roadmap.' }]);
  });

  it("refuses text before the first part, parts out of order and a part twice", () => {
    expect(errorsOf(`Title\n${SPEC}`)[0]).toEqual({ line: 1, message: expect.stringContaining("starts with") });
    expect(errorsOf(`${ROADMAP}${SPEC}`)).toEqual([{ line: 14, message: "The parts must come in this order: # Vision, # Specification, # Roadmap." }]);
    expect(errorsOf(`${SPEC}# Specification\n## Other\nText\n`)).toEqual([{ line: 11, message: "# Specification appears twice (first on line 1)." }]);
  });

  it("checks the vision's parts", () => {
    expect(errorsOf(VISION.replace("## Why now\nRefill programs grew fast this year.\n", ""))).toEqual([{ line: 1, message: "The vision is missing ## Why now." }]);
    expect(errorsOf(VISION.replace("## Problem", "## Market"))).toEqual(
      expect.arrayContaining([
        { line: 7, message: expect.stringContaining('"## Market" is not part of the vision') },
        { line: 1, message: "The vision is missing ## Problem." },
      ]),
    );
    expect(errorsOf(VISION.replace("## Statement\n", "Loose text\n## Statement\n"))[0]).toEqual({ line: 2, message: expect.stringContaining("Put this text under one of ## Statement") });
    expect(errorsOf(VISION.replace("Refill orders are tracked by hand.", ""))).toEqual([{ line: 7, message: "## Problem has no text." }]);
    expect(errorsOf(VISION.replace("Refill programs grew fast this year.", "x".repeat(PLAN_IMPORT_LIMITS.visionField + 1)))).toEqual([{ line: 9, message: `## Why now is ${PLAN_IMPORT_LIMITS.visionField + 1} characters long; keep it to ${PLAN_IMPORT_LIMITS.visionField}.` }]);
  });

  it("checks principles and the north star", () => {
    expect(errorsOf(VISION.replace("- **Customers first**: every change starts with a customer.", "- Customers first: every change"))).toEqual([{ line: 12, message: "Write each principle as - **Title**: what it means." }]);
    expect(errorsOf(VISION.replace("- **Customers first**: every change starts with a customer.", "- **Customers first**:"))).toEqual([{ line: 12, message: 'The principle "Customers first" has no detail after the colon.' }]);
    const noPrinciples = VISION.replace(/- \*\*Customers first[\s\S]*?each step\.\n/, "");
    expect(errorsOf(noPrinciples)).toEqual([{ line: 11, message: expect.stringContaining("## Principles has no principles") }]);
    expect(errorsOf(VISION.replace("- Target: 400 refill orders by Mar 2027\n", ""))).toEqual([{ line: 15, message: "The north star is missing - Target:." }]);
    expect(errorsOf(VISION.replace("- Definition:", "- Goal:"))).toEqual(expect.arrayContaining([{ line: 17, message: expect.stringContaining("three lines") }]));
  });

  it("checks specification sections", () => {
    expect(errorsOf("# Specification\nIntro\n## Problem\nText\n")).toEqual([{ line: 2, message: "Put this text under a section heading (## Section name)." }]);
    expect(errorsOf("# Specification\n\n")).toEqual([{ line: 1, message: expect.stringContaining("has no sections") }]);
    expect(errorsOf("# Specification\n## Problem\n\n## Pricing\nText\n")).toEqual([{ line: 2, message: 'The section "Problem" has no text.' }]);
    expect(errorsOf("# Specification\n## Problem\nA\n## problem!\nB\n")).toEqual([{ line: 4, message: 'The section "problem!" appears twice (first on line 2).' }]);
    expect(errorsOf("# Specification\n## ???\nA\n")).toEqual([{ line: 2, message: "This section has no name. Write it as ## Section name." }]);
    expect(errorsOf(`# Specification\n## ${"N".repeat(81)}\nA\n`)[0]).toEqual({ line: 2, message: expect.stringContaining("keep it to 80") });
    expect(errorsOf("# Specification\n## Problem\n##### Deep\n")[0]).toEqual({ line: 3, message: "Use ### or #### for headings inside a section (this one has 5 #)." });
    expect(errorsOf("# Specification\n## Problem\n```\n# not a part\n```\n")).toEqual([{ line: 3, message: expect.stringContaining("Code blocks are not supported") }]);
  });

  it("checks the roadmap", () => {
    expect(errorsOf("# Roadmap\n### Loose item\n")).toEqual(expect.arrayContaining([{ line: 2, message: "Put roadmap items under ## Now, ## Next or ## Later." }]));
    expect(errorsOf("# Roadmap\n## Soon\n### Item\n")).toEqual([{ line: 2, message: '"## Soon" is not a roadmap horizon. Use ## Now, ## Next or ## Later.' }]);
    expect(errorsOf("# Roadmap\n## Now\n### A\n## Now\n### B\n")).toEqual([{ line: 4, message: "## Now appears twice in the roadmap (first on line 2)." }]);
    expect(errorsOf("# Roadmap\n## Now\nText first\n### A\n")).toEqual([{ line: 3, message: "Start each roadmap item with ### Item title." }]);
    expect(errorsOf("# Roadmap\n## Now\n")).toEqual([{ line: 1, message: expect.stringContaining("has no items") }]);
    expect(errorsOf(`# Roadmap\n## Now\n### ${"T".repeat(201)}\n`)[0]).toEqual({ line: 3, message: expect.stringContaining("keep it to 200") });
    expect(errorsOf("# Roadmap\n## Now\n### A\nAcceptance:\nnot a bullet\n")).toEqual([{ line: 5, message: 'List each acceptance criterion of "A" as - criterion.' }]);
    expect(errorsOf("# Roadmap\n## Now\n### A\nAcceptance:\n\n")).toEqual([{ line: 4, message: '"A" says Acceptance: but lists no criteria.' }]);
    const thirteen = Array.from({ length: 13 }, (_, i) => `- c${i}`).join("\n");
    expect(errorsOf(`# Roadmap\n## Now\n### A\nAcceptance:\n${thirteen}\n`)).toEqual([{ line: 4, message: '"A" has 13 acceptance criteria; keep it to 12.' }]);
  });

  it("enforces the limits: 30 sections, 40 items, 64 KB a section, 256 KB a file", () => {
    const sections = Array.from({ length: 31 }, (_, i) => `## Section ${i}\nText ${i}`).join("\n");
    expect(errorsOf(`# Specification\n${sections}\n`)).toEqual([{ line: 62, message: "The specification has 31 sections; a plan file holds at most 30." }]);
    const items = Array.from({ length: 41 }, (_, i) => `### Item ${i}`).join("\n");
    expect(errorsOf(`# Roadmap\n## Next\n${items}\n`)).toEqual([{ line: 43, message: "The roadmap has 41 items; a plan file holds at most 40." }]);
    expect(errorsOf(`# Specification\n## Big\n${"word ".repeat(14_000)}\n`)).toEqual([{ line: 2, message: 'The section "Big" is larger than 64 KB. Split it into two sections.' }]);
    // Bytes, not characters: 100,000 three-byte characters are 300,000 bytes.
    expect(errorsOf(`# Specification\n## Big\n${"€".repeat(100_000)}\n`)).toEqual([{ line: null, message: expect.stringContaining("larger than 256 KB") }]);
  });

  it("reports at most 20 errors", () => {
    const bad = Array.from({ length: 30 }, (_, i) => `# Part ${i}`).join("\n");
    expect(errorsOf(bad)).toHaveLength(PLAN_IMPORT_LIMITS.errors);
  });
});

describe("Markdown to Tiptap", () => {
  it("bold, italic, both, and code", () => {
    expect(inlineMarkdown("a **b** c")).toEqual([{ type: "text", text: "a " }, { type: "text", text: "b", marks: [{ type: "bold" }] }, { type: "text", text: " c" }]);
    expect(inlineMarkdown("*i*")).toEqual([{ type: "text", text: "i", marks: [{ type: "italic" }] }]);
    expect(inlineMarkdown("***both***")).toEqual([{ type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] }]);
    expect(inlineMarkdown("**bold *and italic***")).toEqual([{ type: "text", text: "bold ", marks: [{ type: "bold" }] }, { type: "text", text: "and italic", marks: [{ type: "bold" }, { type: "italic" }] }]);
    expect(inlineMarkdown("run `pnpm **dev**` now")).toEqual([{ type: "text", text: "run " }, { type: "text", text: "pnpm **dev**", marks: [{ type: "code" }] }, { type: "text", text: " now" }]);
    // Code inside bold carries the code mark alone (the editor's code mark excludes the others).
    expect(inlineMarkdown("**use `x` here**")).toEqual([{ type: "text", text: "use ", marks: [{ type: "bold" }] }, { type: "text", text: "x", marks: [{ type: "code" }] }, { type: "text", text: " here", marks: [{ type: "bold" }] }]);
  });

  it("leaves unpaired markers, spaced asterisks and escapes as text", () => {
    expect(inlineMarkdown("2 * 3 * 4")).toEqual([{ type: "text", text: "2 * 3 * 4" }]);
    expect(inlineMarkdown("**open only")).toEqual([{ type: "text", text: "**open only" }]);
    expect(inlineMarkdown("\\*not italic\\*")).toEqual([{ type: "text", text: "*not italic*" }]);
    expect(inlineMarkdown("a ` lone tick")).toEqual([{ type: "text", text: "a ` lone tick" }]);
    expect(inlineMarkdown("  spaced \t out  ")).toEqual([{ type: "text", text: "spaced out" }]);
    expect(inlineMarkdown("")).toEqual([]);
    expect(inlinePlain("**Bold** and *it*")).toBe("Bold and it");
  });

  it("paragraphs join their lines; blank lines separate blocks; rules are dropped", () => {
    const errors: PlanImportError[] = [];
    expect(markdownToPlanBlocks(lines("one\ntwo\n\n---\n\nthree"), errors)).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "one two" }] },
      { type: "paragraph", content: [{ type: "text", text: "three" }] },
    ]);
    expect(errors).toEqual([]);
  });

  it("headings ### and ####; a list right after a paragraph; loose and continued items; numbered lists keep their start", () => {
    const errors: PlanImportError[] = [];
    const blocks = markdownToPlanBlocks(lines("### Three\n#### Four\nIntro\n- a\n  continued\n\n- b\n  - nested\n3. third\n4. fourth"), errors);
    expect(errors).toEqual([]);
    expect(blocks).toEqual([
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Three" }] },
      { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Four" }] },
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      {
        type: "bulletList",
        content: ["a continued", "b", "nested"].map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })),
      },
      { type: "orderedList", attrs: { start: 3 }, content: ["third", "fourth"].map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })) },
    ]);
  });

  it("a section document validates against the schema and opens with the section name", () => {
    const errors: PlanImportError[] = [];
    const doc = markdownToPlanDoc("Pricing", lines("Plans:\n1. **Starter** at `$29`\n2. *Growth*"), errors);
    expect(errors).toEqual([]);
    expect(PlanDoc.safeParse(doc).success).toBe(true);
    expect(doc.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Pricing" }] });
  });

  it("reports heading levels and code fences against the file's line numbers", () => {
    const errors: PlanImportError[] = [];
    markdownToPlanBlocks(lines("Text\n## Two\n```\n## inside\n```\n###\n", 40), errors);
    expect(errors).toEqual([
      { line: 41, message: "Use ### or #### for headings inside a section (this one has 2 #)." },
      { line: 42, message: expect.stringContaining("Code blocks are not supported") },
    ]);
  });
});
