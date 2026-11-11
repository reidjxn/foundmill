/**
 * Offline checks of the project page eval (package 1.2): the rubric catches what it must, and the mock `projectPage`
 * route (what mock-mode founders get) passes every case through the product's own request and check. The live run is
 * `pnpm evals` (project-page.eval.test.ts), which skips without a key.
 */
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { PROJECT_PAGE_CASES, projectPageProblems, runProjectPageCase } from "../project-page";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const shiftly = PROJECT_PAGE_CASES[0]!;
const good = { pitch: "Same-day cafe shifts for students in Manchester.", about: shiftly.founderWords, forWhom: "Students in Manchester", stage: "idea" as const, showFounders: false };

describe("project page eval", () => {
  it("covers a founder's idea with an audience and without one", () => {
    expect(PROJECT_PAGE_CASES.length).toBeGreaterThanOrEqual(2);
    expect(PROJECT_PAGE_CASES.some((c) => c.audience)).toBe(true);
    expect(PROJECT_PAGE_CASES.some((c) => !c.audience)).toBe(true);
  });

  it("the rubric passes the founder's words and catches invented figures, claims, dates, lost words, British spelling and a made-up audience", () => {
    expect(projectPageProblems(shiftly, good)).toEqual([]);
    expect(projectPageProblems(shiftly, { ...good, about: `${shiftly.founderWords} Over 500 cafes already use it.` }).join()).toMatch(/invented figures 500/);
    expect(projectPageProblems(shiftly, { ...good, about: `${shiftly.founderWords} The leading way to staff a cafe!` }).join()).toMatch(/claim or superlative/);
    expect(projectPageProblems(shiftly, { ...good, about: `${shiftly.founderWords} Launching in March.` }).join()).toMatch(/date/);
    expect(projectPageProblems(shiftly, { ...good, pitch: "A staffing app", about: "Helps businesses find workers.", forWhom: "Businesses" }).join()).toMatch(/kept only|dropped/);
    expect(projectPageProblems(shiftly, { ...good, about: `${shiftly.founderWords} We organise it all.` }).join()).toMatch(/British spelling/);
    const candles = PROJECT_PAGE_CASES[1]!;
    expect(projectPageProblems(candles, { pitch: "Hand-poured candles that smell like a walk in the woods.", about: candles.founderWords, forWhom: "Busy professionals", stage: "idea", showFounders: false }).join()).toMatch(/named an audience/);
  });

  it("the mock route passes every case through the product's request and check", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    const results = await Promise.all(PROJECT_PAGE_CASES.map((c) => runProjectPageCase(client, c)));
    for (const r of results) expect(r.problems, r.caseId).toEqual([]);
  });
});
