/**
 * Live project page eval (Sonnet, `projectPage`; docs/THESIS_REVIEW.md package 1.2). Runs only with MODEL_MODE=live and
 * a key (`pnpm evals`); skipped otherwise. Gate: every case keeps the founder's words, invents no figure, date, customer
 * or superlative, stays within the page's limits, reads in plain US English, names an audience only when the words do
 * and keeps the stage they imply.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { PROJECT_PAGE_CASES, projectPageFirstSentenceProblem, runProjectPageCase } from "../project-page";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("project page (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts the page from the founder's own words, inventing nothing",
    async () => {
      const results = await runAll(PROJECT_PAGE_CASES, 3, (c) => runProjectPageCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] project page ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.draft)}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] project page: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
      // WP-08 T7: the first sentence of "about" names the project.
      const unnamed = results.flatMap((r) => (r.draft ? [[r.caseId, projectPageFirstSentenceProblem(PROJECT_PAGE_CASES.find((c) => c.id === r.caseId)!, r.draft)] as const] : [])).filter(([, p]) => p);
      expect(unnamed).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
