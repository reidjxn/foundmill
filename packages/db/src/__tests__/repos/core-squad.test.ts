/** The repos written in the first pass: businesses, memberships, founders, ideas, departments, screens, dashboards, agents, skills, training, tasks, playbooks, holidays. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("core");
});
afterAll(() => r?.close());

describe("businesses, memberships, founders, ideas", () => {
  it("create → get → update → commit → archive, listForUser, slugs", async () => {
    const b = await repos.businesses.create(r.db, { name: "Ledgerly Books", createdBy: r.A.ownerId, kitPrimary: "#112233" });
    expect(b.slug).toBe("ledgerly-books");
    await repos.memberships.add(r.db, b.id, { userId: r.A.ownerId, role: "owner" });
    expect((await repos.businesses.get(r.db, b.id)).kitPrimary).toBe("#112233");
    expect((await repos.businesses.getBySlug(r.db, "ledgerly-books"))?.id).toBe(b.id);
    const mine = await repos.businesses.listForUser(r.db, r.A.ownerId);
    expect(mine.map((x) => x.id).sort()).toEqual([r.A.businessId, b.id].sort());
    expect(mine.find((x) => x.id === b.id)?.role).toBe("owner");
    const committed = await repos.businesses.commit(r.db, b.id, { archetype: "b2b_saas" });
    expect(committed.committedAt).toBeInstanceOf(Date);
    await expect(repos.businesses.update(r.db, b.id, { kitPrimary: "blue" })).rejects.toThrow(/Invalid business update/);
    await repos.businesses.archive(r.db, b.id);
    await expect(repos.businesses.get(r.db, b.id)).rejects.toThrow(/not found/);
    expect((await repos.businesses.get(r.db, b.id, { includeArchived: true })).archivedAt).toBeInstanceOf(Date);
  });

  it("memberships are per business; roles and section permissions update", async () => {
    expect(await repos.memberships.hasRole(r.db, r.A.businessId, r.A.viewerId, ["owner", "admin"])).toBe(false);
    expect(await repos.memberships.hasRole(r.db, r.A.businessId, r.A.adminId, ["owner", "admin"])).toBe(true);
    expect((await repos.memberships.list(r.db, r.A.businessId, { role: "viewer" })).map((m) => m.userId)).toEqual([r.A.viewerId]);
    const promoted = await repos.memberships.setRole(r.db, r.A.businessId, r.A.viewerId, "member");
    expect(promoted.role).toBe("member");
    await repos.memberships.setSectionPermissions(r.db, r.A.businessId, r.A.viewerId, { finance: "none" });
    expect((await repos.memberships.get(r.db, r.A.businessId, r.A.viewerId))?.sectionPermissions).toEqual({ finance: "none" });
    expect(await repos.memberships.get(r.db, r.B.businessId, r.A.viewerId)).toBeNull();
    expect((await repos.memberships.listForUser(r.db, r.A.ownerId)).every((m) => m.userId === r.A.ownerId)).toBe(true);
  });

  it("founder profile upsert/update and ideas (account-scoped until commit)", async () => {
    const p = await repos.founders.upsert(r.db, r.A.ownerId, { displayName: "Reid", skills: { marketing: 14 }, targetMarkets: ["SE", "GB"] });
    expect(p.displayName).toBe("Reid");
    const p2 = await repos.founders.update(r.db, r.A.ownerId, { riskAppetite: "medium" });
    expect(p2.riskAppetite).toBe("medium");
    expect(p2.skills).toEqual({ marketing: 14 }); // a patch never resets defaulted fields (patchSchema)
    expect((await repos.founders.get(r.db, r.A.ownerId))?.targetMarkets).toEqual(["SE", "GB"]);
    expect(await repos.founders.get(r.db, r.B.ownerId)).toBeNull();

    const idea = await repos.ideas.create(r.db, r.A.ownerId, { title: "Skincare subscriptions", pitch: "Monthly box" });
    expect(idea.businessId).toBeNull();
    await expect(repos.ideas.get(r.db, r.B.ownerId, idea.id)).rejects.toThrow(/not found/);
    expect((await repos.ideas.listForUser(r.db, r.A.ownerId)).items.map((i) => i.id)).toContain(idea.id);
    const committed = await repos.ideas.commit(r.db, r.A.ownerId, idea.id, r.A.businessId);
    expect(committed.businessId).toBe(r.A.businessId);
    expect((await repos.ideas.forBusiness(r.db, r.A.businessId))?.idea.id).toBe(idea.id);
  });
});

describe("departments, screens, dashboards", () => {
  it("creates, reorders, merges departments and keeps screen definitions per tab", async () => {
    const A = r.A.businessId;
    const growth = await repos.departments.create(r.db, A, { name: "Growth", slug: "growth", moduleKeys: ["distribution"], leadAgentId: r.A.agentId });
    const ops = await repos.departments.create(r.db, A, { name: "Operations", slug: "operations", moduleKeys: ["development"] });
    const all = await repos.departments.list(r.db, A);
    expect(all.map((d) => d.slug)).toEqual(["product", "growth", "operations"]);
    await repos.departments.reorder(r.db, A, [ops.id, growth.id, r.A.departmentId]);
    expect((await repos.departments.list(r.db, A)).map((d) => d.slug)).toEqual(["operations", "growth", "product"]);
    await expect(repos.departments.get(r.db, r.B.businessId, growth.id)).rejects.toThrow(/not found/);
    await repos.departments.addMember(r.db, A, growth.id, { memberKind: "agent", memberId: r.A.agent2Id });
    expect((await repos.departments.listMembers(r.db, A, growth.id)).map((m) => m.memberId)).toEqual([r.A.agent2Id]);
    await repos.departments.merge(r.db, A, growth.id, ops.id);
    expect((await repos.departments.list(r.db, A)).map((d) => d.slug)).toEqual(["operations", "product"]);
    expect((await repos.departments.listMembers(r.db, A, ops.id)).map((m) => m.memberId)).toContain(r.A.agent2Id);

    const screen = await repos.screens.upsert(r.db, A, { departmentId: ops.id, tabSlug: "overview", title: "Overview", layout: { widgets: [{ key: "status_strip", x: 0, y: 0, w: 12, h: 2 }] } });
    expect(screen.version).toBe(1);
    const again = await repos.screens.upsert(r.db, A, { departmentId: ops.id, tabSlug: "overview", title: "Overview", layout: { widgets: [] } });
    expect(again.id).toBe(screen.id);
    expect(again.version).toBe(2);
    expect((await repos.screens.get(r.db, A, ops.id, "overview"))?.id).toBe(screen.id);
    expect(await repos.screens.list(r.db, r.B.businessId, ops.id)).toHaveLength(0);

    const dash = await repos.dashboards.create(r.db, A, { userId: r.A.ownerId, name: "My home", preset: "founder", layout: { widgets: [] } });
    await repos.dashboards.setActive(r.db, A, dash.id);
    expect((await repos.dashboards.active(r.db, A, r.A.ownerId))?.id).toBe(dash.id);
    expect(await repos.dashboards.list(r.db, A, r.B.ownerId)).toHaveLength(0);
  });
});

describe("agents, versions, skills, training", () => {
  it("hire with an initial version, save a draft, promote, roll back, clone, release", async () => {
    const A = r.A.businessId;
    const hired = await repos.agents.create(r.db, A, {
      name: "Growth Lead",
      agentType: "distribution_strategist",
      layer: "lead",
      modelKey: "opus",
      departmentIds: [r.A.departmentId],
      initialVersion: { instructions: { role: "Plan channels", goals: ["Find 3 channels"] }, tools: [{ connectorKey: "sendgrid", tools: ["send_mail"] }] },
    });
    expect(hired.currentVersion?.version).toBe(1);
    expect(hired.currentVersion?.state).toBe("live");
    const draft = await repos.agents.createVersion(r.db, A, hired.id, { instructions: { role: "Plan channels v2" }, modelKey: "sonnet" });
    expect(draft.version).toBe(2);
    expect(draft.state).toBe("draft");
    const promoted = await repos.agents.promoteVersion(r.db, A, hired.id, draft.id);
    expect(promoted.currentVersionId).toBe(draft.id);
    expect(promoted.modelKey).toBe("sonnet");
    const versions = await repos.agents.listVersions(r.db, A, hired.id);
    expect(versions.map((v) => [v.version, v.state])).toEqual([
      [2, "live"],
      [1, "retired"],
    ]);
    const rolled = await repos.agents.rollback(r.db, A, hired.id, versions[1]!.id);
    expect(rolled.currentVersionId).toBe(versions[1]!.id);
    await expect(repos.agents.promoteVersion(r.db, A, r.A.agent2Id, draft.id)).rejects.toThrow(/another agent/);
    const clone = await repos.agents.clone(r.db, A, hired.id, { name: "Growth Lead II" });
    expect(clone.currentVersion?.instructions).toEqual(expect.objectContaining({ role: "Plan channels" }));
    const byDept = await repos.agents.list(r.db, A, { departmentId: r.A.departmentId, layer: "lead" });
    expect(byDept.items.map((a) => a.name).sort()).toEqual(["Growth Lead", "Growth Lead II"]);
    expect((await repos.agents.list(r.db, r.B.businessId, { layer: "lead" })).items).toHaveLength(0);
    expect((await repos.agents.chiefOfStaff(r.db, A))?.id).toBe(r.A.agentId);
    const released = await repos.agents.release(r.db, A, clone.id);
    expect(released.status).toBe("paused");
    expect(await repos.agents.pauseAll(r.db, A)).toBeGreaterThan(0);
    expect((await repos.agents.countByStatus(r.db, A)).paused).toBeGreaterThan(0);

    const session = await repos.agents.createSession(r.db, A, { agentId: hired.id, versionId: draft.id, modelKey: "sonnet" });
    const ended = await repos.agents.endSession(r.db, A, session.id, { tokensIn: 100, tokensOut: 20, costMinor: 3, outcome: "done" });
    expect(ended.endedAt).toBeInstanceOf(Date);
    expect((await repos.agents.listSessions(r.db, A, { agentId: hired.id })).items).toHaveLength(1);
    await expect(repos.agents.createSession(r.db, A, { agentId: r.B.agentId })).rejects.toThrow(/not found/);
    await repos.agents.upsertMetric(r.db, A, { agentId: hired.id, day: "2026-10-01", tasksDone: 3, successRate: 0.9 });
    await repos.agents.upsertMetric(r.db, A, { agentId: hired.id, day: "2026-10-01", tasksDone: 4 });
    const metrics = await repos.agents.metrics(r.db, A, hired.id, { from: "2026-10-01", to: "2026-10-31" });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.tasksDone).toBe(4);
  });

  it("skills: platform + custom definitions, held-out tests hidden, agent skill upsert; training runs", async () => {
    const A = r.A.businessId;
    const def = await repos.skills.createCustomDefinition(r.db, A, { agentType: "engineer", skillKey: "pr_hygiene", name: "PR hygiene", description: "Small PRs", group: "execution" });
    await repos.skills.createTest(r.db, A, { skillDefinitionId: def.id, task: { prompt: "Open a PR" }, rubric: { criteria: [] }, heldOut: false });
    await repos.skills.createTest(r.db, A, { skillDefinitionId: def.id, task: { prompt: "Secret" }, rubric: {}, heldOut: true });
    // Held-out tests come back redacted (id + heldOut only, AC-11.10.2) unless the training runner asks for them.
    const redacted = await repos.skills.listTests(r.db, A, def.id);
    expect(redacted).toHaveLength(2);
    expect(redacted.filter((t) => "task" in t)).toHaveLength(1);
    expect(redacted.find((t) => t.heldOut)).toEqual({ id: expect.any(String), skillDefinitionId: def.id, heldOut: true });
    expect((await repos.skills.listTests(r.db, A, def.id, { includeHeldOut: true })).filter((t) => "task" in t)).toHaveLength(2);
    expect((await repos.skills.listDefinitions(r.db, A, { agentType: "engineer" })).map((d) => d.skillKey)).toEqual(expect.arrayContaining(["pr_hygiene", `custom_${r.A.slug}`]));
    expect((await repos.skills.listDefinitions(r.db, r.B.businessId, { agentType: "engineer" })).map((d) => d.skillKey)).not.toContain("pr_hygiene");
    await repos.skills.upsertForAgent(r.db, A, r.A.agent2Id, [{ skillKey: "pr_hygiene", group: "execution", tested: 12.5, proven: 11, nLive: 4, displayed: 12, potential: 16 }]);
    await repos.skills.upsertForAgent(r.db, A, r.A.agent2Id, [{ skillKey: "pr_hygiene", group: "execution", tested: 13, displayed: 13 }]);
    const skills = await repos.skills.listForAgent(r.db, A, r.A.agent2Id);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.displayed).toBe(13);

    const run = await repos.training.create(r.db, A, { agentId: r.A.agent2Id, fromVersionId: r.A.agentVersionId });
    expect(run.status).toBe("queued");
    await repos.training.update(r.db, A, run.id, { status: "awaiting_decision", results: { pr_hygiene: { old: 12, new: 14 } }, costMinor: 40 });
    await expect(repos.training.decide(r.db, A, run.id, "promoted")).rejects.toThrow(/no candidate version/);
    const candidate = await repos.agents.createVersion(r.db, A, r.A.agent2Id, { instructions: { role: "Engineer v2" } });
    await repos.training.update(r.db, A, run.id, { toVersionId: candidate.id });
    const decided = await repos.training.decide(r.db, A, run.id, "promoted");
    expect(decided.decision).toBe("promoted");
    expect((await repos.agents.get(r.db, A, r.A.agent2Id)).currentVersionId).toBe(candidate.id);
    expect((await repos.training.latestForAgent(r.db, A, r.A.agent2Id))?.id).toBe(run.id);
    expect((await repos.training.list(r.db, r.B.businessId)).items).toHaveLength(0);
  });
});

describe("a whole team in a few statements (commit)", () => {
  it("creates agents that manage each other, their versions and skills, in the order given", async () => {
    const A = r.A.businessId;
    const lead = crypto.randomUUID();
    const member = crypto.randomUUID();
    const base = { role: "r", agentType: "engineer", layer: "worker" as const, modelKey: "sonnet" as const, departmentIds: [r.A.departmentId] };
    // The member is listed first and names the lead, created in the same statement, as its line manager.
    const made = await repos.agents.createMany(r.db, A, [
      { id: member, name: "Member", ...base, lineManagerId: lead, initialVersion: { instructions: { role: "member" }, tools: [] } },
      { id: lead, name: "Lead", ...base, initialVersion: { instructions: { role: "lead" }, tools: ["x:y"] } },
    ]);
    expect(made.map((a) => [a.id, a.name, a.lineManagerId])).toEqual([[member, "Member", lead], [lead, "Lead", null]]);
    for (const a of made) {
      expect(a.currentVersion).toMatchObject({ agentId: a.id, version: 1, state: "live" });
      expect(a.currentVersionId).toBe(a.currentVersion!.id);
      expect((await repos.agents.get(r.db, A, a.id)).currentVersionId).toBe(a.currentVersion!.id);
    }

    const skills = await repos.skills.upsertForAgents(r.db, A, [
      { agentId: member, skills: [{ skillKey: "pr_hygiene", group: "execution", tested: 9, displayed: 9 }, { skillKey: "testing", group: "craft", tested: 8, displayed: 8 }, { skillKey: "pr_hygiene", group: "execution", tested: 11, displayed: 11 }] },
      { agentId: lead, skills: [{ skillKey: "testing", group: "craft", tested: 14, displayed: 14 }] },
    ]);
    // A repeated key keeps its last entry; results line up with the input.
    expect(skills.map((list) => list.map((k) => `${k.skillKey}:${k.displayed}`))).toEqual([["pr_hygiene:11", "testing:8", "pr_hygiene:11"], ["testing:14"]]);
    expect((await repos.skills.listForAgent(r.db, A, member)).map((k) => k.skillKey).sort()).toEqual(["pr_hygiene", "testing"]);

    const joined = await repos.departments.addMembers(r.db, A, [{ departmentId: r.A.departmentId, memberKind: "agent", memberId: member }, { departmentId: r.A.departmentId, memberKind: "agent", memberId: member }, { departmentId: r.A.departmentId, memberKind: "agent", memberId: lead }]);
    expect(joined).toHaveLength(2);
    await expect(repos.departments.addMembers(r.db, A, [{ departmentId: r.B.departmentId, memberKind: "agent", memberId: member }])).rejects.toThrow(/belong to the business/);
  });

  it("writes many channels at once and, like upsert, changes only the fields given", async () => {
    const A = r.A.businessId;
    await repos.channels.upsertMany(r.db, A, [{ channelKey: "seo", line: "defence", enabled: true, whyMd: "kept" }]);
    const [seo, email] = await repos.channels.upsertMany(r.db, A, [
      { channelKey: "seo", line: "defence", recommended: true },
      { channelKey: "email_automation", line: "midfield", enabled: true, recommended: true },
    ]);
    expect(seo).toMatchObject({ channelKey: "seo", enabled: true, whyMd: "kept", recommended: true });
    expect(email).toMatchObject({ channelKey: "email_automation", enabled: true, recommended: true });
  });
});

describe("tasks, playbooks, holidays", () => {
  it("task graph: dependencies, cycle refusal, transitions, dispatchable set", async () => {
    const A = r.A.businessId;
    const t1 = await repos.tasks.create(r.db, A, { kind: "code", title: "Schema", assigneeAgentId: r.A.agent2Id, status: "ready" });
    const t2 = await repos.tasks.create(r.db, A, { kind: "code", title: "API", dependsOn: [t1.id], status: "ready" });
    await expect(repos.tasks.addEdge(r.db, A, t2.id, t1.id)).rejects.toThrow(/cycle/);
    await expect(repos.tasks.addEdge(r.db, A, t1.id, r.B.taskId)).rejects.toThrow(/belong to the business/);
    const dispatchable = await repos.tasks.dispatchable(r.db, A);
    expect(dispatchable.map((t) => t.id)).toContain(t1.id);
    expect(dispatchable.map((t) => t.id)).not.toContain(t2.id);
    await expect(repos.tasks.setStatus(r.db, A, t1.id, "done")).rejects.toThrow(/cannot move/);
    await repos.tasks.setStatus(r.db, A, t1.id, "running");
    await repos.tasks.setProgress(r.db, A, t1.id, { progress: 0.5, phase: "implementing" });
    const done = await repos.tasks.setStatus(r.db, A, t1.id, "done");
    expect(done.endedAt).toBeInstanceOf(Date);
    expect(Number(done.progress)).toBe(1);
    expect((await repos.tasks.dispatchable(r.db, A)).map((t) => t.id)).toContain(t2.id);
    expect((await repos.tasks.list(r.db, A, { status: "done" })).items.map((t) => t.id)).toEqual([t1.id]);
    expect((await repos.tasks.list(r.db, A, { assigneeAgentId: r.A.agent2Id })).items.map((t) => t.id)).toEqual(expect.arrayContaining([t1.id, r.A.taskId]));
    const graph = await repos.tasks.graph(r.db, A);
    expect(graph.edges.some((e) => e.fromTask === t1.id && e.toTask === t2.id)).toBe(true);
    expect(graph.tasks.every((t) => t.businessId === A)).toBe(true);
    expect((await repos.tasks.countByStatus(r.db, A)).done).toBe(1);
    expect((await r.svc((tx) => repos.tasks.list(tx, r.B.businessId))).items.every((t) => t.businessId === r.B.businessId)).toBe(true);
  });

  it("playbooks and holidays", async () => {
    const A = r.A.businessId;
    const pb = await repos.playbooks.create(r.db, A, { departmentId: r.A.departmentId, name: "Friday digest", sourceText: "Every Friday summarise the week", compiled: { trigger: { cron: "0 9 * * 5" }, steps: [] } });
    expect((await repos.playbooks.list(r.db, A, { departmentId: r.A.departmentId })).map((p) => p.id)).toEqual(expect.arrayContaining([pb.id, r.A.playbookId]));
    await repos.playbooks.setEnabled(r.db, A, pb.id, false);
    expect((await repos.playbooks.list(r.db, A, { enabled: true })).map((p) => p.id)).not.toContain(pb.id);
    await repos.playbooks.markRun(r.db, A, pb.id);
    expect((await repos.playbooks.get(r.db, A, pb.id)).lastRunAt).toBeInstanceOf(Date);
    await expect(repos.playbooks.get(r.db, r.B.businessId, pb.id)).rejects.toThrow(/not found/);

    const holiday = await repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 7 * 86_400_000), authority: { decisionTypes: ["channel_budget"] }, budgetCeilingMinor: 100000, wakeEvents: ["credential.expiring"] });
    expect((await repos.holidays.current(r.db, A))?.id).toBe(holiday.id);
    await expect(repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 86_400_000) })).rejects.toThrow();
    const ended = await repos.holidays.end(r.db, A, holiday.id);
    expect(ended.endedAt).toBeInstanceOf(Date);
    expect(await repos.holidays.current(r.db, A)).toBeNull();
    expect(await repos.holidays.current(r.db, r.B.businessId)).toBeNull();
  });
});
