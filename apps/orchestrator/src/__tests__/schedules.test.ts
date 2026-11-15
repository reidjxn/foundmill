/**
 * The periodic jobs (audit O-17, DB-03, BF-10, RA-23, MLSL-20): schedule registration against a fake Temporal schedule
 * client (create, update when the definition changed, leave alone otherwise, retry while Temporal is away), the
 * schedule activities on PGlite (business lists, milestone catch-up, CRM and business purges, the engine reconciler's
 * inputs, one failing business never stopping a batch) and the debounced journey matview refresh.
 */
import { repos } from "@foundmill/db";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createScheduleActivities } from "../activities/schedules";
import type { ScheduleResult } from "../activities/types";
import { emitEvent, systemActor } from "../events";
import { JOURNEY_REFRESH_MIN_INTERVAL_MS, journeyDailyRefreshIdle, requestJourneyDailyRefresh } from "../journey-refresh";
import { registerSchedules, registerSchedulesWithRetry, SCHEDULES, scheduleFingerprint, scheduleId, type ScheduleClientLike } from "../schedules";
import { WORKFLOWS_PATH } from "../index";
import * as workflows from "../workflows";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

/** An in-memory stand-in for `client.schedule`: schedules by id, with the notes and options they were given. */
function fakeScheduleClient() {
  const store = new Map<string, { options: Record<string, unknown>; note: string; paused: boolean }>();
  const triggered: string[] = [];
  const updates: string[] = [];
  const client: ScheduleClientLike = {
    async create(options) {
      const id = options.scheduleId;
      if (store.has(id)) throw Object.assign(new Error(`Schedule ${id} already exists`), { name: "ScheduleAlreadyRunning" });
      store.set(id, { options: options as unknown as Record<string, unknown>, note: String(options.state?.note ?? ""), paused: false });
      return {};
    },
    getHandle(id) {
      return {
        async describe() {
          const s = store.get(id)!;
          return { state: { note: s.note, paused: s.paused } } as never;
        },
        async update(fn) {
          const s = store.get(id)!;
          const next = fn({ state: { note: s.note, paused: s.paused } } as never);
          updates.push(id);
          const state = (next.state ?? {}) as { note?: string; paused?: boolean };
          store.set(id, { options: next as unknown as Record<string, unknown>, note: String(state.note ?? ""), paused: Boolean(state.paused) });
        },
        async trigger() {
          triggered.push(id);
        },
      };
    },
  };
  return { client, store, triggered, updates };
}

