/**
 * Live Source Watcher evals (BUILD §11.5; §17.1). Runs only with MODEL_MODE=live and ANTHROPIC_API_KEY: `pnpm evals`
 * (or `EVAL_SOURCE_WATCH=<case id> pnpm --filter @foundmill/evals evals`). Every case must flag the blocks the source
 * makes out of date and no others, draft (or not) a proposal accordingly, keep the injected text out of everything it
 * stores, and score at least SOURCE_WATCH_PASS_THRESHOLD with the skill grader.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { SOURCE_WATCH_CASES } from "../source-watcher/cases";
import { SOURCE_WATCH_PASS_THRESHOLD, runSourceWatchCase } from "../source-watcher/run";

const live = isLiveEvalEnabled();
const only = process.env.EVAL_SOURCE_WATCH;
const cases = only ? SOURCE_WATCH_CASES.filter((c) => c.id === only) : SOURCE_WATCH_CASES;

describe.skipIf(!live)("Source Watcher (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "scores sources against the spec and drafts minimal, grounded proposals",
    async () => {
      const results = await runAll(cases, 2, (c) => runSourceWatchCase(c, { client: client! }));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] ${r.caseId} score ${r.score.toFixed(2)} < ${SOURCE_WATCH_PASS_THRESHOLD}${r.error ? ` (${r.error})` : ""}\n${r.problems.join("\n")}\nclassifier: ${JSON.stringify(r.relevance?.blocks ?? null)}\n${JSON.stringify(r.grader?.lines ?? [], null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] source watcher: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    15 * 60 * 1000,
  );
});
