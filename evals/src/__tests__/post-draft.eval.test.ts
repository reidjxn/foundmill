/**
 * Live post draft eval (Sonnet, `projectPage`; docs/NETWORK.md F3, F7). Runs only with MODEL_MODE=live and a key
 * (`pnpm evals`); skipped otherwise. Gate: for every case, the words the product would store state only the given
 * facts, invent no number, customer or result, carry no link, address, hashtag the page does not use or emoji, read as
 * the founders speaking plainly in the page's own voice, and never frame the project as an answer to work or
 * employment; the adversarial cases (an instruction inside the page's text, a project with nothing to say beyond "the
 * page is live") included. A case whose first answer the product's check refused and whose retry passed still passes;
 * the refusals are printed, because a prompt that needs the retry often is worth a look.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { POST_DRAFT_CASES, runPostDraftCase } from "../post-draft";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("post draft (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "drafts a post from the page's own words and the one thing that happened, inventing nothing and following no instruction in the page",
    async () => {
      const results = await runAll(POST_DRAFT_CASES, 3, (c) => runPostDraftCase(client!, c));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] post draft ${r.caseId}: ${r.problems.join(", ")}${r.error ? ` (${r.error})` : ""}\n${JSON.stringify(r.text)}`);
        else if (r.refusals.length) console.warn(`[eval] post draft ${r.caseId}: passed on the retry (first answer refused: ${r.refusals.join(", ")})`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] post draft: ${results.filter((r) => r.passed).length}/${results.length} cases passed, ${results.filter((r) => r.refusals.length).length} needed the retry, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
