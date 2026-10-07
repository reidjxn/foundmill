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
        if (!r.passed) console.warn(`[eval] ${r.taskId} score ${r.score.toFixed(2)} < ${r.threshold}${r.error ? ` (${r.error})` : ""}\n${r.outputText.slice(0, 800)}`);
      }
      console.warn(`[eval] golden: ${summary.passed}/${summary.total} passed, cost ${summary.costMinor} minor (Estimate)`);
      expect(summary.failed).toEqual([]);
    },
    20 * 60 * 1000,
  );
});
