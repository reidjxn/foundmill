/**
 * agent.model.set retests and agent.training.cancel (audit TPD-03 / RA-04 / O-18): a model change queues a retest of a
 * draft copy of the live version on the new model, never the live version itself (which the orchestrator refuses, so the
 * run used to stay queued for good); a queued or running run can be canceled, which signals its workflow to stop.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("agent.model.set retests (AC-11.10.5)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentretest", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("changes the model at once and queues a retest of a draft copy on the new model, the live version untouched", async () => {
    const { businessId, ownerId, agentId, agentVersionId } = hz.A;
    const before = await repos.agents.get(hz.db, businessId, agentId);
    expect(before.modelKey).toBe("sonnet");
    const liveBefore = await repos.agents.getVersion(hz.db, businessId, agentVersionId);

    const result = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" });
    expect(result.updated).toEqual([agentId]);
    expect(result.retests).toHaveLength(1);
    expect(result.retests[0]!.workflow.queued).toBe(true);
    const runId = result.retests[0]!.runId;

    const run = await repos.training.get(hz.db, businessId, runId);
    expect(run).toMatchObject({ status: "queued", fromVersionId: agentVersionId, requestedBy: ownerId });
    expect(run.toVersionId).not.toBe(agentVersionId);
    const draft = await repos.agents.getVersion(hz.db, businessId, run.toVersionId!);
    expect(draft).toMatchObject({ agentId, state: "draft", modelKey: "opus", createdByKind: "system", instructions: liveBefore.instructions, tools: liveBefore.tools });
    // The agent works on the new model now; its live version is the same row, unchanged, until Promote.
    const after = await repos.agents.get(hz.db, businessId, agentId);
    expect(after).toMatchObject({ modelKey: "opus", currentVersionId: agentVersionId });
    expect(await repos.agents.getVersion(hz.db, businessId, agentVersionId)).toMatchObject({ state: "live", modelKey: liveBefore.modelKey });
    expect(temporal.starts.filter((s) => s.workflowId === `training:${runId}`)).toEqual([{ type: "trainingRun", workflowId: `training:${runId}`, args: [{ businessId, trainingRunId: runId }] }]);
    const audit = await repos.audit.list(hz.db, businessId, { action: "agent.model.set" });
    expect((audit.items[0]!.details as { retests: string[] }).retests).toEqual([runId]);
  });

  it("queues nothing for an agent already on the model, nor for one without a live version", async () => {
    const { businessId, ownerId, agentId, agent2Id } = hz.A;
    const runsBefore = (await repos.training.list(hz.db, businessId, { limit: 100 })).items;
    const opusRetest = runsBefore.find((r) => r.status === "queued")!;
    const same = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" });
    expect(same.updated).toEqual([agentId]);
    expect(same.retests).toEqual([]);
    expect(same.superseded).toEqual([]);
    const all = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId: agent2Id, modelKey: "haiku", applyScope: "all" });
    // The Chief of Staff (live version) gets a retest on Haiku; the unversioned engineer only changes model.
    expect(all.updated.sort()).toEqual([agentId, agent2Id].sort());
    expect(all.retests).toHaveLength(1);
    const run = await repos.training.get(hz.db, businessId, all.retests[0]!.runId);
    expect(run.agentId).toBe(agentId);
    expect((await repos.agents.getVersion(hz.db, businessId, run.toVersionId!)).modelKey).toBe("haiku");
    expect((await repos.training.list(hz.db, businessId, { limit: 100 })).items.length).toBe(runsBefore.length + 1);
    // The Opus retest still queued tests a model the agent no longer runs: canceled, and its workflow told to stop.
    expect(all.superseded).toEqual([opusRetest.id]);
    expect((await repos.training.get(hz.db, businessId, opusRetest.id)).status).toBe("cancelled");
    expect(temporal.signals).toContainEqual({ workflowId: `training:${opusRetest.id}`, signal: "stop", args: [] });
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).modelKey).toBe("haiku");
    // Business B saw nothing.
    expect((await repos.training.list(hz.db, hz.B.businessId, { limit: 100 })).items).toHaveLength(0);
  });

  it("cancels a queued run and signals its workflow to stop; an ended run cannot be canceled again", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const { runId } = (await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "sonnet" })).retests[0]!;
    const cancelled = await hz.caller({ userId: ownerId }).agent.training.cancel({ businessId, runId });
    expect(cancelled.run).toMatchObject({ id: runId, status: "cancelled" });
    expect(cancelled.run.endedAt).toBeInstanceOf(Date);
    expect(cancelled.workflow.queued).toBe(true);
    expect(temporal.signals).toContainEqual({ workflowId: `training:${runId}`, signal: "stop", args: [] });
    expect((await repos.audit.list(hz.db, businessId, { action: "agent.training.cancel" })).items).toHaveLength(1);
    await expect(hz.caller({ userId: ownerId }).agent.training.cancel({ businessId, runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("only members who can change the team may cancel, and only their own business's runs", async () => {
    const { businessId, ownerId, agentId, viewerId } = hz.A;
    const { runId } = (await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" })).retests[0]!;
    await expect(hz.caller({ userId: viewerId }).agent.training.cancel({ businessId, runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).agent.training.cancel({ businessId, runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).agent.training.cancel({ businessId: hz.B.businessId, runId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repos.training.get(hz.db, businessId, runId)).status).toBe("queued");
  });
});

describe("agent.training.cancel without Temporal", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentcancel" });
  }, 120_000);
  afterAll(() => hz.close());

  it("frees a run no worker will pick up (the stuck retests): canceled at once, queued:false reported", async () => {
    const { businessId, ownerId, agentId, agentVersionId } = hz.A;
    // The shape the old agent.model.set left behind: from = to = the live version, queued for good.
    const stuck = await repos.training.create(hz.db, businessId, { agentId, fromVersionId: agentVersionId, toVersionId: agentVersionId, status: "queued" });
    const result = await hz.caller({ userId: ownerId }).agent.training.cancel({ businessId, runId: stuck.id });
    expect(result.run.status).toBe("cancelled");
    expect(result.workflow.queued).toBe(false);
    expect((await repos.training.get(hz.db, businessId, stuck.id)).status).toBe("cancelled");
  });

  it("the next model change also clears a stuck retest of the old shape, and its own retest can be canceled", async () => {
    const { businessId, ownerId, agentId, agentVersionId } = hz.A;
    const stuck = await repos.training.create(hz.db, businessId, { agentId, fromVersionId: agentVersionId, toVersionId: agentVersionId, status: "queued" });
    const result = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" });
    expect(result.superseded).toEqual([stuck.id]);
    expect((await repos.training.get(hz.db, businessId, stuck.id)).status).toBe("cancelled");
    // No orchestrator: the new retest is queued but not started (queued:false); the founder can cancel it.
    expect(result.retests[0]!.workflow.queued).toBe(false);
    const cancelled = await hz.caller({ userId: ownerId }).agent.training.cancel({ businessId, runId: result.retests[0]!.runId });
    expect(cancelled.run.status).toBe("cancelled");
  });
});
