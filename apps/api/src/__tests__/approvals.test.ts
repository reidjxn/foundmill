/**
 * The founder answers an agent's gated call (audit FR-01 / O-02; contract 3). The approval's Inbox item is decided with
 * Approve or Reject: the row is resolved once, `approval.resolved` goes through the outbox, and the `decision` signal
 * reaches `session:<sessionId>` while that session waits (or `approval:<id>` for a plan action or a channel launch).
 * When the session already ended, Approve makes the task ready and starts a cycle on an idle business (never while the
 * team is stopped); Reject keeps the task blocked and the Chief of Staff says so. Section walls hold, and
 * `team.approvals.resolve` does the same from Team › approvals.
 */
import { APPROVAL_OPTIONS, openApprovalItem, repos, resumeBusinessAgents, stopBusinessAgents, type Approval } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "approvals", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  temporal.starts.length = 0;
  temporal.signals.length = 0;
});

const owner = () => hz.caller({ userId: hz.A.ownerId, email: "owner@test.local" });
/** The fixture agent the approvals are opened for. */
let agentName = "";
beforeAll(async () => {
  agentName = (await repos.agents.get(hz.db, hz.A.businessId, hz.A.agentId)).name;
});

/** Other notes that still block Continue (earlier tests leave some open): a cycle would wait for them. */
async function answerOtherBlockingNotes(exceptId: string) {
  const open = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 200 });
  for (const item of open.items) if (item.id !== exceptId && item.blocksContinue && (item.state === "unread" || item.state === "read")) await repos.inbox.archive(hz.db, hz.A.businessId, item.id);
}
const member = () => hz.caller({ userId: hz.A.memberId, email: "member@test.local" });

interface Gated {
  approval: Approval;
  itemId: string;
  taskId: string;
  sessionId: string;
}

/** What the gateway leaves behind for an "ask": a task in a session, the approval and its decision item. */
async function gatedCall(opts: { connectorKey?: string; tool?: string; amountMinor?: number; sessionEnded?: boolean; title?: string } = {}): Promise<Gated> {
  const db = hz.db;
  const A = hz.A.businessId;
  const task = await repos.tasks.create(db, A, { kind: "ops", title: opts.title ?? "Jurisdiction and compliance scan", goalMd: "x", assigneeAgentId: hz.A.agentId, status: opts.sessionEnded ? "blocked" : "running" });
  const session = await repos.agents.createSession(db, A, { agentId: hz.A.agentId, taskId: task.id, modelKey: "sonnet" });
  if (opts.sessionEnded) await repos.agents.endSession(db, A, session.id, { endedAt: new Date(), tokensIn: 0, tokensOut: 0, costMinor: 0, outcome: "blocked" });
  const approval = await repos.approvals.create(db, A, { agentId: hz.A.agentId, sessionId: session.id, connectorKey: opts.connectorKey ?? "github", tool: opts.tool ?? "run_migration", args: { file: "0019_idx.sql" }, reasons: ["schema changes ask first"], ...(opts.amountMinor ? { amountMinor: opts.amountMinor, currency: "USD" } : {}) });
  const { item } = await openApprovalItem(db, A, approval, { agentId: hz.A.agentId, agentName: "Legal Lead", connectorName: opts.connectorKey === "stripe" ? "Stripe" : "GitHub" });
  return { approval: await repos.approvals.get(db, A, approval.id), itemId: item.id, taskId: task.id, sessionId: session.id };
}

