/**
 * Outcome evals in mock mode (WP-05 T6): every case of sessions/cases.ts runs end to end with a scripted agent in place
 * of the Claude Agent SDK (the seeding, the in-process gateway, the orchestrator's live runner and the checks are the
 * real ones), and each check fails on the wrong result. The live run is sessions.eval.test.ts.
 */
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { searchedUrls, SESSION_CASES } from "../sessions/cases";
import { createSessionEvalEnv, FIXTURE_PAGES, MIN_CASE_BUDGET_MINOR, OUTCOME_EVAL_BUDGET_USD, RunBudget, type SessionCase, type SessionEvalEnv, type SessionObservation } from "../sessions/harness";

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
    expect(SESSION_CASES.map((c) => c.id)).toEqual(["researcher.report_saved", "researcher.real_citations", "researcher.unmet_line_goes_to_founder", "researcher.free_plan_searches_and_reads", "product_researcher.nothing_connected_still_finishes", "product_lead.revision_saves_report", "sourcing_manufacturing.records_suppliers", "channel_email_automation.not_connected_is_not_sent", "isolation.refused_tools", "backend_engineer.fixes_failing_test"]);
  });

  it("backend_engineer.fixes_failing_test: the failing run goes back with its output, and the run after the fix passes", async () => {
    const c = byId("backend_engineer.fixes_failing_test");
    let seen: SessionObservation | null = null;
    const r = await env.runSessionCase({ ...c, check: (o) => ((seen = o), c.check(o)) });
    expect(r.problems).toEqual([]);
    const o = seen as SessionObservation | null;
    expect(o?.tests).toEqual([{ passed: 0, failed: 1 }, { passed: 1, failed: 0 }]);
    expect(o?.turns).toHaveLength(1);
    expect(o?.turns[0]).toMatch(/^The acceptance tests failed\. Command: pnpm test\. 0 passed, 1 failed\. Last output:\n[\s\S]*0\.008 !== 0\.08/);
    expect(r.taskStatus).toBe("done");
  }, 60_000);

  it("backend_engineer.fixes_failing_test fails when the engineer never fixes it: two fix turns, then blocked", async () => {
    const c = byId("backend_engineer.fixes_failing_test");
    const wrong = { write: "pricing.json", content: `${JSON.stringify({ currency: "USD", salesTaxRate: 0.008 }, null, 2)}\n` };
    const r = await env.runSessionCase({ ...c, codeScript: [wrong, { endTurn: true }, wrong, { endTurn: true }, wrong] });
    expect(r.passed).toBe(false);
    expect(r.taskStatus).toBe("blocked");
    expect(r.problems.join(" ")).toMatch(/not done/);
    expect(r.problems.join(" ")).toMatch(/last acceptance run did not pass/);
  }, 60_000);

  it("backend_engineer.fixes_failing_test fails when the engineer edits the test instead", async () => {
    const c = byId("backend_engineer.fixes_failing_test");
    const r = await env.runSessionCase({ ...c, codeScript: [{ write: "pricing.test.js", content: "// skipped\n" }] });
    expect(r.passed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/test file was changed/);
  }, 60_000);

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

  it("researcher.unmet_line_goes_to_founder fails when every line really holds: nothing is handed over then", async () => {
    const c = byId("researcher.unmet_line_goes_to_founder");
    const both = [{ line: 1, met: true, reportSection: "Suppliers compared" }, { line: 2, met: true, reportSection: "Sample request" }];
    const script = c.script.map((s) => (s.tool === "complete_task" ? { ...s, args: (ctx: Parameters<typeof s.args>[0]) => ({ taskId: ctx.taskId, summary: "Compared.", acceptance: both }) } : s));
    const r = await env.runSessionCase({ ...c, script });
    expect(r.taskStatus).toBe("done");
    expect(r.passed).toBe(false);
  }, 60_000);

  it("sourcing_manufacturing.records_suppliers: citing create_entity for a line is refused at once, and the report section it cites next ends the task done", async () => {
    // The nightly's failure (Nov 18 to 20): the live agent cited the platform tool that recorded the suppliers, which
    // never counts, and complete_task took it without a word, so the task ended blocked with line 1 not met.
    const c = byId("sourcing_manufacturing.records_suppliers");
    const finish = c.script.find((s) => s.tool === "complete_task")!;
    const cited = { ...finish, args: (ctx: Parameters<typeof finish.args>[0]) => ({ taskId: ctx.taskId, summary: "Recorded two suppliers.", acceptance: [{ line: 1, met: true, tool: "create_entity" }, { line: 2, met: true, reportSection: "RFQ pack draft" }] }) };
    let seen: SessionObservation | null = null;
    const r = await env.runSessionCase({ ...c, script: c.script.flatMap((s) => (s.tool === "complete_task" ? [cited, s] : [s])), check: (o) => ((seen = o), c.check(o)) });
    const o = seen as SessionObservation | null;
    const completes = o?.toolCalls.filter((t) => t.tool === "complete_task") ?? [];
    expect(completes).toHaveLength(2);
    expect(completes[0]!.resultSummary).toMatch(/"ok":false.*line 1 cites create_entity, a tool inside the project/);
    expect(r.problems).toEqual([]);
    expect(r.taskStatus).toBe("done");
  }, 60_000);

  it("researcher.real_citations fails on a source the session never read", async () => {
    const c = byId("researcher.real_citations");
    const script = c.script.map((s) => (s.tool === "save_report" ? { ...s, args: (ctx: Parameters<typeof s.args>[0], seen: readonly unknown[]) => ({ ...s.args(ctx, seen), sources: [{ url: "https://made-up-supplier.example/cups", title: "Made up" }] }) } : s));
    const r = await env.runSessionCase({ ...c, script });
    expect(r.passed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/not a page the web served/);
  }, 60_000);

  it("researcher.real_citations fails on a fixture page cited but not read", async () => {
    const c = byId("researcher.real_citations");
    // The script reads the first three results in order and cites them; this one skips the third read.
    const thirdRead = c.script.filter((s) => s.tool === "fetch_page")[2];
    const script = c.script.filter((s) => s !== thirdRead);
    const r = await env.runSessionCase({ ...c, script });
    expect(r.passed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/cited but never read/);
  }, 60_000);

  // Live run 43771748489 (Nov 15, 2026): the researcher holds an irreversible tool (request_human_action), so it reads web
  // results through the quarantined reader's digest, which has no addresses: it found nothing to read and blocked.
  it("a researcher on the reader's digest gets the search's addresses as facts, and not the raw results", async () => {
    const c = byId("researcher.report_saved");
    let seen: readonly unknown[] = [];
    const script = [c.script[0]!, { connector: "platform", tool: "list_tasks", args: (_ctx: unknown, s: readonly unknown[]) => {
      seen = [...s];
      return {};
    } }];
    await env.runSessionCase({ ...c, script });
    const data = (seen[0] as { result: { data: { quarantined?: boolean; content: unknown } } }).result.data;
    expect(data.quarantined).toBe(true);
    expect(JSON.stringify(data.content)).not.toContain("greencup-supply.example");
    expect(searchedUrls(seen)).toEqual(FIXTURE_PAGES.map((p) => p.url));
  }, 60_000);

  it("channel_email_automation.not_connected_is_not_sent: both sends answer not connected, not the basis policy, and the task ends done with nothing sent", async () => {
    const c = byId("channel_email_automation.not_connected_is_not_sent");
    let seen: SessionObservation | undefined;
    const r = await env.runSessionCase({ ...c, check: (o) => ((seen = o), c.check(o)) });
    const sends = seen!.toolCalls.filter((t) => t.tool === "send_mail");
    expect(sends.map((t) => t.connectorKey)).toEqual(["sendgrid", "platform_mail"]);
    expect(sends[0]!.resultSummary).toMatch(/integration_not_connected/);
    expect(sends[1]!.resultSummary).toMatch(/platform-mail-off/);
    expect(sends.some((t) => /mail-needs-basis/.test(t.resultSummary))).toBe(false);
    expect(seen!.result.outcome).toBe("done");
    expect(seen!.needsYou).toHaveLength(1);
    expect(seen!.needsYou[0]!.bodyMd).toMatch(/Connect .+ in Settings › Integrations/);
    expect(r.problems).toEqual([]);
  }, 60_000);

  it("channel_email_automation.not_connected_is_not_sent fails when the agent saves no draft", async () => {
    const c = byId("channel_email_automation.not_connected_is_not_sent");
    const r = await env.runSessionCase({ ...c, script: c.script.filter((s) => s.tool !== "save_report" && s.tool !== "complete_task") });
    expect(r.passed).toBe(false);
    expect(r.taskStatus).toBe("blocked");
  }, 60_000);

  it("product_researcher.nothing_connected_still_finishes fails when the agent blocks instead of finishing", async () => {
    const c = byId("product_researcher.nothing_connected_still_finishes");
    const r = await env.runSessionCase({ ...c, script: [{ connector: "platform", tool: "block_task", args: (ctx) => ({ taskId: ctx.taskId, reason: "Google Drive is not connected." }) }] });
    expect(r.passed).toBe(false);
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
