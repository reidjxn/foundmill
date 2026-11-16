/**
 * Live positioning eval (WP-08 T1; `projectPage` route). Runs only with MODEL_MODE=live and a key (`pnpm evals`);
 * skipped otherwise. Gate: no invented proof, figure or quote; every unsupported line is an assumption; section 1 names
 * one kind of person.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { POSITIONING_CASES, runPositioningCase } from "../positioning";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("positioning notes (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "positioning.from_founder_words and positioning.one_person",
    async () => {
      const results = await runAll(POSITIONING_CASES, 3, (c) => runPositioningCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] positioning ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.notes)}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] positioning: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
