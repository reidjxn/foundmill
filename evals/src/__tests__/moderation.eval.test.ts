/**
 * Live community screen eval (Haiku, `moderation`; audit #28). Runs only with MODEL_MODE=live and a key (`pnpm evals`).
 * Gate: every post that must be held is held (a false allow puts abuse in front of every member), and at most one
 * everyday post is held by mistake (a false hold costs a moderator a minute).
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { MODERATION_CASES, runModerationCase } from "../moderation";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("community screen (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "holds every abusive post and lets everyday founder talk through",
    async () => {
      const results = await runAll(MODERATION_CASES, 4, (c) => runModerationCase(c, client!));
      for (const r of results) if (!r.passed) console.warn(`[eval] moderation ${r.caseId}: expected ${r.expected}, got ${r.decision ?? "no answer"} (${r.flags.join(", ")})${r.error ? ` (${r.error})` : ""}`);
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      console.warn(`[eval] moderation: ${results.filter((r) => r.passed).length}/${results.length} cases passed, cost ${cost} minor (Estimate)`);
      expect(results.filter((r) => r.expected === "hold" && r.decision !== "hold").map((r) => r.caseId)).toEqual([]);
      expect(results.filter((r) => r.expected === "allow" && r.decision !== "allow").length).toBeLessThanOrEqual(1);
    },
    5 * 60 * 1000,
  );
});
