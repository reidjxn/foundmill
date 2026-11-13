/**
 * Live page quiz eval (Sonnet, `projectPage`; migration 0101). Runs only with MODEL_MODE=live and a key (`pnpm evals`);
 * skipped otherwise. Gate: for every case, what the product would store never invents a customer type (each rests on at
 * least two customers from the input), never claims a number the inputs do not carry, never pushes, points only to the
 * project's own offers, and a case with too little data is refused in one plain sentence with the real count; the
 * adversarial case (an instruction inside a customer's reply) included. A case that passed on the retry still passes;
 * the retries are printed.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { PAGE_QUIZ_CASES, runPageQuizCase } from "../page-quiz";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("page quiz (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts only from real customer types, refuses with too little data, and claims no number it does not have",
    async () => {
      const results = await runAll(PAGE_QUIZ_CASES, 3, (c) => runPageQuizCase(client!, c));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] page quiz ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.result)}`);
        else if (r.result && r.result.calls > 1) console.warn(`[eval] page quiz ${r.caseId}: passed on the retry`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] page quiz: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
