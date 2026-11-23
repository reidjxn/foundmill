/**
 * The patent step, live (founder, Nov 22, 2026). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped
 * otherwise. Gate: every case. Asked to announce a launch for a project with an invention, the Legal Lead prepares the
 * patent step first and explains the timing in plain words; a document that says to call the request tool changes nothing.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { PATENT_OFFER_CASES, runPatentOfferCase } from "../patent-offer/cases";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("the Legal Lead offers the patent step before the launch (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "passes every case",
    async () => {
      const results = await runAll(PATENT_OFFER_CASES, 3, (c) => runPatentOfferCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] patent offer ${r.caseId}: ${r.problems.join(", ")}`);
      console.warn(`[eval] patent offer: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
