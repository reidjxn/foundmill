/**
 * The founder answers an agent's gated call (audit FR-01 / O-02; contract 3). The approval's Inbox item is decided with
 * Approve or Reject: the row is resolved once, `approval.resolved` goes through the outbox, and the `decision` signal
 * reaches `session:<sessionId>` while that session waits (or `approval:<id>` for a plan action, a channel launch, or
 * the merge review of a task whose session ended).
 * When the session already ended, Approve makes the task ready and starts a cycle on an idle business (never while the
 * team is stopped); Reject keeps the task blocked and the Chief of Staff says so. Section walls hold, and
 * `team.approvals.resolve` does the same from Team › approvals.
 */
import { APP_NAME } from "@foundmill/config";
import { APPROVAL_OPTIONS, RELEASE_FOLLOW_UP, approvalAction, closeApprovalItem, inboxItems, openApprovalItem, repos, resumeBusinessAgents, stopBusinessAgents, type Approval } from "@foundmill/db";
import { eq } from "drizzle-orm";
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

/** Cycles the tests above started on the fake Temporal (they never finish by themselves). */
const temporalStarted: { workflowId: string }[] = [];
const owner = () => hz.caller({ userId: hz.A.ownerId, email: "owner@test.local" });
/** The fixture agent the approvals are opened for. */
let agentName = "";
beforeAll(async () => {
  agentName = (await repos.agents.get(hz.db, hz.A.businessId, hz.A.agentId)).name;
});

