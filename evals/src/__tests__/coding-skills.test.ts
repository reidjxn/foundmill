/** Coding agents start with Ponytail and Caveman (WP-06 T13), offline. Live totals: coding-skills.eval.test.ts. */
import { describe, expect, it } from "vitest";
import { CODING_CASES, checkCodingOutput, codingRequest, handbackIsPlain, verdict, type CodingOutput } from "../skills/coding-skills";

const plain = "I fixed the form so that it now refuses an empty email and shows the message. I added one test for it, and all of the tests pass.";
const good = (c: (typeof CODING_CASES)[number]): CodingOutput => ({
  working_notes: "Fix. Test.",
  files: [
    { path: c.allowed[0]!, content: `${c.accept.source.includes("planLabel") ? "planLabel(account.tier)" : "x.trim() 'Enter your email address' Lessons need 2 hours notice"}` },
    { path: c.allowed[1]!, content: "test" },
  ],
  handback: plain,
});

describe("skills.coding (offline)", () => {
  it("the two requests differ only by the Skills section, which carries both bodies and the plain-sentences rule", () => {
    const c = CODING_CASES[0]!;
    const without = codingRequest(c, false), withBoth = codingRequest(c, true);
    expect(without.user).toBe(withBoth.user);
    expect(withBoth.system).toContain("Short working turns");
    expect(withBoth.system).toContain("Smallest complete change");
    expect(withBoth.system).toContain("stays in plain, full sentences");
    expect(without.system).not.toContain("Short working turns");
  });

  for (const c of CODING_CASES) {
    it(`${c.id}: accepts a right change, refuses a wrong, wide or squeezed one`, () => {
      expect(checkCodingOutput(c, good(c))).toEqual([]);
      expect(checkCodingOutput(c, { ...good(c), files: [{ path: "src/other.ts", content: "" }] })).not.toEqual([]);
      expect(checkCodingOutput(c, { ...good(c), handback: "Fixed. Test added." })).toContain("the hand-back is not in plain full sentences");
      expect(checkCodingOutput(c, null)).toEqual(["no valid answer"]);
    });
  }

  it("a fragment hand-back is not plain; full sentences are", () => {
    expect(handbackIsPlain("Fix done. Test pass. No layout change.")).toBe(false);
    expect(handbackIsPlain(plain)).toBe(true);
  });

  it("ships only if tokens fall and acceptance does not", () => {
    const arm = (withSkills: boolean, outputTokens: number, accepted: boolean) => ({ caseId: "a", withSkills, outputTokens, accepted, problems: [], costMinor: 0 });
    expect(verdict([arm(false, 900, true), arm(true, 600, true)]).ship).toBe(true);
    expect(verdict([arm(false, 900, true), arm(true, 600, false)]).ship).toBe(false);
    expect(verdict([arm(false, 900, true), arm(true, 950, true)]).ship).toBe(false);
  });
});
