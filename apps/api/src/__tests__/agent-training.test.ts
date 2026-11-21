/**
 * agent.model.set retests and agent.training.cancel (audit TPD-03 / RA-04 / O-18): a model change queues a retest of a
 * draft copy of the live version on the new model, never the live version itself (which the orchestrator refuses, so the
 * run used to stay queued for good); a queued or running run can be canceled, which signals its workflow to stop.
 */
import { periodOf, repos } from "@foundmill/db";
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
    // A wider scope queues no retest unless asked (WP-09 T9: one press must not queue a retest per agent).
    const quiet = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId: agent2Id, modelKey: "sonnet", applyScope: "all" });
    expect(quiet.retests).toEqual([]);
    await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId: agent2Id, modelKey: "opus", applyScope: "all", retest: false });
    const all = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId: agent2Id, modelKey: "haiku", applyScope: "all", retest: true });
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
    const { runId } = (await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" })).retests[0]!;
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
    const { runId } = (await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "haiku" })).retests[0]!;
    await expect(hz.caller({ userId: viewerId }).agent.training.cancel({ businessId, runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).agent.training.cancel({ businessId, runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).agent.training.cancel({ businessId: hz.B.businessId, runId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repos.training.get(hz.db, businessId, runId)).status).toBe("queued");
  });

  it("a change back to the live version's model queues no retest and withdraws the Haiku results, which can no longer switch it back", async () => {
    const { businessId, ownerId, agentId, agentVersionId } = hz.A;
    const pending = (await repos.training.list(hz.db, businessId, { agentId, status: "queued", limit: 10 })).items;
    expect(pending).toHaveLength(1);
    // The Haiku retest finished and awaits a decision.
    await repos.training.transition(hz.db, businessId, pending[0]!.id, ["queued"], { status: "awaiting_decision", endedAt: new Date() });
    const versionsBefore = (await repos.agents.listVersions(hz.db, businessId, agentId)).length;

    const back = await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "sonnet" });
    expect(back.updated).toEqual([agentId]);
    expect(back.retests).toEqual([]);
    expect(back.superseded).toEqual([pending[0]!.id]);
    expect(await repos.training.get(hz.db, businessId, pending[0]!.id)).toMatchObject({ status: "cancelled", decision: null });
    expect(await repos.agents.listVersions(hz.db, businessId, agentId)).toHaveLength(versionsBefore);
    await expect(hz.caller({ userId: ownerId }).agent.training.promote({ businessId, runId: pending[0]!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repos.agents.get(hz.db, businessId, agentId)).toMatchObject({ modelKey: "sonnet", currentVersionId: agentVersionId });
  });

  it("promoting a draft saved before a model change keeps the model the agent runs now (FU-T2-1)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect((await repos.agents.get(hz.db, businessId, agentId)).modelKey).toBe("sonnet");
    // The founder saves a draft on Sonnet, then moves the agent to Opus before the draft is trained and promoted.
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId, instructions: { role: "Chief of Staff", goals: ["Plan every round of work"], rules: ["Ask before spending"], playbook: ["Read the inbox first"], tone: "Plain", examples: [] } });
    expect(version.modelKey).toBe("sonnet");
    await owner.agent.model.set({ businessId, agentId, modelKey: "opus" });
    const run = await repos.training.create(hz.db, businessId, { agentId, toVersionId: version.id, status: "awaiting_decision" });
    await owner.agent.training.promote({ businessId, runId: run.id });
    // The draft's instructions are live; the agent did not move back to Sonnet.
    expect(await repos.agents.get(hz.db, businessId, agentId)).toMatchObject({ currentVersionId: version.id, modelKey: "opus" });
    expect((await repos.agents.getVersion(hz.db, businessId, version.id)).modelKey).toBe("sonnet");
  });
});

