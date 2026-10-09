/**
 * Live logo designer eval (Opus, `logo_designer`). Runs only with MODEL_MODE=live and a key (`pnpm evals`). For every
 * brief (one of them sporty on purpose): the requested number of distinct marks, each valid SVG after the api's
 * sanitiser, none a shield, star, ball or sports image (checked heuristically, see ../logo.ts). Gate: every brief, both for
 * the one-call set (`logo_designer`) and for the api's four parallel single-mark calls (`logo_mark`).
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { LOGO_BRIEFS, runLogoEval, runLogoMarksEval } from "../logo";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("logo designer (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "draws the requested marks, valid after sanitising, with no forbidden shapes",
    async () => {
      const results = await runAll(LOGO_BRIEFS, 3, (b) => runLogoEval(b, client!));
      for (const r of results) {
        if (!r.check.passed) console.warn(`[eval] logo ${r.briefId}: ${r.check.problems.join(" | ")}${r.error ? ` (${r.error})` : ""}`);
        for (const m of r.check.marks) if (m.removed.length) console.warn(`[eval] logo ${r.briefId} / ${m.name}: sanitiser removed ${m.removed.join(", ")}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] logo: ${results.filter((r) => r.check.passed).length}/${results.length} briefs passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.check.passed).map((r) => r.briefId)).toEqual([]);
    },
    10 * 60 * 1000,
  );

  it(
    "the api's path: four parallel single-mark calls (one per direction) make a valid, distinct set",
    async () => {
      const results = await runAll(LOGO_BRIEFS, 3, (b) => runLogoMarksEval(b, client!));
      for (const r of results) if (!r.check.passed) console.warn(`[eval] logo marks ${r.briefId}: ${r.check.problems.join(" | ")}${r.error ? ` (${r.error})` : ""}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] logo marks: ${results.filter((r) => r.check.passed).length}/${results.length} briefs passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => !r.check.passed).map((r) => r.briefId)).toEqual([]);
    },
    10 * 60 * 1000,
  );
});
