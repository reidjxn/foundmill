/**
 * Autopilot's activities on PGlite (0055): the guard-rail check reads the real stop flag, credits, vacation, Inbox and
 * cycle log and decides with the shared pure function; a pause is persisted once with its audit row, event and (for
 * failed or empty cycles) an Inbox note that does not block Continue; a started cycle leaves an audit row and an event;
 * a crashed cycle is closed as failed so it counts toward the streak and is not "running" forever.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTOPILOT_MAX_SLEEP_MS, AUTOPILOT_POLL_MS, createAutopilotActivities, runEndedKey } from "../activities/autopilot";
import { nextCycleNumberOf } from "../activities/holiday";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let acts: ReturnType<typeof createAutopilotActivities>;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "autopilot", clockStart: "2026-10-13T12:00:00.000Z" });
  acts = createAutopilotActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

// Each test gets its own business: the cycle log of one must not leak into the next.
let fx: BusinessFixture;
let seq = 0;
const B = () => fx.businessId;
const H = 60 * 60 * 1000;
const cycleStarted = (n: number, iso: string, trigger = "autopilot") =>
  repos.events.write(t.db, B(), { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, occurredAt: new Date(iso), payload: { cycleId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, cycleNumber: n, workflowId: `cycle:${B()}:${n}`, trigger, timeBoxAgentHours: 4, plannedTaskIds: [], budget: null } });
const cycleCompleted = (n: number, iso: string, outcome: string, dispatched: number, completed: number) =>
  repos.events.write(t.db, B(), { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, occurredAt: new Date(iso), payload: { cycleId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, cycleNumber: n, workflowId: `cycle:${B()}:${n}`, outcome, tasksDispatched: dispatched, tasksCompleted: completed, tasksBlocked: 0, agentHours: 1, cost: { amountMinor: 10, currency: "USD" }, inboxItemIds: [], durationMs: 1000 } });

beforeEach(async () => {
  seq += 1;
  fx = await createBusinessFixture(t.h, `autopilot-${seq}`);
  // The fixture's own Inbox items would hold Autopilot at "Waiting for you"; these tests start from a clear Inbox.
  const items = await repos.inbox.list(t.db, B(), { limit: 200 });
  for (const i of items.items) if (i.blocksContinue) await repos.inbox.archive(t.db, B(), i.id);
});

describe("autopilotEvaluate", () => {
  it("off until the founder turns it on", async () => {
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toEqual({ action: "off" });
  });

  it("paid entry: waits for an owner's entry plan before starting a cycle on its own (WP-09 T16)", async () => {
    const now = t.clock.nowMs();
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(now - 10 * H));
    const paid = createAutopilotActivities({ ...t.deps, env: { ...t.deps.env, PAID_ENTRY: true } });
    expect((await paid.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "wait", why: "entry_plan" });
    const row = await repos.checkouts.create(t.db, B(), { kind: "subscription", mode: "mock", amountMinor: 500, createdBy: fx.ownerId });
    await repos.accountPlans.activate(t.db, { userId: fx.ownerId, mode: "mock", checkoutId: row.id });
    expect((await paid.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "start" });
  });

  it("starts a cycle once the interval since the last one has passed, and waits (with a planned time) before", async () => {
    const now = t.clock.nowMs();
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(now - 10 * H));
    await cycleStarted(1, new Date(now - 6 * H).toISOString());
    await cycleCompleted(1, new Date(now - 5 * H).toISOString(), "completed", 2, 2);
    // every 4 hours after the end (5 hours ago): due an hour ago.
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "start" });
    // A cycle that ended 1 hour ago is not due for 3 hours; the workflow sleeps until then and the chip shows the time.
    await cycleStarted(2, new Date(now - 2 * H).toISOString());
    await cycleCompleted(2, new Date(now - 1 * H).toISOString(), "completed", 2, 2);
    const wait = await acts.autopilotEvaluate({ businessId: B() });
    expect(wait.decision).toMatchObject({ action: "wait", why: "schedule", nextAt: now + 3 * H });
    expect(wait.waitMs).toBe(Math.min(3 * H, AUTOPILOT_MAX_SLEEP_MS));
    expect((await repos.businesses.get(t.db, B())).autopilotNextAt?.getTime()).toBe(now + 3 * H);
  });

  it("an open decision never stops the rounds (Nov 7, 2026); a hard stop makes it wait, and nothing is decided for the founder", async () => {
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(t.clock.nowMs() - 10 * H));
    const chief = await repos.agents.chiefOfStaff(t.db, B());
    const base = { from_agent_id: chief!.id, body_md: "x", status_strip: [], exhibit: { kind: "none" as const, spec_ref: null }, source_event_ids: [], entity_ids: [] };
    const item = await repos.inbox.createItem(t.db, B(), { ...base, type: "decision", subject: "Pick one", decision: { options: [{ id: "a", label: "A", recommended: true, consequence: "c", cost_minor: 0, reversible: true }, { id: "b", label: "B", recommended: false, consequence: "d", cost_minor: 0, reversible: true }], free_text: false, expires_at: null }, blocks_continue: true });
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision.action).not.toBe("wait");
    const stop = await repos.inbox.createItem(t.db, B(), { ...base, type: "warning", subject: "Credits used up", decision: null, blocks_continue: true });
    const e = await acts.autopilotEvaluate({ businessId: B() });
    expect(e.decision).toMatchObject({ action: "wait", why: "inbox" });
    expect(e.waitMs).toBe(AUTOPILOT_POLL_MS);
    expect((await repos.inbox.get(t.db, B(), item.id)).state).not.toBe("answered");
    await repos.inbox.archive(t.db, B(), stop.id, { force: true });
    await repos.inbox.archive(t.db, B(), item.id, { force: true });
  });

  it("never starts while stopped or out of credits, and a vacation or a running cycle holds it", async () => {
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(t.clock.nowMs() - 10 * H));
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "paused", reason: "kill_switch" });
    await resumeBusinessAgents(t.db, B());
    // Still paused after the resume: only the founder turns it back on.
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "paused", reason: "kill_switch" });
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(t.clock.nowMs() - 10 * H));
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision.action).toBe("start");
    const holiday = await repos.holidays.start(t.db, B(), { untilAt: new Date(t.clock.nowMs() + 24 * H), authority: {}, startedBy: fx.ownerId });
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "wait", why: "vacation" });
    await repos.holidays.end(t.db, B(), holiday.id, { reportInboxItemId: null, endedAt: t.clock.now() });
    await cycleStarted(7, new Date(t.clock.nowMs() - 0.5 * H).toISOString());
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "wait", why: "cycle_running" });
  });

  it("pauses after N failed or empty cycles in a row (counting only cycles since it was turned on)", async () => {
    const now = t.clock.nowMs();
    // An older failed cycle from before it was turned on does not count.
    await cycleStarted(10, new Date(now - 30 * H).toISOString(), "continue");
    await cycleCompleted(10, new Date(now - 29 * H).toISOString(), "failed", 1, 0);
    await repos.autopilot.set(t.db, B(), { enabled: true }, new Date(now - 20 * H));
    for (const [i, hoursAgo] of [[11, 12], [12, 8], [13, 4]] as const) {
      await cycleStarted(i, new Date(now - (hoursAgo + 1) * H).toISOString());
      await cycleCompleted(i, new Date(now - hoursAgo * H).toISOString(), i === 12 ? "failed" : "completed", i === 12 ? 1 : 0, 0);
    }
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "pause", reason: "idle_cycles" });
    // Failures that wrote no cycle at all count too.
    await repos.autopilot.set(t.db, B(), { enabled: true, maxIdleCycles: 4 }, new Date(now - 3 * H));
    expect((await acts.autopilotEvaluate({ businessId: B(), unrecordedFailures: 4 })).decision).toMatchObject({ action: "pause", reason: "idle_cycles" });
  });

  it("holds at the day's cycle cap and at the day's spend ceiling, until tomorrow (UTC)", async () => {
    const now = t.clock.nowMs();
    await repos.autopilot.set(t.db, B(), { enabled: true, maxCyclesPerDay: 2, cadence: "after_cycle" }, new Date(now - 10 * H));
    await cycleStarted(21, new Date(now - 3 * H).toISOString());
    await cycleCompleted(21, new Date(now - 2.5 * H).toISOString(), "completed", 1, 1);
    await cycleStarted(22, new Date(now - 2 * H).toISOString());
    await cycleCompleted(22, new Date(now - 1.5 * H).toISOString(), "completed", 1, 1);
    const capped = await acts.autopilotEvaluate({ businessId: B() });
    expect(capped.decision).toMatchObject({ action: "wait", why: "daily_cycles", until: Date.UTC(2026, 9, 14) });
    expect(capped.waitMs).toBe(AUTOPILOT_MAX_SLEEP_MS);
    await repos.autopilot.set(t.db, B(), { maxCyclesPerDay: 6, spendCeilingMinor: 0 });
    expect((await acts.autopilotEvaluate({ businessId: B() })).decision).toMatchObject({ action: "wait", why: "daily_spend" });
  });

  it("a project committed without a budget (no cycle yet, one ready task) starts cycle 1 at the overnight shift's first look, and its empty history is not an idle night (WP-04 T3)", async () => {
    const now = t.clock.nowMs();
    const committedAt = now - 2 * H;
    // The overnight shift as Commit turns it on, due one hour ago (its daily hour falls after the commit).
    const dailyHour = new Date(now - 1 * H).getUTCHours();
    await repos.autopilot.set(t.db, B(), { enabled: true, cadence: "daily", dailyHour, ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15, maxIdleCycles: 1 }, new Date(committedAt));
    await repos.tasks.create(t.db, B(), { kind: "research", title: "Answer the specification's open questions", goalMd: "Answer each open question.", acceptance: ["Every open question answered"], departmentId: null, assigneeAgentId: null, status: "ready", currency: "USD" });
    expect((await repos.events.list(t.db, B(), { type: "cycle.started" })).items).toHaveLength(0);
    const look = await acts.autopilotEvaluate({ businessId: B() });
    // No cycle means no idle streak: even with a limit of one empty cycle it starts, never pauses.
    expect(look.decision).toMatchObject({ action: "start" });
    expect(look.cycleBudgetMinor).toBe(15);
    // Cycles are numbered from history: the first one is cycle 1.
    expect(await nextCycleNumberOf(t.db, B())).toBe(1);
  });
});

describe("autopilotPause", () => {
  it("persists a pause once, with an audit row and an event, and leaves a note that does not block Continue", async () => {
    await repos.autopilot.set(t.db, B(), { enabled: true });
    const first = await acts.autopilotPause({ businessId: B(), reason: "idle_cycles" });
    expect(first).toEqual({ paused: true });
    expect(await acts.autopilotPause({ businessId: B(), reason: "idle_cycles" })).toEqual({ paused: false });
    expect(await repos.businesses.get(t.db, B())).toMatchObject({ autopilotEnabled: true, autopilotPausedReason: "idle_cycles" });
    expect((await repos.audit.list(t.db, B(), { action: "autopilot.pause" })).items).toHaveLength(1);
    const events = (await repos.events.list(t.db, B(), { type: "autopilot.changed" })).items.filter((e) => (e.payload as { change?: string }).change === "paused");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ pausedReason: "idle_cycles", cadence: "every_4h" });
    const notes = (await repos.inbox.list(t.db, B(), { limit: 100 })).items.filter((i) => i.subject === "Autopilot paused: nothing got done");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "warning", blocksContinue: false });
    expect(notes[0]!.bodyMd).toMatch(/failed or did nothing/);
    // A pause for another reason leaves no Inbox note (credits and stops explain themselves elsewhere).
    await repos.autopilot.set(t.db, B(), { enabled: true });
    await acts.autopilotPause({ businessId: B(), reason: "credits_exhausted" });
    expect((await repos.inbox.list(t.db, B(), { limit: 100 })).items.filter((i) => i.subject.startsWith("Autopilot paused")).length).toBe(1);
  });

  it("does nothing when Autopilot is off", async () => {
    expect(await acts.autopilotPause({ businessId: B(), reason: "kill_switch" })).toEqual({ paused: false });
  });
});

describe("autopilotCycleStarted and autopilotCycleFailed", () => {
  it("records the start (audit + autopilot.cycle_started)", async () => {
    await acts.autopilotCycleStarted({ businessId: B(), cycleNumber: 30, workflowId: `cycle:${B()}:30`, cadence: "every_4h", cyclesToday: 2 });
    expect((await repos.audit.list(t.db, B(), { action: "autopilot.cycle_start" })).items[0]!.details).toMatchObject({ cycleNumber: 30, cyclesToday: 2 });
    expect((await repos.events.list(t.db, B(), { type: "autopilot.cycle_started" })).items[0]!.payload).toMatchObject({ cycleNumber: 30, cadence: "every_4h", cyclesToday: 2 });
  });

  it("closes a crashed cycle as failed once, so it counts toward the streak and is no longer running", async () => {
    const now = t.clock.nowMs();
    await cycleStarted(40, new Date(now - 1 * H).toISOString());
    const closed = await acts.autopilotCycleFailed({ businessId: B(), workflowId: `cycle:${B()}:40`, error: "boom" });
    expect(closed).toEqual({ recorded: true });
    const done = (await repos.events.list(t.db, B(), { type: "cycle.completed" })).items.filter((e) => (e.payload as { cycleNumber?: number }).cycleNumber === 40);
    expect(done).toHaveLength(1);
    expect(done[0]!.payload).toMatchObject({ outcome: "failed" });
    await acts.autopilotCycleFailed({ businessId: B(), workflowId: `cycle:${B()}:40`, error: "boom again" });
    expect((await repos.events.list(t.db, B(), { type: "cycle.completed" })).items.filter((e) => (e.payload as { cycleNumber?: number }).cycleNumber === 40)).toHaveLength(1);
    // A cycle that never wrote cycle.started cannot be closed: the caller counts it itself.
    expect(await acts.autopilotCycleFailed({ businessId: B(), workflowId: `cycle:${B()}:41`, error: "never started" })).toEqual({ recorded: false });
  });
});

describe("Continue runs until done: the run's look and its end (Nov 7, 2026)", () => {
  const RUN = "5a1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f62";

  it("a run decides before the schedule, with Autopilot off: start, wait for a running cycle, end when a round did nothing", async () => {
    const now = t.clock.nowMs();
    const run = { id: RUN, startedAt: now - 3 * H };
    // No round finished yet and nothing open: the next round starts (Autopilot itself is off).
    const first = await acts.autopilotEvaluate({ businessId: B(), run });
    expect(first.decision).toEqual({ action: "off" });
    expect(first.run).toEqual({ decision: { action: "start" }, waitMs: 0 });
    // A round is running: look again in a minute.
    await cycleStarted(50, new Date(now - 2 * H).toISOString(), "continue");
    expect((await acts.autopilotEvaluate({ businessId: B(), run })).run).toEqual({ decision: { action: "wait", why: "cycle_running", until: null }, waitMs: 60_000 });
    // It finished work: the next round starts; the round after it found nothing: the run is done.
    await cycleCompleted(50, new Date(now - 1.5 * H).toISOString(), "completed", 2, 2);
    expect((await acts.autopilotEvaluate({ businessId: B(), run })).run?.decision).toEqual({ action: "start" });
    await cycleStarted(51, new Date(now - 1 * H).toISOString());
    await cycleCompleted(51, new Date(now - 0.5 * H).toISOString(), "completed", 0, 0);
    expect((await acts.autopilotEvaluate({ businessId: B(), run })).run?.decision).toEqual({ action: "end", reason: "done" });
    // Without a run nothing about the run comes back.
    expect((await acts.autopilotEvaluate({ businessId: B() })).run).toBeNull();
  });

  it("the press and its rounds count toward the day's cycle cap, which ends the run", async () => {
    const now = t.clock.nowMs();
    await repos.autopilot.set(t.db, B(), { maxCyclesPerDay: 2 });
    await cycleStarted(60, new Date(now - 3 * H).toISOString(), "continue");
    await cycleCompleted(60, new Date(now - 2.5 * H).toISOString(), "completed", 1, 1);
    await cycleStarted(61, new Date(now - 2 * H).toISOString(), "autopilot");
    await cycleCompleted(61, new Date(now - 1.5 * H).toISOString(), "completed", 1, 1);
    const capped = await acts.autopilotEvaluate({ businessId: B(), run: { id: RUN, startedAt: now - 3.5 * H } });
    expect(capped.cyclesToday).toBe(2);
    expect(capped.run?.decision).toEqual({ action: "end", reason: "daily_cycles" });
  });

  it("records the end once (event, audit), and the day's limit leaves one note that does not block Continue", async () => {
    const now = t.clock.nowMs();
    await cycleStarted(70, new Date(now - 2 * H).toISOString(), "continue");
    await cycleCompleted(70, new Date(now - 1.5 * H).toISOString(), "completed", 1, 1);
    await cycleStarted(71, new Date(now - 1 * H).toISOString());
    await cycleCompleted(71, new Date(now - 0.5 * H).toISOString(), "completed", 1, 1);
    const ended = await acts.autopilotRunEnded({ businessId: B(), runId: RUN, startedAt: now - 3 * H, reason: "daily_cycles" });
    expect(ended).toEqual({ recorded: true, rounds: 2 });
    const events = (await repos.events.list(t.db, B(), { type: "cycle.run_ended" })).items;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ runId: RUN, reason: "daily_cycles", rounds: 2, cost: { amountMinor: 20, currency: "USD" }, maxCyclesPerDay: 6 });
    expect((await repos.audit.list(t.db, B(), { action: "cycle.run_end" })).items[0]!.details).toMatchObject({ runId: RUN, reason: "daily_cycles", rounds: 2 });
    const notes = (await repos.inbox.list(t.db, B(), { limit: 100 })).items.filter((i) => i.subject === "Today's cycle limit is reached");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "update", blocksContinue: false });
    expect(notes[0]!.bodyMd).toMatch(/Settings › What the team can do/);
    // A second end (a retry, or the workflow after the API wrote Pause's end) changes nothing.
    expect(await acts.autopilotRunEnded({ businessId: B(), runId: RUN, startedAt: now - 3 * H, reason: "done" })).toMatchObject({ recorded: false });
    expect((await repos.events.list(t.db, B(), { type: "cycle.run_ended" })).items).toHaveLength(1);
    expect((await repos.inbox.list(t.db, B(), { limit: 100 })).items.filter((i) => i.subject === "Today's cycle limit is reached")).toHaveLength(1);
  });

  it("a run that is done leaves no extra note (the idle cycle's own note says what is in the way)", async () => {
    const before = (await repos.inbox.list(t.db, B(), { limit: 200 })).items.length;
    expect(await acts.autopilotRunEnded({ businessId: B(), runId: RUN, startedAt: t.clock.nowMs() - H, reason: "done" })).toEqual({ recorded: true, rounds: 0 });
    expect((await repos.inbox.list(t.db, B(), { limit: 200 })).items.length).toBe(before);
    expect(await repos.events.byIdempotencyKey(t.db, B(), runEndedKey(RUN))).not.toBeNull();
  });

  it("names the run on a follow-on round's start", async () => {
    await acts.autopilotCycleStarted({ businessId: B(), cycleNumber: 31, workflowId: `cycle:${B()}:31`, cadence: "every_4h", cyclesToday: 3, runId: RUN });
    expect((await repos.events.list(t.db, B(), { type: "autopilot.cycle_started" })).items[0]!.payload).toMatchObject({ cycleNumber: 31, runId: RUN });
    expect((await repos.audit.list(t.db, B(), { action: "autopilot.cycle_start" })).items[0]!.details).toMatchObject({ runId: RUN });
  });
});
