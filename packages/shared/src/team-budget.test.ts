import { describe, expect, it } from "vitest";
import { teamBudgetEstimate } from "./team-budget";

describe("teamBudgetEstimate (WP-14 T3)", () => {
  it("reads the pace from what the month's outcomes cost and says how many more the balance covers", () => {
    expect(teamBudgetEstimate({ balanceMinor: 380, spentMinor: 120, outcomes: 4 })).toEqual({ outcomes: 4, costPerOutcomeMinor: 30, enoughFor: 12 });
    expect(teamBudgetEstimate({ balanceMinor: 20, spentMinor: 480, outcomes: 3 })).toEqual({ outcomes: 3, costPerOutcomeMinor: 160, enoughFor: 0 });
    expect(teamBudgetEstimate({ balanceMinor: 0, spentMinor: 500, outcomes: 5 })?.enoughFor).toBe(0);
  });

  it("makes up no number: no outcome yet, or nothing spent, is no estimate", () => {
    expect(teamBudgetEstimate({ balanceMinor: 500, spentMinor: 0, outcomes: 0 })).toBeNull();
    expect(teamBudgetEstimate({ balanceMinor: 400, spentMinor: 100, outcomes: 0 })).toBeNull();
    expect(teamBudgetEstimate({ balanceMinor: 500, spentMinor: 0, outcomes: 2 })).toBeNull();
  });
});
