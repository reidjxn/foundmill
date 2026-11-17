/**
 * The chapter report eval (WP-14 T8): every case passes its gate, the thin chapters say they were quiet and invent
 * nothing, and the gate itself catches a result claimed with no record. The report is a
 * template, so this runs the same in `pnpm evals` and in the unit suite.
 */
import { describe, expect, it } from "vitest";
import { CHAPTER_REPORT_CASES, runChapterReportCase } from "../chapter-report";

describe("chapter report eval", () => {
  it("has thin cases and a full one, with unique ids", () => {
    expect(new Set(CHAPTER_REPORT_CASES.map((c) => c.id)).size).toBe(CHAPTER_REPORT_CASES.length);
    expect(CHAPTER_REPORT_CASES.filter((c) => c.thin).length).toBeGreaterThanOrEqual(2);
    expect(CHAPTER_REPORT_CASES.some((c) => !c.thin)).toBe(true);
  });

  for (const c of CHAPTER_REPORT_CASES) {
    it(`${c.id}: says only what is on record`, () => {
      const result = runChapterReportCase(c);
      expect(result.problems, result.body).toEqual([]);
    });
  }

  it("an empty chapter: it says so in every section, with no item, no link and no number but its own label", () => {
    const { body } = runChapterReportCase(CHAPTER_REPORT_CASES.find((c) => c.id === "chapter_report.empty")!);
    expect(body).toContain("Q3 2026 was a quiet chapter. There is little on record, so this report is short, and nothing in it is filled in.");
    expect(body.match(/Nothing on record for this chapter\./g)).toHaveLength(3);
    expect(body).toContain("No single moment stands out on the record for this chapter.");
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toEqual([]);
    expect(body).not.toContain("[[ent:");
    expect(body.replace(/Q3 2026/g, "")).not.toMatch(/\d/);
  });

  it("a chapter with one piece of work: that one item, its agent linked, and the quiet line", () => {
    const { body } = runChapterReportCase(CHAPTER_REPORT_CASES.find((c) => c.id === "chapter_report.one_piece_of_work")!);
    expect(body).toContain("quiet chapter");
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toEqual(["- [[ent:0c0c0c0c-0000-4000-8000-000000000002|Rhea Stone]] finished 1 piece of work."]);
    expect(body).toContain("[[ent:0c0c0c0c-0000-4000-8000-000000000002|Rhea Stone]] finished “Booking form”, the longest piece of work of the chapter (12 minutes).");
  });

  it("the gate catches a result claimed with no record, and a case whose thin flag is wrong", () => {
    const base = CHAPTER_REPORT_CASES.find((c) => c.id === "chapter_report.one_piece_of_work")!;
    // Free text an agent wrote (a report's title) that claims a result the chapter has no record of.
    const claimed = { ...base.facts, reports: [{ agent: base.facts.work[0]!.agent, title: "Revenue grew" }] };
    expect(runChapterReportCase({ ...base, facts: claimed }).problems.some((p) => p.startsWith("claims a result with no record"))).toBe(true);
    const full = CHAPTER_REPORT_CASES.find((c) => !c.thin)!;
    expect(runChapterReportCase({ ...base, facts: full.facts }).problems).toContain("the case's own thin flag disagrees with its facts");
  });
});
