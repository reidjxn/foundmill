/**
 * What bounds a live session (audit BF-11, O-29, #15): the smallest of the task's budget, the month's credits (platform
 * key), the business's monthly model budget and the agent's wage cap, and the words each gives the founder.
 */
import { describe, expect, it } from "vitest";
import { boundSpend, budgetSummary, LIMIT_WORDS, type BudgetLimit } from "../activities/session-budget";

const task = { taskBudgetMinor: 2_000, taskSpentMinor: 500 };

describe("boundSpend", () => {
  it("is the session's share of a capped cycle (Autopilot's own spend, 0077) when that is tighter", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: 9_000, cycleCapMinor: 7 })).toEqual({ remainingMinor: 7, limit: "cycle" });
    expect(boundSpend({ ...task, creditsLeftMinor: 9_000, cycleCapMinor: null })).toEqual({ remainingMinor: 1_500, limit: "task" });
  });
  it("is the task's remaining budget when nothing else is tighter, or set", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: null })).toEqual({ remainingMinor: 1_500, limit: "task" });
    expect(boundSpend({ ...task, creditsLeftMinor: 9_000, wageLeftMinor: null, modelBudgetLeftMinor: null })).toEqual({ remainingMinor: 1_500, limit: "task" });
  });

  it("is the credits left when the platform key pays and they are fewer", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: 700 })).toEqual({ remainingMinor: 700, limit: "credits" });
  });

  it("is what is left of the monthly model budget, with or without credits (an own-key business has none)", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: null, modelBudgetLeftMinor: 600 })).toEqual({ remainingMinor: 600, limit: "model_budget" });
    expect(boundSpend({ ...task, creditsLeftMinor: 9_000, modelBudgetLeftMinor: 600 })).toEqual({ remainingMinor: 600, limit: "model_budget" });
  });

  it("is what is left of the agent's wage cap, whoever pays", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: null, wageLeftMinor: 200 })).toEqual({ remainingMinor: 200, limit: "wage_cap" });
    expect(boundSpend({ ...task, creditsLeftMinor: 9_000, wageLeftMinor: 200, modelBudgetLeftMinor: 600 })).toEqual({ remainingMinor: 200, limit: "wage_cap" });
  });

  it("names the tightest limit, the earlier one on a tie, and never goes below zero", () => {
    expect(boundSpend({ ...task, creditsLeftMinor: 300, wageLeftMinor: 300, modelBudgetLeftMinor: 300 })).toEqual({ remainingMinor: 300, limit: "credits" });
    expect(boundSpend({ ...task, creditsLeftMinor: null, wageLeftMinor: 300, modelBudgetLeftMinor: 300 })).toEqual({ remainingMinor: 300, limit: "model_budget" });
    expect(boundSpend({ ...task, creditsLeftMinor: null, wageLeftMinor: 0 })).toEqual({ remainingMinor: 0, limit: "wage_cap" });
    expect(boundSpend({ ...task, creditsLeftMinor: -40 })).toEqual({ remainingMinor: 0, limit: "credits" });
    expect(boundSpend({ taskBudgetMinor: 100, taskSpentMinor: 400, creditsLeftMinor: null })).toEqual({ remainingMinor: 0, limit: "task" });
  });
});

describe("what the founder reads when a limit stops a session", () => {
  const limits: BudgetLimit[] = ["task", "credits", "wage_cap", "model_budget"];
  it("every limit has its own summary and reason words, in US English with no unexplained figure", () => {
    const summaries = limits.map((l) => budgetSummary(l, task));
    expect(new Set(summaries).size).toBe(limits.length);
    for (const summary of summaries) expect(summary).toMatch(/^Blocked: /);
    expect(budgetSummary("wage_cap", task)).toMatch(/wage cap/);
    expect(budgetSummary("model_budget", task)).toMatch(/monthly model budget/);
    expect(budgetSummary("task", task)).toMatch(/\$5\.00 of \$20\.00, an Estimate/);
    for (const limit of limits) {
      expect(LIMIT_WORDS[limit].used.length).toBeGreaterThan(10);
      expect(LIMIT_WORDS[limit].spent.length).toBeGreaterThan(10);
    }
  });
});
