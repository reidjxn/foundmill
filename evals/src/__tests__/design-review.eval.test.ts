/**
 * Live design review eval (Opus on the `designReview` vision route, item 13). Runs only with MODEL_MODE=live and a key
 * (`pnpm evals`); skipped otherwise. Gate: every planted problem in the fixture screenshots is flagged on its page under
 * its principle, no fix praises, no page it was not shown is judged, a blank page gets no fix, and pages the sandbox
 * could not show are never reviewed.
 */
import { describe, expect, it } from "vitest";
import { DESIGN_REVIEW_CASES, runDesignReviewCase } from "../design-review";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("design review (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "flags the planted problems from the screenshots and never praises or judges what it did not see",
    async () => {
      const results = await runAll(DESIGN_REVIEW_CASES, 3, (c) => runDesignReviewCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] design review ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.review)}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] design review: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
