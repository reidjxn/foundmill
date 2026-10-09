import { sanitiseSvg } from "@foundmill/shared/logo";
import { describe, expect, it } from "vitest";
import { resolveModel } from "../routing";
import { LogoDesignOutput } from "../schemas";
import { MOCK_LOGO_DIRECTION_FAMILIES, MockModelClient } from "./index";
import { promptWith } from "./fixtures.test-helpers";

const client = new MockModelClient();
const brief = { business_name: "Northwind Skincare", pitch: "Fragrance-free skincare for sensitive skin.", archetype: "DTC physical product", brand_colours: { primary: "#1b4fd8", secondary: "#f5c400" }, count: 4, round: 0 };
const run = (input: Record<string, unknown>) => client.complete({ route: "logoDesigner", system: "Draw logo marks.", messages: promptWith(input), schema: LogoDesignOutput });

describe("logo designer (mock)", () => {
  it("routes to Opus", () => {
    expect(resolveModel("logoDesigner")).toMatchObject({ modelKey: "opus", locked: false });
  });

  it("draws the requested number of distinct marks in the brand colours, each already clean for the sanitiser", async () => {
    const r = await run(brief);
    expect(r.repaired).toBe(false);
    const { marks } = r.json;
    expect(marks).toHaveLength(4);
    expect(new Set(marks.map((m) => m.name)).size).toBe(4);
    for (const m of marks) {
      const clean = sanitiseSvg(m.svg);
      expect(clean.ok, m.name).toBe(true);
      if (!clean.ok) continue;
      expect(clean.removed, m.name).toEqual([]);
      expect(clean.viewBox).toEqual([0, 0, 100, 100]);
      // A background tile covers the box, then at least one symbol shape.
      expect(clean.shapes, m.name).toBeGreaterThanOrEqual(2);
      expect(m.svg).toMatch(/#1b4fd8|#f5c400/);
      expect(m.concept).toContain("Northwind");
      expect(`${m.name} ${m.concept} ${m.svg}`).not.toMatch(/shield|crest|badge|star|ball|trophy|<text/i);
    }
  });

  it("is deterministic for the same brief and changes with a new round", async () => {
    const a = await run(brief);
    const b = await run(brief);
    expect(a.json).toEqual(b.json);
    const again = await run({ ...brief, round: 1 });
    expect(again.json.marks.map((m) => m.svg)).not.toEqual(a.json.marks.map((m) => m.svg));
  });

  it("honours count, follows the colours and falls back to defaults for a thin brief", async () => {
    const two = await run({ ...brief, count: 2, brand_colours: { primary: "#1f6f5f", secondary: "#e8c56b" } });
    expect(two.json.marks).toHaveLength(2);
    expect(two.json.marks.every((m) => /#1f6f5f|#e8c56b/.test(m.svg))).toBe(true);
    const thin = await run({ business_name: "" });
    expect(thin.json.marks).toHaveLength(4);
    expect(thin.json.marks.every((m) => sanitiseSvg(m.svg).ok)).toBe(true);
  });
});

describe("logo designer (mock), one mark per direction", () => {
  const directions = ["monogram", "geometric", "negative_space", "abstract"] as const;

  it("draws exactly one clean mark per direction, and the four directions never repeat a family", async () => {
    const marks = await Promise.all(directions.map((direction) => run({ ...brief, count: 1, direction }).then((r) => r.json.marks)));
    for (const set of marks) expect(set).toHaveLength(1);
    const flat = marks.map((m) => m[0]!);
    expect(new Set(flat.map((m) => m.name)).size).toBe(4);
    expect(new Set(flat.map((m) => m.svg)).size).toBe(4);
    for (const m of flat) expect(sanitiseSvg(m.svg).ok, m.name).toBe(true);
    // The monogram draws the initial in the dot matrix.
    expect(flat[0]!.name).toBe("Dot matrix");
  });

  it("picks only from the direction's own families, whatever the round", async () => {
    const byName: Record<string, string> = { "Dot matrix": "matrix", Orbit: "orbit", Corner: "corner", Arch: "arch", "Split disc": "split", Signal: "wave", Fold: "fold", Stack: "stack" };
    for (const direction of directions) {
      for (let round = 0; round < 6; round++) {
        const r = await run({ ...brief, direction, round, count: 4 });
        expect(r.json.marks).toHaveLength(1);
        expect(MOCK_LOGO_DIRECTION_FAMILIES[direction]).toContain(byName[r.json.marks[0]!.name]);
      }
    }
  });

  it("ignores an unknown direction and draws a set", async () => {
    const r = await run({ ...brief, direction: "heraldic" });
    expect(r.json.marks).toHaveLength(4);
  });
});
