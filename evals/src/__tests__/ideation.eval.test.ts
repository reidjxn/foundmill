/**
 * Live ideation eval (Opus: `ideationSlate` then `ideation` per card, audit P2). Runs only with MODEL_MODE=live and a
 * key (`pnpm evals`). For every brief: a 6-12 slate with distinct names and angles, a card per slate item that keeps
 * its name and archetype, tight cards with citations, and no archetype the founder ruled out. Also prints how many
 * card calls read the shared prefix from the prompt cache and the wall time to the first card and to the whole set
 * (the founder's wait), so the fan-out's speed and cost are measured on every live run. Gate: every brief.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { IDEATION_BRIEFS, runIdeationEval } from "../ideation";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("ideation (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts a distinct 6-12 slate and a matching card for every item, within the founder's constraints",
    async () => {
      const results = await runAll(IDEATION_BRIEFS, 2, (b) => runIdeationEval(b, client!));
      for (const r of results) {
        if (!r.check.passed) console.warn(`[eval] ideation ${r.briefId}: ${r.check.problems.map((p) => `${p.kind}: ${p.message}`).join(" | ")}${r.error ? ` (${r.error})` : ""}`);
        console.warn(`[eval] ideation ${r.briefId}: ${r.check.cards}/${r.check.slateSize} cards, first card ${r.firstCardMs ?? "-"} ms, set ${r.totalMs} ms, cache reads ${r.cacheReads}/${r.cardCalls}, cost ${r.costMinor} minor (Estimate)`);
      }
      expect(results.filter((r) => !r.check.passed).map((r) => r.briefId)).toEqual([]);
    },
    10 * 60 * 1000,
  );
});
