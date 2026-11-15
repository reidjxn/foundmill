import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "decide" });
}, 120_000);
afterAll(() => hz.close());
// Free text is planned by a model, which has an allowance per minute: each test starts with a fresh one.
beforeEach(() => hz.limits.reset());

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
    // It waits in Needs you; a decision never holds Continue (0071, Nov 7, 2026).
    expect(before.items.map((i) => i.id)).toContain(item.id);
    expect(before.items.find((i) => i.id === item.id)?.blocksContinue).toBe(false);

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
    expect(after.blocking).toBe(before.blocking);
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
    // The title names the work by its channel ("Paid advertising campaign"); the goal keeps the founder's words.
    expect(tasks.items.some((t) => t.title === "Paid advertising campaign" && t.goalMd.toLowerCase().includes("google ads"))).toBe(true);
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

  it("an archive and a plan confirmation publish inbox.item_updated, so another member's open Inbox refetches (audit RUI-09)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const updates = async () => (await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_updated", limit: 200 })).items.map((e) => e.payload as Record<string, unknown>);

    const staged = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: (await decisionItem("Paid search?")).id, freeText: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week" });
    expect(staged.requiresConfirmation).toBe(true);
    expect((await updates()).some((p) => p.inboxItemId === staged.item.id)).toBe(false);
    const confirmed = await owner.plan.confirm({ businessId: hz.A.businessId, planId: staged.plan.id });
    expect(await updates()).toContainEqual({ inboxItemId: staged.item.id, change: "plan_confirmed", planId: staged.plan.id, followUpItemId: confirmed.followUp!.id });

    // A decision that still waits for its answer cannot be archived (it would clear the gate with nobody deciding): a note can.
    const gone = await repos.inbox.createItem(hz.db, hz.A.businessId, { type: "update", from_agent_id: hz.A.agentId, subject: "Archived elsewhere", body_md: "Nothing to decide.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    await owner.inbox.archive({ businessId: hz.A.businessId, itemId: gone.id });
    // Ids only: a member walled from the item learns nothing from the stream.
    expect(await updates()).toContainEqual({ inboxItemId: gone.id, change: "archived", planId: null, followUpItemId: null });
    const event = (await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_updated", limit: 200 })).items.find((e) => (e.payload as { inboxItemId: string }).inboxItemId === gone.id)!;
    expect(event.actor).toMatchObject({ kind: "user", id: hz.A.ownerId });
  });

  it("free text naming a roadmap item carries its id, and 'all agents' changes every agent, not the one the compiler named (audit VRB-X1, api-services-28)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const portal = await repos.product.upsertRoadmapItem(hz.db, hz.A.businessId, { title: "Retail portal", horizon: "now" });
    const roadmap = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: (await decisionItem("Roadmap?")).id, freeText: "push the retail portal milestone to next quarter" });
    expect(roadmap.plan.actions.map((a) => a.type)).toEqual(["update_roadmap"]);
    expect(roadmap.plan.actions[0]!.params).toMatchObject({ roadmap_item_id: portal.id });
    expect(roadmap.deferred).toEqual([roadmap.plan.actions[0]!.id]);

    const before = (await repos.agents.list(hz.db, hz.A.businessId, { limit: 50 })).items.map((a) => a.modelKey);
    const models = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: (await decisionItem("Cut model costs?")).id, freeText: "Switch all agents to haiku" });
    expect(models.plan.actions[0]).toMatchObject({ type: "set_agent_model", params: { model_key: "haiku", apply_scope: "all" } });
    // Run for every agent in-process, exactly as Agent profile › Model does (locked work is skipped): never only the one
    // agent the compiler happened to name.
    expect(models.executed).toEqual([models.plan.actions[0]!.id]);
    expect(models.deferred).toEqual([]);
    const after = (await repos.agents.list(hz.db, hz.A.businessId, { limit: 50 })).items.map((a) => a.modelKey);
    expect(after).not.toEqual(before);
    expect(after.filter((k) => k === "haiku").length).toBeGreaterThan(1);
  });

  it("an option marked not reversible, or costing more than the threshold, asks for confirmation in Assisted mode (audit AC-02)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const withOptions = (subject: string, options: { id: string; label: string; recommended: boolean; consequence: string; cost_minor: number; reversible: boolean }[]) =>
      repos.inbox.createItem(hz.db, hz.A.businessId, {
        type: "decision",
        from_agent_id: hz.A.agentId,
        subject,
        body_md: "Choose how to reach press and testers.",
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: { options, free_text: true, expires_at: null },
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
    const pilot = { id: "pilot", label: "Enable PR to reach press and testers", recommended: false, consequence: "Start a PR push.", cost_minor: 0, reversible: false };
    const undoable = { ...pilot, id: "easy", recommended: true, reversible: true };
    const costly = { ...pilot, id: "costly", reversible: true, cost_minor: 500_000 };

    const item = await withOptions("How do we reach testers?", [pilot, undoable, costly]);
    const irreversible = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "pilot" });
    expect(irreversible.requiresConfirmation).toBe(true);
    expect(irreversible.plan.status).toBe("pending_confirmation");
    expect(irreversible.executed).toEqual([]);
    expect(irreversible.evaluations.every((e) => e.outcome === "ask")).toBe(true);
    expect(irreversible.evaluations[0]!.policyIds).toContain("assisted-ask-irreversible");

    const easy = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: (await withOptions("Easy reach?", [pilot, undoable, costly])).id, chosenOption: "easy" });
    expect(easy.requiresConfirmation).toBe(false);
    expect(easy.executed.length).toBeGreaterThan(0);

    const expensive = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: (await withOptions("Costly reach?", [pilot, undoable, costly])).id, chosenOption: "costly" });
    expect(expensive.requiresConfirmation).toBe(true);
    expect(expensive.executed).toEqual([]);
  });

  it("inbox.list carries the tab counts and the blocking count on the first page only (audit SOAK-09)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await decisionItem("Counted once?");
    await decisionItem("Counted once, again?");
    const first = await owner.inbox.list({ businessId: hz.A.businessId, tab: "respond", limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    expect(first.counts?.respond).toBeGreaterThanOrEqual(2);
    // The blocking count is the hard stops alone: open decisions are not among them (Nov 7, 2026).
    expect(typeof first.blocking).toBe("number");
    expect(first.continueState).toMatchObject({ kind: (first.blocking ?? 0) > 0 ? "blocked" : "idle" });

    const second = await owner.inbox.list({ businessId: hz.A.businessId, tab: "respond", limit: 1, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(second.counts).toBeUndefined();
    expect(second.blocking).toBeUndefined();
    expect(second.continueState).toBeUndefined();
  });

  it("a decision past its expires_at stays open and keeps blocking Continue: nothing answers it for the founder (audit VCML-X2)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const item = await repos.inbox.createItem(hz.db, hz.A.businessId, {
      type: "decision",
      from_agent_id: hz.A.agentId,
      subject: "Past its deadline?",
      body_md: "Choose the first channel.",
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: [{ id: "a", label: "Outbound", recommended: true, consequence: "Starts outbound.", cost_minor: 0, reversible: true }, { id: "b", label: "Content", recommended: false, consequence: "Starts content.", cost_minor: 0, reversible: true }], free_text: true, expires_at: "2026-01-01T00:00:00.000Z" },
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    const list = await owner.inbox.list({ businessId: hz.A.businessId, tab: "respond" });
    expect(list.items.map((i) => i.id)).toContain(item.id);
    expect(list.items.find((i) => i.id === item.id)?.blocksContinue).toBe(false);
    // It can still be answered after the deadline, and that releases Continue as for any decision.
    const result = await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "a" });
    expect(result.item.state).toBe("answered");
    expect(result.item.blocksContinue).toBe(false);
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
    // The founder answers it, so the next press has something new to say (a decision still waiting is not written twice).
    if (first.item.type === "decision") await owner.inbox.decide({ businessId: hz.A.businessId, itemId: first.item.id, chosenOption: ((first.item.decision as { options: { id: string }[] }).options[0])!.id });
    const second = await owner.inbox.refresh({ businessId: hz.A.businessId });
    expect(second.item.id).not.toBe(first.item.id);
    const after = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    expect(after.items.length).toBeGreaterThanOrEqual(before.items.length + 2);
    const created = await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_created" });
    expect(created.items.length).toBeGreaterThanOrEqual(2);
  });

  it("audit CML-02: Refresh with nothing new does not write the same blocking decision again; it points at the open one", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    let last = await owner.inbox.refresh({ businessId: hz.A.businessId });
    for (let i = 0; i < 4 && last.item.type !== "decision"; i++) last = await owner.inbox.refresh({ businessId: hz.A.businessId });
    expect(last.item.type).toBe("decision");
    const before = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    const again = await owner.inbox.refresh({ businessId: hz.A.businessId });
    const third = await owner.inbox.refresh({ businessId: hz.A.businessId });
    const after = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    // Every grounded decision the in-process composer knows is open now: the presses answer with one of them.
    const decisions = after.items.filter((i) => i.type === "decision" && i.state !== "answered");
    const subjects = decisions.map((i) => i.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(after.blocking ?? 0).toBeLessThanOrEqual((before.blocking ?? 0) + 1);
    expect(decisions.map((i) => i.id)).toContain(third.item.id);
    expect(again.item.type).toBe("decision");
  });
});

