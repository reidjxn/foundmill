/**
 * Offline checks of the positioning eval (WP-08 T1): the rubric catches invented proof, figures, quotes and several
 * audiences, and the product's check (`finalisePositioning`) already strips what the rubric refuses. The live run is
 * `pnpm evals` (positioning.eval.test.ts), which skips without a key.
 */
import { emptyPositioning } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { POSITIONING_CASES, positioningProblems } from "../positioning";

const shiftly = POSITIONING_CASES[0]!;
const good = { ...emptyPositioning("Same-day cafe shifts for students in Manchester.", "2026-11-16"), forWhom: [{ text: "Students in Manchester who want a few hours of cafe work", label: "founder" as const, source: "your words" }] };

describe("positioning eval", () => {
  it("passes notes taken from the founder's words", () => {
    expect(positioningProblems(shiftly, good)).toEqual([]);
  });

  it("catches invented proof, figures, quotes, unsupported labels and several audiences", () => {
    expect(positioningProblems(shiftly, { ...good, proof: [{ text: "Cafes love it", label: "customer", source: "x" }] }).join()).toMatch(/proof not in/);
    expect(positioningProblems(shiftly, { ...good, problem: [{ text: "500 cafes struggle", label: "assumption", source: null }] }).join()).toMatch(/invented figure 500/);
    expect(positioningProblems(shiftly, { ...good, problem: [{ text: '"I never find staff"', label: "assumption", source: null }] }).join()).toMatch(/quotation/);
    expect(positioningProblems(shiftly, { ...good, today: [{ text: "Agencies charge a lot", label: "observed", source: "a site" }] }).join()).toMatch(/labeled observed/);
    const many = { ...good, forWhom: [good.forWhom[0]!, good.forWhom[0]!, good.forWhom[0]!] };
    expect(positioningProblems(shiftly, many).join()).toMatch(/several audiences/);
  });
});
