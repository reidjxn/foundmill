/**
 * The go-to-market evals that run every night against a live model (WP-08 T12; `.github/workflows/evals-go-to-market.yml`).
 * Each entry is a live suite that already exists next to the task that added it; the workflow runs exactly these files.
 * `evals/src/__tests__/go-to-market.test.ts` fails when a file is missing or the workflow runs a different list.
 */
export const GO_TO_MARKET_EVALS = [
  { task: "T1", file: "positioning.eval.test.ts", covers: "positioning.from_founder_words, positioning.one_person" },
  { task: "T4", file: "post-draft.eval.test.ts", covers: "the first post draft for each subject" },
  { task: "T4", file: "channel-creative.eval.test.ts", covers: "channel creative from the positioning notes" },
  { task: "T7", file: "project-page.eval.test.ts", covers: "the page draft, its first sentence and no invented price" },
] as const;

export const GO_TO_MARKET_EVAL_FILES: readonly string[] = GO_TO_MARKET_EVALS.map((e) => e.file);
