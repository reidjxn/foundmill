/**
 * Live Planner eval (route `planner`). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped otherwise.
 * Gate: with nowhere for code to go live, no code task and one goal that says building starts later; with a
 * repository, code tasks that each name their file scope.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { PLANNER_CASES, runPlannerCase } from "../planner";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("planner (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "plans no code with nowhere to publish, and code with file scopes when a repository is there",
    async () => {
      const results = await runAll(PLANNER_CASES, 2, (c) => runPlannerCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] planner ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.plan?.tasks.map((t) => ({ kind: t.kind, title: t.title })))}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] planner: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    4 * 60 * 1000,
  );
});
