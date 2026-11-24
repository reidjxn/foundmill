/**
 * Live golden evals (BUILD §17.1). Runs only with MODEL_MODE=live and ANTHROPIC_API_KEY; `pnpm --filter
 * @foundmill/evals evals`. Each template must pass every one of its golden tasks at its threshold.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll, runGoldenTask, summariseGolden } from "../harness";
import { GOLDEN_TASKS } from "../golden/tasks";

const live = isLiveEvalEnabled();
const only = process.env.EVAL_TEMPLATE; // optional: run one template's tasks
const tasks = only ? GOLDEN_TASKS.filter((t) => t.templateKey === only) : GOLDEN_TASKS;

describe.skipIf(!live)("golden tasks per template (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "every golden task passes its template threshold",
    async () => {
      const results = await runAll(tasks, 4, (task) => runGoldenTask(task, { client: client! }));
      const summary = summariseGolden(results);
      for (const r of results) {
        if (r.passed) continue;
        // A score of 0 is usually a failed deterministic check: name it, so a live run says which (Nov 22, 2026).
        const failedChecks = r.checks.filter((c) => !c.passed).map((c) => `check ${c.kind} failed${c.detail ? `: ${c.detail}` : ""}`);
        const lines = [...failedChecks, ...(r.grader?.lines ?? []).filter((l) => l.score < r.threshold).map((l) => `grader ${l.score}: ${l.reason}`)];
        console.warn(`[eval] ${r.taskId} score ${r.score.toFixed(2)} < ${r.threshold}${r.error ? ` (${r.error})` : ""}\n${lines.join("\n")}\n${r.outputText.slice(0, 6000)}`);
      }
      // Every case's margin, so a run shows the cases near their line (the next flips), not only the failures.
      const near = results.filter((r) => r.passed && r.score < r.threshold + 0.1);
      for (const r of near) console.warn(`[eval] near ${r.taskId} ${r.score.toFixed(2)} (threshold ${r.threshold}); ${(r.grader?.lines ?? []).filter((l) => l.score < 1).map((l) => `${l.score}: ${l.reason}`).join(" | ")}`);
      console.warn(`[eval] scores: ${results.map((r) => `${r.taskId}=${r.score.toFixed(2)}`).join(" ")}`);
      console.warn(`[eval] golden: ${summary.passed}/${summary.total} passed, cost ${summary.costMinor} minor (Estimate)`);
      expect(summary.failed).toEqual([]);
    },
    20 * 60 * 1000,
  );
});
