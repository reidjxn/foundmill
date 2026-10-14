/**
 * 0023 business controls: the team-wide stop flag and its way back, agents' pause reasons, sessions' workflow ids.
 * The flag is a column of `businesses`, so its policies hold: members read it, only owners and admins change it.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resumeBusinessAgents, stopBusinessAgents } from "../../controls";
import { repos } from "../../repos";
import { agents, businesses } from "../../schema";
import { createBusinessFixture, RLS_DENIED } from "../rls/fixtures";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("controls");
}, 120_000);
afterAll(() => r?.close());

const A = () => r.A.businessId;
const B = () => r.B.businessId;
const statuses = async (businessId: string) => (await repos.agents.list(r.db, businessId, { limit: 50 })).items.map((a) => ({ status: a.status, reason: a.pausedReason }));

describe("sessions carry their real workflow id", () => {
  it("createSession writes session:<id> with the row (no placeholder), with or without a caller-chosen id", async () => {
    const s = await repos.agents.createSession(r.db, A(), { agentId: r.A.agent2Id, taskId: r.A.taskId });
    expect(s.workflowId).toBe(`session:${s.id}`);
    const id = "5e55e55e-0000-4000-8000-000000000001";
    const chosen = await repos.agents.createSession(r.db, A(), { id, agentId: r.A.agent2Id, taskId: r.A.taskId });
    expect(chosen).toMatchObject({ id, workflowId: `session:${id}` });
    await repos.agents.endSession(r.db, A(), s.id, { outcome: "failed" });
    await repos.agents.endSession(r.db, A(), chosen.id, { outcome: "done" });
    const recent = await repos.agents.recentOutcomes(r.db, A(), { taskIds: [r.A.taskId] });
    expect(recent.map((x) => [x.id, x.outcome])).toEqual(expect.arrayContaining([[s.id, "failed"], [chosen.id, "done"]]));
    expect(recent.every((x) => x.endedAt !== null)).toBe(true);
    expect(await repos.agents.recentOutcomes(r.db, B(), { taskIds: [r.A.taskId] })).toEqual([]);
  });
});

describe("stopBusinessAgents / resumeBusinessAgents", () => {
  it("a stop sets the flag, pauses every live agent with the reason and leaves the other business alone", async () => {
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "healthy");
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(false);
    const stop = await stopBusinessAgents(r.db, A(), { reason: "key_revoked" });
    expect(stop).toMatchObject({ reason: "key_revoked", alreadyStopped: false });
    expect(stop.paused.map((p) => p.id).sort()).toEqual([r.A.agentId, r.A.agent2Id].sort());
    expect(stop.paused.find((p) => p.id === r.A.agent2Id)?.from).toBe("healthy");
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(true);
    expect(await statuses(A())).toEqual(expect.arrayContaining([{ status: "paused", reason: "key_revoked" }]));
    expect((await statuses(A())).every((a) => a.status === "paused")).toBe(true);
    expect(await repos.businesses.agentsStopped(r.db, B())).toBe(false);
    expect((await statuses(B())).some((a) => a.status !== "paused")).toBe(true);
  });

  it("a top-up does not lift a key revoke; a new key does", async () => {
    expect(await resumeBusinessAgents(r.db, A(), { reason: "credits_exhausted" })).toMatchObject({ resumed: false, reason: "key_revoked", agentIds: [] });
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(true);
    const back = await resumeBusinessAgents(r.db, A(), { reason: "key_revoked" });
    expect(back).toMatchObject({ resumed: true, reason: "key_revoked" });
    expect(back.agentIds.sort()).toEqual([r.A.agentId, r.A.agent2Id].sort());
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(false);
    expect(await statuses(A())).toEqual(expect.arrayContaining([{ status: "idle", reason: null }]));
    expect((await statuses(A())).some((a) => a.status === "paused")).toBe(false);
    // Nothing to resume: a key stored on a running team changes nothing.
    expect(await resumeBusinessAgents(r.db, A(), { reason: "key_revoked" })).toMatchObject({ resumed: false, agentIds: [] });
  });

  it("Stop all agents outranks a credits stop: a top-up then lifts nothing, only an owner or admin does", async () => {
    await stopBusinessAgents(r.db, A(), { reason: "credits_exhausted" });
    const again = await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    expect(again).toMatchObject({ reason: "kill_switch", alreadyStopped: true, paused: [] });
    expect(await resumeBusinessAgents(r.db, A(), { reason: ["credits_exhausted", "key_revoked"] })).toMatchObject({ resumed: false, reason: "kill_switch" });
    expect((await repos.businesses.stopState(r.db, A())).reason).toBe("kill_switch");
    expect(await resumeBusinessAgents(r.db, A())).toMatchObject({ resumed: true, reason: "kill_switch" });
    expect(await repos.businesses.stopState(r.db, A())).toMatchObject({ stopped: false, stoppedAt: null, reason: null });
  });

  it("a key or credits stop after the kill switch keeps the kill switch as the reason", async () => {
    await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    expect(await stopBusinessAgents(r.db, A(), { reason: "credits_exhausted" })).toMatchObject({ reason: "kill_switch", alreadyStopped: true });
    await resumeBusinessAgents(r.db, A());
  });

  it("a wage-cap pause survives a resume; leaving paused drops any reason (trigger)", async () => {
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "paused", { pausedReason: "wage_cap" });
    await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    const back = await resumeBusinessAgents(r.db, A());
    expect(back.agentIds).toEqual([r.A.agentId]);
    expect(await repos.agents.get(r.db, A(), r.A.agent2Id)).toMatchObject({ status: "paused", pausedReason: "wage_cap" });
    // Any writer that moves the agent out of paused drops the reason, even a raw update.
    await r.db.update(agents).set({ status: "idle" }).where(eq(agents.id, r.A.agent2Id));
    expect(await repos.agents.get(r.db, A(), r.A.agent2Id)).toMatchObject({ status: "idle", pausedReason: null });
  });

  it("an agent paused with no recorded reason (before 0023) comes back with an owner's resume", async () => {
    await r.db.update(agents).set({ status: "paused" }).where(eq(agents.id, r.A.agent2Id));
    expect(await repos.agents.get(r.db, A(), r.A.agent2Id)).toMatchObject({ status: "paused", pausedReason: null });
    expect(await resumeBusinessAgents(r.db, A())).toMatchObject({ resumed: true, agentIds: [r.A.agent2Id] });
  });

  it("setHealthStatus never overwrites a pause", async () => {
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "paused", { pausedReason: "kill_switch" });
    expect(await repos.agents.setHealthStatus(r.db, A(), r.A.agent2Id, "failing")).toBeNull();
    expect(await repos.agents.get(r.db, A(), r.A.agent2Id)).toMatchObject({ status: "paused", pausedReason: "kill_switch" });
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "idle");
    expect(await repos.agents.setHealthStatus(r.db, A(), r.A.agent2Id, "failing")).toMatchObject({ status: "failing" });
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "idle");
  });

  it("an archived business counts as stopped", async () => {
    const C = await createBusinessFixture(r.h, "controls-c");
    expect(await repos.businesses.stopState(r.db, C.businessId)).toMatchObject({ stopped: false, archived: false });
    await repos.businesses.archive(r.db, C.businessId);
    expect(await repos.businesses.stopState(r.db, C.businessId)).toMatchObject({ stopped: true, archived: true, reason: null });
    expect(await repos.businesses.agentsStopped(r.db, C.businessId)).toBe(true);
  });
});

describe("what a stop covers beyond the agents it paused (SEC3)", () => {
  it("an agent hired, cloned or created in bulk while the team is stopped starts paused with the stop's reason and comes back with the others", async () => {
    await stopBusinessAgents(r.db, A(), { reason: "credits_exhausted" });
    const hired = await repos.agents.create(r.db, A(), { name: "Hired During Stop", agentType: "copywriter" });
    expect(hired).toMatchObject({ status: "paused", pausedReason: "credits_exhausted" });
    const cloned = await repos.agents.clone(r.db, A(), r.A.agentId, { name: "Cloned During Stop" });
    expect(cloned).toMatchObject({ status: "paused", pausedReason: "credits_exhausted" });
    const [bulk] = await repos.agents.createMany(r.db, A(), [{ id: "5e55e55e-0000-4000-8000-0000000000b1", name: "Bulk During Stop", agentType: "copywriter", status: "healthy" }]);
    expect(bulk).toMatchObject({ status: "paused", pausedReason: "credits_exhausted" });
    // The other business is not stopped: its hires start as asked.
    expect(await repos.agents.create(r.db, B(), { name: "Hired Elsewhere", agentType: "copywriter" })).toMatchObject({ status: "idle", pausedReason: null });

    const back = await resumeBusinessAgents(r.db, A());
    expect(back.agentIds).toEqual(expect.arrayContaining([hired.id, cloned.id, bulk!.id]));
    for (const id of [hired.id, cloned.id, bulk!.id]) expect(await repos.agents.get(r.db, A(), id)).toMatchObject({ status: "idle", pausedReason: null });
    // Running again: a hire starts as asked.
    expect(await repos.agents.create(r.db, A(), { name: "Hired After Resume", agentType: "copywriter" })).toMatchObject({ status: "idle" });
    for (const id of [hired.id, cloned.id, bulk!.id]) await repos.agents.release(r.db, A(), id);
  });

  it("cancelActive cancels every run still in flight with the reason, and only this business's", async () => {
    const draft = await repos.agents.createVersion(r.db, A(), r.A.agentId, { state: "draft" });
    const queued = await repos.training.create(r.db, A(), { agentId: r.A.agentId, toVersionId: draft.id, status: "queued" });
    const running = await repos.training.create(r.db, A(), { agentId: r.A.agentId, toVersionId: draft.id, status: "running" });
    const done = await repos.training.create(r.db, A(), { agentId: r.A.agentId, toVersionId: draft.id, status: "awaiting_decision" });
    const otherDraft = await repos.agents.createVersion(r.db, B(), r.B.agentId, { state: "draft" });
    const other = await repos.training.create(r.db, B(), { agentId: r.B.agentId, toVersionId: otherDraft.id, status: "queued" });

    const cancelled = await repos.training.cancelActive(r.db, A(), { coachSummaryMd: "Training canceled: Stop all agents." });
    expect(cancelled.map((c) => c.id).sort()).toEqual([queued.id, running.id].sort());
    for (const id of [queued.id, running.id]) expect(await repos.training.get(r.db, A(), id)).toMatchObject({ status: "cancelled", coachSummaryMd: "Training canceled: Stop all agents.", endedAt: expect.any(Date) });
    expect((await repos.training.get(r.db, A(), done.id)).status).toBe("awaiting_decision");
    expect((await repos.training.get(r.db, B(), other.id)).status).toBe("queued");
    expect(await repos.training.cancelActive(r.db, A(), { coachSummaryMd: "again" })).toEqual([]);
  });
});

describe("the stop flag under RLS (a column of businesses)", () => {
  it("members read it; members and viewers cannot change it, admins can; nobody touches another business", async () => {
    await stopBusinessAgents(r.db, A(), { reason: "kill_switch" });
    const read = (businessId: string) => (tx: Parameters<Parameters<RepoHarness["as"]>[1]>[0]) => tx.select({ at: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId));
    expect(await r.as(r.A.memberId, read(A()))).toEqual([{ at: expect.any(Date), reason: "kill_switch" }]);
    expect(await r.as(r.A.memberId, read(B()))).toEqual([]);
    for (const userId of [r.A.memberId, r.A.viewerId, r.B.ownerId]) {
      try {
        const rows = await r.as(userId, (tx) => tx.update(businesses).set({ agentsStoppedAt: null, agentsStoppedReason: null }).where(eq(businesses.id, A())).returning({ id: businesses.id }));
        expect(rows).toHaveLength(0);
      } catch (err) {
        expect((err as Error).message).toMatch(RLS_DENIED);
      }
    }
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(true);
    const cleared = await r.as(r.A.adminId, (tx) => resumeBusinessAgents(tx, A()));
    expect(cleared).toMatchObject({ resumed: true, reason: "kill_switch" });
    expect(await repos.businesses.agentsStopped(r.db, A())).toBe(false);
  });
});
