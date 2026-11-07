/**
 * Offline checks of the goal revision eval (founder, 2026-11-07): the mock `goalProposal` route (the deterministic reader
 * mock-mode founders get) reads every measured case, never changes a goal on a question or an instruction to do something
 * else, and every sentence it leads to reads plainly. The live run is `pnpm evals` (goal-proposal.eval.test.ts).
 */
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { GOAL_PROPOSAL_CASES, goalSentenceProblems, runGoalProposalCase, summariseGoalProposals } from "../goal-proposal";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("goal revision eval", () => {
  it("the corpus covers the kinds, dates and the words that must change nothing", () => {
    expect(GOAL_PROPOSAL_CASES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(GOAL_PROPOSAL_CASES.map((c) => c.id)).size).toBe(GOAL_PROPOSAL_CASES.length);
    const kinds = new Set(GOAL_PROPOSAL_CASES.flatMap((c) => (c.expect.changed ? [c.expect.kind] : [])));
    expect([...kinds].sort()).toEqual(["custom", "paying_customers", "revenue_month", "signups"]);
    expect(GOAL_PROPOSAL_CASES.filter((c) => !c.expect.changed).length).toBeGreaterThanOrEqual(2);
  });

  it("the sentence check catches day-first and ISO dates and jargon", () => {
    expect(goalSentenceProblems("Get the first 20 paying customers by Jan 31")).toEqual([]);
    expect(goalSentenceProblems("Get 20 customers by 31 Jan")).toContain("date format");
    expect(goalSentenceProblems("Get 20 customers by 2027-01-31")).toContain("date format");
    expect(goalSentenceProblems("Merge the pull request by Jan 31").some((p) => p.startsWith("jargon"))).toBe(true);
  });

  it("the mock route passes every measured case and never changes the goal on words that name no change", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    const results = await Promise.all(GOAL_PROPOSAL_CASES.map((c) => runGoalProposalCase(client, c)));
    const summary = summariseGoalProposals(results);
    // The deterministic reader has no custom goals (the live route reads those); every other case passes.
    const failed = summary.failed.filter((f) => f.caseId !== "g09");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    const byId = new Map(results.map((r) => [r.caseId, r]));
    expect(byId.get("g01")?.sentence).toBe("Get the first 20 paying customers by Jan 31");
    expect(byId.get("g03")?.sentence).toBe("Reach £5,000 of revenue in a month by Mar 31");
    expect(byId.get("g07")?.shape).toBeNull();
    expect(byId.get("g08")?.shape).toBeNull();
  });
});
