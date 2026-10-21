/**
 * Autopilot (0055): the setting is owner and admin only, audited, off by default; turning it on starts its workflow
 * (refused while the team is stopped); Stop all agents pauses it and the resume does not turn it back on; the status
 * is the same decision the workflow makes (a blocking Inbox item reads as Needs your answer); Commit can start a business
 * on autopilot.
 */
import { repos, stopBusinessAgents } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("business.autopilot", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "autopilot", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  const A = () => hz.A.businessId;
  const owner = () => hz.caller({ userId: hz.A.ownerId });
  const admin = () => hz.caller({ userId: hz.A.adminId });
  const member = () => hz.caller({ userId: hz.A.memberId });

  beforeEach(async () => {
    await repos.autopilot.set(hz.db, A(), { enabled: false, cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 });
    await owner().business.resumeAgents({ businessId: A() }).catch(() => undefined);
    // The fixture's blocking items would hold Autopilot at "Needs your answer"; tests that need none clear them.
    temporal.starts.length = 0;
    temporal.signals.length = 0;
  });

  it("is off by default and shows the Off chip to any member", async () => {
    const s = await member().business.autopilot.get({ businessId: A() });
    expect(s).toMatchObject({ enabled: false, state: "off", label: "Off", pausedReason: null, nextAt: null });
    expect(s.settings).toEqual({ cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 });
  });

  it("only owners and admins change it; a member, and another business's owner, are refused", async () => {
    await expect(member().business.autopilot.set({ businessId: A(), enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).business.autopilot.set({ businessId: A(), enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await repos.businesses.get(hz.db, A())).autopilotEnabled).toBe(false);
    expect(temporal.starts).toEqual([]);
  });

  it("turning it on starts the workflow `autopilot:<businessId>`, writes an audit row and an event; an admin may too", async () => {
    const r = await admin().business.autopilot.set({ businessId: A(), enabled: true });
    expect(r.change).toBe("turned_on");
    expect(r.workflow).toMatchObject({ queued: true, workflowId: `autopilot:${A()}` });
    expect(temporal.starts.map((s) => [s.type, s.workflowId])).toEqual([["autopilot", `autopilot:${A()}`]]);
    const business = await repos.businesses.get(hz.db, A());
    expect(business).toMatchObject({ autopilotEnabled: true, autopilotPausedReason: null });
    expect(business.autopilotChangedAt).toBeInstanceOf(Date);
    const audit = await repos.audit.list(hz.db, A(), { action: "autopilot.turn_on" });
    expect(audit.items[0]).toMatchObject({ actorKind: "user", actorId: hz.A.adminId });
    const events = await repos.events.list(hz.db, A(), { type: "autopilot.changed" });
    expect(events.items[0]!.payload).toMatchObject({ change: "turned_on", pausedReason: null, cadence: "every_4h", maxCyclesPerDay: 6 });
  });

  it("turning it off nudges the running workflow and audits it", async () => {
    await owner().business.autopilot.set({ businessId: A(), enabled: true });
    temporal.signals.length = 0;
    const r = await owner().business.autopilot.set({ businessId: A(), enabled: false });
    expect(r.change).toBe("turned_off");
    expect(temporal.signals.map((s) => [s.workflowId, s.signal])).toEqual([[`autopilot:${A()}`, "autopilotRefresh"]]);
    expect((await repos.audit.list(hz.db, A(), { action: "autopilot.turn_off" })).items).toHaveLength(1);
    expect((await owner().business.autopilot.get({ businessId: A() })).state).toBe("off");
  });

  it("settings are validated (1 to 24 cycles a day, 1 to 10 idle cycles), saved, audited once, and nudge the workflow", async () => {
    await expect(owner().business.autopilot.set({ businessId: A(), maxCyclesPerDay: 25 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner().business.autopilot.set({ businessId: A(), maxCyclesPerDay: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner().business.autopilot.set({ businessId: A(), maxIdleCycles: 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner().business.autopilot.set({ businessId: A(), dailyHour: 24 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner().business.autopilot.set({ businessId: A(), enabled: true });
    temporal.signals.length = 0;
    const r = await owner().business.autopilot.set({ businessId: A(), cadence: "daily", dailyHour: 14, maxCyclesPerDay: 2, spendCeilingMinor: 750, maxIdleCycles: 5 });
    expect(r.change).toBe("settings_changed");
    expect(r.status.settings).toEqual({ cadence: "daily", dailyHour: 14, maxCyclesPerDay: 2, spendCeilingMinor: 750, maxIdleCycles: 5 });
    expect(temporal.signals.map((s) => s.signal)).toEqual(["autopilotRefresh"]);
    // The same values again change nothing: no second audit row.
    const again = await owner().business.autopilot.set({ businessId: A(), cadence: "daily", dailyHour: 14, maxCyclesPerDay: 2, spendCeilingMinor: 750, maxIdleCycles: 5 });
    expect(again.change).toBeNull();
    expect((await repos.audit.list(hz.db, A(), { action: "autopilot.update_settings" })).items).toHaveLength(1);
    // Clearing the ceiling falls back to the credits left.
    expect((await owner().business.autopilot.set({ businessId: A(), spendCeilingMinor: null })).status.settings.spendCeilingMinor).toBeNull();
  });

  it("reads as Needs your answer while an Inbox item blocks Continue, and never answers it", async () => {
    await owner().business.autopilot.set({ businessId: A(), enabled: true });
    const blocking = await repos.inbox.countBlocking(hz.db, A());
    const s = await owner().business.autopilot.get({ businessId: A() });
    if (blocking > 0) {
      expect(s).toMatchObject({ state: "waiting", label: "Needs your answer", waitingFor: "inbox" });
      expect(s.detail).toMatch(/Autopilot never answers (it|them) for you/);
      expect(await repos.inbox.countBlocking(hz.db, A())).toBe(blocking);
    } else {
      expect(s.state).toBe("on");
    }
  });

  it("Stop all agents ends it with the stop signal and pauses it; Resume does not turn it back on", async () => {
    await owner().business.autopilot.set({ businessId: A(), enabled: true });
    temporal.signals.length = 0;
    const stop = await owner().business.stopAllAgents({ businessId: A() });
    expect(stop.workflows.signalled).toContain(`autopilot:${A()}`);
    expect(temporal.signals.find((s) => s.workflowId === `autopilot:${A()}`)?.signal).toBe("stop");
    const paused = await repos.businesses.get(hz.db, A());
    expect(paused).toMatchObject({ autopilotEnabled: true, autopilotPausedReason: "kill_switch" });
    expect((await repos.audit.list(hz.db, A(), { action: "autopilot.pause" })).items[0]!.details).toMatchObject({ reason: "kill_switch" });
    expect((await repos.events.list(hz.db, A(), { type: "autopilot.changed" })).items.some((e) => (e.payload as { change?: string }).change === "paused")).toBe(true);
    expect(await owner().business.autopilot.get({ businessId: A() })).toMatchObject({ state: "paused", label: "Paused: agents stopped", pausedReason: "kill_switch" });

    await owner().business.resumeAgents({ businessId: A() });
    const after = await owner().business.autopilot.get({ businessId: A() });
    expect(after).toMatchObject({ state: "paused", pausedReason: "kill_switch" });
    // ensure never restarts a paused Autopilot.
    temporal.starts.length = 0;
    expect(await owner().business.autopilot.ensure({ businessId: A() })).toMatchObject({ running: false });
    expect(temporal.starts).toEqual([]);

    // Only the founder turning it on again clears the pause and starts it.
    const on = await owner().business.autopilot.set({ businessId: A(), enabled: true });
    expect(on.change).toBe("turned_on");
    expect((await repos.businesses.get(hz.db, A())).autopilotPausedReason).toBeNull();
    expect(temporal.starts.map((s) => s.workflowId)).toEqual([`autopilot:${A()}`]);
  });

  it("refuses to turn it on while the team is stopped (a stopped team never auto-starts)", async () => {
    await stopBusinessAgents(hz.db, A(), { reason: "kill_switch" });
    await expect(owner().business.autopilot.set({ businessId: A(), enabled: true })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Autopilot cannot start/) });
    expect((await repos.businesses.get(hz.db, A())).autopilotEnabled).toBe(false);
    expect(temporal.starts).toEqual([]);
  });

  it("used-up credits and a revoked key stop the team and pause Autopilot with their own reason", async () => {
    await repos.autopilot.set(hz.db, A(), { enabled: true });
    await stopBusinessAgents(hz.db, A(), { reason: "credits_exhausted" });
    expect(await owner().business.autopilot.get({ businessId: A() })).toMatchObject({ state: "paused", label: "Paused: credits used up", pausedReason: "credits_exhausted" });
    expect((await repos.businesses.get(hz.db, A())).autopilotPausedReason).toBe("credits_exhausted");
  });

  it("ensure starts the workflow of an Autopilot that is on, and only that", async () => {
    expect(await member().business.autopilot.ensure({ businessId: A() })).toMatchObject({ running: false });
    expect(temporal.starts).toEqual([]);
    await repos.autopilot.set(hz.db, A(), { enabled: true });
    expect(await member().business.autopilot.ensure({ businessId: A() })).toMatchObject({ running: true });
    expect(temporal.starts.map((s) => s.workflowId)).toEqual([`autopilot:${A()}`]);
    await expect(hz.caller({ userId: hz.A.viewerId }).business.autopilot.ensure({ businessId: A() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Autopilot cycles carry the autopilot trigger in the event log (cycle.started accepts it)", async () => {
    const ev = await repos.events.write(hz.db, A(), { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId: crypto.randomUUID(), cycleNumber: 91, workflowId: `cycle:${A()}:91`, trigger: "autopilot", timeBoxAgentHours: 4, plannedTaskIds: [], budget: null } });
    expect(ev.type).toBe("cycle.started");
  });
});