describe("schedule registration", () => {
  it("defines a schedule for every periodic job, each naming a workflow the worker bundles", () => {
    const ids = SCHEDULES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const job of ["journeyDailyRefresh", "journeyMatviewRefresh", "benchmarksRebuild", "credentialExpiryScan", "consentRenewalScan", "agentMetricsRollup", "agentHealthSweep", "legalCalendarRoll", "sourceWatchSweep", "channelEngineReconcile", "crmDeletionSweep", "businessDeletionSweep", "founderNotifications"]) {
      expect(SCHEDULES.map((s) => s.workflowType)).toContain(job);
      expect(typeof (workflows as Record<string, unknown>)[job]).toBe("function");
    }
    expect(WORKFLOWS_PATH).toMatch(/workflows\/index\.ts$/);
  });

  it("creates every schedule once on the main queue, triggers the engine reconciler and the mock-results count, and leaves unchanged ones alone", async () => {
    const fake = fakeScheduleClient();
    const first = await registerSchedules(fake.client, { taskQueue: "fm-main" });
    expect(first.created).toHaveLength(SCHEDULES.length);
    const reconcile = fake.store.get(scheduleId("fm-main", "channel-engine-reconcile"))!;
    expect(reconcile.options).toMatchObject({ action: { type: "startWorkflow", workflowType: "channelEngineReconcile", taskQueue: "fm-main" }, policies: { overlap: "SKIP" } });
    const onBoot = [scheduleId("fm-main", "channel-engine-reconcile"), scheduleId("fm-main", "mock-results-cleanup")];
    expect(fake.triggered).toEqual(onBoot);
    expect(fake.store.get(scheduleId("fm-main", "mock-results-cleanup"))!.options).toMatchObject({ spec: { cronExpressions: ["30 3 * * *"] }, action: { workflowType: "mockResultsCleanup", args: [{}] } });
    const nightly = fake.store.get(scheduleId("fm-main", "journey-daily-refresh"))!;
    expect(nightly.options).toMatchObject({ spec: { cronExpressions: ["10 2 * * *"] }, action: { workflowType: "journeyDailyRefresh", args: [{}] } });
    expect(nightly.note).toContain(`[fm:${scheduleFingerprint(SCHEDULES.find((s) => s.id === "journey-daily-refresh")!, "fm-main")}]`);

    // A second boot (another replica, a restart) changes nothing, and runs the engine reconciler again at once.
    const second = await registerSchedules(fake.client, { taskQueue: "fm-main" });
    expect(second).toEqual({ created: [], updated: [], unchanged: SCHEDULES.map((s) => scheduleId("fm-main", s.id)) });
    expect(fake.updates).toEqual([]);
    expect(fake.triggered).toEqual([...onBoot, ...onBoot]);
  });

  it("updates a schedule whose definition changed, keeping an operator's pause", async () => {
    const fake = fakeScheduleClient();
    await registerSchedules(fake.client, { taskQueue: "q" });
    const id = scheduleId("q", "benchmarks-rebuild");
    fake.store.get(id)!.paused = true;
    const changed = SCHEDULES.map((s) => (s.id === "benchmarks-rebuild" ? { ...s, spec: { cronExpressions: ["0 3 * * *"] } } : s));
    const result = await registerSchedules(fake.client, { taskQueue: "q", definitions: changed });
    expect(result.updated).toEqual([id]);
    expect(fake.store.get(id)!.options).toMatchObject({ spec: { cronExpressions: ["0 3 * * *"] }, state: { paused: true } });
  });

  it("keeps environments apart when they share a namespace (ids carry the task queue)", async () => {
    const fake = fakeScheduleClient();
    await registerSchedules(fake.client, { taskQueue: "staging" });
    await registerSchedules(fake.client, { taskQueue: "production" });
    expect(fake.store.size).toBe(SCHEDULES.length * 2);
  });

  it("never fails boot: retries with backoff while Temporal is unreachable, then registers", async () => {
    const fake = fakeScheduleClient();
    let attempts = 0;
    const waits: number[] = [];
    const warn = vi.fn();
    const closed = vi.fn(async () => undefined);
    const result = await registerSchedulesWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("connect ECONNREFUSED 127.0.0.1:7233");
        return { client: fake.client, close: closed };
      },
      { taskQueue: "q", log: { info: vi.fn(), warn }, initialDelayMs: 100, maxDelayMs: 150, sleep: async (ms) => void waits.push(ms) },
    );
    expect(result?.created).toHaveLength(SCHEDULES.length);
    expect(waits).toEqual([100, 150]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the process stops", async () => {
    const abort = new AbortController();
    const result = await registerSchedulesWithRetry(
      async () => {
        abort.abort();
        throw new Error("unreachable");
      },
      { taskQueue: "q", log: { info: vi.fn(), warn: vi.fn() }, signal: abort.signal, sleep: async () => undefined },
    );
    expect(result).toBeNull();
  });
});

