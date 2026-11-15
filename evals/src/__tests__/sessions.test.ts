/**
 * Outcome evals in mock mode (WP-05 T6): every case of sessions/cases.ts runs end to end with a scripted agent in place
 * of the Claude Agent SDK (the seeding, the in-process gateway, the orchestrator's live runner and the checks are the
 * real ones), and each check fails on the wrong result. The live run is sessions.eval.test.ts.
 */
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_CASES } from "../sessions/cases";
import { createSessionEvalEnv, FIXTURE_PAGES, MIN_CASE_BUDGET_MINOR, OUTCOME_EVAL_BUDGET_USD, RunBudget, type SessionCase, type SessionEvalEnv } from "../sessions/harness";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof Sdk>();
  const { interceptQuery } = await import("../sessions/harness");
  return { ...actual, query: (call: Parameters<typeof actual.query>[0]) => interceptQuery(actual.query as never, call as never) };
});

const byId = (id: string): SessionCase => SESSION_CASES.find((c) => c.id === id)!;

describe("outcome evals with scripted agents (mock)", () => {
  let env: SessionEvalEnv;
  const previousMode = process.env.MODEL_MODE;

  beforeAll(async () => {
    process.env.MODEL_MODE = "mock";
    env = await createSessionEvalEnv();
  }, 120_000);

  afterAll(async () => {
    await env?.close();
    if (previousMode === undefined) delete process.env.MODEL_MODE;
    else process.env.MODEL_MODE = previousMode;
  });

  it("names the cases of the spec and runs mock (no key)", () => {
    expect(env.live).toBe(false);
    expect(SESSION_CASES.map((c) => c.id)).toEqual(["researcher.report_saved", "researcher.real_citations", "channel_email_automation.not_connected_is_not_sent", "isolation.refused_tools"]);
  });

  for (const c of SESSION_CASES) {
    it(`${c.id} passes with an agent that does it right`, async () => {
      const r = await env.runSessionCase(c);
      expect(r.problems).toEqual([]);
      expect(r.passed).toBe(true);
      // A scripted run costs nothing.
      expect(r.costMinor).toBe(0);
    }, 60_000);
  }

  it("researcher.report_saved fails when the agent ends without saving a report", async () => {
    const c = byId("researcher.report_saved");
    const r = await env.runSessionCase({ ...c, script: c.script.filter((s) => s.tool !== "save_report" && s.tool !== "complete_task") });
    expect(r.passed).toBe(false);
    expect(r.taskStatus).not.toBe("done");
    expect(r.problems.join(" ")).toMatch(/no task_reports row/);
  }, 60_000);

  it("researcher.real_citations fails on a source the session never read", async () => {
    const c = byId("researcher.real_citations");
    const script = c.script.map((s) => (s.tool === "save_report" ? { ...s, args: (ctx: Parameters<typeof s.args>[0]) => ({ ...s.args(ctx), sources: [{ url: "https://made-up-supplier.example/cups", title: "Made up" }] }) } : s));
    const r = await env.runSessionCase({ ...c, script });
    expect(r.passed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/not a page the web served/);
  }, 60_000);

  it("researcher.real_citations fails on a fixture page cited but not read", async () => {
    const c = byId("researcher.real_citations");
    const script = c.script.filter((s) => !(s.tool === "fetch_page" && s.args({ businessId: "", agentId: "", taskId: "", sessionId: "" }).url === FIXTURE_PAGES[2]!.url));
    const r = await env.runSessionCase({ ...c, script });
    expect(r.passed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/cited but never read/);
  }, 60_000);

  it("channel_email_automation.not_connected_is_not_sent fails when the agent calls the task done", async () => {
    const c = byId("channel_email_automation.not_connected_is_not_sent");
    const script = c.script.map((s) => (s.tool === "block_task" ? { connector: "platform", tool: "complete_task", args: (ctx: Parameters<typeof s.args>[0]) => ({ taskId: ctx.taskId, summary: "Sent the welcome email." }) } : s));
    const r = await env.runSessionCase({ ...c, script });
    // Today the runner lets this end done: the project address's refusal (`platform-mail-off`, a deny) is not counted as
    // not connected, so not every outside call was. The check is what catches it.
    if (r.taskStatus === "done") expect(r.passed).toBe(false);
    else expect(r.taskStatus).toBe("blocked");
  }, 60_000);
});

describe("the run budget", () => {
  it("is $2 (Estimate) shared by the whole run, and stops a case that could not finish", () => {
    expect(OUTCOME_EVAL_BUDGET_USD).toBe(2);
    const b = new RunBudget();
    expect(b.totalMinor).toBe(200);
    b.add(150);
    b.add(Number.NaN);
    b.add(-5);
    expect(b.spentMinor).toBe(150);
    expect(b.reached).toBe(false);
    b.add(200 - 150 - MIN_CASE_BUDGET_MINOR + 1);
    expect(b.reached).toBe(true);
  });

  it("a case does not start once the budget is reached", async () => {
    const budget = new RunBudget(5);
    const env = await createSessionEvalEnv({ budget });
    try {
      const r = await env.runSessionCase(SESSION_CASES[0]!);
      expect(r.passed).toBe(false);
      expect(r.problems.join(" ")).toMatch(/run budget .* is reached/);
    } finally {
      await env.close();
    }
  }, 120_000);
});