describe("promote writes the run's scores onto the agent's ratings (founder: 'Training doesn't update ratings')", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentratings" });
  }, 120_000);
  afterAll(() => hz.close());

  const skillsOf = async (agentId: string) => new Map((await repos.skills.listForAgent(hz.db, hz.A.businessId, agentId)).map((s) => [s.skillKey, s]));
  /** A trained draft awaiting the founder's decision, as the orchestrator leaves it (results per skill, test counts). */
  const awaitingRun = async (results: Record<string, { old: number; new: number; tests?: number }>) => {
    const { businessId, ownerId, agentId } = hz.A;
    const { version } = await hz.caller({ userId: ownerId }).agent.training.saveDraft({ businessId, agentId, instructions: { role: "Chief of Staff", goals: ["Plan every round of work"], rules: ["Ask before spending"], playbook: ["Read the inbox first"], tone: "Plain", examples: [] } });
    const agent = await repos.agents.get(hz.db, businessId, agentId);
    const run = await repos.training.create(hz.db, businessId, { agentId, fromVersionId: agent.currentVersionId, toVersionId: version.id, status: "awaiting_decision" });
    return repos.training.update(hz.db, businessId, run.id, { results, endedAt: new Date() });
  };

  it("promote writes tested, re-blended displayed and potential in one transaction with the event and the audit entry; a skill with no tests stays untested and the profile's figures follow", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await repos.skills.upsertForAgent(hz.db, businessId, agentId, [
      { skillKey: "planning", group: "judgement", tested: 10, proven: null, nLive: 0, displayed: 10, potential: 10 },
      { skillKey: "speed", group: "execution", tested: 10, proven: 14, nLive: 20, displayed: 12, potential: 10 },
      { skillKey: "library_release_notes", group: "craft", tested: null, proven: null, nLive: 0, displayed: 10, potential: 10 },
    ]);
    const run = await awaitingRun({ planning: { old: 10, new: 13, tests: 12 }, speed: { old: 10, new: 8, tests: 12 }, library_release_notes: { old: 10, new: 10, tests: 0 } });
    // The results read "No tests yet" for the library skill before anything is decided.
    const results = await owner.agent.training.results({ businessId, runId: run.id });
    expect(results.deltas.find((d) => d.skillKey === "library_release_notes")).toMatchObject({ old: 10, new: 10, tests: 0 });
    expect(results.deltas.find((d) => d.skillKey === "planning")).toMatchObject({ delta: 3, tests: 12 });

    const promoted = await owner.agent.training.promote({ businessId, runId: run.id });
    expect(promoted.decision).toBe("promoted");
    // Potential is the best tested score across the agent's runs (BUILD §11.10); the template's baseline is not one.
    expect(promoted.ratings.map((r) => [r.skillKey, r.previousTested, r.tested, r.displayed, r.potential]).sort()).toEqual([
      ["planning", 10, 13, 13, 13],
      ["speed", 10, 8, 11, 8],
    ]);
    const skills = await skillsOf(agentId);
    expect(skills.get("planning")).toMatchObject({ tested: "13.000", displayed: 13, potential: 13 });
    expect(skills.get("speed")).toMatchObject({ tested: "8.000", proven: "14.000", nLive: 20, displayed: 11, potential: 8 });
    expect(skills.get("library_release_notes")).toMatchObject({ tested: null, displayed: 10, potential: 10 });
    // The profile shows it at once: the tested rating per skill, and the stars over the skills that have one (13 + 8) / 2.
    const profile = await owner.agent.profile.get({ businessId, agentId });
    expect(profile.skills.find((s) => s.skillKey === "planning")).toMatchObject({ tested: "13.000", displayed: 13 });
    expect(profile.skills.find((s) => s.skillKey === "library_release_notes")).toMatchObject({ tested: null });
    expect(profile.stars).toEqual({ current: Math.round(10.5 / 4), potential: Math.round(13 / 4) });
    const audit = await repos.audit.list(hz.db, businessId, { action: "agent.training.promote" });
    expect((audit.items[0]!.details as { ratings: { skillKey: string; from: number | null; to: number }[] }).ratings.map((r) => [r.skillKey, r.from, r.to]).sort()).toEqual([
      ["planning", 10, 13],
      ["speed", 10, 8],
    ]);
    const events = await repos.events.list(hz.db, businessId, { type: "agent.promoted", limit: 5 });
    expect(events.items.some((e) => (e.payload as { trainingRunId: string | null }).trainingRunId === run.id)).toBe(true);
  });

  it("discard writes nothing, a viewer may not promote, and another business's owner cannot reach the run", async () => {
    const { businessId, ownerId, viewerId, agentId } = hz.A;
    const before = await repos.skills.listForAgent(hz.db, businessId, agentId);
    const run = await awaitingRun({ planning: { old: 13, new: 18, tests: 12 } });
    await expect(hz.caller({ userId: viewerId }).agent.training.promote({ businessId, runId: run.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).agent.training.promote({ businessId: hz.B.businessId, runId: run.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const discarded = await hz.caller({ userId: ownerId }).agent.training.discard({ businessId, runId: run.id });
    expect(discarded).toMatchObject({ decision: "discarded", ratings: [] });
    expect(await repos.skills.listForAgent(hz.db, businessId, agentId)).toEqual(before);
  });

  it("rollback restores the ratings the promotion replaced and keeps the potential reached (AC-11.10.6)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const run = await awaitingRun({ planning: { old: 13, new: 16, tests: 12 }, library_release_notes: { old: 10, new: 10, tests: 0 } });
    await owner.agent.training.promote({ businessId, runId: run.id });
    const promoted = (await skillsOf(agentId)).get("planning")!;
    // The discarded 18 above was reached on a run too, so the potential already remembers it.
    expect(promoted).toMatchObject({ tested: "16.000", displayed: 16, potential: 18 });
    await owner.agent.training.rollback({ businessId, agentId });
    const skills = await skillsOf(agentId);
    expect(skills.get("planning")).toMatchObject({ tested: "13.000", displayed: 13, potential: promoted.potential });
    expect(skills.get("library_release_notes")).toMatchObject({ tested: null });
    const audit = await repos.audit.list(hz.db, businessId, { action: "agent.training.rollback" });
    expect((audit.items[0]!.details as { ratingsRestored: { skillKey: string; from: number | null; to: number }[] }).ratingsRestored).toEqual([{ skillKey: "planning", from: 16, to: 13 }]);
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

describe("training says a true price and checks it against the balance (WP-09 T9)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentprice", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  /** Leaves `minor` of this month's credits (the included credits used up first, as the first charge would). */
  const leave = async (businessId: string, minor: number) => {
    const period = periodOf(new Date());
    const { balance } = await repos.usage.ensurePeriodCredits(hz.db, businessId, period, 0);
    await repos.usage.chargeCredits(hz.db, businessId, period, Number(balance.balanceMinor));
    if (minor > 0) await repos.usage.grantCredits(hz.db, businessId, period, minor);
  };

  it("refuses a run and a retest the credits cannot finish, with both figures, and queues nothing", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await repos.skills.upsertForAgent(hz.db, businessId, agentId, [{ skillKey: "planning", group: "judgement", tested: 10, proven: null, nLive: 0, displayed: 10, potential: 10 }]);
    const estimate = await owner.agent.training.estimate({ businessId, agentId, modelKey: "opus" });
    expect(estimate.costMinor).toBeGreaterThan(1);
    expect(estimate.batchCostMinor).toBeLessThan(estimate.costMinor);
    const retest = await owner.agent.model.retestEstimate({ businessId, agentId, modelKey: "opus" });
    expect(retest).toMatchObject({ agents: 1, tests: estimate.tests, costMinor: estimate.costMinor, label: "Estimate" });
    await leave(businessId, estimate.costMinor - 1);
    const runsBefore = (await repos.training.list(hz.db, businessId, { limit: 100 })).items.length;
    const dollars = (m: number) => `$${(m / 100).toFixed(2)}`;
    await expect(owner.agent.model.set({ businessId, agentId, modelKey: "opus" })).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: `This check costs about ${dollars(estimate.costMinor)} (Estimate) and ${dollars(estimate.costMinor - 1)} of credits is left. Check fewer skills, or add credits or your own key.`,
    });
    expect((await repos.agents.get(hz.db, businessId, agentId)).modelKey).toBe("sonnet");
    expect((await repos.training.list(hz.db, businessId, { limit: 100 })).items.length).toBe(runsBefore);
    // A training run on Opus is refused the same way, before any run row exists.
    const live = await repos.agents.getVersion(hz.db, businessId, hz.A.agentVersionId);
    const version = await repos.agents.createVersion(hz.db, businessId, agentId, { instructions: live.instructions, tools: live.tools as unknown[], modelKey: "opus", state: "draft", createdByKind: "user", createdBy: ownerId });
    await expect(owner.agent.training.run({ businessId, agentId, versionId: version.id })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect((await repos.training.list(hz.db, businessId, { limit: 100 })).items.length).toBe(runsBefore);
    // Without a retest the model change costs nothing, so it goes through.
    expect((await owner.agent.model.set({ businessId, agentId, modelKey: "opus", retest: false })).retests).toEqual([]);
  });

  it("does not check a project on its own key", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    await repos.skills.upsertForAgent(hz.db, businessId, agentId, [{ skillKey: "planning", group: "judgement", tested: 10, proven: null, nLive: 0, displayed: 10, potential: 10 }]);
    await leave(businessId, 0);
    await expect(hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    await repos.businesses.update(hz.db, businessId, { modelBilling: "byok" });
    try {
      expect((await hz.caller({ userId: ownerId }).agent.model.set({ businessId, agentId, modelKey: "opus" })).retests).toHaveLength(1);
    } finally {
      await repos.businesses.update(hz.db, businessId, { modelBilling: "credits" });
    }
  });
});
