/**
 * Live idea box eval (route `ideation`, the visitor's one card; docs/IDEA_BOX.md). Runs only with MODEL_MODE=live and a
 * key (`pnpm evals`). Every case: a tight card that keeps the subject, honest about a weak idea, deaf to an instruction
 * in the line, and the nearest legitimate business (or a refusal) for a harmful one. Also prints the time to the first
 * JSON and to the whole card against the founder's bar (2 s and 10 s). Gate: every case.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { IDEA_BOX_CASES, runIdeaBoxEval } from "../idea-box";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("idea box (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts one honest card per case",
    async () => {
      const results = await runAll(IDEA_BOX_CASES, 3, (c) => runIdeaBoxEval(c, client!));
      for (const r of results) {
        if (!r.check.passed) console.warn(`[eval] idea box ${r.caseId}: ${r.check.problems.join(" | ")}${r.error ? ` (${r.error})` : ""}`);
        console.warn(`[eval] idea box ${r.caseId}: first JSON ${r.firstTextMs ?? "-"} ms, card ${r.totalMs} ms (bar: 2,000 and 10,000), cost ${Math.round(r.costMicro / 1_000_000)} US cents (Estimate)`);
      }
      expect(results.filter((r) => !r.check.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
