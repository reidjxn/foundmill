/**
 * The approval round trip on the orchestrator's side (audit FR-01 / O-02 / O-26), on PGlite with the replay sandbox:
 *
 * - a gated call opens one approval and one decision Inbox item (Approve / Reject, blocking Continue);
 * - Approve releases the session still waiting and it carries on; Reject ends it blocked on the founder's answer, and
 *   the cycle leaves the task alone until it is started by hand;
 * - a session that ended before the answer (APPROVAL_WAIT_MINUTES) leaves its task waiting; once approved the task is
 *   dispatchable again and the next session's same call goes on under that approval, without asking a second time;
 * - a recorded hold that resolves by itself leaves no approval or Inbox item open behind it.
 */
import { APPROVAL_OPTIONS, closeApprovalItem, repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { MockSandboxProvider, RECORDINGS } from "@foundmill/sandbox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { grantApproval, openApprovalNote } from "../activities/approvals";
import { createBriefActivities } from "../activities/brief";
import { approvalDeferral, createCycleActivities } from "../activities/cycle";
import { createSessionActivities } from "../activities/session";
import { FakeClock } from "../clock";
import { openSessionRow, setupOrchestratorHarness, wait, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let clock: FakeClock;
let acts: ReturnType<typeof createSessionActivities>;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "appr" });
  clock = new FakeClock("2026-10-05T08:00:00.000Z");
  // Holds as recorded: the usage-index recording waits on `run_migration` until someone answers.
  const provider = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: "as_recorded", recordings: RECORDINGS });
  acts = createSessionActivities({ ...t.deps, clock, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) });
});
afterAll(async () => {
  await t?.close();
});

async function newTask(title: string) {
  return repos.tasks.create(t.db, t.businessId, { kind: "code", title, goalMd: title, assigneeAgentId: t.workerId, status: "running" });
}

async function startOn(taskId: string, recordingKey = "ledgerly-usage-index") {
  const sessionId = await openSessionRow(t, t.workerId, taskId);
  const input = { businessId: t.businessId, agentId: t.workerId, taskId, sessionId };
  const launch = { ...(await acts.prepareSession(input)), recordingKey };
  return { sessionId, input, launch, run: acts.runAgentSession(input, launch) };
}

async function approvalOf(sessionId: string) {
  let found: Awaited<ReturnType<typeof repos.approvals.get>> | null = null;
  await vi.waitFor(async () => {
    found = (await repos.approvals.list(t.db, t.businessId, { sessionId })).items[0] ?? null;
    if (!found) throw new Error("no approval yet");
  }, { timeout: 10_000, interval: 50 });
  return found!;
}

/** What `inbox.decide` does before it signals the session: store the answer and answer the item. */
async function founderDecides(approvalId: string, outcome: "approved" | "rejected") {
  const resolved = await repos.approvals.resolve(t.db, t.businessId, approvalId, { outcome, byKind: "user", byId: t.fixture.ownerId });
  await closeApprovalItem(t.db, t.businessId, resolved);
  return resolved;
}

