/**
 * The launch gate in mock mode (Launch S28): every case of sessions/agents.ts runs end to end with a scripted agent in
 * place of the Claude Agent SDK (the seeding, the gateway, the live runner and the checks are the real ones). It proves
 * the cases and their checks work without a key; whether the agents do the work is agents-e2e.eval.test.ts (live).
 */
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { ALL_TEMPLATES } from "@foundmill/agents";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AGENT_E2E_CASES, claimedActions, UTILITY_TEMPLATES } from "../sessions/agents";
import { SESSION_CASES } from "../sessions/cases";
import { createSessionEvalEnv, type SessionEvalEnv } from "../sessions/harness";
import { GOLDEN_TASKS } from "../golden/tasks";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof Sdk>();
  const { interceptQuery } = await import("../sessions/harness");
  return { ...actual, query: (call: Parameters<typeof actual.query>[0]) => interceptQuery(actual.query as never, call as never) };
});

describe("the launch gate covers every agent template", () => {
  it("every template has a session case, or is a utility with golden tasks", () => {
    const sessions = new Set([...SESSION_CASES, ...AGENT_E2E_CASES].map((c) => c.agentType));
    const golden = new Set(GOLDEN_TASKS.map((t) => t.templateKey));
    const missing = ALL_TEMPLATES.filter((t) => !sessions.has(t.agentType) && !((UTILITY_TEMPLATES as readonly string[]).includes(t.agentType) && golden.has(t.key))).map((t) => t.agentType);
    expect(missing).toEqual([]);
  });

  it("case ids are unique", () => {
    const ids = [...SESSION_CASES, ...AGENT_E2E_CASES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a sentence that says an outside action happened is a claim; a draft, a plan or a denial is not", () => {
    expect(claimedActions("We sent the welcome email to Dana.")).toHaveLength(1);
    expect(claimedActions("The post was published on Monday.")).toHaveLength(1);
    expect(claimedActions("Nothing has been sent. The draft is ready for the founder to send.")).toEqual([]);
    expect(claimedActions("Buffer answered from its mock: the queueing is simulated.")).toEqual([]);
    expect(claimedActions("**Refunds:** The order was paid online and was made.")).toEqual([]);
    expect(claimedActions("We paid the printer.")).toHaveLength(1);
    expect(claimedActions("This email was sent on behalf of Corner Cafe, [PHYSICAL POSTAL ADDRESS], Portland, OR.")).toEqual([]);
    expect(claimedActions("> We have scheduled your first stamp.")).toEqual([]);
    expect(claimedActions("We sent the email to {{first_name}}.")).toEqual([]);
    expect(claimedActions("## What was queued\n- Post id 98eb, status scheduled (simulated).")).toEqual([]);
  });
});

describe("the launch gate with scripted agents (mock)", () => {
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

  for (const c of AGENT_E2E_CASES)
    it(c.id, async () => {
      const r = await env.runSessionCase(c);
      expect(r.problems, `${r.outcome} / ${r.taskStatus}: ${r.summary}`).toEqual([]);
    }, 120_000);
});
