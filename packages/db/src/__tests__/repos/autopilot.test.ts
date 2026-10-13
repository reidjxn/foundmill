/**
 * 0041 Autopilot: the switch and settings on `businesses` (no table of its own, so the business policies hold: members
 * read, only owners and admins change), the pause a guard rail writes (idempotent, and the stop flag writes it in the
 * same transaction), and the facts the decision reads (`loadAutopilotFacts`, `summarizeCycleEvents`).
 */
import { decideAutopilot } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAutopilotFacts, STALE_CYCLE_MS, summarizeCycleEvents } from "../../autopilot";
import { resumeBusinessAgents, stopBusinessAgents } from "../../controls";
import { repos } from "../../repos";
import { businesses } from "../../schema";
import { RLS_DENIED } from "../rls/fixtures";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("autopilot");
}, 120_000);
afterAll(() => r?.close());

const A = () => r.A.businessId;
const B = () => r.B.businessId;
const row = (id: string) => repos.businesses.get(r.db, id);

beforeEach(async () => {
  await resumeBusinessAgents(r.db, A());
  await resumeBusinessAgents(r.db, B());
  for (const id of [A(), B()]) await repos.autopilot.set(r.db, id, { enabled: false, cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 });
});

describe("repos.autopilot.set", () => {
  it("is off by default, with the brief's defaults (every 4 hours, 6 cycles a day, pause after 3, no ceiling)", async () => {
    const fresh = await row(B());
    expect(fresh).toMatchObject({ autopilotEnabled: false, autopilotCadence: "every_4h", autopilotDailyHour: 9, autopilotMaxCyclesPerDay: 6, autopilotSpendCeilingMinor: null, autopilotMaxIdleCycles: 3, autopilotPausedReason: null, autopilotChangedAt: null, autopilotNextAt: null });
  });

  it("turns on and off, stamping when and clearing any pause and planned time", async () => {
    const at = new Date("2026-10-13T08:00:00.000Z");
    const on = await repos.autopilot.set(r.db, A(), { enabled: true }, at);
    expect(on).toMatchObject({ turnedOn: true, turnedOff: false, settingsChanged: false });
    expect(on.business).toMatchObject({ autopilotEnabled: true, autopilotChangedAt: at });
    // On again changes nothing.
    expect(await repos.autopilot.set(r.db, A(), { enabled: true }, new Date("2026-10-13T09:00:00.000Z"))).toMatchObject({ turnedOn: false });
    expect((await row(A())).autopilotChangedAt).toEqual(at);
    await repos.autopilot.setNextAt(r.db, A(), new Date("2026-10-13T12:00:00.000Z"));
    const off = await repos.autopilot.set(r.db, A(), { enabled: false }, new Date("2026-10-13T10:00:00.000Z"));
    expect(off).toMatchObject({ turnedOff: true });
    expect(off.business).toMatchObject({ autopilotEnabled: false, autopilotNextAt: null, autopilotPausedReason: null });
  });

  it("turning it on after a pause clears the pause and restarts the idle count from now", async () => {
    await repos.autopilot.set(r.db, A(), { enabled: true }, new Date("2026-10-13T08:00:00.000Z"));
    expect(await repos.autopilot.pause(r.db, A(), "idle_cycles")).toBe(true);
    expect(await row(A())).toMatchObject({ autopilotPausedReason: "idle_cycles" });
    const again = await repos.autopilot.set(r.db, A(), { enabled: true }, new Date("2026-10-13T11:00:00.000Z"));
    expect(again.turnedOn).toBe(true);
    expect(again.before.autopilotPausedReason).toBe("idle_cycles");
    expect(again.business).toMatchObject({ autopilotPausedReason: null, autopilotChangedAt: new Date("2026-10-13T11:00:00.000Z") });
  });

  it("changes settings alone without touching the state, and says whether they differ", async () => {
    await repos.autopilot.set(r.db, A(), { enabled: true }, new Date("2026-10-13T08:00:00.000Z"));
    const s = await repos.autopilot.set(r.db, A(), { cadence: "daily", dailyHour: 14, maxCyclesPerDay: 2, spendCeilingMinor: 750, maxIdleCycles: 5 });
    expect(s).toMatchObject({ turnedOn: false, turnedOff: false, settingsChanged: true });
    expect(s.business).toMatchObject({ autopilotEnabled: true, autopilotCadence: "daily", autopilotDailyHour: 14, autopilotMaxCyclesPerDay: 2, autopilotMaxIdleCycles: 5 });
    expect(Number(s.business.autopilotSpendCeilingMinor)).toBe(750);
    expect((await repos.autopilot.set(r.db, A(), { cadence: "daily", spendCeilingMinor: 750 })).settingsChanged).toBe(false);
    expect((await repos.autopilot.set(r.db, A(), { spendCeilingMinor: null })).business.autopilotSpendCeilingMinor).toBeNull();
  });

  it("refuses values outside the limits (the repo, and the database checks behind it)", async () => {
    for (const bad of [{ maxCyclesPerDay: 0 }, { maxCyclesPerDay: 25 }, { maxIdleCycles: 0 }, { maxIdleCycles: 11 }, { dailyHour: 24 }, { dailyHour: -1 }, { spendCeilingMinor: -1 }, { cadence: "every_minute" as never }]) {
      await expect(repos.autopilot.set(r.db, A(), bad)).rejects.toThrow();
    }
    await expect(r.h.pg.query(`update businesses set autopilot_max_cycles_per_day = 25 where id = $1`, [A()])).rejects.toThrow(/check/i);
    await expect(r.h.pg.query(`update businesses set autopilot_paused_reason = 'kill_switch' where id = $1`, [A()])).rejects.toThrow(/check/i);
  });

  it("is scoped to its business", async () => {
    await repos.autopilot.set(r.db, A(), { enabled: true, maxCyclesPerDay: 3 });
    expect(await row(B())).toMatchObject({ autopilotEnabled: false, autopilotMaxCyclesPerDay: 6 });
  });
});