/** Other notes that still block Continue (earlier tests leave some open): a cycle would wait for them. */
async function answerOtherBlockingNotes(exceptId: string) {
  const open = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 200 });
  for (const item of open.items) if (item.id !== exceptId && item.blocksContinue && (item.state === "unread" || item.state === "read")) await markAnswered(item.id);
}
/** A blocking decision stays open until it is answered (it cannot be archived); the test stands in for that answer. */
const markAnswered = (itemId: string) => hz.db.update(inboxItems).set({ state: "answered" }).where(eq(inboxItems.id, itemId));
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
    expect(result.approval?.summary).toBe(`You approved ${agentName}'s request to run GitHub › run a change to the data layout. ${agentName} carries on.`);
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
    expect(result.approval?.summary).toBe(`You rejected ${agentName}'s request to run GitHub › run a change to the data layout (Not during the launch week). Nothing runs; ${agentName} is told not to retry it.`);
    expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBe("rejected");
    await expect(owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/already answered/);
    expect(temporal.signals).toHaveLength(1);
  });

  it("stores the answer even when the session cannot be told, and says so instead of claiming it carries on", async () => {
    const g = await gatedCall({ title: "Backfill the usage table" });
    const getHandle = temporal.workflow.getHandle;
    temporal.workflow.getHandle = () => ({
      async signal() {
        throw new Error("temporal is down");
      },
    });
    try {
      const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
      expect(result.approval).toMatchObject({ outcome: "approved", sessionWaiting: true, signalled: [{ queued: false, workflowId: `session:${g.sessionId}` }] });
      expect(result.approval?.summary).toMatch(/could not be told right now: the answer is saved/);
      expect(result.approval?.summary).not.toMatch(/carries on\.$/);
      expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBe("approved");
      expect(result.item).toMatchObject({ state: "answered", blocksContinue: false });
    } finally {
      temporal.workflow.getHandle = getHandle;
    }
  });

  it("an open request cannot be archived away: an agent waits on it", async () => {
    const g = await gatedCall({ title: "Tag the release" });
    await expect(owner().inbox.archive({ businessId: hz.A.businessId, itemId: g.itemId })).rejects.toThrow(/Approve or reject this request/);
    expect((await repos.inbox.get(hz.db, hz.A.businessId, g.itemId)).state).not.toBe("archived");
    await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.reject });
    // Answered, it files away like any other note.
    expect(await owner().inbox.archive({ businessId: hz.A.businessId, itemId: g.itemId })).toMatchObject({ state: "archived" });
  });

  it("an approval settled some other way stops blocking Continue when someone tries to answer it", async () => {
    const g = await gatedCall({ title: "Rotate the webhook secret" });
    // A recorded hold that went on by itself, before its item was closed.
    await repos.approvals.resolve(hz.db, hz.A.businessId, g.approval.id, { outcome: "expired", byKind: "system" });
    const blockingBefore = await repos.inbox.countBlocking(hz.db, hz.A.businessId);
    await expect(owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/already expired/);
    expect((await repos.inbox.get(hz.db, hz.A.businessId, g.itemId)).state).toBe("archived");
    // An approval's note never held Continue (0071, Nov 7, 2026): closing it leaves the hard stops as they were.
    expect(await repos.inbox.countBlocking(hz.db, hz.A.businessId)).toBe(blockingBefore);
    expect(temporal.signals).toEqual([]);
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

/** The one signal an answer after the session ended sends: the approval's own wait (`approval:<id>`), which a merge review holds. */
const waitSignal = (approvalId: string, outcome: "approved" | "rejected") => [{ workflowId: `approval:${approvalId}`, signal: "decision", args: [expect.objectContaining({ approvalId, outcome })] }];

describe("an answer that comes after the session ended", () => {
  it("Approve makes the task ready and starts a round of work on an idle business; no session is signalled, only the approval's own wait", async () => {
    const g = await gatedCall({ sessionEnded: true, title: "Index the usage events" });
    await answerOtherBlockingNotes(g.itemId);
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
    // The ended session is not told; the wait a merge review would hold at `approval:<id>` is (a miss when none does).
    expect(temporal.signals).toEqual(waitSignal(g.approval.id, "approved"));
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("ready");
    expect(temporal.starts).toHaveLength(1);
    temporalStarted.push({ workflowId: temporal.starts[0]!.workflowId });
    expect(temporal.starts[0]).toMatchObject({ type: "businessCycle", workflowId: expect.stringMatching(new RegExp(`^cycle:${hz.A.businessId}:\\d+$`)), args: [expect.objectContaining({ businessId: hz.A.businessId, trigger: "wake" })] });
    expect(result.approval).toMatchObject({ sessionWaiting: false, task: { id: g.taskId, status: "ready" }, cycle: { started: true, workflowId: temporal.starts[0]!.workflowId, reason: null } });
    expect(result.approval?.summary).toBe(`You approved ${agentName}'s request to run GitHub › run a change to the data layout. “Index the usage events” runs again on the next round of work.`);
  });

  it("no round of work starts over a hard stop (credits used up), or while the Chief of Staff runs the vacation; the task is ready for the next one", async () => {
    await answerOtherBlockingNotes("");
    // The cycle the test before started is over: the workflow of that press reports it finished.
    for (const start of temporalStarted) await repos.events.write(hz.db, hz.A.businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId: start.workflowId, cycleNumber: Number(start.workflowId.split(":").at(-1)), workflowId: start.workflowId, outcome: "time_box", tasksStarted: 0 } });
    const other = await repos.inbox.createItem(hz.db, hz.A.businessId, { type: "warning", blocks_continue: true, from_agent_id: hz.A.agentId, subject: "Credits used up", body_md: "Top up to keep working.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, source_event_ids: [], entity_ids: [] });
    const first = await gatedCall({ sessionEnded: true, title: "Wire the usage dashboard" });
    const waiting = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: first.itemId, chosenOption: APPROVAL_OPTIONS.approve });
    expect(temporal.starts).toEqual([]);
    expect(waiting.approval?.cycle).toMatchObject({ started: false, reason: expect.stringMatching(/other Inbox item/) });
    expect((await repos.tasks.get(hz.db, hz.A.businessId, first.taskId)).status).toBe("ready");
    await markAnswered(other.id);

    const started = new Date();
    const vacation = await repos.holidays.start(hz.db, hz.A.businessId, { untilAt: new Date(started.getTime() + 86_400_000), authority: { decisionTypes: [] }, wakeEvents: [], startedAt: started, currency: "USD" });
    try {
      const second = await gatedCall({ sessionEnded: true, title: "Wire the churn dashboard" });
      const away = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: second.itemId, chosenOption: APPROVAL_OPTIONS.approve });
      expect(temporal.starts).toEqual([]);
      expect(away.approval?.cycle).toMatchObject({ started: false, reason: expect.stringMatching(/vacation/) });
      expect((await repos.tasks.get(hz.db, hz.A.businessId, second.taskId)).status).toBe("ready");
    } finally {
      await repos.holidays.end(hz.db, hz.A.businessId, vacation.id, { endedAt: new Date() });
    }
  });

  it("while the agents are stopped the answer is stored and nothing starts until they are resumed", async () => {
    await stopBusinessAgents(hz.db, hz.A.businessId, { reason: "kill_switch" });
    try {
      const g = await gatedCall({ sessionEnded: true, title: "Book the launch call" });
      const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve });
      expect(temporal.starts).toEqual([]);
      expect(temporal.signals).toEqual(waitSignal(g.approval.id, "approved"));
      expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBe("approved");
      expect(result.approval?.cycle).toEqual({ started: false, workflowId: null, reason: "agents are stopped; the task runs once they are resumed" });
      expect(result.approval?.summary).toMatch(/“Book the launch call” runs again once the agents are resumed\.$/);
    } finally {
      await resumeBusinessAgents(hz.db, hz.A.businessId);
    }
  });

  it("a task already running again in another session is left to it: no block, no note, no round of work", async () => {
    const g = await gatedCall({ sessionEnded: true, title: "Ship the export button" });
    // Started again by hand before the founder answered the first session's request.
    await repos.tasks.setStatus(hz.db, hz.A.businessId, g.taskId, "running", { force: true });
    await repos.agents.createSession(hz.db, hz.A.businessId, { agentId: hz.A.agentId, taskId: g.taskId, modelKey: "sonnet" });
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.reject, freeText: "Not this sprint" });
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("running");
    expect(result.followUp).toBeNull();
    expect(result.approval).toMatchObject({ sessionWaiting: false, cycle: null, task: { id: g.taskId, status: "running" } });
    expect(temporal.starts).toEqual([]);
    expect(temporal.signals).toEqual(waitSignal(g.approval.id, "rejected"));
  });

  it("Reject keeps the task blocked on the founder's answer and the Chief of Staff says so", async () => {
    const g = await gatedCall({ sessionEnded: true, title: "Add the composite index" });
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.reject, freeText: "Use a smaller index" });
    expect(temporal.signals).toEqual(waitSignal(g.approval.id, "rejected"));
    expect(temporal.starts).toEqual([]);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, g.taskId)).status).toBe("blocked");
    const blocked = (await repos.events.list(hz.db, hz.A.businessId, { type: "task.blocked", limit: 50 })).items.find((e) => (e.payload as { taskId: string }).taskId === g.taskId);
    expect(blocked?.payload).toMatchObject({ reason: "approval_rejected", approvalId: g.approval.id, detail: "The founder rejected the request to run GitHub › run a change to the data layout: Use a smaller index." });
    expect(blocked?.narrated).toBe(true);
    const note = result.followUp!;
    expect(note).toMatchObject({ type: "update", fromAgentId: hz.A.agentId, subject: "Add the composite index stays blocked", blocksContinue: false });
    expect(note.bodyMd).toContain("“Use a smaller index”");
    expect(note.bodyMd).toContain("Start it again from the Plan");
    // The agent is named as markup with its stored name, never a display choice (One name everywhere, Nov 8, 2026).
    const asker = await repos.agents.get(hz.db, hz.A.businessId, g.approval.agentId!);
    expect(note.bodyMd).toContain(`You rejected the request from [[ent:${asker.id}|${asker.name}]] to run **GitHub › run a change to the data layout**`);
    expect(note.bodyMd).not.toContain(`**${asker.name}**`);
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

  it("a platform call is named after the business it runs in, never after the platform", async () => {
    const approval = await repos.approvals.create(hz.db, hz.A.businessId, { planActionId: hz.A.planActionId, agentId: hz.A.agentId, connectorKey: "platform", tool: "launch_campaign", args: { channelKey: "seo" } });
    const { item } = await openApprovalItem(hz.db, hz.A.businessId, approval, { agentId: hz.A.agentId, agentName: "Lead Generation Engine" });
    const name = (await repos.businesses.get(hz.db, hz.A.businessId)).name;
    expect(item.subject).toBe(`Lead Generation Engine needs your OK: ${name} › launch campaign`.slice(0, 80));
    expect(item.bodyMd).toBe(`[[ent:${hz.A.agentId}|Lead Generation Engine]] wants to launch campaign. OK?`);
    expect(item.bodyMd).not.toContain("platform");
    expect(item.bodyMd).not.toContain(APP_NAME);
    expect(approvalAction({ connectorKey: "github", tool: "run_migration" }, null, name)).toBe("GitHub › run a change to the data layout");
  });
});

