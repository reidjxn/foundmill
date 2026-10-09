/**
 * Live foundations evals (BUILD §11.1 first open, §11.5; §17.1). Runs only with MODEL_MODE=live and ANTHROPIC_API_KEY:
 * `pnpm evals` (or `EVAL_FOUNDATIONS=<case id> pnpm --filter @foundmill/evals evals`). Every case must pass its
 * deterministic checks (every section drafted, every imported issue on the roadmap, figures labelled by the model,
 * nothing from the injected README) and score at least FOUNDATIONS_PASS_THRESHOLD with the skill grader.
 */
import { describe, expect, it } from "vitest";
import { FOUNDATIONS_CASES } from "../foundations/cases";
import { FOUNDATIONS_PASS_THRESHOLD, runFoundationsCase } from "../foundations/run";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();
const only = process.env.EVAL_FOUNDATIONS;
const cases = only ? FOUNDATIONS_CASES.filter((c) => c.id === only) : FOUNDATIONS_CASES;

describe.skipIf(!live)("foundations drafting (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts a grounded vision, specification and roadmap for every case",
    async () => {
      const results = await runAll(cases, 2, (c) => runFoundationsCase(c, { client: client! }));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] ${r.caseId} score ${r.score.toFixed(2)} < ${FOUNDATIONS_PASS_THRESHOLD}${r.error ? ` (${r.error})` : ""}\n${r.problems.join("\n")}\n${JSON.stringify(r.grader?.lines ?? [], null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] foundations: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    20 * 60 * 1000,
  );
});
