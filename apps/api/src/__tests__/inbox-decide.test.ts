import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "decide" });
}, 120_000);
afterAll(() => hz.close());

async function decisionItem(subject: string) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "The team needs a steer on the first channel. Outbound is the recommended route for a narrow ICP.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: "outbound", label: "Outbound to a narrow ICP", recommended: true, consequence: "Lead generation starts first.", cost_minor: 0, reversible: true },
        { id: "content", label: "Content first", recommended: false, consequence: "SEO and content start first.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("inbox.decide (BUILD §11.3, AC-11.3.3/4/5)", () => {
  it("an option click compiles a plan, marks the item answered, releases Continue, writes decision.made and a follow-up", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await decisionItem("Where should the first customer come from?");
    const before = await owner.inbox.list({ businessId: hz.A.businessId, tab: "respond" });
    expect(before.blocking).toBeGreaterThan(0);

    const result = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "outbound" });
    expect(result.item.state).toBe("answered");
    expect(result.item.blocksContinue).toBe(false);
    expect(result.decision.chosenOption).toBe("outbound");
    expect(result.plan.origin).toBe("option");
    expect(result.plan.actions.length).toBeGreaterThan(0);
    expect(result.followUp?.type).toBe("update");
    expect(result.followUp?.subject).toMatch(/^Decided:/);

    const events = await repos.events.list(hz.db, hz.A.businessId, { type: "decision.made" });
    expect(events.items.some((e) => (e.payload as { inboxItemId: string }).inboxItemId === item.id)).toBe(true);
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "inbox.decide" });
    expect(audit.items.some((a) => (a.target as { id: string }).id === item.id && a.actorId === hz.A.ownerId)).toBe(true);

    const after = await owner.inbox.list({ businessId: hz.A.businessId, tab: "respond" });
    expect(after.blocking).toBe(before.blocking - 1);
    const detail = await owner.inbox.get({ businessId: hz.A.businessId, itemId: item.id });
    expect(detail.plan?.id).toBe(result.plan.id);
    expect(detail.decisions).toHaveLength(1);
  });

  it("AC-11.3.4: free text with spend above the threshold compiles enable_channel + set_budget + create_task and asks for confirmation", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await decisionItem("Paid acquisition?");
    const result = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week" });
    const types = result.plan.actions.map((a) => a.type);
    expect(types).toEqual(["enable_channel", "set_budget", "create_task"]);
    expect(result.plan.actions[1]!.params).toMatchObject({ channel: "paid_ads", amount_minor: 50000 });
    // Assisted mode (default): €500 is above the €250 approval threshold → outside policy → confirmation.
    expect(result.requiresConfirmation).toBe(true);
    expect(result.plan.status).toBe("pending_confirmation");
    expect(result.evaluations.find((e) => e.action.type === "set_budget")?.outcome).toBe("ask");
    expect(result.executed).toEqual([]);
    expect(result.followUp).toBeNull();
    expect(result.item.state).toBe("answered");

    // The founder confirms: the plan executes in-process (channel enabled with the budget, task created).
    const confirmed = await owner.plan.confirm({ businessId: hz.A.businessId, planId: result.plan.id });
    expect(confirmed.exec.executed.length).toBe(3);
    const channel = await repos.channels.getByKey(hz.db, hz.A.businessId, "paid_ads");
    expect(channel?.enabled).toBe(true);
    expect(channel?.budgetMinor).toBe(50000);
    const status = await owner.plan.status({ businessId: hz.A.businessId, planId: result.plan.id });
    expect(status.counts.done).toBe(3);
    expect(status.plan.status).toBe("done");
    expect(confirmed.followUp?.type).toBe("update");
  });

  it("AC-11.3.4 (inside policy): spend within caps executes immediately", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await decisionItem("Small SEO test?");
    const result = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "spend €100 on Google ads this week" });
    expect(result.requiresConfirmation).toBe(false);
    expect(result.plan.status).toBe("done");
    expect(result.executed.length).toBe(result.plan.actions.length);
    expect(result.dispatch).toBeNull();
    const tasks = await repos.tasks.list(hz.db, hz.A.businessId, { kind: "channel" });
    expect(tasks.items.some((t) => t.title.toLowerCase().includes("google ads"))).toBe(true);
  });

  it("AC-11.3.5: a hard-gate request compiles to request_human_action only and creates a founder task", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await decisionItem("Supplier invoice");
    const result = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "pay the supplier invoice" });
    expect(result.plan.actions.map((a) => a.type)).toEqual(["request_human_action"]);
    expect(result.evaluations[0]!.hardGate).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    const tasks = await repos.tasks.list(hz.db, hz.A.businessId, { kind: "ops", limit: 50 });
    const founderTask = tasks.items.find((t) => t.title.startsWith("Founder action:"));
    expect(founderTask).toBeDefined();
    expect(founderTask!.assigneeAgentId).toBeNull();
    const preview = await owner.plan.preview({ businessId: hz.A.businessId, text: "wire €2,000 to the supplier and sign the contract" });
    expect(preview.evaluations.every((e) => e.action.type === "request_human_action")).toBe(true);
    expect(preview.hardGates).toBeGreaterThan(0);
  });

  it("rejects an option that is not on the item and an empty decision", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await decisionItem("Bad option");
    await expect(owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "nope" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("AC-11.3.2: Refresh yields exactly one new item (in-process composer fallback, mock models)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const before = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    const first = await owner.inbox.refresh({ businessId: hz.A.businessId });
    expect(first.source).toBe("local");
    expect(first.item.businessId).toBe(hz.A.businessId);
    expect(first.item.subject.length).toBeLessThanOrEqual(80);
    const second = await owner.inbox.refresh({ businessId: hz.A.businessId });
    expect(second.item.id).not.toBe(first.item.id);
    const after = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    expect(after.items.length).toBe(before.items.length + 2);
    const created = await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_created" });
    expect(created.items.length).toBeGreaterThanOrEqual(2);
  });
});