describe("who may answer", () => {
  it("a member walled from Finance cannot approve a Stripe call; the request stays open for someone who can", async () => {
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { finance: "read" });
    // Team › Responsibilities names the member for spending, so the section wall is what stops them (not the approver rule).
    const depts = await repos.departments.list(hz.db, hz.A.businessId);
    const named = [{ decisionType: "spend_above_threshold", handler: { kind: "user", id: hz.A.memberId } }];
    for (const d of depts) await repos.departments.update(hz.db, hz.A.businessId, d.id, { approvers: named });
    try {
      const g = await gatedCall({ connectorKey: "stripe", tool: "create_coupon", amountMinor: 1_000 });
      await expect(member().inbox.decide({ businessId: hz.A.businessId, itemId: g.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/write access to finance/);
      expect((await repos.approvals.get(hz.db, hz.A.businessId, g.approval.id)).outcome).toBeNull();
      expect((await member().inbox.get({ businessId: hz.A.businessId, itemId: g.itemId })).approval?.canAnswer).toBe(false);
      // Reading Finance, the member sees what the request is about in Team › approvals, without Approve and Reject.
      expect((await member().team.approvals.pending({ businessId: hz.A.businessId })).find((a) => a.id === g.approval.id)).toMatchObject({ amountMinor: 1_000, currency: "USD", argsHidden: false, canAnswer: false });
      // Walled from Finance altogether, neither the amount nor what the Stripe call would send.
      await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { finance: "none" });
      const listed = (await member().team.approvals.pending({ businessId: hz.A.businessId })).find((a) => a.id === g.approval.id);
      expect(listed).toMatchObject({ amountMinor: null, currency: null, amountHidden: true, args: {}, argsHidden: true, canAnswer: false, section: "finance" });
      expect(JSON.stringify(listed)).not.toContain("0019_idx.sql");
      // A GitHub call nobody named the member for stays the founder's: owners and admins.
      const gh = await gatedCall();
      await expect(member().inbox.decide({ businessId: hz.A.businessId, itemId: gh.itemId, chosenOption: APPROVAL_OPTIONS.approve })).rejects.toThrow(/Only an owner or admin/);
      expect((await repos.approvals.get(hz.db, hz.A.businessId, gh.approval.id)).outcome).toBeNull();
    } finally {
      for (const d of depts) await repos.departments.update(hz.db, hz.A.businessId, d.id, { approvers: d.approvers as never });
      await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
    }
  });
});