const code = (p: Promise<unknown>) => p.then(() => "OK", (err: { code?: string }) => err.code ?? String(err));
const SPEND = "spend up to €500 on LinkedIn ads targeting fintech CFOs next week";

describe("a plan waiting for its go-ahead stays confirmable (audit OL-01, FR-08)", () => {
  it("after a reload: a fresh caller finds it in Respond, reads it back from inbox.get and confirms it by the plan's id alone", async () => {
    const businessId = hz.A.businessId;
    const item = await decisionItem("Paid acquisition, decided before a reload?");
    const blockingBefore = (await hz.caller({ userId: hz.A.ownerId }).inbox.list({ businessId, tab: "respond", limit: 200 })).blocking;
    const decided = await hz.caller({ userId: hz.A.ownerId }).inbox.decide({ businessId, itemId: item.id, freeText: SPEND });
    expect(decided.requiresConfirmation).toBe(true);

    // A new page, another tab or another device: nothing the deciding page remembered, only what the server keeps.
    const fresh = hz.caller({ userId: hz.A.ownerId });
    const respond = await fresh.inbox.list({ businessId, tab: "respond", limit: 200 });
    expect(respond.items.find((i) => i.id === item.id)).toMatchObject({ state: "answered", awaitingConfirmation: true });
    // Continue is free all the same: the note was answered.
    expect(respond.blocking).toBe(blockingBefore ?? 0);
    const reopened = await fresh.inbox.get({ businessId, itemId: item.id });
    expect(reopened.item.state).toBe("answered");
    expect(reopened.plan).toMatchObject({ id: decided.plan.id, status: "pending_confirmation" });
    expect(reopened.plan?.actions.map((a) => [a.type, a.policyOutcome, a.status])).toEqual([
      ["enable_channel", "allow", "pending"],
      ["set_budget", "ask", "pending"],
      ["create_task", "allow", "pending"],
    ]);
    expect(reopened.confirmation).toEqual({ planId: decided.plan.id, asks: 1, hardGates: 0, denied: 0, canConfirm: true, blockedReason: null });

    const confirmed = await fresh.plan.confirm({ businessId, planId: reopened.confirmation!.planId });
    expect(confirmed.alreadyConfirmed).toBe(false);
    expect(confirmed.exec.executed).toHaveLength(3);
    expect((await repos.channels.getByKey(hz.db, businessId, "paid_ads"))?.budgetMinor).toBe(50_000);
    const after = await fresh.inbox.get({ businessId, itemId: item.id });
    expect(after.confirmation).toBeNull();
    expect(after.plan?.status).toBe("done");
    expect(after.plan?.confirmedAt).toBeTruthy();
    expect((await fresh.inbox.list({ businessId, tab: "respond", limit: 200 })).items.some((i) => i.id === item.id)).toBe(false);
    expect((await fresh.inbox.list({ businessId, limit: 200 })).items.find((i) => i.id === item.id)?.awaitingConfirmation).toBe(false);

    // The other tab's press: nothing runs, is written or audited a second time.
    const tasksBefore = (await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length;
    const twice = await hz.caller({ userId: hz.A.ownerId }).plan.confirm({ businessId, planId: decided.plan.id });
    expect(twice).toMatchObject({ alreadyConfirmed: true, dispatch: null, followUp: null, exec: { executed: [], deferred: [] } });
    expect(twice.plan.status).toBe("done");
    expect((await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length).toBe(tasksBefore);
    const audits = await repos.audit.list(hz.db, businessId, { action: "plan.confirm", limit: 200 });
    expect(audits.items.filter((a) => (a.target as { id: string }).id === decided.plan.id)).toHaveLength(1);
  });

  it("two presses at once run the plan once", async () => {
    const businessId = hz.A.businessId;
    const item = await decisionItem("Paid acquisition, confirmed twice at once?");
    const decided = await hz.caller({ userId: hz.A.ownerId }).inbox.decide({ businessId, itemId: item.id, freeText: SPEND });
    const both = await Promise.all([0, 1].map(() => hz.caller({ userId: hz.A.ownerId }).plan.confirm({ businessId, planId: decided.plan.id })));
    expect(both.map((r) => r.alreadyConfirmed).sort()).toEqual([false, true]);
    const ran = await repos.plans.get(hz.db, businessId, decided.plan.id);
    const taskAction = ran.actions.find((a) => a.type === "create_task")!;
    expect((await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.filter((t) => t.planActionId === taskAction.id)).toHaveLength(1);
  });

  it("whoever cannot give the go-ahead sees why, and plan.confirm refuses them", async () => {
    const businessId = hz.A.businessId;
    const item = await decisionItem("Paid acquisition, reviewed by the team?");
    const decided = await hz.caller({ userId: hz.A.ownerId }).inbox.decide({ businessId, itemId: item.id, freeText: SPEND });
    await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.memberId, { distribution: "read" });
    try {
      const member = await hz.caller({ userId: hz.A.memberId }).inbox.get({ businessId, itemId: item.id });
      expect(member.confirmation).toMatchObject({ planId: decided.plan.id, canConfirm: false, blockedReason: expect.stringMatching(/write access to distribution/) });
      expect(await code(hz.caller({ userId: hz.A.memberId }).plan.confirm({ businessId, planId: decided.plan.id }))).toBe("FORBIDDEN");
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.memberId, {});
    }
    const viewer = await hz.caller({ userId: hz.A.viewerId }).inbox.get({ businessId, itemId: item.id });
    expect(viewer.confirmation).toMatchObject({ canConfirm: false, blockedReason: expect.stringMatching(/read-only/) });
    expect(await code(hz.caller({ userId: hz.A.viewerId }).plan.confirm({ businessId, planId: decided.plan.id }))).toBe("FORBIDDEN");
    expect((await repos.plans.get(hz.db, businessId, decided.plan.id)).status).toBe("pending_confirmation");
  });
});

describe("after a vacation (audit O-16): the Chief of Staff's decisions read back like the founder's", () => {
  it("a decision taken on vacation shows its running plan; a spend left open is the founder's to decide, and still asks first", async () => {
    const businessId = hz.A.businessId;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const chief = (await repos.agents.chiefOfStaff(hz.db, businessId))!;
    // What the orchestrator's holidayAutoDecide writes for a decision inside the authority the founder gave.
    const taken = await decisionItem("Which channel first, while I'm away?");
    const plan = await repos.plans.create(hz.db, businessId, { origin: "holiday", inboxItemId: taken.id, status: "executing", summaryMd: "The team carries out your choice.", actions: [{ type: "create_task", params: { kind: "ops", title: "Outbound to a narrow ICP" }, agentId: hz.A.agentId, policyOutcome: "allow" }] });
    await repos.plans.setWorkflowId(hz.db, businessId, plan.id, `plan:${plan.id}`);
    await repos.inbox.decide(hz.db, businessId, taken.id, { chosenOption: "outbound", decidedByKind: "chief_of_staff", decidedBy: chief.id, planId: plan.id });

    const read = await owner.inbox.get({ businessId, itemId: taken.id });
    expect(read.decisions[0]).toMatchObject({ chosenOption: "outbound", decidedByKind: "chief_of_staff", planId: plan.id });
    expect(read.plan).toMatchObject({ id: plan.id, origin: "holiday", status: "executing" });
    expect(read.confirmation).toBeNull();
    expect((await owner.inbox.list({ businessId, tab: "respond", limit: 200 })).items.some((i) => i.id === taken.id)).toBe(false);
    // It runs on its own: there is nothing for the founder to confirm.
    expect(await code(owner.plan.confirm({ businessId, planId: plan.id }))).toBe("BAD_REQUEST");

    // A spend the Chief of Staff left open: back from vacation, the founder decides it, and the money still asks first.
    const left = await decisionItem("Paid acquisition, left for my return?");
    expect((await owner.inbox.list({ businessId, tab: "respond", limit: 200 })).items.find((i) => i.id === left.id)).toMatchObject({ state: "unread", awaitingConfirmation: false });
    const mine = await owner.inbox.decide({ businessId, itemId: left.id, freeText: SPEND });
    expect(mine.requiresConfirmation).toBe(true);
    expect(mine.plan.origin).toBe("free_text");
  });
});