describe("a gated call waits for the founder's answer in the Inbox", () => {
  it("opens one approval and one decision item; Approve releases the waiting session and it carries on", async () => {
    const task = await newTask("Customer usage report endpoint");
    const { sessionId, input, launch, run } = await startOn(task.id);
    const approval = await approvalOf(sessionId);
    expect(approval).toMatchObject({ taskId: task.id, connectorKey: "github", tool: "run_migration", outcome: null });
    expect(approval.inboxItemId).not.toBeNull();
    const item = await repos.inbox.get(t.db, t.businessId, approval.inboxItemId!);
    expect(item).toMatchObject({ type: "decision", blocksContinue: true, fromAgentId: t.workerId, subject: "Test Engineer needs your OK: GitHub › run a change to the data layout" });
    expect(item.bodyMd).toContain("“Customer usage report endpoint”");
    // The call's arguments are a developer detail (the reading pane's Details), never in the founder's note.
    expect(item.bodyMd).not.toContain("create index concurrently");
    expect((item.decision as { options: { id: string }[] }).options.map((o) => o.id)).toEqual([APPROVAL_OPTIONS.approve, APPROVAL_OPTIONS.reject]);
    const requested = (await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 50 })).items.filter((e) => (e.payload as { approvalId: string }).approvalId === approval.id);
    expect(requested).toHaveLength(1);
    expect(requested[0]!.narrated).toBe(true);
    expect((await repos.events.list(t.db, t.businessId, { type: "inbox.item_created", limit: 50 })).items.some((e) => (e.payload as { inboxItemId: string }).inboxItemId === item.id)).toBe(true);

    await founderDecides(approval.id, "approved");
    await t.control.post(sessionId, { kind: "decision", approvalId: approval.id, outcome: "approved", by: t.fixture.ownerId });
    const result = await run;
    expect(result.outcome).toBe("done");
    expect((await repos.approvals.list(t.db, t.businessId, { sessionId })).items.map((a) => a.id)).toEqual([approval.id]);
    expect(await repos.inbox.get(t.db, t.businessId, item.id)).toMatchObject({ state: "answered", blocksContinue: false });
    const notes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(notes.some((r) => r.event.kind === "note" && r.event.text === "Approval approved; continuing.")).toBe(true);
    expect((await acts.finishSession(input, launch, result)).taskStatus).not.toBe("blocked");
  });

  it("Reject ends the session blocked on the founder's answer, and the cycle leaves the task alone until it is started by hand", async () => {
    const task = await newTask("Add the composite index");
    const { sessionId, input, launch, run } = await startOn(task.id);
    const approval = await approvalOf(sessionId);
    await founderDecides(approval.id, "rejected");
    await t.control.post(sessionId, { kind: "decision", approvalId: approval.id, outcome: "rejected", by: t.fixture.ownerId, note: "Not during the launch week" });
    const result = await run;
    expect(result).toMatchObject({ outcome: "blocked", blockedReason: "approval_rejected", approvalId: approval.id });
    const finish = await acts.finishSession(input, launch, result);
    expect(finish.taskStatus).toBe("blocked");
    const blocked = (await repos.events.list(t.db, t.businessId, { type: "task.blocked", limit: 50 })).items.find((e) => (e.payload as { sessionId: string }).sessionId === sessionId);
    expect(blocked?.payload).toMatchObject({ reason: "approval_rejected", approvalId: approval.id });

    const brief = await createBriefActivities(t.deps).loadBrief({ businessId: t.businessId });
    const held = brief.openTasks.find((x) => x.id === task.id)!;
    expect(held.approvalHold).toEqual({ approvalId: approval.id, outcome: "rejected" });
    expect(approvalDeferral(held)).toMatch(/rejected its request; it runs again once started by hand/);
    const plan = await createCycleActivities(t.deps).planCycle({ businessId: t.businessId, cycleNumber: 1, trigger: "continue", brief });
    expect(plan.starts.some((s) => s.taskId === task.id)).toBe(false);
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toBe(approvalDeferral(held));
    await repos.tasks.setStatus(t.db, t.businessId, task.id, "done", { force: true });
  });
});