describe("team.approvals", () => {
  it("lists the open approvals with who asks and for which task, and resolve answers the Inbox item too", async () => {
    const g = await gatedCall({ title: "Publish the pricing page" });
    const pending = await owner().team.approvals.pending({ businessId: hz.A.businessId });
    expect(pending.find((a) => a.id === g.approval.id)).toMatchObject({ agentName: expect.any(String), taskTitle: "Publish the pricing page", action: "GitHub › run a change to the data layout", section: "development" });
    const resolved = await owner().team.approvals.resolve({ businessId: hz.A.businessId, approvalId: g.approval.id, outcome: "approved" });
    expect(resolved).toMatchObject({ id: g.approval.id, outcome: "approved", answer: { sessionWaiting: true } });
    expect(temporal.signals).toEqual([{ workflowId: `session:${g.sessionId}`, signal: "decision", args: [expect.objectContaining({ approvalId: g.approval.id, outcome: "approved" })] }]);
    const item = await repos.inbox.get(hz.db, hz.A.businessId, g.itemId);
    expect(item).toMatchObject({ state: "answered", blocksContinue: false });
    expect((await repos.inbox.decisionsFor(hz.db, hz.A.businessId, g.itemId)).map((d) => d.chosenOption)).toEqual([APPROVAL_OPTIONS.approve]);
    await expect(owner().team.approvals.resolve({ businessId: hz.A.businessId, approvalId: g.approval.id, outcome: "rejected" })).rejects.toThrow(/already approved/);
  });
});

