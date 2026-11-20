/**
 * Quick replies without a model wait (audit P4; BUILD §11.3 "option click or free text → (free text) Opus compiles a
 * Plan"): a pre-written option compiles in-process with the rule engine, so the click never waits on the plan compiler;
 * free text still goes through it. Hard gates still compile to `request_human_action`, an option the rules cannot map
 * becomes one task for the agent who asked, and a "not now" option records the choice and runs nothing.
 */
import { repos, type Agent, type Business } from "@foundmill/db";
import { MockModelClient, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileOptionPlan, type PlanContext } from "../services/plans";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "inboxopt" });
}, 120_000);
afterAll(() => hz.close());

/** A model client that takes `delayMs` per call and records every route it was asked for. */
function slowModels(delayMs: number) {
  const inner = new MockModelClient();
  const routes: string[] = [];
  const client: ModelClient = {
    mode: "mock",
    complete: (async (req: CompleteRequest) => {
      routes.push(req.route);
      await new Promise((r) => setTimeout(r, delayMs));
      return inner.complete(req as never);
    }) as ModelClient["complete"],
  };
  return { client, routes };
}

async function decisionItem(options: { id: string; label: string; consequence: string }[]) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject: "What next for the first channel?",
    body_md: "The team needs a steer on the first channel before the next round of work.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    // A decision offers at least two options; the second is a neutral alternative.
    decision: { options: [...options, { id: "other", label: "Something else", consequence: "Write what should happen instead." }].map((o, i) => ({ ...o, recommended: i === 0, cost_minor: 0, reversible: true })), free_text: true, expires_at: null },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

const callerWith = async (models: ModelClient) => {
  const { createCaller } = await import("../router");
  return createCaller({ ...hz.deps, models }, { userId: hz.A.ownerId, email: "owner@test.local" });
};

describe("inbox.decide with a pre-written option (audit P4)", () => {
  it("never calls a model on an option click, even when the model is slow; free text still does", async () => {
    const { client, routes } = slowModels(3_000);
    const caller = await callerWith(client);
    const item = await decisionItem([{ id: "seo", label: "Start SEO content", consequence: "The content agent writes the first four articles." }]);
    const started = Date.now();
    const result = await caller.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "seo" });
    const elapsed = Date.now() - started;
    expect(routes).toEqual([]);
    expect(elapsed).toBeLessThan(2_000);
    expect(result.plan.origin).toBe("option");
    expect(result.plan.actions.map((a) => a.type)).toContain("create_task");
    expect(result.item.state).toBe("answered");
    expect(result.followUp?.subject).toMatch(/^Decided:/);
    // The question keeps its own mark: "Decided: What next for the first channel?", never "?." (FR-21).
    expect(result.followUp?.bodyMd.split("\n")[0]).toBe("Decided: What next for the first channel?");

    const fast = slowModels(0);
    const second = await callerWith(fast.client);
    const other = await decisionItem([{ id: "a", label: "Option A", consequence: "x" }]);
    await second.inbox.decide({ businessId: hz.A.businessId, itemId: other.id, freeText: "spend €100 on Google ads this week" });
    expect(fast.routes).toEqual(["planCompiler"]);
  });

  it("an option the rules cannot map becomes one task for the agent who asked", async () => {
    const caller = await callerWith(slowModels(0).client);
    const item = await decisionItem([{ id: "narrow", label: "Go with the narrower positioning", consequence: "Copy changes on the landing page." }]);
    const result = await caller.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "narrow" });
    expect(result.plan.actions).toHaveLength(1);
    expect(result.plan.actions[0]).toMatchObject({ type: "create_task", agentId: hz.A.agentId, status: "done" });
    expect(result.plan.actions[0]!.params).toMatchObject({ title: "Go with the narrower positioning", decided_option: "narrow" });
    const tasks = await repos.tasks.list(hz.db, hz.A.businessId, { limit: 200 });
    expect(tasks.items.some((t) => t.title === "Go with the narrower positioning" && t.assigneeAgentId === hz.A.agentId)).toBe(true);
  });

  it("a 'not now' option records the choice and runs nothing; a hard-gated option asks the founder", async () => {
    const caller = await callerWith(slowModels(0).client);
    const item = await decisionItem([{ id: "later", label: "Not now", consequence: "We revisit after the next round of work." }]);
    const result = await caller.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "later" });
    expect(result.plan.actions.map((a) => a.type)).toEqual(["reply_only"]);
    expect(result.followUp?.bodyMd).toMatch(/You chose "Not now"; nothing runs now/);
    expect(result.followUp?.bodyMd).not.toMatch(/Question:/);

    const gated = await decisionItem([{ id: "pay", label: "Pay the supplier invoice", consequence: "The invoice is settled today." }]);
    const paid = await caller.inbox.decide({ businessId: hz.A.businessId, itemId: gated.id, chosenOption: "pay" });
    expect(paid.plan.actions.map((a) => a.type)).toEqual(["request_human_action"]);
    expect(paid.evaluations[0]!.hardGate).toBe(true);
  });
});

