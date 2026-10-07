import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, escapeCsvCell, toCsv } from "./csv";
import {
  entityIdsIn,
  entityNodesToPlain,
  hasEntityMarkup,
  parseEntityText,
  stripEntityMarkup,
} from "./entityMarkup";
import {
  applyDecisions,
  buildHunks,
  diffLines,
  hunkHeader,
  splitLines,
  summariseDiff,
  threeWay,
} from "./diff";
import { describeFilter, matchesAllFilters, matchesFilter, type FilterField } from "./filters";
import { ENTITY_IDS, SPEC_BASE, SPEC_ORIGINAL, SPEC_PROPOSED } from "./fixtures";

describe("csv", () => {
  it("quotes delimiters, quotes and newlines and doubles quotes", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("two\nlines")).toBe('"two\nlines"');
    expect(escapeCsvCell("a;b", ";")).toBe('"a;b"');
  });
  it("neutralises spreadsheet formulas", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
  });
  it("formats cells: dates ISO, money as major units, null empty, objects JSON", () => {
    expect(csvCell(new Date("2026-10-07T09:30:00Z"))).toBe("2026-10-07T09:30:00.000Z");
    expect(csvCell({ amountMinor: 184000, currency: "EUR" })).toBe("1840.00 EUR");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell({ a: 1 })).toBe('"a":1'.length > 0 ? '{"a":1}' : "");
  });
  it("builds a header row and one line per row with CRLF", () => {
    const csv = toCsv(
      [
        { header: "Name", value: (r: { n: string; v: number }) => r.n },
        { header: "Value, EUR", value: (r: { n: string; v: number }) => r.v },
      ],
      [
        { n: "Sara", v: 1 },
        { n: "Tomas, Jr", v: 2 },
      ],
    );
    expect(csv).toBe('Name,"Value, EUR"\r\nSara,1\r\n"Tomas, Jr",2\r\n');
    expect(toCsv([], [], { bom: true }).charCodeAt(0)).toBe(0xfeff);
  });
  it("makes safe file names", () => {
    expect(csvFileName("Hot this week")).toBe("Hot-this-week.csv");
    expect(csvFileName("leads.csv")).toBe("leads.csv");
    expect(csvFileName("   ")).toBe("export.csv");
    expect(csvFileName("Scout's pipeline / Q4")).toBe("Scout-s-pipeline-Q4.csv");
  });
});

describe("entityMarkup", () => {
  const text = `Call [[ent:${ENTITY_IDS.sara}|Sara]] at [[ent:${ENTITY_IDS.nordic}|Nordic Beauty]] today.`;
  it("parses mentions into entity nodes and merges text", () => {
    const nodes = parseEntityText(text);
    expect(nodes.map((n) => n.type)).toEqual(["text", "entity", "text", "entity", "text"]);
    expect(nodes[1]).toMatchObject({ type: "entity", id: ENTITY_IDS.sara, display: "Sara" });
    expect(entityNodesToPlain(nodes)).toBe("Call Sara at Nordic Beauty today.");
    expect(entityIdsIn(nodes)).toEqual([ENTITY_IDS.sara, ENTITY_IDS.nordic]);
    expect(stripEntityMarkup(text)).toBe("Call Sara at Nordic Beauty today.");
  });
  it("keeps malformed markup as plain text, never as a link", () => {
    const bad =
      "See [[ent:NOT-A-UUID|Sara]] and [[ent:0f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a40|unclosed";
    const nodes = parseEntityText(bad);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("text");
    expect(hasEntityMarkup(bad)).toBe(false);
    expect(hasEntityMarkup(text)).toBe(true);
  });
  it("uses hrefFor when given and dedupes ids", () => {
    const nodes = parseEntityText(`${text} [[ent:${ENTITY_IDS.sara}|her]]`, {
      hrefFor: (id) => `/crm/${id}`,
    });
    expect(nodes[1]).toMatchObject({ href: `/crm/${ENTITY_IDS.sara}` });
    expect(entityIdsIn(nodes)).toHaveLength(2);
  });
});