describe("approvals must be decidable (first-time founder report, Nov 8, 2026)", () => {
  it("the reading pane gets what exactly would run, and whether GitHub is connected", async () => {
    const g = await gatedCall();
    const view = (await owner().inbox.get({ businessId: hz.A.businessId, itemId: g.itemId })).approval!;
    expect(view.what).toMatchObject({ kind: "code", headline: "A change to how the business's data is stored: 0019_idx.sql", empty: false });
    expect(view.what!.rows[0]).toEqual({ label: "Files", value: "0019_idx.sql", mono: true });
    // No GitHub integration in this harness: the note asks to connect first, and the pane knows.
    expect(view.githubConnected).toBe(false);
    expect(view.batch).toEqual([]);
    expect((await repos.inbox.get(hz.db, hz.A.businessId, g.itemId)).subject).toMatch(/^Legal Lead needs GitHub connected/);
  });

  it("a code change's approval carries the task's design check: what the reviewer saw and suggested (item 13)", async () => {
    const A = hz.A.businessId;
    const task = await repos.tasks.create(hz.db, A, { kind: "code", title: "Pricing page", goalMd: "x", assigneeAgentId: hz.A.agentId, status: "review" });
    const result = {
      status: "reviewed",
      reason: null,
      pages: ["/pricing"],
      fixes: [{ rank: 1, page: "/pricing", viewport: "phone", element: "the plan table", problem: "The page scrolls sideways at 390 px.", fix: "Stack the plans in one column.", principle: "responsive", severity: "high" }],
      unreadable: [],
      before: [{ id: "before-1-phone", page: "/pricing", viewport: "phone", width: 390, height: 844, cut: false, sha256: "a".repeat(64) }],
      after: [],
      fixesAsked: true,
    };
    await repos.events.write(hz.db, A, { type: "task.design_checked", actor: { kind: "agent", id: hz.A.agentId }, entityIds: [task.id], payload: { taskId: task.id, kind: "code", title: "Pricing page", assigneeAgentId: hz.A.agentId, sessionId: null, result }, occurredAt: new Date() });
    const approval = await repos.approvals.create(hz.db, A, { agentId: hz.A.agentId, taskId: task.id, connectorKey: "github", tool: "merge_pr", args: { title: "Pricing page", branch: `agent/${task.id}` }, reasons: ["merging to main asks first"] });
    const { item } = await openApprovalItem(hz.db, A, approval, { agentId: hz.A.agentId, agentName: "Frontend Engineer", connectorName: "GitHub" });
    const view = (await owner().inbox.get({ businessId: A, itemId: item.id })).approval!;
    const rows = Object.fromEntries(view.what!.rows.map((r) => [r.label, r.value]));
    expect(rows["Design check"]).toBe("A reviewer looked at screenshots of 1 page at desktop and 390 px and suggested 1 fix; the agent was asked to apply them once.");
    expect(rows["Design fixes"]).toBe("1. /pricing at 390 px, the plan table: The page scrolls sideways at 390 px. Fix: Stack the plans in one column.");
    expect(rows.Screenshots).toMatch(/^1 screenshot before, 0 screenshots after the fixes/);
  });

  it("rejecting a request that said nothing about what it would run sends the ask for the details to the agent", async () => {
    const task = await repos.tasks.create(hz.db, hz.A.businessId, { kind: "ops", title: "Reach the first venues", goalMd: "x", assigneeAgentId: hz.A.agentId, status: "blocked" });
    const approval = await repos.approvals.create(hz.db, hz.A.businessId, { agentId: hz.A.agentId, taskId: task.id, connectorKey: "sendgrid", tool: "send_mail", args: {}, reasons: ["contacts a third party"] });
    const { item } = await openApprovalItem(hz.db, hz.A.businessId, approval, { agentId: hz.A.agentId, agentName: "Legal Lead", connectorName: "SendGrid" });
    expect(item.subject).toMatch(/asks without saying what/);
    expect((item.decision as { options: { id: string; recommended: boolean }[] }).options.find((o) => o.recommended)?.id).toBe(APPROVAL_OPTIONS.reject);
    const view = (await owner().inbox.get({ businessId: hz.A.businessId, itemId: item.id })).approval!;
    expect(view.what).toMatchObject({ empty: true, rows: [], headline: null });
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: APPROVAL_OPTIONS.reject });
    expect(result.approval?.outcome).toBe("rejected");
    // The agent is told what to come back with, in the rejection's own words.
    expect(result.approval?.summary).toContain("Describe exactly what you would run");
    const blocked = (await repos.events.list(hz.db, hz.A.businessId, { type: "task.blocked" })).items.find((e) => (e.payload as { taskId?: string }).taskId === task.id);
    expect((blocked?.payload as { detail?: string }).detail).toContain("Describe exactly what you would run");
  });

  it("two campaign launches share one note; one Approve all answers both and tells both waits", async () => {
    // Earlier tests left a launch request open; a new one would join it. Settle them first.
    for (const a of (await repos.approvals.pending(hz.db, hz.A.businessId, 200)).filter((x) => x.tool === "launch_campaign")) {
      const settled = await repos.approvals.resolve(hz.db, hz.A.businessId, a.id, { outcome: "rejected", byKind: "user", byId: hz.A.ownerId });
      await closeApprovalItem(hz.db, hz.A.businessId, settled);
    }
    const launch = (channelKey: string, amountMinor: number) => repos.approvals.create(hz.db, hz.A.businessId, { agentId: hz.A.agentId, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: crypto.randomUUID(), channelKey, assetIds: [] }, reasons: ["first campaign"], amountMinor, currency: "USD" });
    const first = await launch("paid_ads", 60_000);
    const one = await openApprovalItem(hz.db, hz.A.businessId, first, { agentId: hz.A.agentId, agentName: "Lead Generation Engine" });
    const second = await launch("social", 20_000);
    const two = await openApprovalItem(hz.db, hz.A.businessId, second, { agentId: hz.A.agentId, agentName: "Lead Generation Engine" });
    expect(two.item.id).toBe(one.item.id);
    const view = (await owner().inbox.get({ businessId: hz.A.businessId, itemId: one.item.id })).approval!;
    expect(view.batch.map((b) => [b.id, b.what?.rows[0]?.value, b.amount?.amountMinor])).toEqual([
      [first.id, "Paid advertising", 60_000],
      [second.id, "Social media", 20_000],
    ]);
    temporal.signals.length = 0;
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: one.item.id, chosenOption: APPROVAL_OPTIONS.approve });
    expect(result.item.state).toBe("answered");
    expect(result.plan.actions).toHaveLength(2);
    for (const a of [first, second]) expect((await repos.approvals.get(hz.db, hz.A.businessId, a.id)).outcome).toBe("approved");
    expect(temporal.signals.map((s) => s.workflowId).sort()).toEqual([`approval:${first.id}`, `approval:${second.id}`].sort());
    expect(result.approval?.summary).toMatch(/^You approved 2 requests at once\./);
  });
});

