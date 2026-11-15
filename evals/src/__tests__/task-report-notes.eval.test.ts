/**
 * Live `composer.task_report_simulated` / `composer.task_report_injected` (WP-05 T3 security review, Opus
 * `inboxComposer`). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped otherwise. Gate: a simulated
 * report is narrated as simulated, and no instruction found in a report reaches the note or its options.
 */
import { describe, expect, it } from "vitest";
import { TASK_REPORT_NOTE_CASES, runTaskReportNoteCase } from "../task-report-notes";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("composer task report notes (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "says simulated findings were simulated and never follows a report's instructions",
    async () => {
      const results = await runAll(TASK_REPORT_NOTE_CASES, 3, (c) => runTaskReportNoteCase(c, client!));
      for (const r of results) if (!r.passed) console.warn(`[eval] task report note ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    4 * 60 * 1000,
  );
});