describe("compileOptionPlan", () => {
  const agent = { id: "00000000-0000-4000-8000-000000000001", name: "Nadia", role: "Distribution lead", agentType: "department_lead", departmentIds: [] } as unknown as Agent;
  const ctx: PlanContext = { business: { id: "b", name: "Ledgerly" } as Business, agents: [agent], holidayActive: false, currency: "EUR" };
  const item = { fromAgentId: agent.id, subject: "Paid acquisition?" };

  it("maps channel options to typed actions with the option's own amount", () => {
    const plan = compileOptionPlan({ id: "a", label: "Spend €100 on Google ads this week" }, item, ctx);
    expect(plan.source).toBe("rules");
    expect(plan.actions.map((a) => a.type)).toEqual(["enable_channel", "set_budget", "create_task"]);
    expect(plan.actions[1]!.params).toMatchObject({ amount_minor: 10_000, currency: "EUR" });
  });

  it("tells a no-action option from one that only starts like one", () => {
    for (const label of ["Not now", "Not yet.", "Skip this", "Hold off", "Do nothing", "Wait and see", "Keep things as they are"]) {
      expect(compileOptionPlan({ id: "x", label }, item, ctx).actions.map((a) => a.type), label).toEqual(["reply_only"]);
    }
    for (const label of ["Hold off on hiring until revenue", "Wait for the pilot results", "Hold a webinar for CFOs"]) {
      expect(compileOptionPlan({ id: "x", label }, item, ctx).actions.map((a) => a.type), label).not.toEqual(["reply_only"]);
    }
  });

  it("never answers a clicked option with a clarifying question", () => {
    const plan = compileOptionPlan({ id: "x", label: "Go with the narrower positioning", consequence: "Copy changes on the landing page." }, item, ctx);
    expect(plan.actions.every((a) => a.type !== "reply_only")).toBe(true);
    expect(plan.summary).toMatch(/Nadia carries out your choice/);
  });
});

describe("an answered item costs nothing to answer again (security review 2026-10-10)", () => {
  it("free text on an answered item is refused before the plan compiler runs, through inbox.decide and the Inbox reply", async () => {
    const first = await callerWith(slowModels(0).client);
    const item = await decisionItem([{ id: "seo", label: "Start SEO content", consequence: "The content agent writes the first four articles." }]);
    await first.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "seo" });

    const { client, routes } = slowModels(0);
    const again = await callerWith(client);
    for (let i = 0; i < 3; i++) {
      await expect(again.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "spend €100 on Google ads this week" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already answered/) });
    }
    await expect(again.agent.conversation.inboxReply({ businessId: hz.A.businessId, itemId: item.id, text: "Spend €100 on Google ads this week" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(routes).toEqual([]);
    expect(await repos.inbox.decisionsFor(hz.db, hz.A.businessId, item.id)).toHaveLength(1);
  });
});
