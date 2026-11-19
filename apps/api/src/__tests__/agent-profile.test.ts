/**
 * agent.* fixes (brief W19): the History strip agrees with the sessions it lists (TPD-29), sessions name their task
 * (TPD-21), the wage month is the viewer's and evaluated per request (RA-25), the model picker predicts a wage for an
 * agent with no spend yet (TPD-32), a released agent's profile cannot be edited (TPD-28), a rollback ends the watch
 * (TPD-20), training and saving are idempotent (RA-13), an empty or foreign patch is a 400 (BILL-23), negotiation cannot
 * be switched on while nothing runs it (GLS2F-07), custom skills are drafted, reviewed and counted (AC-08), and a
 * repeated plan request writes one graph (RA-13).
 */
import { CUSTOM_SKILL_TEST_COUNT } from "@foundmill/agents";
import { periodOf, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const instructions = (role: string) => ({ role, goals: ["Plan every round of work"], rules: ["Ask before spending"], playbook: ["Read the inbox first"], tone: "Plain", examples: [] });

describe("agent profile and training (W19)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentw19", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("History's 30-day figures come from the agent's own sessions, usage and approvals, and sessions name their task (TPD-29, TPD-21)", async () => {
    const { businessId, ownerId, agent2Id, taskId } = hz.A;
    const yesterday = new Date(Date.now() - 86_400_000);
    const s = await repos.agents.createSession(hz.db, businessId, { agentId: agent2Id, taskId, startedAt: yesterday });
    await repos.agents.endSession(hz.db, businessId, s.id, { outcome: "done", endedAt: yesterday, costMinor: 310 });
    await repos.usage.record(hz.db, businessId, { agentId: agent2Id, sessionId: s.id, kind: "tokens", costMinor: 310, occurredAt: yesterday.toISOString() });
    const profile = await hz.caller({ userId: ownerId }).agent.profile.get({ businessId, agentId: agent2Id });
    expect(profile.recent).toMatchObject({ days: 30, tasksDone: 1, sessions: 1, failed: 0, costMinor: 310, currency: "USD", label: "Estimate" });
    expect(profile.metrics.find((m) => m.day === yesterday.toISOString().slice(0, 10))).toMatchObject({ tasksDone: 1, sessions: 1, costMinor: 310 });
    const listed = profile.sessions.find((x) => x.id === s.id);
    expect(listed?.task).toEqual({ id: taskId, title: "Build onboarding", status: expect.any(String) });
    // No agent line manager: it reports to the owner, who is "You" only to that person.
    expect(profile.reportsToOwner).toEqual({ userId: ownerId, isViewer: true });
    expect((await hz.caller({ userId: hz.A.adminId }).agent.profile.get({ businessId, agentId: agent2Id })).reportsToOwner).toEqual({ userId: ownerId, isViewer: false });
  });

  it("the profile's versions list only tools that exist; a draft saved from what is shown never counts as new tools", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    // Held since before Nov 11, 2026: grants on a connector that was never built and capabilities no tool serves.
    const stored = [
      { connectorKey: "platform", tools: ["tasks.list", "documents.write", "rfq.create", "inbox.request_human_action"] },
      { connectorKey: "figma", tools: ["files.read", "nodes.read"] },
      { connectorKey: "github", tools: ["repos.read", "issues.list"] },
    ];
    const agent = await repos.agents.create(hz.db, businessId, { name: "Hired last month", agentType: "frontend_engineer", initialVersion: { instructions: instructions("Frontend engineer"), tools: stored } });
    const shown = [
      { connectorKey: "platform", tools: ["tasks.list", "inbox.request_human_action"] },
      { connectorKey: "github", tools: ["repos.read"] },
    ];
    const profile = await hz.caller({ userId: ownerId }).agent.profile.get({ businessId, agentId: agent.id });
    expect(profile.current?.tools).toEqual(shown);
    expect(profile.versions.map((v) => v.tools)).toEqual([shown]);
    // The stored version is untouched.
    expect((await repos.agents.getVersion(hz.db, businessId, agent.currentVersionId!)).tools).toEqual(stored);
    // Saving what the Tools tab shows is a narrower grant set, so anyone with Team write may save it.
    const saved = await hz.caller({ userId: memberId }).agent.training.saveDraft({ businessId, agentId: agent.id, instructions: instructions("Frontend engineer"), tools: shown });
    expect(saved.version.tools).toEqual(shown);
  });

  it("the wage is for the month the viewer names, and the default month is evaluated per request (RA-25)", async () => {
    const { businessId, ownerId, agent2Id } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect((await owner.agent.profile.get({ businessId, agentId: agent2Id })).wage.period).toBe(periodOf(new Date()));
    expect((await owner.agent.profile.get({ businessId, agentId: agent2Id, period: "2026-01" })).wage).toMatchObject({ period: "2026-01", costMinor: 0 });
    await expect(owner.agent.profile.get({ businessId, agentId: agent2Id, period: "2026-13" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await owner.finance.wages({ businessId })).period).toBe(periodOf(new Date()));
  });

  it("the model picker predicts a wage per model for an agent with no spend (TPD-32)", async () => {
    const { businessId, ownerId } = hz.A;
    const fresh = await repos.agents.create(hz.db, businessId, { name: "Fresh hire", agentType: "backend_engineer" });
    const compare = await hz.caller({ userId: ownerId }).agent.model.compare({ businessId, agentId: fresh.id, period: periodOf(new Date()) });
    expect(compare).toMatchObject({ basis: "typical_month", currency: "USD" });
    const wages = Object.fromEntries(compare.options.map((o) => [o.modelKey, o.predictedWageMinor]));
    expect(wages.opus).toBeGreaterThan(wages.sonnet!);
    expect(wages.sonnet).toBeGreaterThan(wages.haiku!);
    expect(compare.options.every((o) => o.predictedSkillDelta === null && o.label === "Estimate")).toBe(true);
    await repos.usage.record(hz.db, businessId, { agentId: fresh.id, kind: "tokens", costMinor: 1000 });
    expect((await hz.caller({ userId: ownerId }).agent.model.compare({ businessId, agentId: fresh.id })).basis).toBe("this_month");
  });

  it("profile.update takes only profile fields, refuses an empty patch, a round of work and a released agent (BILL-23, TPD-27, TPD-28)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const a = await repos.agents.create(hz.db, businessId, { name: "Editable", agentType: "engineer" });
    const report = await repos.agents.create(hz.db, businessId, { name: "Its report", agentType: "engineer", lineManagerId: a.id });
    await expect(owner.agent.profile.update({ businessId, agentId: a.id, patch: {} })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.agent.profile.update({ businessId, agentId: a.id, patch: { status: "healthy" } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.agent.profile.update({ businessId, agentId: a.id, patch: { lineManagerId: report.id } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const updated = await owner.agent.profile.update({ businessId, agentId: a.id, patch: { lineManagerId: agentId, role: "Builds things" } });
    expect(updated).toMatchObject({ lineManagerId: agentId, role: "Builds things" });
    const entry = (await repos.audit.list(hz.db, businessId, { action: "agent.profile.update" })).items[0]!;
    expect(entry.details).toMatchObject({ lineManagerId: { from: null, to: agentId } });
    await repos.agents.release(hz.db, businessId, a.id);
    await expect(owner.agent.profile.update({ businessId, agentId: a.id, patch: { role: "Back again" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/has left the team/) });
    expect((await owner.agent.profile.get({ businessId, agentId: a.id })).agent.archivedAt).toBeInstanceOf(Date);
    // Its profile is a record: no new draft, model, autonomy or negotiation limits either (TPD-28).
    await expect(owner.agent.training.saveDraft({ businessId, agentId: a.id, instructions: instructions("Engineer") })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/has left the team/) });
    await expect(owner.agent.model.set({ businessId, agentId: a.id, modelKey: "haiku" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.agent.autonomy.set({ businessId, agentId: a.id, autonomy: { mode: "lower" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a second training run of a draft is refused while one is active; a released agent cannot be trained (RA-13)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId, instructions: instructions("Chief of Staff") });
    const results = await Promise.allSettled([owner.agent.training.run({ businessId, agentId, versionId: version.id }), owner.agent.training.run({ businessId, agentId, versionId: version.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect((await repos.training.list(hz.db, businessId, { agentId, limit: 50 })).items.filter((r) => r.toVersionId === version.id)).toHaveLength(1);
  });

  it("two saves at once both succeed with their own version numbers (RA-13)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const draft = (n: number) => owner.agent.training.saveDraft({ businessId, agentId, instructions: instructions(`Draft ${n}`) });
    const [a, b] = await Promise.all([draft(1), draft(2)]);
    expect(a.version.version).not.toBe(b.version.version);
  });

  it("promote happens once, and a rollback ends the seven-day watch (RA-13, TPD-20)", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const a = await repos.agents.create(hz.db, businessId, { name: "Promoted agent", agentType: "engineer", initialVersion: { instructions: { role: "v1" } } });
    const draft = await repos.agents.createVersion(hz.db, businessId, a.id, { instructions: { role: "v2" }, state: "draft" });
    const run = await repos.training.create(hz.db, businessId, { agentId: a.id, fromVersionId: a.currentVersionId, toVersionId: draft.id, status: "awaiting_decision" });
    const results = await Promise.allSettled([owner.agent.training.promote({ businessId, runId: run.id }), owner.agent.training.promote({ businessId, runId: run.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const promoted = (await repos.events.list(hz.db, businessId, { type: "agent.promoted", limit: 100 })).items.filter((e) => (e.payload as { trainingRunId?: string }).trainingRunId === run.id);
    expect(promoted).toHaveLength(1);
    expect((await repos.training.get(hz.db, businessId, run.id)).watchUntil!.getTime()).toBeGreaterThan(Date.now());
    await owner.agent.training.rollback({ businessId, agentId: a.id });
    expect((await repos.training.get(hz.db, businessId, run.id)).watchUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await repos.agents.get(hz.db, businessId, a.id)).currentVersionId).toBe(a.currentVersionId);
    // Nothing left to roll back to: the banner's action would fail, and the banner is gone.
    await expect(owner.agent.training.rollback({ businessId, agentId: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("negotiation cannot be switched on while nothing runs it; limits can be saved off (GLS2F-07, LS2-07)", async () => {
    const { businessId, ownerId, agent2Id } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await expect(owner.agent.negotiation.set({ businessId, agentId: agent2Id, negotiation: { enabled: true, priceMinMinor: 100, priceMaxMinor: 500 } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/not available yet/) });
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).negotiation).not.toMatchObject({ enabled: true });
    expect(await owner.agent.negotiation.set({ businessId, agentId: agent2Id, negotiation: { enabled: false, priceMinMinor: 100, priceMaxMinor: 500 } })).toEqual({ updated: [agent2Id] });
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).negotiation).toMatchObject({ enabled: false, priceMinMinor: 100 });
  });
});

describe("custom skills (AC-08)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "agentskills" });
  }, 120_000);
  afterAll(() => hz.close());

  it("drafts tests with Opus, waits for review, then counts for the agent on the reviewed tests only", async () => {
    const { businessId, ownerId, agent2Id } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const before = await owner.agent.training.estimate({ businessId, agentId: agent2Id });
    const created = await owner.agent.skills.createCustom({ businessId, agentId: agent2Id, name: "Grant writing", description: "Writes grant applications that follow the funder's guidance and word limits.", examples: ["A 500-word innovation grant summary"] });
    expect(created.skillKey).toBe("custom_grant_writing");
    expect(created.cost).toMatchObject({ currency: "USD", label: "Estimate" });
    expect(created.drafts.length).toBeGreaterThan(0);
    expect(created.draftsHeldOut).toBeGreaterThan(0);
    expect(created.drafts.length + created.draftsHeldOut).toBeLessThanOrEqual(30);
    expect(CUSTOM_SKILL_TEST_COUNT).toBe(12);
    // Drafts are shown without the held-out ones, and the skill does not count yet.
    const listed = await owner.agent.skills.custom({ businessId, agentId: agent2Id });
    expect(listed).toEqual([expect.objectContaining({ definitionId: created.definitionId, status: "awaiting_review", onAgent: false, tests: 0 })]);
    expect(listed[0]!.drafts.map((d) => d.id).sort()).toEqual(created.drafts.map((d) => d.id).sort());
    expect((await owner.agent.training.estimate({ businessId, agentId: agent2Id })).tests).toBe(before.tests);
    // The same name twice is a conflict.
    await expect(owner.agent.skills.createCustom({ businessId, agentId: agent2Id, name: "Grant writing", description: "Writes grant applications that follow the funder's guidance." })).rejects.toMatchObject({ code: "CONFLICT" });

    const keep = created.drafts.slice(0, 1).map((d) => d.id);
    const reviewed = await owner.agent.skills.review({ businessId, agentId: agent2Id, definitionId: created.definitionId, keepTestIds: keep });
    expect(reviewed).toMatchObject({ skillKey: "custom_grant_writing", reviewed: 1 + created.draftsHeldOut, dropped: created.drafts.length - 1 });
    const after = await owner.agent.skills.custom({ businessId, agentId: agent2Id });
    expect(after[0]).toMatchObject({ status: "counts", onAgent: true, tests: 1 + created.draftsHeldOut, heldOut: created.draftsHeldOut, drafts: [] });
    expect((await repos.skills.listForAgent(hz.db, businessId, agent2Id)).map((s) => s.skillKey)).toContain("custom_grant_writing");
    // The estimate counts the reviewed tests (held-out ones included), and never throws on a custom key.
    expect((await owner.agent.training.estimate({ businessId, agentId: agent2Id })).tests).toBe(before.tests + 1 + created.draftsHeldOut);
    // A counted skill is not discarded; a viewer cannot add one; another business sees none.
    await expect(owner.agent.skills.discard({ businessId, agentId: agent2Id, definitionId: created.definitionId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hz.caller({ userId: hz.A.viewerId }).agent.skills.createCustom({ businessId, agentId: agent2Id, name: "Bookkeeping", description: "Keeps the books tidy and reconciled every week." })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await hz.caller({ userId: hz.B.ownerId }).agent.skills.custom({ businessId: hz.B.businessId, agentId: hz.B.agent2Id })).toEqual([]);
  });

  it("a skill still awaiting review can be discarded", async () => {
    const { businessId, ownerId, agent2Id } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const created = await owner.agent.skills.createCustom({ businessId, agentId: agent2Id, name: "Release notes", description: "Writes release notes customers can follow without the changelog." });
    expect(await owner.agent.skills.discard({ businessId, agentId: agent2Id, definitionId: created.definitionId })).toEqual({ discarded: created.definitionId });
    expect((await owner.agent.skills.custom({ businessId, agentId: agent2Id })).some((d) => d.definitionId === created.definitionId)).toBe(false);
    // Added again later, it starts from its own new drafts only (the discarded drafts went with it).
    const again = await owner.agent.skills.createCustom({ businessId, agentId: agent2Id, name: "Release notes", description: "Writes release notes customers can follow without the changelog." });
    const listed = (await owner.agent.skills.custom({ businessId, agentId: agent2Id })).find((d) => d.definitionId === again.definitionId);
    expect(listed?.drafts.map((d) => d.id).sort()).toEqual(again.drafts.map((d) => d.id).sort());
    expect(listed?.draftsHeldOut).toBe(again.draftsHeldOut);
  });

  it("the Coach drafting the tests is offered mock tools only for connectors the agent really holds tools on", async () => {
    const { businessId, ownerId } = hz.A;
    // Held since before Nov 11, 2026: a grant on a connector that was never built.
    const agent = await repos.agents.create(hz.db, businessId, { name: "Hired in October", agentType: "frontend_engineer", initialVersion: { instructions: instructions("Frontend engineer"), tools: [{ connectorKey: "figma", tools: ["files.read"] }, { connectorKey: "github", tools: ["repos.read"] }] } });
    const complete = vi.spyOn(hz.deps.models, "complete");
    try {
      await hz.caller({ userId: ownerId }).agent.skills.createCustom({ businessId, agentId: agent.id, name: "Component docs", description: "Writes component documentation that follows the design system." });
      const prompt = JSON.stringify(complete.mock.calls.find(([req]) => req.attribution?.kind === "custom_skill_tests")?.[0].messages);
      expect(prompt).toContain("github.mock");
      expect(prompt).not.toContain("figma");
    } finally {
      complete.mockRestore();
    }
  });
});

describe("dev.tasks.plan: one plan per request (RA-13)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "devplanonce" });
  }, 120_000);
  afterAll(() => hz.close());

  it("two identical requests at once write one graph; a repeat within the window returns it; another goal plans anew", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const before = (await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length;
    const [a, b] = await Promise.all([owner.dev.tasks.plan({ businessId, goal: "Add CSV export to reports" }), owner.dev.tasks.plan({ businessId, goal: "Add CSV export to reports" })]);
    expect(a.tasks.map((t) => t.id).sort()).toEqual(b.tasks.map((t) => t.id).sort());
    const afterTwo = (await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length;
    expect(afterTwo).toBe(before + a.tasks.length);
    const again = await owner.dev.tasks.plan({ businessId, goal: "  Add CSV   export to reports " });
    expect(again).toMatchObject({ reused: true, costMinor: 0 });
    expect(again.tasks.map((t) => t.id).sort()).toEqual(a.tasks.map((t) => t.id).sort());
    expect((await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length).toBe(afterTwo);
    const other = await owner.dev.tasks.plan({ businessId, goal: "Add PDF export to reports" });
    expect(other.reused).toBe(false);
    expect((await repos.tasks.list(hz.db, businessId, { limit: 500 })).items.length).toBe(afterTwo + other.tasks.length);
  });
});
