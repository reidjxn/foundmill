/**
 * Live showcase script eval (`projectPage` for the script, `skillGrader` for the judge; docs/THESIS_REVIEW.md §13 item
 * 15). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped otherwise. Gate: for every solo and
 * multi-founder case, the script the product would store passes the code checks and the judge on all five: no people
 * counts, no framing of a solo founder as lacking someone, no work framing, no rankings, facts only.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { SHOWCASE_SCRIPT_CASES, runShowcaseScriptCase } from "../showcase-script";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("showcase script (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "writes shots and a post from the public story only, with no people, no lack, no work, no ranking and nothing invented",
    async () => {
      const results = await runAll(SHOWCASE_SCRIPT_CASES, 3, (c) => runShowcaseScriptCase(client!, c, { judge: true }));
      for (const r of results) if (!r.passed) console.warn(`[eval] showcase script ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.script)}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] showcase script: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
