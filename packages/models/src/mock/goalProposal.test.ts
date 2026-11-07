/** The mock goal route (founder, 2026-11-07): the deterministic reader of packages/shared, exact for mock-mode e2e runs. */
import { describe, expect, it } from "vitest";
import { GoalProposalOutput } from "../schemas";
import { MockModelClient } from "./index";

const ask = (input: Record<string, unknown>) => new MockModelClient().complete({ route: "goalProposal", schema: GoalProposalOutput, system: "Revise the goal.", messages: [{ role: "user", content: "```json\n" + JSON.stringify(input) + "\n```" }] });
const current = { kind: "paying_customers", target: 10, due_on: "2026-12-19", custom_words: null };

describe("mock goalProposal", () => {
  it("reads a number with what it counts and a date; the same words give the same answer", async () => {
    const a = await ask({ founder_words: "20 customers by Jan 31", today: "2026-11-07", currency: "GBP", current });
    expect(a.json).toEqual({ changed: true, kind: "paying_customers", target: 20, due_on: "2027-01-31", custom_words: null });
    expect(a.repaired).toBe(false);
    expect((await ask({ founder_words: "20 customers by Jan 31", today: "2026-11-07", currency: "GBP", current })).json).toEqual(a.json);
  });

  it("revenue in whole units of the business's currency; words with no number or date change nothing", async () => {
    expect((await ask({ founder_words: "£5,000 a month by March", today: "2026-11-07", currency: "GBP", current })).json).toEqual({ changed: true, kind: "revenue_month", target: 5000, due_on: "2027-03-31", custom_words: null });
    expect((await ask({ founder_words: "hmm, not sure about this", today: "2026-11-07", currency: "GBP", current })).json).toEqual({ changed: false, kind: "paying_customers", target: 10, due_on: "2026-12-19", custom_words: null });
  });
});