describe("schedule activities on PGlite", () => {
  let t: OrchestratorTestHarness;
  let acts: ReturnType<typeof createScheduleActivities>;
  beforeAll(async () => {
    t = await setupOrchestratorHarness({ prefix: "sched" });
    acts = createScheduleActivities(t.deps);
    await repos.businesses.commit(t.db, t.businessId, { archetype: "b2b_saas" });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("lists the committed businesses; the runnable list leaves a stopped team out", async () => {
    expect((await acts.listScheduledBusinesses({})).businessIds).toContain(t.businessId);
    await repos.businesses.setAgentsStopped(t.db, t.businessId, { reason: "kill_switch" });
    try {
      expect((await acts.listScheduledBusinesses({ runnable: true })).businessIds).not.toContain(t.businessId);
      expect((await acts.listEnginesToEnsure()).channels.some((c) => c.businessId === t.businessId)).toBe(false);
    } finally {
      await repos.businesses.clearAgentsStopped(t.db, t.businessId);
    }
  });

  it("one business that fails never stops the batch", async () => {
    const missing = "00000000-0000-4000-8000-00000000dead";
    const result = await acts.benchmarksRebuild({ businessIds: [missing, t.businessId] });
    expect(result.notes.some((n) => n.startsWith(`${missing}: failed`))).toBe(true);
    const audit = await repos.audit.list(t.db, t.businessId, { action: "schedule.benchmarks_rebuild", limit: 5 });
    expect(audit.items.length).toBeGreaterThan(0);
  });

  it("a retried benchmarks rebuild reads every business again and resumes only the writes", async () => {
    const other = await repos.businesses.create(t.db, { name: "Benchmarks Peer", archetype: "b2b_saas" });
    await repos.businesses.commit(t.db, other.id, { archetype: "b2b_saas" });
    const written = async (businessId: string) => (await repos.audit.list(t.db, businessId, { action: "schedule.benchmarks_rebuild", limit: 50 })).items;
    const before = { mine: (await written(t.businessId)).length, peer: (await written(other.id)).length };
    // The attempt before wrote the first business, then its worker went away (heartbeat details = next index).
    const heartbeats: unknown[] = [];
    const env = new MockActivityEnvironment({ heartbeatDetails: 1 });
    env.on("heartbeat", (d: unknown) => heartbeats.push(d));
    const result = (await env.run(acts.benchmarksRebuild, { businessIds: [t.businessId, other.id] })) as ScheduleResult;
    expect(result.notes.some((n) => n.startsWith("resumed at business 2 of 2"))).toBe(true);
    expect((await written(t.businessId)).length).toBe(before.mine);
    const peer = await written(other.id);
    expect(peer.length).toBe(before.peer + 1);
    // Both businesses' numbers are in the benchmark the resumed attempt wrote, not only the ones after the resume point.
    expect((peer[0]!.details as { benchmarks: { archetype: string; businesses: number }[] }).benchmarks).toContainEqual(expect.objectContaining({ archetype: "b2b_saas", businesses: 2 }));
    // While it re-read, the heartbeats kept the write progress, so a failure there still resumes the writes.
    expect(heartbeats.slice(0, 2)).toEqual([1, 1]);
  });

  it("the nightly milestone catch-up awards the trophies the business reached", async () => {
    await repos.journeys.recordConversion(t.db, t.businessId, { kind: "payment", amountMinor: 2_000, currency: "EUR", occurredAt: new Date("2026-10-01T09:00:00Z") });
    const result = await acts.milestonesCatchUp({ businessIds: [t.businessId], at: "2026-10-05T00:00:00Z" });
    expect(result.touched).toBe(1);
    expect(await repos.journeys.awardedTrophyKeys(t.db, t.businessId)).toContain("customer_1");
    expect((await acts.milestonesCatchUp({ businessIds: [t.businessId] })).touched).toBe(0);
  });

  it("the engine reconciler lists every enabled channel and records the engine it started", async () => {
    const { channels } = await acts.listEnginesToEnsure();
    const mine = channels.find((c) => c.channelId === t.fixture.channelId);
    expect(mine).toMatchObject({ businessId: t.businessId, channelKey: "events", engineWorkflowId: null });
    expect(await acts.recordEngineWorkflows({ entries: [{ businessId: t.businessId, channelId: t.fixture.channelId, workflowId: `engine:${t.fixture.channelId}` }] })).toEqual({ updated: 1 });
    expect((await repos.channels.get(t.db, t.businessId, t.fixture.channelId)).engineWorkflowId).toBe(`engine:${t.fixture.channelId}`);
    expect(await acts.recordEngineWorkflows({ entries: [{ businessId: t.businessId, channelId: t.fixture.channelId, workflowId: `engine:${t.fixture.channelId}` }] })).toEqual({ updated: 0 });
  });

  it("on staging the reconciler keeps only offline tracking: a channel that cannot act, or acts through tasks, gets no engine (founder, 2026-11-11; WP-02 T2)", async () => {
    const staging = createScheduleActivities({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging", LIVE_CONNECTORS: "github" } });
    const print = await repos.channels.upsert(t.db, t.businessId, { channelKey: "print", line: "wings", enabled: true, kitMode: true });
    const seo = await repos.channels.upsert(t.db, t.businessId, { channelKey: "seo", line: "defence", enabled: true, kitMode: false });
    const mine = async () => (await staging.listEnginesToEnsure()).channels.filter((c) => c.businessId === t.businessId).map((c) => c.channelKey).sort();
    // Events has no publisher, SEO's connector is live here but not connected: only print (offline tracking) keeps its engine.
    expect(await mine()).toEqual(["print"]);
    await repos.integrations.upsert(t.db, t.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    // SEO can act now (the agents work through tasks and sessions), but the weekly engine has nothing it can send for
    // it yet, so it gets no engine and no launch is ever claimed (WP-02 T2). Offline tracking keeps its engine.
    expect(await mine()).toEqual(["print"]);
    // Tap-to-post (founder, 2026-11-12): social is available and on the board, and the founder posts it. No engine is
    // ever ensured for it, so the reconciler does not start one every 15 minutes for the engine to stop at once.
    const social = await repos.channels.upsert(t.db, t.businessId, { channelKey: "social", line: "midfield", enabled: true, kitMode: false });
    expect(await mine()).toEqual(["print"]);
    // In test (and development) nothing is left out.
    const all = (await acts.listEnginesToEnsure()).channels.filter((c) => c.businessId === t.businessId).map((c) => c.channelId);
    expect(all).toEqual(expect.arrayContaining([t.fixture.channelId, print.id, seo.id, social.id]));
  });

  it("purges CRM records whose deletion came due and records it on the audit chain", async () => {
    const person = await repos.entities.create(t.db, t.businessId, { kind: "person", displayName: "Gone Soon", identifiers: { email: "gone@example.com" } });
    await repos.entities.requestDeletion(t.db, t.businessId, person.id, { requestedAt: new Date("2026-09-01T00:00:00Z") });
    const result = await acts.purgeDueEntities({ at: "2026-10-05T00:00:00Z" });
    expect(result.touched).toBeGreaterThanOrEqual(1);
    await expect(repos.entities.get(t.db, t.businessId, person.id)).rejects.toThrow();
    const audit = await repos.audit.list(t.db, t.businessId, { action: "crm.entity.purged", limit: 5 });
    expect(audit.items.some((a) => (a.target as { id?: string }).id === person.id)).toBe(true);
  });

  it("business deletion: lists the due business with its workflows, refuses a canceled one, purges a due one", async () => {
    const fresh = await repos.businesses.create(t.db, { name: "Doomed Co", archetype: "b2b_saas" });
    await repos.businesses.commit(t.db, fresh.id, { archetype: "b2b_saas" });
    const channel = await repos.channels.upsert(t.db, fresh.id, { channelKey: "seo", line: "defence", enabled: true });
    const cycleWorkflowId = `cycle:${fresh.id}:3`;
    await emitEvent(t.db, { businessId: fresh.id, type: "cycle.started", actor: systemActor, payload: { cycleId: crypto.randomUUID(), cycleNumber: 3, workflowId: cycleWorkflowId, trigger: "continue", timeBoxAgentHours: 2, plannedTaskIds: [] } });
    await repos.audit.append(t.db, fresh.id, { actorKind: "user", action: "business.request_deletion", target: { kind: "business", id: fresh.id }, details: { scheduledFor: "2026-10-01T00:00:00.000Z" } });
    const { due } = await acts.listDueBusinessDeletions({ at: "2026-10-05T00:00:00Z" });
    const mine = due.find((d) => d.businessId === fresh.id);
    expect(mine?.workflowIds).toContain(`engine:${channel.id}`);
    // A cycle still running is stopped too, so it does not dispatch into a business that is going away.
    expect(mine?.workflowIds).toContain(cycleWorkflowId);
    expect(await acts.purgeBusiness({ businessId: fresh.id, at: "2026-09-20T00:00:00Z" })).toEqual({ purged: false, reason: expect.stringMatching(/not due/) });
    expect(await acts.purgeBusiness({ businessId: fresh.id, at: "2026-10-05T00:00:00Z" })).toEqual({ purged: true, reason: null });
    await expect(repos.businesses.get(t.db, fresh.id, { includeArchived: true })).rejects.toThrow();
    // The harness's own business is untouched.
    expect((await repos.businesses.get(t.db, t.businessId)).id).toBe(t.businessId);
  });

  it("the debounced journey refresh runs at once, then folds bursts into one trailing refresh", async () => {
    const spy = vi.spyOn(repos.journeys, "refreshDaily");
    vi.useFakeTimers();
    try {
      let now = 1_000_000;
      const clock = () => now;
      requestJourneyDailyRefresh(t.deps, { now: clock });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await journeyDailyRefreshIdle(t.db);
      requestJourneyDailyRefresh(t.deps, { now: clock });
      requestJourneyDailyRefresh(t.deps, { now: clock });
      expect(spy).toHaveBeenCalledTimes(1);
      now += JOURNEY_REFRESH_MIN_INTERVAL_MS;
      await vi.advanceTimersByTimeAsync(JOURNEY_REFRESH_MIN_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(2);
      await journeyDailyRefreshIdle(t.db);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });
});
