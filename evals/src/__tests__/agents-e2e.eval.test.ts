/**
 * The launch gate, live (Launch S28; founder, Nov 24, 2026: "100% of our agents have to work end to end for our users
 * when we launch"). Every agent template's most common real task as a whole session with its real tools
 * (sessions/agents.ts and the T6 cases in sessions/cases.ts), and the utilities' golden tasks (they run no session).
 * Run by `.github/workflows/evals-agents-e2e.yml` only, never on a pull request. Its budget is AGENTS_E2E_BUDGET_USD per
 * pass (Estimate); the gate passes when two consecutive passes are all green. `AGENTS_E2E_ONLY` (comma-separated case
 * ids or template prefixes) reruns a subset.
 */
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runGoldenTask } from "../harness";
import { GOLDEN_TASKS } from "../golden/tasks";
import { AGENT_E2E_CASES, UTILITY_TEMPLATES } from "../sessions/agents";
import { SESSION_CASES } from "../sessions/cases";
import { createSessionEvalEnv, RunBudget, type SessionCaseResult, type SessionEvalEnv } from "../sessions/harness";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof Sdk>();
  const { interceptQuery } = await import("../sessions/harness");
  return { ...actual, query: (call: Parameters<typeof actual.query>[0]) => interceptQuery(actual.query as never, call as never) };
});

/** One pass of the whole gate, US dollars (Estimate): about 47 sessions at 5 to 12 cents and five golden tasks. */
export const AGENTS_E2E_BUDGET_USD = 10;

const live = isLiveEvalEnabled();
const only = (process.env.AGENTS_E2E_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const picked = (id: string) => only.length === 0 || only.some((o) => id.startsWith(o));
const cases = [...SESSION_CASES, ...AGENT_E2E_CASES].filter((c) => picked(c.id));
const utilityTasks = GOLDEN_TASKS.filter((t) => (UTILITY_TEMPLATES as readonly string[]).includes(t.templateKey) && picked(t.id));

describe.skipIf(!live)("launch gate: every agent end to end (live)", () => {
  let env: SessionEvalEnv;
  const budget = new RunBudget(AGENTS_E2E_BUDGET_USD * 100);
  const results: SessionCaseResult[] = [];
  const failed: string[] = [];

  beforeAll(async () => {
    env = await createSessionEvalEnv({ budget });
    expect(env.live).toBe(true);
  }, 120_000);

  afterAll(async () => {
    const passed = results.filter((r) => r.passed).length;
    console.warn(`[eval] launch gate: sessions ${passed}/${results.length} passed; failed: ${failed.join(", ") || "none"}; cost ${budget.spentMinor.toFixed(2)} minor of ${AGENTS_E2E_BUDGET_USD * 100} (Estimate)`);
    await env?.close();
  });

  for (const c of cases)
    it(
      c.id,
      async () => {
        const r = await env.runSessionCase(c);
        results.push(r);
        if (!r.passed) failed.push(c.id);
        console.warn(`[eval] ${r.passed ? "PASS" : "FAIL"} ${c.id}: ${r.outcome ?? "not run"} / task ${r.taskStatus ?? "-"}, cost ${r.costMinor.toFixed(2)} minor (Estimate); run spent ${budget.spentMinor.toFixed(2)}${r.problems.length ? `; problems: ${r.problems.join(" | ")}\ntools: ${r.toolTrail || "none"}${r.notes ? `\nnotes:\n${r.notes}` : ""}${r.reportExcerpt ? `\nreport: ${r.reportExcerpt}` : ""}` : ""}`);
        expect(r.problems).toEqual([]);
      },
      15 * 60 * 1000,
    );

  for (const task of utilityTasks)
    it(
      `utility golden ${task.id}`,
      async () => {
        expect(budget.reached).toBe(false);
        const r = await runGoldenTask(task, { client: createEvalClient() });
        budget.add(r.costMinor);
        if (!r.passed) failed.push(task.id);
        console.warn(`[eval] ${r.passed ? "PASS" : "FAIL"} ${task.id}: score ${r.score.toFixed(2)} of ${r.threshold}${r.error ? ` (${r.error})` : ""}; cost ${r.costMinor} minor (Estimate)${r.passed ? "" : `\n${r.checks.filter((x) => !x.passed).map((x) => `check ${x.kind}${x.detail ? `: ${x.detail}` : ""}`).join("\n")}\n${r.outputText.slice(0, 1500)}`}`);
        expect(r.passed).toBe(true);
      },
      5 * 60 * 1000,
    );

  it("the pass stayed within its budget", () => {
    expect(budget.reached).toBe(false);
  });
});