describe("an answer that comes after the session ended", () => {
  it("the task waits while the approval is open; once approved it is dispatchable and the next session goes on under that approval", async () => {
    const task = await newTask("Index the usage events");
    const first = await startOn(task.id);
    const approval = await approvalOf(first.sessionId);
    await wait(400); // a control poll sees the hold
    await clock.advance(31 * 60_000); // past APPROVAL_WAIT_MINUTES
    const ended = await first.run;
    expect(ended).toMatchObject({ outcome: "blocked", blockedReason: "awaiting_approval", approvalId: approval.id });
    expect((await acts.finishSession(first.input, first.launch, ended)).taskStatus).toBe("blocked");

    const briefs = createBriefActivities(t.deps);
    const waiting = (await briefs.loadBrief({ businessId: t.businessId })).openTasks.find((x) => x.id === task.id)!;
    expect(waiting.approvalHold).toEqual({ approvalId: approval.id, outcome: null });
    expect(approvalDeferral(waiting)).toBe("waiting for the founder's approval in the Inbox");

    await founderDecides(approval.id, "approved");
    const brief = await briefs.loadBrief({ businessId: t.businessId });
    const ready = brief.openTasks.find((x) => x.id === task.id)!;
    expect(ready.approvalHold).toBeNull();
    const plan = await createCycleActivities(t.deps).planCycle({ businessId: t.businessId, cycleNumber: 2, trigger: "wake", brief });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason ?? null).not.toMatch(/approval/);

    // The next session on the task replays the same hold: it goes on under the founder's approval, asking nothing.
    const second = await startOn(task.id);
    const result = await second.run;
    expect(result.outcome).toBe("done");
    expect((await repos.approvals.list(t.db, t.businessId, { taskId: task.id })).items.map((a) => a.id)).toEqual([approval.id]);
    expect(await repos.approvals.get(t.db, t.businessId, approval.id)).toMatchObject({ outcome: "approved", usedBySessionId: second.sessionId });
    const requested = (await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 100 })).items.filter((e) => (e.payload as { sessionId: string }).sessionId === second.sessionId);
    expect(requested).toHaveLength(0);
    const notes = await readSessionEvents(t.redis, second.sessionId, { kinds: ["note"] });
    expect(notes.some((r) => r.event.kind === "note" && /^The founder already approved run_migration; continuing without asking again\.$/.test(r.event.text))).toBe(true);
  });
});

describe("an approval a plan grants by naming it (approve_spend)", () => {
  it("is answered like the Inbox answers it: approval.resolved, the item closes, the waiting session gets the decision", async () => {
    const task = await newTask("Apply the pricing migration");
    const sessionId = await openSessionRow(t, t.workerId, task.id);
    const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.workerId, sessionId, connectorKey: "github", tool: "run_migration", args: { file: "0021_pricing.sql" } });
    const itemId = await openApprovalNote(t.db, t.businessId, approval, { agent: { id: t.workerId, name: "Test Engineer" } });
    await t.control.drain(sessionId);

    const granted = await grantApproval(t.deps, t.businessId, approval.id, t.fixture.ownerId);
    expect(granted).toMatchObject({ outcome: "approved", byKind: "user", byId: t.fixture.ownerId });
    expect(await repos.inbox.get(t.db, t.businessId, itemId!)).toMatchObject({ state: "answered", blocksContinue: false });
    const resolved = (await repos.events.list(t.db, t.businessId, { type: "approval.resolved", limit: 100 })).items.filter((e) => (e.payload as { approvalId: string }).approvalId === approval.id);
    expect(resolved).toHaveLength(1);
    expect(await t.control.drain(sessionId)).toEqual([expect.objectContaining({ kind: "decision", approvalId: approval.id, outcome: "approved", by: t.fixture.ownerId })]);

    // Granting it again changes nothing and tells nobody twice.
    await grantApproval(t.deps, t.businessId, approval.id, t.fixture.ownerId);
    expect(await t.control.drain(sessionId)).toEqual([]);
  });
});

describe("recorded holds that resolve by themselves", () => {
  it("leave no approval or Inbox item open behind the call that went on", async () => {
    const provider = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: "as_recorded", recordings: RECORDINGS });
    const quick = createSessionActivities({ ...t.deps, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) });
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "finance", title: "Launch the annual discount", goalMd: "x", assigneeAgentId: t.workerId, status: "running" });
    const sessionId = await openSessionRow(t, t.workerId, task.id);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: task.id, sessionId };
    // The coupon hold auto-approves after 1.5 s of recorded time (instant at this speed); a hard gate follows.
    const launch = { ...(await quick.prepareSession(input)), recordingKey: "ledgerly-annual-plan-discount" };
    await quick.runAgentSession(input, launch);
    const approvals = (await repos.approvals.list(t.db, t.businessId, { sessionId })).items;
    expect(approvals.length).toBeGreaterThan(0);
    for (const a of approvals) {
      expect(a).toMatchObject({ outcome: "approved", byKind: "system" });
      if (a.inboxItemId) expect((await repos.inbox.get(t.db, t.businessId, a.inboxItemId)).state).toBe("archived");
    }
  });
});
