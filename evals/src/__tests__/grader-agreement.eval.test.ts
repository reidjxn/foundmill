/**
 * Grader agreement (WP-09 T9 step 5), live only (evals-models-live.yml). Thirty golden tasks are answered once, and each
 * answer is graded three times: by the judge (Opus at medium effort) and by the two cheaper candidates (Haiku 5.5 and
 * Sonnet, both at low). A candidate may take over `skillGrader` when pass or fail agrees with the judge on at least 27 of
 * 30 and the mean score differs by at most 0.1 (Estimates). This suite prints the figures and the verdict; the move itself
 * is a separate change to `routing.ts`. Cost: about $3 a run (Estimate).
 */
import type { Effort, ModelKey } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { createEvalClient, gradeGoldenOutput, isLiveEvalEnabled, passThresholdFor, runAll, runGoldenTask } from "../harness";
import { GOLDEN_TASKS } from "../golden/tasks";

export const AGREEMENT_TASKS = 30;
export const MIN_AGREEING = 27;
export const MAX_MEAN_GAP = 0.1;

const JUDGE = { modelOverride: "opus", effort: "medium" } as const satisfies { modelOverride: ModelKey; effort: Effort };
const CANDIDATES = [
  { modelOverride: "haiku", effort: "low" },
  { modelOverride: "sonnet", effort: "low" },
] as const satisfies ReadonlyArray<{ modelOverride: ModelKey; effort: Effort }>;

describe.skipIf(!isLiveEvalEnabled())("grader agreement (live)", () => {
  it(
    "grades thirty answers with the judge and each candidate, and names the cheapest grader that agrees",
    async () => {
      const client = createEvalClient();
      const tasks = GOLDEN_TASKS.slice(0, AGREEMENT_TASKS);
      const rows = await runAll(tasks, 4, async (task) => {
        const answered = await runGoldenTask(task, { client });
        if (answered.error) return { task, error: answered.error };
        const grade = (g: { modelOverride: ModelKey; effort: Effort }) => gradeGoldenOutput(client, task, answered.outputText, answered.checks, g);
        const [judge, ...candidates] = await Promise.all([grade(JUDGE), ...CANDIDATES.map(grade)]);
        return { task, judge: judge!, candidates, cost: answered.costMinor + judge!.costMinor + candidates.reduce((s, c) => s + c.costMinor, 0) };
      });
      const failed = rows.filter((r) => "error" in r);
      expect(failed.map((r) => `${r.task.id}: ${"error" in r ? r.error : ""}`)).toEqual([]);
      const graded = rows.filter((r): r is Exclude<typeof r, { error: string }> => !("error" in r));
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
      const verdicts = CANDIDATES.map((c, i) => {
        const agreeing = graded.filter((r) => (r.judge.score >= passThresholdFor(r.task.templateKey, r.task)) === (r.candidates[i]!.score >= passThresholdFor(r.task.templateKey, r.task))).length;
        const gap = Math.abs(mean(graded.map((r) => r.judge.score)) - mean(graded.map((r) => r.candidates[i]!.score)));
        return { grader: `${c.modelOverride} at ${c.effort}`, agreeing, of: graded.length, meanGap: Number(gap.toFixed(3)), qualifies: agreeing >= MIN_AGREEING && gap <= MAX_MEAN_GAP };
      });
      const winner = verdicts.find((v) => v.qualifies);
      console.warn(`[eval] grader agreement: ${JSON.stringify(verdicts)}; verdict: ${winner ? `move skillGrader to ${winner.grader}` : "keep Opus and set effort low"}; cost ${graded.reduce((s, r) => s + r.cost, 0)} minor (Estimate)`);
      expect(graded).toHaveLength(tasks.length);
    },
    30 * 60 * 1000,
  );
});