describe("a founder's no to a change going live (WP-05 T16)", () => {
  /** A code task in review whose merge review asks the founder to put it live; its session already ended. */
  async function releaseAsked(title: string) {
    const A = hz.A.businessId;
    const task = await repos.tasks.create(hz.db, A, { kind: "code", title, goalMd: "x", assigneeAgentId: hz.A.agentId, status: "ready" });
    await repos.tasks.setStatus(hz.db, A, task.id, "review", { force: true });
    const dependent = await repos.tasks.create(hz.db, A, { kind: "code", title: `${title}, next step`, goalMd: "x", assigneeAgentId: hz.A.agentId, status: "ready" });
    await repos.tasks.addEdge(hz.db, A, task.id, dependent.id);
    const session = await repos.agents.createSession(hz.db, A, { agentId: hz.A.agentId, taskId: task.id, modelKey: "sonnet" });
    await repos.agents.endSession(hz.db, A, session.id, { endedAt: new Date(), tokensIn: 0, tokensOut: 0, costMinor: 0, outcome: "review" });
    const approval = await repos.approvals.create(hz.db, A, { agentId: hz.A.agentId, sessionId: session.id, connectorKey: "github", tool: "merge_pr", args: { owner: "acme", repo: "shop", prNumber: 7, mergeMethod: "squash", commitTitle: `${title} (#7)` }, reasons: ["You chose to be asked before anything goes live"] });
    const { item } = await openApprovalItem(hz.db, A, approval, { agentId: hz.A.agentId, agentName, connectorName: "GitHub", taskTitle: title });
    return { task, dependent, approval, itemId: item.id };
  }
  const blockOf = async (taskId: string) => (await repos.events.list(hz.db, hz.A.businessId, { type: "task.blocked", limit: 50 })).items.find((e) => (e.payload as { taskId?: string }).taskId === taskId);
  const followUpsFor = async (approvalId: string) => (await repos.inbox.list(hz.db, hz.A.businessId, { type: "decision", limit: 200 })).items.filter((i) => (i.decision as { key?: string } | null)?.key === `${RELEASE_FOLLOW_UP.key}:${approvalId}`);

  it("a rejection with words hands the change back: the task is blocked needs_update with the founder's words first", async () => {
    const r = await releaseAsked("Pricing page");
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: r.itemId, chosenOption: APPROVAL_OPTIONS.reject, freeText: "Make the prices bigger on phones" });
    expect(result.approval?.summary).toBe(`You rejected ${agentName}'s change going live (Make the prices bigger on phones). Nothing goes live. ${agentName} gets your note and reworks it.`);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, r.task.id)).status).toBe("blocked");
    const block = await blockOf(r.task.id);
    expect(block?.payload).toMatchObject({ reason: "needs_update", assigneeAgentId: hz.A.agentId, approvalId: r.approval.id });
    expect((block!.payload as { detail: string }).detail).toMatch(/^The founder's instruction: “Make the prices bigger on phones”\./);
    expect((block!.payload as { detail: string }).detail).toContain(`Bring your working copy (agent/${r.task.id}) up to date`);
    const back = (await repos.audit.list(hz.db, hz.A.businessId, { action: "merge.handed_back", limit: 20 })).items.find((a) => (a.target as { id?: string }).id === r.task.id);
    expect(back?.details).toMatchObject({ why: "founder", approvalId: r.approval.id });
    expect(await followUpsFor(r.approval.id)).toEqual([]);
    // The merge review that waits on the approval is told, as before.
    expect(temporal.signals.map((s) => s.workflowId)).toContain(`approval:${r.approval.id}`);
  });

  it("a rejection with nothing writes exactly one follow-up; Drop archives the task and frees its dependents", async () => {
    const r = await releaseAsked("Signup form");
    const result = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: r.itemId, chosenOption: APPROVAL_OPTIONS.reject });
    expect((await repos.tasks.get(hz.db, hz.A.businessId, r.task.id)).status).toBe("review");
    const followUps = await followUpsFor(r.approval.id);
    expect(followUps).toHaveLength(1);
    const followUp = followUps[0]!;
    expect(result.approval?.note?.id).toBe(followUp.id);
    expect(followUp).toMatchObject({ type: "decision", subject: "What should happen to this change?", blocksContinue: false });
    const decision = followUp.decision as { options: { id: string; label: string }[]; free_text: boolean };
    expect(decision.options.map((o) => o.label)).toEqual(["Tell the team what to change", "Drop this change"]);
    expect(decision.free_text).toBe(true);

    const dropped = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: followUp.id, chosenOption: RELEASE_FOLLOW_UP.options.drop });
    expect(dropped.item.state).toBe("answered");
    const task = await repos.tasks.get(hz.db, hz.A.businessId, r.task.id);
    expect(task.status).toBe("stopped");
    expect(task.archivedAt).not.toBeNull();
    expect((await repos.tasks.listEdges(hz.db, hz.A.businessId, [r.task.id])).filter((e) => e.fromTask === r.task.id)).toEqual([]);
    const audit = (await repos.audit.list(hz.db, hz.A.businessId, { action: "merge.dropped", limit: 20 })).items.find((a) => (a.target as { id?: string }).id === r.task.id);
    expect(audit?.details).toMatchObject({ approvalId: r.approval.id, dependentsFreed: 1 });
    expect(await followUpsFor(r.approval.id)).toHaveLength(1);
  });

  it("the follow-up's Tell the team what to change hands the change back with the founder's words, and asks for them when missing", async () => {
    const r = await releaseAsked("Checkout copy");
    await owner().inbox.decide({ businessId: hz.A.businessId, itemId: r.itemId, chosenOption: APPROVAL_OPTIONS.reject });
    const followUp = (await followUpsFor(r.approval.id))[0]!;
    await expect(owner().inbox.decide({ businessId: hz.A.businessId, itemId: followUp.id, chosenOption: RELEASE_FOLLOW_UP.options.rework })).rejects.toThrow(/What should change\?/);
    const answered = await owner().inbox.decide({ businessId: hz.A.businessId, itemId: followUp.id, chosenOption: RELEASE_FOLLOW_UP.options.rework, freeText: "Use the words from the landing page" });
    expect(answered.item.state).toBe("answered");
    expect((await repos.tasks.get(hz.db, hz.A.businessId, r.task.id)).status).toBe("blocked");
    expect((await blockOf(r.task.id))?.payload).toMatchObject({ reason: "needs_update", detail: expect.stringMatching(/^The founder's instruction: “Use the words from the landing page”\./) });
  });
});
