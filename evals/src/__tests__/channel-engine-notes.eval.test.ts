/**
 * Live `channel_engine.reports_prepared_not_launched` (WP-02 T2, Opus `inboxComposer`). Runs only with MODEL_MODE=live
 * and a key (`pnpm evals`); skipped otherwise. Gate: no note about prepared offline-tracking materials says launched,
 * live, sent or published.
 */
import { describe, expect, it } from "vitest";
import { CHANNEL_ENGINE_NOTE_CASES, runChannelEngineNoteCase } from "../channel-engine-notes";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("channel_engine.reports_prepared_not_launched (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "never says a prepared campaign launched, went live, was sent or was published",
    async () => {
      const results = await runAll(CHANNEL_ENGINE_NOTE_CASES, 3, (c) => runChannelEngineNoteCase(c, client!));
      for (const r of results) if (!r.passed) console.warn(`[eval] channel engine note ${r.caseId}: ${r.claims.join(", ")}${r.error ? ` (${r.error})` : ""}`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    4 * 60 * 1000,
  );
});
