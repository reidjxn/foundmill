/**
 * Live Team call evals (docs/TEAM_CALL.md §4: `teamCallTurn` on Sonnet and `teamCallWrapUp` on Opus, both at low
 * effort). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped otherwise. Gate: agents address each other
 * by mention and a round has two of them, no turn claims an action was taken, a one-to-one call has only the called
 * agent, the fixture call files a roadmap item, a development task and a marketing task with its money step a budget
 * or the founder's own step, and nothing names jobs, employment or a missing cofounder.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { TEAM_CALL_CASES, runTeamCallCase } from "../team-call";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("team call (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "agents discuss with each other and the founder, never claim anything was done, and the wrap-up files what was agreed",
    async () => {
      const results = await runAll(TEAM_CALL_CASES, 3, (c) => runTeamCallCase(client!, c));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] team call ${r.caseId} (${r.kind}): ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify({ rounds: r.rounds.map((x) => x.raw), wrapUp: r.wrapUpRaw }, null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] team call: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    10 * 60 * 1000,
  );
});
