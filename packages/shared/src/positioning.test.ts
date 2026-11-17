import { describe, expect, it } from "vitest";
import { POSITIONING_LINE_SECTIONS, emptyPositioning, positioningProblems, positioningSectionsChanged, readPositioning, renderPositioning, type PositioningNotes } from "./positioning";

const notes = (over: Partial<PositioningNotes> = {}): PositioningNotes => ({
  ...emptyPositioning("A fresh sourdough loaf on your porch every Saturday.", "2026-11-15"),
  version: 1,
  forWhom: [{ text: "People within two miles who buy good bread most weeks.", label: "assumption", source: "ask the 6 neighbors" }],
  problem: [{ text: '"The good bakery sells out by 9."', label: "customer", source: "reply in the neighborhood group, Nov 9, 2026" }],
  proof: [{ text: "I bake every weekend.", label: "founder", source: "idea card" }],
  ...over,
});

describe("readPositioning", () => {
  it("returns null for anything that is not notes", () => {
    expect(readPositioning(null)).toBeNull();
    expect(readPositioning([])).toBeNull();
    expect(readPositioning({ version: 1 })).toBeNull();
  });

  it("reads defensively: unknown labels become assumptions, long text is cut, empty lines dropped", () => {
    const n = readPositioning({ oneLine: "x".repeat(500), step: "nope", forWhom: [{ text: "Bakers", label: "guess" }, { text: "  " }, ...Array.from({ length: 12 }, (_, i) => ({ text: `l${i}`, label: "founder", source: "s" }))] });
    expect(n?.oneLine.length).toBe(200);
    expect(n?.step).toBe("follow");
    expect(n?.forWhom[0]).toEqual({ text: "Bakers", label: "assumption", source: null });
    expect(n?.forWhom.length).toBe(8);
    expect(n?.version).toBe(0);
  });

  it("round-trips its own output", () => {
    expect(readPositioning(notes())).toEqual(notes());
  });
});

describe("positioningProblems", () => {
  it("is empty for labeled lines with sources", () => {
    expect(positioningProblems(notes())).toEqual([]);
  });

  it("asks for a source on any line that is not an assumption, and for the one line", () => {
    const n = notes({ oneLine: "", different: [{ text: "Baked that morning.", label: "founder", source: null }] });
    const p = positioningProblems(n);
    expect(p[0]).toMatch(/one line/);
    expect(p.some((x) => x.startsWith("4. What is different, line 1"))).toBe(true);
  });
});

describe("renderPositioning", () => {
  it("keeps the header and the eight sections in order, with labels shown", () => {
    const text = renderPositioning(notes());
    expect(text.startsWith("Positioning notes\nVersion: v1, Nov 15, 2026\nOne line: A fresh sourdough")).toBe(true);
    const headings = [...POSITIONING_LINE_SECTIONS.map((s) => s.heading), "6. Objections", "7. Voice", "8. Learned so far"];
    const at = headings.map((h) => text.indexOf(h));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain("(customer; reply in the neighborhood group, Nov 9, 2026)");
    expect(text).toContain("(assumption; ask the 6 neighbors)");
  });

  it("cuts at max on a line boundary", () => {
    const full = renderPositioning(notes());
    const cut = renderPositioning(notes(), 120);
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(full.startsWith(cut)).toBe(true);
    expect(full[cut.length]).toBe("\n");
  });
});

describe("positioningSectionsChanged", () => {
  it("names what changed", () => {
    expect(positioningSectionsChanged(notes(), notes({ oneLine: "Other" }))).toEqual(["oneLine"]);
    expect(positioningSectionsChanged(null, notes())).toContain("forWhom");
  });
});