describe("repos.autopilot.pause", () => {
  it("pauses an Autopilot that is on, once, and never one that is off", async () => {
    expect(await repos.autopilot.pause(r.db, A(), "credits_exhausted")).toBe(false);
    await repos.autopilot.set(r.db, A(), { enabled: true });
    expect(await repos.autopilot.pause(r.db, A(), "credits_exhausted")).toBe(true);
    expect(await repos.autopilot.pause(r.db, A(), "kill_switch")).toBe(false);
    expect((await row(A())).autopilotPausedReason).toBe("credits_exhausted");
  });
});

describe("the stop flag pauses Autopilot and the resume does not turn it back on", () => {
  it("stop (any reason) pauses it in the same transaction; resume leaves it paused", async () => {
    await repos.autopilot.set(r.db, A(), { enabled: true });
    const stop = await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    expect(stop.autopilotPaused).toBe(true);
    expect(await row(A())).toMatchObject({ autopilotEnabled: true, autopilotPausedReason: "kill_switch" });
    expect((await repos.audit.list(r.db, A(), { action: "autopilot.pause" })).items[0]!.details).toMatchObject({ reason: "kill_switch" });
    // A second stop does not pause twice.
    expect((await stopBusinessAgents(r.db, A(), { reason: "credits_exhausted" })).autopilotPaused).toBe(false);
    await resumeBusinessAgents(r.db, A());
    expect(await row(A())).toMatchObject({ autopilotEnabled: true, autopilotPausedReason: "kill_switch" });
  });

  it("a stop with Autopilot off, or in another business, pauses nothing", async () => {
    expect((await stopBusinessAgents(r.db, A(), { reason: "key_revoked" })).autopilotPaused).toBe(false);
    await resumeBusinessAgents(r.db, A());
    await repos.autopilot.set(r.db, B(), { enabled: true });
    await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    expect((await row(B())).autopilotPausedReason).toBeNull();
  });
});

describe("autopilot columns under RLS (columns of businesses)", () => {
  it("members and viewers read them, cannot change them; admins can; nobody touches another business", async () => {
    await repos.autopilot.set(r.db, A(), { enabled: true });
    const read = (businessId: string) => (tx: Parameters<Parameters<RepoHarness["as"]>[1]>[0]) => tx.select({ on: businesses.autopilotEnabled }).from(businesses).where(eq(businesses.id, businessId));
    expect(await r.as(r.A.memberId, read(A()))).toEqual([{ on: true }]);
    expect(await r.as(r.A.memberId, read(B()))).toEqual([]);
    for (const userId of [r.A.memberId, r.A.viewerId, r.B.ownerId]) {
      try {
        const rows = await r.as(userId, (tx) => tx.update(businesses).set({ autopilotEnabled: false }).where(eq(businesses.id, A())).returning({ id: businesses.id }));
        expect(rows).toHaveLength(0);
      } catch (err) {
        expect((err as Error).message).toMatch(RLS_DENIED);
      }
    }
    expect((await row(A())).autopilotEnabled).toBe(true);
    const off = await r.as(r.A.adminId, (tx) => repos.autopilot.set(tx, A(), { enabled: false }));
    expect(off.turnedOff).toBe(true);
    const on = await r.as(r.A.ownerId, (tx) => repos.autopilot.set(tx, A(), { enabled: true, maxCyclesPerDay: 4 }));
    expect(on.business.autopilotMaxCyclesPerDay).toBe(4);
  });
});