describe("deciding an approval's Inbox item", () => {
  it("Approve resolves the approval, writes approval.resolved through the outbox and signals session:<sessionId>", async () => {
    const g = await gatedCall();
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
    expect(temporal.signals).toEqual([{ workflowId: `session:${g.sessionId}`, signal: "decision", args: [{ approvalId: g.approval.id, planActionId: null, outcome: "approved", by: hz.A.ownerId, byKind: "user", note: null }] }]);
    expect(temporal.starts).toEqual([]); // the session carries on; no cycle needed
    expect(result.approval).toMatchObject({ approvalId: g.approval.id, outcome: "approved", sessionWaiting: true, cycle: null, signalled: [{ queued: true, workflowId: `session:${g.sessionId}` }] });
    expect(result.approval?.summary).toBe(`You approved ${agentName}'s request to run GitHub › run migration. ${agentName} carries on.`);
    expect(result.item).toMatchObject({ state: "answered", blocksContinue: false });
    expect(result.plan).toMatchObject({ status: "done", summaryMd: result.approval!.summary });
    expect(result.plan.actions.map((a) => [a.type, a.status])).toEqual([["reply_only", "done"]]);

    const row = await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id);
    expect(row).toMatchObject({ outcome: "approved", byKind: "user", byId: hz.A.ownerId });
    const resolved = (await repos.events.list(hz.db, hz.A.businessId, { type: "approval.resolved", limit: 50 })).items.find((e) => (e.payload as { approvalId: string }).approvalId === g.approval.id);
    expect(resolved?.payload).toMatchObject({ outcome: "approved", resolvedBy: { kind: "user", id: hz.A.ownerId } });
    expect((await repos.events.outboxPending(hz.db, hz.A.businessId)).some((o) => o.eventId === resolved!.id)).toBe(true);
    // The task is the session's business, not the Inbox's.
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("running");
  });

  it("Reject sends the founder's reason with the decision; a second answer is refused", async () => {
    const g = await gatedCall();
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.reject, freeText: "Not during the launch week" });
    expect(temporal.signals).toEqual([{ workflowId: `session:${g.sessionId}`, signal: "decision", args: [expect.objectContaining({ approvalId: g.approval.id, outcome: "rejected", note: "Not during the launch week" })] }]);
    expect(result.approval?.summary).toBe(`You rejected ${agentName}'s request to run GitHub › run migration (Not during the launch week). Nothing runs; ${agentName} is told not to retry it.`);
    expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBe("rejected");
    await expect(owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/already answered/);
    expect(temporal.signals).toHaveLength(1);
  });

  it("free text alone decides nothing on an approval's item, and never calls the plan compiler", async () => {
    const g = await gatedCall();
    await expect(owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, freeText: "Go ahead and run the migration tonight" })).rejects.toThrow(/Choose Approve or Reject/);
    expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBeNull();
    expect((await repos.inbox.get(hz.db, hz.A.businessId, g.itemId)).state).not.toBe("answered");
    expect(temporal.signals).toEqual([]);
  });

  it("inbox.get shows the approval: the agent and the task to link, the call, what it sends and the amount", async () => {
    const g = await gatedCall({ connectorKey: "stripe", tool: "create_coupon", amountMinor: 4_500, title: "Set up the first runway forecast" });
    const got = await owner().inbox.get({ businessId: hz.A.businessId, itemId: g.itemId });
    expect(got.approval).toMatchObject({
      id: g.approval.id,
      outcome: null,
      action: "Stripe › create coupon",
      args: JSON.stringify({ file: "0019_idx.sql" }),
      amount: { amountMinor: 4_500, currency: "USD" },
      agent: { id: hz.A.agentId },
      task: { id: g.taskId, title: "Set up the first runway forecast", status: "running" },
      sessionWaiting: true,
      section: "finance",
      canAnswer: true,
    });
    // Any other note has none.
    expect((await owner().inbox.get({ businessId: hz.A.businessId, itemId: hz.A.inboxItemId })).approval).toBeNull();
  });
});

describe("an answer that comes after the session ended", () => {
  it("Approve makes the task ready and starts a cycle on an idle business; no session is signalled", async () => {
    const g = await gatedCall({ sessionEnded: true, title: "Index the usage events" });
    await answerOtherBlockingNotes(g.itemId);
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
    expect(temporal.signals).toEqual([]);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("ready");
    expect(temporal.starts).toHaveLength(1);
    expect(temporal.starts[0]).toMatchObject({ type: "businessCycle", workflowId: expect.stringMatching(new RegExp(`^cycle:${hz.A.businessId}:\\d+$`)), args: [expect.objectContaining({ businessId: hz.A.businessId, trigger: "wake" })] });
    expect(result.approval).toMatchObject({ sessionWaiting: false, task: { id: g.taskId, status: "ready" }, cycle: { started: true, workflowId: temporal.starts[0]!.workflowId, reason: null } });
    expect(result.approval?.summary).toBe(`You approved ${agentName}'s request to run GitHub › run migration. “Index the usage events” runs again on the next cycle.`);
  });

  it("while the agents are stopped the answer is stored and nothing starts until they are resumed", async () => {
    await stopBusinessAgents(hz.db, hz.A.businessId, { reason: "kill_switch" });
    try {
      const g = await gatedCall({ sessionEnded: true, title: "Book the launch call" });
      const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
      expect(temporal.starts).toEqual([]);
      expect(temporal.signals).toEqual([]);
      expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBe("approved");
      expect(result.approval?.cycle).toEqual({ started: false, workflowId: null, reason: "agents are stopped; the task runs once they are resumed" });
      expect(result.approval?.summary).toMatch(/“Book the launch call” runs again once the agents are resumed\.$/);
    } finally {
      await resumeBusinessAgents(hz.db, hz.A.businessId);
    }
  });

  it("Reject keeps the task blocked on the founder's answer and the Chief of Staff says so", async () => {
    const g = await gatedCall({ sessionEnded: true, title: "Add the composite index" });
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.reject, freeText: "Use a smaller index" });
    expect(temporal.signals).toEqual([]);
    expect(temporal.starts).toEqual([]);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("blocked");
    const blocked = (await repos.events.list(hz.db, hz.A.businessId, { type: "task.blocked", limit: 50 })).items.find((e) => (e.payload as { taskId: string }).taskId === g.taskId);
    expect(blocked?.payload).toMatchObject({ reason: "approval_rejected", approvalId: g.approval.id, detail: "The founder rejected the request to run GitHub › run migration: Use a smaller index." });
    expect(blocked?.narrated).toBe(true);
    const note = result.followUp!;
    expect(note).toMatchObject({ type: "update", fromAgentId: hz.A.agentId, subject: "Add the composite index stays blocked", blocksContinue: false });
    expect(note.bodyMd).toContain("“Use a smaller index”");
    expect(note.bodyMd).toContain("Start it again from the Plan");
    expect((await repos.approvals.holds(hz.db, hz.A.businessId, [g.taskId])).get(g.taskId)).toEqual({ approvalId: g.approval.id, outcome: "rejected" });
  });
});

