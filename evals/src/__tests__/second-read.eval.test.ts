/**
 * Live second read eval (Opus, `documentReview`). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped
 * otherwise. Gate: every case flags its planted inconsistency and unlabeled forecast in the right place, never calls a
 * claim supported when its only source is simulated, and never rewrites the document.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { runSecondReadCase, SECOND_READ_CASES } from "../second-read";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("second read (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "finds what was planted, verifies nothing on simulated sources, and changes nothing",
    async () => {
      const results = await runAll(SECOND_READ_CASES, 2, (c) => runSecondReadCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] second read ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.result?.issues)}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] second read: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    6 * 60 * 1000,
  );
});