describe("summarizeCycleEvents", () => {
  const at = (iso: string) => new Date(iso);
  const started = (cycleId: string, iso: string, trigger = "continue") => ({ type: "cycle.started", occurredAt: at(iso), payload: { cycleId, trigger } });
  const completed = (cycleId: string, iso: string, outcome = "completed", tasksDispatched = 2, tasksCompleted = 2) => ({ type: "cycle.completed", occurredAt: at(iso), payload: { cycleId, outcome, tasksDispatched, tasksCompleted } });
  const now = at("2026-10-13T12:00:00.000Z").getTime();
  const opts = { now, since: at("2026-10-13T00:00:00.000Z").getTime(), dayStart: at("2026-10-13T00:00:00.000Z").getTime() };

  it("finds the open cycle, the last start and end, today's Autopilot starts and the cycles since it was turned on", () => {
    const events = [started("c3", "2026-10-13T11:00:00Z", "autopilot"), completed("c2", "2026-10-13T09:00:00Z", "failed", 1, 0), started("c2", "2026-10-13T08:00:00Z", "autopilot"), completed("c1", "2026-10-12T20:00:00Z"), started("c1", "2026-10-12T18:00:00Z")];
    const s = summarizeCycleEvents(events, opts);
    expect(s).toMatchObject({ open: true, autopilotStartsToday: 2 });
    expect(s.lastStartedAt).toBe(at("2026-10-13T11:00:00Z").getTime());
    expect(s.lastEndedAt).toBe(at("2026-10-13T09:00:00Z").getTime());
    // Only the cycle that finished since `since` counts toward the streak.
    expect(s.finished).toEqual([{ outcome: "failed", tasksDispatched: 1, tasksCompleted: 0 }]);
  });

  it("a cycle that completed is not open, and one that began more than 36 hours ago and never completed is a crashed one, not a running one", () => {
    expect(summarizeCycleEvents([completed("c1", "2026-10-13T10:00:00Z"), started("c1", "2026-10-13T09:00:00Z")], opts).open).toBe(false);
    const old = new Date(now - STALE_CYCLE_MS - 60_000).toISOString();
    expect(summarizeCycleEvents([started("c1", old)], opts).open).toBe(false);
    expect(summarizeCycleEvents([started("c1", "2026-10-13T11:00:00Z")], opts).open).toBe(true);
    expect(summarizeCycleEvents([], opts)).toMatchObject({ open: false, lastStartedAt: null, lastEndedAt: null, autopilotStartsToday: 0, finished: [] });
  });
});

describe("loadAutopilotFacts feeds the same decision the workflow makes", () => {
  it("reads the stop flag, credits, vacation, Inbox, cycles and spend of one business", async () => {
    const now = new Date("2026-10-13T12:00:00.000Z");
    await repos.autopilot.set(r.db, A(), { enabled: true }, new Date("2026-10-13T06:00:00.000Z"));
    const base = await loadAutopilotFacts(r.db, await row(A()), now);
    expect(base).toMatchObject({ enabled: true, pausedReason: null, stopReason: null, vacation: false, archived: false });
    expect(base.blockingItems).toBe(await repos.inbox.countBlocking(r.db, A()));
    expect(base.since).toBe(new Date("2026-10-13T06:00:00.000Z").getTime());
    expect(base.settings).toEqual({ cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 });

    await repos.events.write(r.db, A(), { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, occurredAt: new Date("2026-10-13T10:00:00.000Z"), payload: { cycleId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60", cycleNumber: 1, workflowId: `cycle:${A()}:1`, trigger: "autopilot", timeBoxAgentHours: 4, plannedTaskIds: [], budget: null } });
    const running = await loadAutopilotFacts(r.db, await row(A()), now);
    expect(running).toMatchObject({ cycleOpen: true, cyclesToday: 1 });
    expect(decideAutopilot(running)).toMatchObject({ action: "wait", why: "cycle_running" });

    await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    const stopped = await loadAutopilotFacts(r.db, await row(A()), now);
    expect(stopped).toMatchObject({ stopReason: "kill_switch", pausedReason: "kill_switch" });
    expect(decideAutopilot(stopped)).toMatchObject({ action: "paused", reason: "kill_switch" });

    // Another business is untouched.
    expect(await loadAutopilotFacts(r.db, await row(B()), now)).toMatchObject({ enabled: false, stopReason: null, cycleOpen: false, cyclesToday: 0 });
  });

  it("a vacation in progress is a fact", async () => {
    await repos.autopilot.set(r.db, B(), { enabled: true });
    await repos.holidays.start(r.db, B(), { untilAt: new Date(Date.now() + 86_400_000), authority: {}, startedBy: r.B.ownerId });
    expect((await loadAutopilotFacts(r.db, await row(B()), new Date())).vacation).toBe(true);
  });
});
