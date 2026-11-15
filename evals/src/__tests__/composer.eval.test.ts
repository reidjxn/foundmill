/**
 * Live Composer eval (Opus, `inboxComposer`; UX plan §7.19). Runs only with MODEL_MODE=live and a key (`pnpm evals`).
 * Over the AC-11.3.1 corpus (100 notes): the replace-tier gate over body, labels, consequences and because must have no
 * hit on any note, every recommended option must carry a because, and the rubric (the business stake first, each term
 * defined or avoided, the recommended option has a because) must average at least the pass mark.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { COMPOSER_CORPUS, COMPOSER_PARKED_CASES, COMPOSER_PASS_THRESHOLD, runComposerCase, runParkedClauseCase, summariseComposer } from "../composer";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("inbox composer (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "writes 100 plain-language notes: no replace-tier term, a because on every recommended option, the rubric above the pass mark",
    async () => {
      const results = await runAll(COMPOSER_CORPUS, 3, (c) => runComposerCase(c, client!));
      const summary = summariseComposer(results);
      for (const r of results) {
        if (r.namingHits.length) console.warn(`[eval] composer ${r.caseId} naming: ${r.namingHits.map((h) => `${h.field} ${h.problem} "${h.text}"`).join(" | ")}`);
        if (r.hits.length) console.warn(`[eval] composer ${r.caseId}: ${r.hits.map((h) => `${h.field} "${h.term}" (${h.text})`).join(" | ")}`);
        if (r.error) console.warn(`[eval] composer ${r.caseId}: ${r.error}`);
      }
      console.warn(`[eval] composer: ${summary.passed}/${summary.total} passed, mean score ${summary.meanScore.toFixed(2)}, cost ${summary.costMinor} minor (Estimate)`);
      expect(summary.plainFailed).toEqual([]);
      expect(summary.namingFailed).toEqual([]);
      expect(summary.noBecause).toEqual([]);
      expect(summary.meanScore).toBeGreaterThanOrEqual(COMPOSER_PASS_THRESHOLD);
    },
    30 * 60 * 1000,
  );

  it(
    "composer.parked_clause: a parked task is said once, explained in plain words, never as a request or an option (WP-05 T18)",
    async () => {
      const results = await runAll(COMPOSER_PARKED_CASES, 3, (c) => runParkedClauseCase(c, client!));
      for (const r of results) if (!r.passed) console.warn(`[eval] composer parked ${r.caseId}: ${r.problems.join(" | ")}${r.error ? ` (${r.error})` : ""}`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    4 * 60 * 1000,
  );
});
