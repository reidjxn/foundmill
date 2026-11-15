/**
 * Offline checks of the Planner eval: the rubric catches what it must, and the mock `planner` route (what mock-mode
 * founders get) passes both fixtures. The live run is `pnpm evals` (planner.eval.test.ts), which skips without a key.
 */
import type { PlannedTask } from "@foundmill/models";
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { PLANNER_CASES, plannerProblems, runPlannerCase } from "../planner";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const none = PLANNER_CASES.find((c) => c.destination === "none")!;
const github = PLANNER_CASES.find((c) => c.destination === "github")!;
const task = (over: Partial<PlannedTask>): PlannedTask => ({ id: "t1", title: "t", goal: "g", kind: "research", acceptance_criteria: ["a"], test_expectations: [], file_scope_hints: [], depends_on: [], estimate_hours: 1, hard: false, roadmap_item_id: null, ...over });

describe("planner eval", () => {
  it("covers a project with nowhere to publish and one with a repository", () => {
    expect(PLANNER_CASES.map((c) => c.destination).sort()).toEqual(["github", "none"]);
  });

  it("the rubric passes a good plan and catches code with no destination, a missing note, and code with no file scope", () => {
    const note = task({ goal: "Write the build plan. Building starts once the project has a place to publish." });
    expect(plannerProblems(none, { tasks: [note] })).toEqual([]);
    expect(plannerProblems(none, { tasks: [note, task({ id: "t2", kind: "code" })] }).join()).toMatch(/planned 1 code task/);
    expect(plannerProblems(none, { tasks: [task({})] }).join()).toMatch(/building starts/);
    expect(plannerProblems(github, { tasks: [task({ kind: "code", file_scope_hints: ["apps/web/"] })] })).toEqual([]);
    expect(plannerProblems(github, { tasks: [task({})] }).join()).toMatch(/no code task/);
    expect(plannerProblems(github, { tasks: [task({ kind: "code" })] }).join()).toMatch(/names no file scope/);
  });

  it("the mock route passes both fixtures through the product's own request", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    for (const c of PLANNER_CASES) {
      const r = await runPlannerCase(client, c);
      expect(r.problems, c.id).toEqual([]);
    }
  });
});
