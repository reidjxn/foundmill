/**
 * Live goal revision eval (Sonnet, `goalProposal`; founder, 2026-11-07). Runs only with MODEL_MODE=live and a key
 * (`pnpm evals`). Gate: at least nine of the ten cases pass, and the words that name no change never change the goal.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { GOAL_PROPOSAL_CASES, runGoalProposalCase, summariseGoalProposals } from "../goal-proposal";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("goal revision (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "reads the founder's change as a kind, a target and a date",
    async () => {
      const results = await runAll(GOAL_PROPOSAL_CASES, 4, (c) => runGoalProposalCase(client!, c));
      const summary = summariseGoalProposals(results);
      for (const f of summary.failed) console.warn(`[eval] goal ${f.caseId}: ${f.problems.join(", ")} (${f.sentence ?? "no change"})`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] goal revision: ${summary.passed}/${summary.total} cases passed, cost ${cost} minor (Estimate)`);
      expect(summary.passed).toBeGreaterThanOrEqual(GOAL_PROPOSAL_CASES.length - 1);
      const noChange = GOAL_PROPOSAL_CASES.filter((c) => !c.expect.changed).map((c) => c.id);
      expect(summary.failed.filter((f) => noChange.includes(f.caseId))).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