describe("diff", () => {
  const apply = (oldText: string, newText: string): string => {
    const ops = diffLines(oldText, newText);
    return ops
      .filter((o) => o.kind !== "delete")
      .map((o) => o.text)
      .join("\n");
  };
  it("produces an edit script that rebuilds the new text", () => {
    expect(apply(SPEC_ORIGINAL, SPEC_PROPOSED)).toBe(splitLines(SPEC_PROPOSED).join("\n"));
    expect(apply("a\nb\nc", "a\nc")).toBe("a\nc");
    expect(apply("", "x\ny")).toBe("x\ny");
    expect(apply("x\ny", "")).toBe("");
    expect(apply("same", "same")).toBe("same");
  });
  it("is minimal on a classic case and numbers lines on both sides", () => {
    const ops = diffLines(["a", "b", "c", "a", "b", "b", "a"], ["c", "b", "a", "b", "a", "c"]);
    const edits = ops.filter((o) => o.kind !== "equal").length;
    expect(edits).toBe(5); // Myers' paper example: D = 5
    const equal = ops.filter((o) => o.kind === "equal");
    expect(equal.every((o) => o.oldLine !== undefined && o.newLine !== undefined)).toBe(true);
    expect(ops.filter((o) => o.kind === "delete").every((o) => o.newLine === undefined)).toBe(true);
  });
  it("groups changes into hunks with context and unified headers", () => {
    const ops = diffLines(SPEC_ORIGINAL, SPEC_PROPOSED);
    const hunks = buildHunks(ops, 1);
    expect(hunks.length).toBe(2);
    expect(hunks[0]?.id).toBe("h0");
    expect(hunkHeader(hunks[0]!)).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    expect(hunks[0]?.removed).toBe(3);
    expect(hunks[0]?.added).toBe(4);
    expect(hunks[1]?.added).toBe(1);
    const far = buildHunks(
      diffLines("a\nb\nc\nd\ne\nf\ng\nh\ni\nj", "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ"),
      2,
    );
    expect(far).toHaveLength(2);
    expect(buildHunks(diffLines("x", "x"))).toEqual([]);
  });
  it("applies mixed accept / reject / edit decisions", () => {
    const ops = diffLines(SPEC_ORIGINAL, SPEC_PROPOSED);
    const hunks = buildHunks(ops, 1);
    const pending = applyDecisions(ops, hunks, {});
    expect(pending).toBe(splitLines(SPEC_ORIGINAL).join("\n"));
    const all = applyDecisions(ops, hunks, {
      h0: { decision: "accepted" },
      h1: { decision: "accepted" },
    });
    expect(all).toBe(splitLines(SPEC_PROPOSED).join("\n"));
    const mixed = applyDecisions(ops, hunks, {
      h0: { decision: "accepted" },
      h1: { decision: "rejected" },
    });
    expect(mixed).toContain("Retail price €42");
    expect(mixed).not.toContain("CPNP");
    const edited = applyDecisions(ops, hunks, {
      h0: { decision: "rejected" },
      h1: {
        decision: "edited",
        text: "Glass bottle with pump, recyclable carton.\nLabel printed in Sweden.\nCarton carries the CPNP number and a QR code.\n",
      },
    });
    expect(edited).toContain("Retail price €39");
    expect(edited).toContain("QR code");
    expect(summariseDiff(hunks, { h0: { decision: "accepted" } })).toMatchObject({
      hunks: 2,
      accepted: 1,
      pending: 1,
      added: 5,
      removed: 3,
    });
  });
  it("aligns three ways and flags only real conflicts", () => {
    const hunks = threeWay(SPEC_BASE, SPEC_ORIGINAL, SPEC_PROPOSED, 0);
    // ours changed the MOQ line (12 → 24); theirs changed prices, the discount, added a bundle and a CPNP line, and also set MOQ 24.
    expect(hunks).toHaveLength(2);
    const pricing = hunks.find((h) => h.rows.some((r) => r.base?.includes("Minimum order")));
    expect(pricing).toBeDefined();
    expect(pricing?.conflict).toBe(false); // both sides made the same change to the MOQ line
    expect(pricing?.theirsChanged).toBe(true);
    expect(pricing?.oursChanged).toBe(true);
    const moqRow = pricing?.rows.find((r) => r.base?.includes("Minimum order"));
    expect(moqRow).toMatchObject({ oursKind: "changed", theirsKind: "changed" });
    const cpnp = hunks.find((h) => h.rows.some((r) => r.theirs?.includes("CPNP")));
    expect(cpnp).toMatchObject({ conflict: false, oursChanged: false, theirsChanged: true });
    const conflict = threeWay("a\nb\nc", "a\nB1\nc", "a\nB2\nc", 0);
    expect(conflict).toHaveLength(1);
    expect(conflict[0]?.conflict).toBe(true);
    expect(conflict[0]?.rows[0]).toMatchObject({
      base: "b",
      ours: "B1",
      theirs: "B2",
      oursKind: "changed",
      theirsKind: "changed",
    });
    const inserted = threeWay("a\nb", "a\nb", "a\nx\nb", 0);
    expect(inserted[0]?.rows[0]).toMatchObject({
      theirs: "x",
      theirsKind: "added",
      oursKind: "equal",
    });
    const deleted = threeWay("a\nb\nc", "a\nc", "a\nb\nc", 0);
    expect(deleted[0]?.rows[0]).toMatchObject({
      base: "b",
      oursKind: "missing",
      theirsKind: "equal",
    });
  });
});

