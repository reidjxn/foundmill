/**
 * Live mentor evals (WP-04 T10): the Chief of Staff's conversation reply and the Composer's decision note, with the
 * founder's own context, for a first-timer with no budget, an operator, two cofounders and a founder with no name. Runs
 * only with MODEL_MODE=live and a key (`pnpm evals`, nightly); skipped otherwise. Gate: the founder's first name when it
 * is known and no made-up one, at most one explained idea, the free option recommended to the founder who cannot spend,
 * nothing that names jobs or employment, and nothing that says anyone is missing.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { MENTOR_CASES, runMentorCase } from "../mentor";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("mentor (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "addresses the founder by name, teaches one idea, recommends the free first move and never says anyone is missing",
    async () => {
      const results = await runAll(MENTOR_CASES, 2, (c) => runMentorCase(client!, c));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] mentor ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify({ reply: r.reply, note: r.note }, null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] mentor: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
