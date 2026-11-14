/**
 * team.* fixes (brief W19): one Chief of Staff (ARB-18), unknown templates are a 400 (ARB-25), release stops the work
 * and leaves no dangling pointer (TPD-09, ARB-19, VTPD-X1), merge moves the agents (RA-16), a move changes the line
 * manager (TPD-27), the Team table's Form, Tools, Latest update and Health come from real rows (TPD-08), a co-founder
 * can be added by email (WEB-12), and Responsibilities are an admin's call, refuse unknown departments (ARB-26) and
 * route approvals (TPD-04).
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("team.agents (W19)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "teamw19", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("refuses to hire or clone a second Chief of Staff and never lists it in the catalog (ARB-18)", async () => {
    const { businessId, ownerId, departmentId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await expect(owner.team.agents.hire({ businessId, templateKey: "chief_of_staff", departmentId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/one Chief of Staff/) });
    await expect(owner.team.agents.clone({ businessId, agentId, name: "Second chief" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const catalogue = await owner.team.agents.catalogue({ businessId });
    expect(catalogue.some((t) => t.key === "chief_of_staff" || t.family === "assistant")).toBe(false);
    expect((await repos.agents.list(hz.db, businessId, { limit: 500 })).items.filter((a) => a.layer === "assistant")).toHaveLength(1);
  });

  it("an unknown template is a 400 that names the problem, not a 500 (ARB-25)", async () => {
    const { businessId, ownerId, departmentId } = hz.A;
    await expect(hz.caller({ userId: ownerId }).team.agents.hire({ businessId, templateKey: "no_such_template", departmentId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Unknown agent template/) });
  });

  it("a hire reports to the department's live lead; an archived department is refused", async () => {
    const { businessId, ownerId, departmentId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const hired = await owner.team.agents.hire({ businessId, templateKey: "docs_writer", departmentId, name: "Nell" });
    expect(hired.lineManagerId).toBe(agentId);
    const gone = await repos.departments.create(hz.db, businessId, { name: "Gone dept" });
    await repos.departments.archive(hz.db, businessId, gone.id);
    await expect(owner.team.agents.hire({ businessId, templateKey: "docs_writer", departmentId: gone.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("release hands work back, clears the lead and reports, and signals the open session to stop (TPD-09, ARB-19)", async () => {
    const { businessId, memberId } = hz.A;
    const lead = await repos.agents.create(hz.db, businessId, { name: "Leaving lead", agentType: "engineer" });
    const report = await repos.agents.create(hz.db, businessId, { name: "Its report", agentType: "engineer", lineManagerId: lead.id });
    const dept = await repos.departments.create(hz.db, businessId, { name: "Lead dept", leadAgentId: lead.id });
    const task = await repos.tasks.create(hz.db, businessId, { kind: "code", title: "Half done", status: "running", assigneeAgentId: lead.id, departmentId: dept.id });
    const session = await repos.agents.createSession(hz.db, businessId, { agentId: lead.id, taskId: task.id });
    // A member who may change the team releases it; the department's lead is cleared even though members cannot write departments.
    const released = await hz.caller({ userId: memberId }).team.agents.release({ businessId, agentId: lead.id });
    expect(released).toMatchObject({ id: lead.id, status: "paused", handedBack: [task.id], sessions: { stopping: 1, signalled: 1 } });
    expect(released.archivedAt).toBeInstanceOf(Date);
    expect(temporal.signals).toContainEqual({ workflowId: `session:${session.id}`, signal: "stop", args: [{ reason: "released", by: memberId }] });
    expect(await repos.tasks.get(hz.db, businessId, task.id)).toMatchObject({ status: "ready", assigneeAgentId: null });
    expect((await repos.departments.get(hz.db, businessId, dept.id)).leadAgentId).toBeNull();
    expect((await repos.agents.get(hz.db, businessId, report.id)).lineManagerId).toBeNull();
    const health = await repos.events.latestPerAgent(hz.db, businessId, "agent.health_changed", [lead.id]);
    expect(health.get(lead.id)?.payload).toMatchObject({ to: "paused", reason: "Leaving lead was released from the team" });
    // Releasing again changes nothing and signals nothing.
    const signals = temporal.signals.length;
    expect(await hz.caller({ userId: memberId }).team.agents.release({ businessId, agentId: lead.id })).toMatchObject({ handedBack: [], sessions: { stopping: 0, signalled: 0 } });
    expect(temporal.signals).toHaveLength(signals);
  });

  it("the Chief of Staff cannot be released; another business's agent is not found", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    await expect(hz.caller({ userId: ownerId }).team.agents.release({ businessId, agentId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hz.caller({ userId: ownerId }).team.agents.release({ businessId, agentId: hz.B.agent2Id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repos.agents.get(hz.db, hz.B.businessId, hz.B.agent2Id)).archivedAt).toBeNull();
  });

  it("a move makes the new department's lead the line manager; no lead means the founder (TPD-27)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const mover = await repos.agents.create(hz.db, businessId, { name: "Mover", agentType: "engineer", lineManagerId: agentId });
    const newLead = await repos.agents.create(hz.db, businessId, { name: "New lead", agentType: "engineer" });
    const withLead = await repos.departments.create(hz.db, businessId, { name: "With lead", leadAgentId: newLead.id });
    const noLead = await repos.departments.create(hz.db, businessId, { name: "No lead" });
    expect(await owner.team.agents.loan({ businessId, agentId: mover.id, departmentId: withLead.id, move: true })).toMatchObject({ departmentIds: [withLead.id], lineManagerId: newLead.id });
    // A loan (not a move) keeps the manager.
    expect(await owner.team.agents.loan({ businessId, agentId: mover.id, departmentId: noLead.id })).toMatchObject({ departmentIds: [withLead.id, noLead.id], lineManagerId: newLead.id });
    expect(await owner.team.agents.loan({ businessId, agentId: mover.id, departmentId: noLead.id, move: true })).toMatchObject({ departmentIds: [noLead.id], lineManagerId: null });
  });

  it("department.merge moves the merged department's agents (RA-16)", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const from = await repos.departments.create(hz.db, businessId, { name: "Merged away" });
    const into = await repos.departments.create(hz.db, businessId, { name: "Merged into" });
    const a = await repos.agents.create(hz.db, businessId, { name: "Merged agent", agentType: "engineer", departmentIds: [from.id] });
    await owner.department.merge({ businessId, fromId: from.id, intoId: into.id });
    expect((await repos.agents.get(hz.db, businessId, a.id)).departmentIds).toEqual([into.id]);
    const list = await owner.team.agents.list({ businessId, departmentId: into.id });
    expect(list.agents.map((x) => x.id)).toContain(a.id);
  });

  it("team.agents.list fills Form, Tools, Latest update, Health and the Chief of Staff flag from real rows (TPD-08)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const a = await repos.agents.create(hz.db, businessId, { name: "Busy agent", agentType: "engineer", initialVersion: { tools: [{ connectorKey: "github", tools: ["open_pr", "merge_pr"] }] } });
    const task = await repos.tasks.create(hz.db, businessId, { kind: "code", title: "Ship the export", status: "running", assigneeAgentId: a.id });
    for (const [i, outcome] of ["done", "failed", "blocked"].entries()) {
      const s = await repos.agents.createSession(hz.db, businessId, { agentId: a.id, taskId: task.id, startedAt: new Date(Date.now() - 600_000) });
      await repos.agents.endSession(hz.db, businessId, s.id, { outcome, endedAt: new Date(Date.now() - 500_000 + i * 60_000) });
    }
    await repos.agents.createSession(hz.db, businessId, { agentId: a.id, taskId: task.id });
    await repos.agents.setStatus(hz.db, businessId, a.id, "injured");
    await repos.events.write(hz.db, businessId, { type: "agent.health_changed", actor: { kind: "system", id: "health" }, payload: { agentId: a.id, from: "healthy", to: "injured", reason: "The GitHub credential it depends on has expired", signals: { credentialExpired: true }, expectedReturnAt: null, sessionId: null } });
    const { agents } = await hz.caller({ userId: ownerId }).team.agents.list({ businessId });
    const row = agents.find((x) => x.id === a.id)!;
    expect(row.tools).toEqual([{ connectorKey: "github", tools: ["open_pr", "merge_pr"] }]);
    expect(row.form).toEqual(["success", "failure", "partial"]);
    expect(row.latestUpdate).toMatchObject({ text: "Working on “Ship the export”" });
    expect(row.health).toMatchObject({ credentialExpired: true, loopDetected: false, reason: "The GitHub credential it depends on has expired" });
    expect(row.health.errorRate).toBeCloseTo(1 / 3);
    expect(row.health.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(agents.find((x) => x.id === agentId)?.chiefOfStaff).toBe(true);
    expect(row.chiefOfStaff).toBe(false);
  });

  it("team.agents.list shows only tools that exist: grants stored for connectors that were never built are not listed, and every hire holds none", async () => {
    const { businessId, ownerId, departmentId } = hz.A;
    // What an agent hired before Nov 11, 2026 still holds: its version was copied from the old social template.
    const stored = [
      { connectorKey: "platform", tools: ["tasks.list", "campaigns.create", "assets.create", "inbox.request_human_action"] },
      { connectorKey: "instagram", tools: ["media.publish", "comments.reply"] },
      { connectorKey: "x_publishing", tools: ["posts.publish"] },
      { connectorKey: "gmail", tools: ["drafts.create"] },
    ];
    const old = await repos.agents.create(hz.db, businessId, { name: "Old social engine", agentType: "channel_social", initialVersion: { tools: stored } });
    const owner = hz.caller({ userId: ownerId });
    const row = (await owner.team.agents.list({ businessId })).agents.find((x) => x.id === old.id)!;
    expect(row.tools).toEqual([
      { connectorKey: "platform", tools: ["tasks.list", "inbox.request_human_action"] },
      { connectorKey: "gmail", tools: ["drafts.create"] },
    ]);
    // The row itself is not rewritten (no data migration): a session resolves it to the same real tools either way.
    expect((await repos.agents.getVersion(hz.db, businessId, old.currentVersionId!)).tools).toEqual(stored);
    // A hire today copies the template, which grants only what resolves: nothing is hidden from what is stored.
    const agent = await owner.team.agents.hire({ businessId, templateKey: "channel_social", departmentId });
    const hired = (await owner.team.agents.list({ businessId })).agents.find((x) => x.id === agent.id)!;
    const version = await repos.agents.getVersion(hz.db, businessId, hired.currentVersionId!);
    expect(hired.tools).toEqual(version.tools);
    // The social template also grants the two media connectors on the founder's own key (built, so they resolve):
    // they ask first and say "not connected" until the founder connects them. Buffer (queue posts on the founder's own Buffer) likewise.
    expect(hired.tools.map((t) => t.connectorKey)).toEqual(["platform", "quarantine", "runway", "elevenlabs_voice", "buffer"]);
  });

  it("team.agents.list rates each agent on the one /20 scale (`rating20`, one decimal) and keeps the deprecated /10 `rating` for one release", async () => {
    const { businessId, ownerId } = hz.A;
    const rated = await repos.agents.create(hz.db, businessId, { name: "Rated agent", agentType: "engineer" });
    await repos.skills.upsertForAgent(hz.db, businessId, rated.id, [
      { skillKey: "planning", group: "judgement", tested: 14, proven: null, nLive: 0, displayed: 14, potential: 18 },
      { skillKey: "testing", group: "execution", tested: 17, proven: null, nLive: 0, displayed: 17, potential: 19 },
    ]);
    const unrated = await repos.agents.create(hz.db, businessId, { name: "Unrated agent", agentType: "engineer" });
    const { agents } = await hz.caller({ userId: ownerId }).team.agents.list({ businessId });
    const row = agents.find((x) => x.id === rated.id)!;
    // (14 + 17) / 2 = 15.5 on the /20 scale; the deprecated field says the same thing out of 10.
    expect(row.rating20).toBe(15.5);
    expect(row.rating).toBe(7.8);
    // No skills yet: not rated on either scale (the table shows "—").
    const empty = agents.find((x) => x.id === unrated.id)!;
    expect(empty.rating20).toBeNull();
    expect(empty.rating).toBeNull();
  });

  it("team.agents.list and department.list carry each agent's tier; the catalog leaves the utility family out unless asked (Leads first)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const dept = await repos.departments.create(hz.db, businessId, { name: "Tiers", slug: "tiers", moduleKeys: ["development"] });
    // A worker that leads a department is a lead; the Planner takes tasks, so it is a specialist; a utility is a background helper.
    const lead = await repos.agents.create(hz.db, businessId, { name: "Tier lead", agentType: "growth_marketer", layer: "worker", departmentIds: [dept.id] });
    await repos.departments.setLead(hz.db, businessId, dept.id, lead.id);
    const planner = await repos.agents.create(hz.db, businessId, { name: "Planner", agentType: "planner", layer: "worker", departmentIds: [dept.id], lineManagerId: lead.id });
    const helper = await repos.agents.create(hz.db, businessId, { name: "Entity linker", agentType: "entity_linker", layer: "utility", departmentIds: [dept.id] });
    const { agents } = await owner.team.agents.list({ businessId });
    const tier = (id: string) => agents.find((a) => a.id === id)?.tier;
    expect([tier(agentId), tier(lead.id), tier(planner.id), tier(helper.id)]).toEqual(["chief", "lead", "specialist", "background"]);
    const departments = await owner.department.list({ businessId });
    const tiers = departments.find((d) => d.id === dept.id)!;
    expect(tiers.lead).toMatchObject({ id: lead.id, tier: "lead" });
    expect(Object.fromEntries(tiers.squad.map((m) => [m.name, m.tier]))).toEqual({ "Tier lead": "lead", Planner: "specialist", "Entity linker": "background" });
    const catalogue = await owner.team.agents.catalogue({ businessId });
    expect(catalogue.some((t) => t.family === "utility")).toBe(false);
    expect(catalogue.some((t) => t.key === "planner")).toBe(true);
    const utilities = await owner.team.agents.catalogue({ businessId, family: "utility" });
    expect(utilities.map((t) => t.key).sort()).toEqual(["categoriser", "classifier", "entity_linker", "moderation", "triage"]);
  });
});

describe("team.humans and team.responsibilities (W19)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "teamw19h" });
  }, 120_000);
  afterAll(() => hz.close());

  it("a cofounder joins through an invitation they accept: the silent add by email or account id is gone (THESIS 3.1)", async () => {
    const { businessId, ownerId } = hz.A;
    const newcomer = await hz.h.createUser("cofounder-w19@test.local");
    const owner = hz.caller({ userId: ownerId });
    expect("invite" in (owner.team.humans as Record<string, unknown>)).toBe(false);
    // A cofounder invitation names the person's address, and only the account signed in with it accepts.
    const { link } = await owner.invitation.create({ businessId, role: "cofounder", email: "cofounder-w19@test.local" });
    expect(await hz.caller({ userId: newcomer, email: "cofounder-w19@test.local" }).invitation.accept({ confirmAdult: true, token: link.split("/i/")[1]! })).toEqual({ businessId, already: false });
    expect(await repos.memberships.get(hz.db, businessId, newcomer)).toMatchObject({ role: "cofounder", sectionPermissions: {} });
    // founder.profile.get tells a person their own account ID.
    expect((await hz.caller({ userId: newcomer }).founder.profile.get()).userId).toBe(newcomer);
  });

  it("responsibilities.set is an owner's or admin's call, needs a named handler and a department of the business (ARB-26)", async () => {
    const { businessId, ownerId, memberId, departmentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await expect(hz.caller({ userId: memberId }).team.responsibilities.set({ businessId, decisionType: "merge_to_main", handler: { kind: "user", id: memberId } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.team.responsibilities.set({ businessId, decisionType: "merge_to_main", handler: { kind: "user", id: null } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const auditBefore = (await repos.audit.list(hz.db, businessId, { action: "team.responsibilities.set" })).items.length;
    await expect(owner.team.responsibilities.set({ businessId, decisionType: "merge_to_main", handler: { kind: "founder", id: null }, departmentId: hz.B.departmentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repos.audit.list(hz.db, businessId, { action: "team.responsibilities.set" })).items).toHaveLength(auditBefore);
    expect(await owner.team.responsibilities.set({ businessId, decisionType: "message_customers", handler: { kind: "user", id: memberId }, departmentId })).toEqual({ updated: 1 });
  });

  it("responsibilities.get names the business's own Chief of Staff, or null before one is hired (Settings › What the team can do)", async () => {
    const { businessId, viewerId } = hz.A;
    const before = await hz.caller({ userId: viewerId }).team.responsibilities.get({ businessId });
    const existing = await repos.agents.chiefOfStaff(hz.db, businessId);
    expect(before.chiefOfStaffId).toBe(existing?.id ?? null);
    const chief = existing ?? (await repos.agents.create(hz.db, businessId, { name: "Chief", agentType: "chief_of_staff", layer: "assistant" }));
    expect((await hz.caller({ userId: hz.A.ownerId }).team.responsibilities.get({ businessId })).chiefOfStaffId).toBe(chief.id);
    // Another business never reads this one's Chief of Staff.
    const other = await hz.caller({ userId: hz.B.ownerId }).team.responsibilities.get({ businessId: hz.B.businessId });
    expect(other.chiefOfStaffId).not.toBe(chief.id);
  });

  it("approvals are routed to the handler, who sees them as theirs; others cannot answer them (TPD-04, VARB-B4-X2)", async () => {
    const { businessId, ownerId, memberId, departmentId, agent2Id } = hz.A;
    await repos.agents.update(hz.db, businessId, agent2Id, { departmentIds: [departmentId] });
    // message_customers in Product goes to the member (set in the test above).
    const approval = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "gmail", tool: "send_email" });
    expect(approval).toMatchObject({ decisionType: "message_customers", handlerKind: "user", handlerId: memberId });
    const mine = await hz.caller({ userId: memberId }).team.approvals.pending({ businessId, forMe: true });
    expect(mine.map((a) => a.id)).toEqual([approval.id]);
    expect(mine[0]).toMatchObject({ handler: { kind: "user", id: memberId }, forMe: true, canResolve: true });
    const ownersQueue = await hz.caller({ userId: ownerId }).team.approvals.pending({ businessId, forMe: true });
    expect(ownersQueue.map((a) => a.id)).not.toContain(approval.id);
    // Another approval for the founder: the member may not answer one delegated elsewhere.
    await hz.caller({ userId: ownerId }).team.responsibilities.set({ businessId, decisionType: "publish_content", handler: { kind: "user", id: hz.A.adminId }, departmentId });
    const forAdmin = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "x", tool: "schedule_post" });
    await expect(hz.caller({ userId: memberId }).team.approvals.resolve({ businessId, approvalId: forAdmin.id, outcome: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await hz.caller({ userId: memberId }).team.approvals.resolve({ businessId, approvalId: approval.id, outcome: "approved" })).outcome).toBe("approved");
    // An owner can always step in.
    expect((await hz.caller({ userId: ownerId }).team.approvals.resolve({ businessId, approvalId: forAdmin.id, outcome: "rejected" })).outcome).toBe("rejected");
  });

  it("an approval delegated to an agent is decided by it as it opens (TPD-04); a merge to the default branch stays with the founder", async () => {
    const { businessId, ownerId, departmentId, agent2Id } = hz.A;
    const decider = await repos.agents.create(hz.db, businessId, { name: "Merge decider", agentType: "review_agent", departmentIds: [departmentId] });
    await hz.caller({ userId: ownerId }).team.responsibilities.set({ businessId, decisionType: "message_customers", handler: { kind: "agent", id: decider.id }, departmentId });
    const message = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "gmail", tool: "send_email", decisionType: "message_customers" });
    expect(message).toMatchObject({ outcome: "approved", byKind: "agent", byId: decider.id });
    expect((await hz.caller({ userId: ownerId }).team.approvals.pending({ businessId })).map((a) => a.id)).not.toContain(message.id);
    // Delegating merges does not hand them to the agent: the founder answers every merge.
    await hz.caller({ userId: ownerId }).team.responsibilities.set({ businessId, decisionType: "merge_to_main", handler: { kind: "agent", id: decider.id }, departmentId });
    const merge = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "github", tool: "merge_pr" });
    expect(merge).toMatchObject({ outcome: null, handlerKind: null });
    expect((await hz.caller({ userId: ownerId }).team.approvals.pending({ businessId })).map((a) => a.id)).toContain(merge.id);
    await expect(hz.caller({ userId: ownerId }).team.responsibilities.set({ businessId, decisionType: "sign_contracts", handler: { kind: "agent", id: decider.id } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