describe("filters", () => {
  const fields: FilterField[] = [
    { id: "name", label: "Name", kind: "text" },
    { id: "score", label: "Score", kind: "number" },
    {
      id: "stage",
      label: "Stage",
      kind: "select",
      options: [
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
      ],
    },
    { id: "when", label: "Last contact", kind: "date" },
    { id: "replied", label: "Replied", kind: "boolean" },
  ];
  it("matches text, number, select, date and boolean operators", () => {
    expect(matchesFilter("Sara Lindqvist", { op: "contains", value: "lind" })).toBe(true);
    expect(matchesFilter("Sara", { op: "not_contains", value: "x" })).toBe(true);
    expect(matchesFilter("Sara", { op: "eq", value: "sara" })).toBe(true);
    expect(matchesFilter("", { op: "is_empty" })).toBe(true);
    expect(matchesFilter(null, { op: "not_empty" })).toBe(false);
    expect(matchesFilter(14, { op: "gte", value: 14 }, "number")).toBe(true);
    expect(matchesFilter(13, { op: "gte", value: 14 }, "number")).toBe(false);
    expect(matchesFilter(5, { op: "between", value: [1, 10] }, "number")).toBe(true);
    expect(
      matchesFilter({ amountMinor: 500, currency: "EUR" }, { op: "lt", value: 600 }, "number"),
    ).toBe(true);
    expect(matchesFilter("won", { op: "in", value: ["won", "lost"] }, "select")).toBe(true);
    expect(matchesFilter("new", { op: "in", value: ["won", "lost"] }, "select")).toBe(false);
    expect(matchesFilter("new", { op: "neq", value: "won" }, "select")).toBe(true);
    expect(
      matchesFilter(new Date("2026-10-07T23:00:00Z"), { op: "on", value: "2026-10-07" }, "date"),
    ).toBe(true);
    expect(matchesFilter("2026-10-01", { op: "before", value: "2026-10-07" }, "date")).toBe(true);
    expect(
      matchesFilter("2026-10-01", { op: "between", value: ["2026-09-01", "2026-10-01"] }, "date"),
    ).toBe(true);
    expect(matchesFilter(true, { op: "eq", value: "true" }, "boolean")).toBe(true);
    expect(matchesFilter(false, { op: "eq", value: true }, "boolean")).toBe(false);
  });
  it("ANDs chips across fields and describes them in words", () => {
    const row = { name: "Sara", score: 15, stage: "won", when: "2026-10-01", replied: true };
    expect(
      matchesAllFilters(
        row,
        [
          { id: "1", field: "score", op: "gte", value: 14 },
          { id: "2", field: "stage", op: "in", value: ["won"] },
        ],
        fields,
      ),
    ).toBe(true);
    expect(
      matchesAllFilters(row, [{ id: "1", field: "name", op: "contains", value: "tom" }], fields),
    ).toBe(false);
    expect(
      describeFilter({ id: "x", field: "stage", op: "in", value: ["won", "lost"] }, fields),
    ).toEqual({ field: "Stage", op: "is any of", value: "Won, Lost" });
    expect(
      describeFilter({ id: "x", field: "score", op: "between", value: [1, 10] }, fields),
    ).toEqual({ field: "Score", op: "between", value: "1 and 10" });
    expect(describeFilter({ id: "x", field: "name", op: "is_empty" }, fields)).toEqual({
      field: "Name",
      op: "is empty",
      value: "",
    });
    expect(describeFilter({ id: "x", field: "replied", op: "eq", value: true }, fields).value).toBe(
      "yes",
    );
  });
});
