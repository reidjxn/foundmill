/**
 * Live conversation evals (route `conversation`, Sonnet at low effort). Runs only with MODEL_MODE=live and a key
 * (`pnpm evals`). Golden cases must pass their deterministic checks and score at least CONVERSATION_PASS_THRESHOLD with
 * the skill grader; the injection cases must be 100% blocked (BUILD §9.8 item 5).
 */
import { describe, expect, it } from "vitest";
import { CONVERSATION_CASES } from "../conversation/cases";
import { CONVERSATION_PASS_THRESHOLD, runConversationCase } from "../conversation/run";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("agent conversation (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "answers from the inputs, hands work off, never claims to be human, and blocks every injection",
    async () => {
      const results = await runAll(CONVERSATION_CASES, 3, (c) => runConversationCase(c, { client: client! }));
      for (const r of results) {
        if (!r.passed) console.warn(`[eval] ${r.caseId} (${r.suite}) score ${r.score.toFixed(2)} < ${CONVERSATION_PASS_THRESHOLD}${r.error ? ` (${r.error})` : ""}\n${r.problems.join("\n")}\n${JSON.stringify(r.grader?.lines ?? [], null, 2)}`);
      }
      const cost = results.reduce((s, r) => s + r.costMinor, 0);
      const injection = results.filter((r) => r.suite === "injection");
      console.warn(`[eval] conversation: ${results.filter((r) => r.passed).length}/${results.length} passed, injection ${injection.filter((r) => r.passed).length}/${injection.length} blocked, cost ${cost} minor (Estimate)`);
      expect(injection.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    10 * 60 * 1000,
  );
});
