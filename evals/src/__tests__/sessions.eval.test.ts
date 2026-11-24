/**
 * Outcome evals (WP-05 T6): a session with tools reaches a result, checked on the database. Live with MODEL_MODE=live and
 * ANTHROPIC_API_KEY (the nightly workflow `.github/workflows/evals-outcomes.yml`); every case's cost comes off one run
 * budget of OUTCOME_EVAL_BUDGET_USD (Estimate), and the run fails once it is reached. Without a key the same cases run
 * with scripted agents in sessions.test.ts.
 */
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isLiveEvalEnabled } from "../harness";
import { SESSION_CASES } from "../sessions/cases";
import { createSessionEvalEnv, OUTCOME_EVAL_BUDGET_USD, type SessionCaseResult, type SessionEvalEnv } from "../sessions/harness";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof Sdk>();
  const { interceptQuery } = await import("../sessions/harness");
  return { ...actual, query: (call: Parameters<typeof actual.query>[0]) => interceptQuery(actual.query as never, call as never) };
});

const live = isLiveEvalEnabled();

describe.skipIf(!live)("outcome evals: sessions with tools (live)", () => {
  let env: SessionEvalEnv;
  const results: SessionCaseResult[] = [];

  beforeAll(async () => {
    env = await createSessionEvalEnv();
    expect(env.live).toBe(true);
  }, 120_000);

  afterAll(async () => {
    const spent = env?.budget.spentMinor ?? 0;
    console.warn(`[eval] outcome evals: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${spent.toFixed(2)} minor of ${OUTCOME_EVAL_BUDGET_USD * 100} (Estimate)`);
    await env?.close();
  });

  for (const c of SESSION_CASES) {
    it(
      c.id,
      async () => {
        const r = await env.runSessionCase(c);
        results.push(r);
        console.warn(`[eval] ${r.passed ? "PASS" : "FAIL"} ${c.id}: ${r.outcome ?? "not run"} / task ${r.taskStatus ?? "-"}, cost ${r.costMinor.toFixed(2)} minor (Estimate); run spent ${env.budget.spentMinor.toFixed(2)}${r.problems.length ? `; problems: ${r.problems.join(" | ")}\ntools: ${r.toolTrail || "none"}${r.reportExcerpt ? `\nreport: ${r.reportExcerpt}` : ""}` : ""}`);
        expect(r.problems).toEqual([]);
        expect(env.budget.spentMinor).toBeLessThanOrEqual(env.budget.totalMinor);
      },
      15 * 60 * 1000,
    );
  }

  it("the run stayed within its budget", () => {
    expect(env.budget.reached).toBe(false);
    expect(env.budget.spentMinor).toBeLessThanOrEqual(env.budget.totalMinor);
  });
});