describe("approvals a plan action or a channel launch waits on", () => {
  it("signal approval:<id>, the wait that runs them", async () => {
    const approval = await repos.approvals.create(hz.db, hz.A.businessId, { planActionId: hz.A.planActionId, agentId: hz.A.agentId, connectorKey: "platform", tool: "launch_campaign", args: { channelKey: "seo" } });
    const { item } = await openApprovalItem(hz.db, hz.A.businessId, approval, { agentId: hz.A.agentId, agentName: "Distribution Strategist" });
    await owner().inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: APPROVAL_OPTIONS.approve });
    expect(temporal.signals).toEqual([{ workflowId: `approval:${approval.id}`, signal: "decision", args: [expect.objectContaining({ approvalId: approval.id, planActionId: hz.A.planActionId, outcome: "approved" })] }]);
  });
});

describe("who may answer", () => {
  it("a member walled from Finance cannot approve a Stripe call; the request stays open for someone who can", async () => {
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { finance: "read" });
    try {
      const g = await gatedCall({ connectorKey: "stripe", tool: "create_coupon", amountMinor: 1_000 });
      await expect(member().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/write access to finance/);
      expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBeNull();
      expect((await member().inbox.get({ businessId: hz.A.businessId, itemId: g.itemId })).approval?.canAnswer).toBe(false);
      // The same member answers a GitHub call.
      const gh = await gatedCall();
      await member().inbox.decide({ businessId: hz.A.businessId, itemId: gh.itemId, chosenOption: APPROVAL_OPTIONS.approve });
      expect((await repos.approvals.get(hz.db, hz.A.businessId, gh.approval.id)).outcome).toBe("approved");
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
    }
  });
});

describe("team.approvals", () => {
  it("lists the open approvals with who asks and for which task, and resolve answers the Inbox item too", async () => {
    const g = await gatedCall({ title: "Publish the pricing page" });
    const pending = await owner().team.approvals.pending({ businessId: hz.A.businessId });
    expect(pending.find((a) => a.id === g.approval.id)).toMatchObject({ agentName: expect.any(String), taskTitle: "Publish the pricing page", action: "GitHub › run migration", section: "development" });
    const resolved = await owner().team.approvals.resolve({ businessId: hz.A.businessId, approvalId: g.approval.id, outcome: "approved" });
    expect(resolved).toMatchObject({ id: g.approval.id, outcome: "approved", answer: { sessionWaiting: true } });
    expect(temporal.signals).toEqual([{ workflowId: `session:${g.sessionId}`, signal: "decision", args: [expect.objectContaining({ approvalId: g.approval.id, outcome: "approved" })] }]);
    const item = await repos.inbox.get(hz.db, hz.A.businessId, g.itemId);
    expect(item).toMatchObject({ state: "answered", blocksContinue: false });
    expect((await repos.inbox.decisionsFor(hz.db, hz.A.businessId, g.itemId)).map((d) => d.chosenOption)).toEqual([APPROVAL_OPTIONS.approve]);
    await expect(owner().team.approvals.resolve({ businessId: hz.A.businessId, approvalId: g.approval.id, outcome: "rejected" })).rejects.toThrow(/already approved/);
  });
});
