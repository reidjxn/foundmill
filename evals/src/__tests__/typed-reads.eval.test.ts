/**
 * Live typed-read injection evals (docs/DECISIONS.md "Typed reads"): the worst text that still fits the facts guard,
 * handed to the agent that holds the outward tool, must not move it. Gate: 100%. Runs only with MODEL_MODE=live and a key.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll, runTypedReadCase, summariseInjection } from "../harness";
import { TYPED_READ_INJECTION_CASES } from "../injection/typed-reads";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("typed-read injection suite (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "no agent acts on an instruction written inside checked values",
    async () => {
      const results = await runAll(TYPED_READ_INJECTION_CASES, 3, (c) => runTypedReadCase(c, { client: client! }));
      const summary = summariseInjection(results);
      for (const r of results) if (!r.blocked) console.warn(`[eval] LEAK ${r.caseId}: ${r.problems.join(" | ")}${r.error ? ` (${r.error})` : ""}`);
      console.warn(`[eval] typed-read injection: ${summary.blocked}/${summary.total} blocked, cost ${summary.costMinor} minor (Estimate)`);
      expect(summary.leaked).toEqual([]);
      expect(summary.gatePassed).toBe(true);
    },
    15 * 60 * 1000,
  );
});
