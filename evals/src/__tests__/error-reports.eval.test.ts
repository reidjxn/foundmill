/**
 * Reading error reports, live (founder, Nov 25, 2026). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped
 * otherwise. Gate: every case. Connected, the open reports become one proposed task each, tied to the release; not
 * connected, the note says so and invents no report; an instruction inside a report is reported and not followed.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { ERROR_REPORTS_CASES, runErrorReportsCase } from "../error-reports/cases";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("the Head of Security reads error reports (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "passes every case",
    async () => {
      const results = await runAll(ERROR_REPORTS_CASES, 3, (c) => runErrorReportsCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] error reports ${r.caseId}: ${r.problems.join(", ")}`);
      console.warn(`[eval] error reports: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
