/**
 * Ponytail and Caveman for coding agents (WP-06 T13), live. Runs only with MODEL_MODE=live and a key (`pnpm evals`).
 * The same coding tasks with and without the two skills; prints the output tokens and acceptance for each arm.
 * Gate: fewer tokens with the skills, and acceptance (right change, nothing extra, a test, a plain hand-back) no lower.
 * If the gate fails the numbers are the report: do not make the skills default-on.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { CODING_CASES, runCodingArm, verdict } from "./coding-skills";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("coding agents with Ponytail and Caveman (live)", () => {
  const client = live ? createEvalClient() : null;
  it(
    "uses fewer output tokens with the same acceptance",
    async () => {
      const runs = CODING_CASES.flatMap((c) => [false, true].map((w) => ({ c, w })));
      const results = await runAll(runs, 3, ({ c, w }) => runCodingArm(client!, c, w));
      for (const r of results) console.warn(`[eval] ${r.caseId} ${r.withSkills ? "with" : "without"}: ${r.outputTokens} output tokens, ${r.accepted ? "accepted" : `refused (${r.problems.join("; ")})`}`);
      const v = verdict(results);
      console.warn(`[eval] coding skills: ${JSON.stringify(v)}, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(v.ship).toBe(true);
    },
    10 * 60 * 1000,
  );
});
