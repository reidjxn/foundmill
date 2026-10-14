/**
 * Live channel creative evals (BUILD §11.7 "Create"; §17.1). Runs only with MODEL_MODE=live and ANTHROPIC_API_KEY:
 * `pnpm evals` (or `EVAL_CHANNEL_CREATIVE=<case id> pnpm --filter @foundmill/evals evals`). Every case must draft
 * assets of its channel's kinds, keep the forbidden text out, and score at least CHANNEL_CREATIVE_PASS_THRESHOLD with
 * the skill grader.
 */
import { describe, expect, it } from "vitest";
import { CHANNEL_CREATIVE_CASES } from "../channel-creative/cases";
import { CHANNEL_CREATIVE_PASS_THRESHOLD, runChannelCreativeCase } from "../channel-creative/run";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();
const only = process.env.EVAL_CHANNEL_CREATIVE;
const cases = only ? CHANNEL_CREATIVE_CASES.filter((c) => c.id === only) : CHANNEL_CREATIVE_CASES;

describe.skipIf(!live)("Channel creative (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts the week's creative within the house rules",
    async () => {
      const results = await runAll(cases, 2, (c) => runChannelCreativeCase(c, { client: client! }));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] ${r.caseId} score ${r.score.toFixed(2)} < ${CHANNEL_CREATIVE_PASS_THRESHOLD}${r.error ? ` (${r.error})` : ""}\n${r.problems.join("\n")}\n${JSON.stringify(r.grader?.lines ?? [], null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] channel creative: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    10 * 60 * 1000,
  );
});
