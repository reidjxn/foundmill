/**
 * Team repos (fix brief W19): empty patches are a 400 not a 500 (BILL-23), release leaves nothing pointing at the
 * agent and hands its work back (TPD-09, ARB-19), merge moves the agents with their department (RA-16), line managers
 * stay a tree (TPD-27), approvals are routed by the Responsibilities matrix (TPD-04, VARB-B4-X2), training decisions and
 * runs are claimed once and versions never collide (RA-13), a rollback ends the watch (TPD-20), custom skill tests
 * count only once reviewed (AC-08), and the roster/profile reads come from the session rows themselves (TPD-08, TPD-29).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { inferDecisionType } from "../../repos/approvals";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("team");
}, 120_000);
afterAll(() => r?.close());

const agent = (name: string, extra: Record<string, unknown> = {}) => repos.agents.create(r.db, r.A.businessId, { name, agentType: "engineer", ...extra });

describe("empty patches (BILL-23)", () => {
  it("an update that names no field that can change is a ValidationError, not drizzle's 'No values to set'", async () => {
    const { businessId, agentId, departmentId, taskId } = r.A;
    await expect(repos.agents.update(r.db, businessId, agentId, {})).rejects.toMatchObject({ code: "validation", status: 400 });
    // Keys the schema strips (status is not patchable) leave nothing either.
    await expect(repos.agents.update(r.db, businessId, agentId, { status: "healthy" } as never)).rejects.toThrow(/Nothing to update on the agent/);
    await expect(repos.departments.update(r.db, businessId, departmentId, {})).rejects.toThrow(/Nothing to update on the department/);
    await expect(repos.tasks.update(r.db, businessId, taskId, {})).rejects.toThrow(/Nothing to update/);
    // A real change still goes through.
    expect((await repos.agents.update(r.db, businessId, agentId, { role: "Runs the cycle" })).role).toBe("Runs the cycle");
  });
});

describe("line managers stay a tree (TPD-27)", () => {
  it("refuses the agent itself, a released agent and anyone who reports to it", async () => {
    const { businessId } = r.A;
    const lead = await agent("Tree lead");
    const report = await agent("Tree report", { lineManagerId: lead.id });
    const deep = await agent("Tree deep", { lineManagerId: report.id });
    await expect(repos.agents.update(r.db, businessId, lead.id, { lineManagerId: lead.id })).rejects.toThrow(/its own line manager/);
    await expect(repos.agents.update(r.db, businessId, lead.id, { lineManagerId: deep.id })).rejects.toThrow(/reports to this agent/);
    const gone = await agent("Tree gone");
    await repos.agents.release(r.db, businessId, gone.id);
    await expect(repos.agents.update(r.db, businessId, lead.id, { lineManagerId: gone.id })).rejects.toThrow(/has left the team/);
    // Another business's agent is refused as a reference to a row that is not this business's (audit RA-07).
    await expect(repos.agents.update(r.db, businessId, lead.id, { lineManagerId: r.B.agentId })).rejects.toThrow(/must be an agent of this business/);
    expect((await repos.agents.update(r.db, businessId, deep.id, { lineManagerId: lead.id })).lineManagerId).toBe(lead.id);
  });
});

describe("release (TPD-09, ARB-19)", () => {
  it("clears the department lead, moves reports to its own manager, archives and pauses, and is idempotent", async () => {
    const { businessId } = r.A;
    const boss = await agent("Release boss");
    const lead = await agent("Release lead", { lineManagerId: boss.id });
    const report = await agent("Release report", { lineManagerId: lead.id });
    const dept = await repos.departments.create(r.db, businessId, { name: "Release dept", leadAgentId: lead.id });
    const released = await repos.agents.release(r.db, businessId, lead.id);
    expect(released).toMatchObject({ status: "paused", pausedReason: null });
    expect(released.archivedAt).toBeInstanceOf(Date);
    expect((await repos.departments.get(r.db, businessId, dept.id)).leadAgentId).toBeNull();
    expect((await repos.agents.get(r.db, businessId, report.id)).lineManagerId).toBe(boss.id);
    const again = await repos.agents.release(r.db, businessId, lead.id);
    expect(again.archivedAt?.getTime()).toBe(released.archivedAt?.getTime());
    // Business B is untouched.
    expect((await repos.departments.get(r.db, r.B.businessId, r.B.departmentId)).leadAgentId).toBe(r.B.agentId);
  });

  it("hands back open tasks: running and paused return to ready unassigned, review and done keep the record", async () => {
    const { businessId } = r.A;
    const worker = await agent("Handback worker");
    const mk = (title: string, status: "running" | "paused" | "planned" | "review" | "done") => repos.tasks.create(r.db, businessId, { kind: "code", title, status, assigneeAgentId: worker.id });
    const [running, paused, planned, review, done] = await Promise.all([mk("Running one", "running"), mk("Paused one", "paused"), mk("Planned one", "planned"), mk("In review", "review"), mk("Done one", "done")]);
    const back = await repos.tasks.handBack(r.db, businessId, worker.id);
    expect(back.map((b) => [b.task.id, b.from]).sort()).toEqual([[running.id, "running"], [paused.id, "paused"], [planned.id, "planned"]].sort());
    expect(await repos.tasks.get(r.db, businessId, running.id)).toMatchObject({ status: "ready", assigneeAgentId: null, endedAt: null });
    expect(await repos.tasks.get(r.db, businessId, paused.id)).toMatchObject({ status: "ready", assigneeAgentId: null });
    expect(await repos.tasks.get(r.db, businessId, planned.id)).toMatchObject({ status: "planned", assigneeAgentId: null });
    expect(await repos.tasks.get(r.db, businessId, review.id)).toMatchObject({ status: "review", assigneeAgentId: worker.id });
    expect(await repos.tasks.get(r.db, businessId, done.id)).toMatchObject({ status: "done", assigneeAgentId: worker.id });
    expect(await repos.tasks.handBack(r.db, r.B.businessId, worker.id)).toEqual([]);
  });
});

describe("department merge (RA-16)", () => {
  it("moves agents and tasks to the target department, keeps one copy and carries the lead across", async () => {
    const { businessId } = r.A;
    const lead = await agent("Merge lead");
    const from = await repos.departments.create(r.db, businessId, { name: "Merge from", leadAgentId: lead.id });
    const into = await repos.departments.create(r.db, businessId, { name: "Merge into" });
    const only = await agent("Merge only", { departmentIds: [from.id] });
    const both = await agent("Merge both", { departmentIds: [into.id, r.A.departmentId, from.id] });
    const task = await repos.tasks.create(r.db, businessId, { kind: "ops", title: "Merge task", departmentId: from.id });
    const merged = await repos.departments.merge(r.db, businessId, from.id, into.id);
    expect(merged.leadAgentId).toBe(lead.id);
    expect((await repos.agents.get(r.db, businessId, only.id)).departmentIds).toEqual([into.id]);
    expect((await repos.agents.get(r.db, businessId, both.id)).departmentIds).toEqual([into.id, r.A.departmentId]);
    expect((await repos.tasks.get(r.db, businessId, task.id)).departmentId).toBe(into.id);
    expect((await repos.departments.get(r.db, businessId, from.id)).archivedAt).toBeInstanceOf(Date);
    await expect(repos.departments.merge(r.db, businessId, from.id, into.id)).rejects.toThrow(/Only live departments/);
  });
});

describe("approvals routed by Responsibilities (TPD-04)", () => {
  it("infers the decision type from the gated tool", () => {
    expect(inferDecisionType("github", "merge_pr")).toBe("merge_to_main");
    expect(inferDecisionType("dropbox_sign", "send_envelope")).toBe("sign_contracts");
    expect(inferDecisionType("stripe", "create_coupon")).toBe("spend_above_threshold");
    expect(inferDecisionType("x", "schedule_post")).toBe("publish_content");
    expect(inferDecisionType("gmail", "send_email")).toBe("message_customers");
    expect(inferDecisionType("search", "lookup")).toBeNull();
  });

  it("names the department's handler; a delegated agent decides at once; merges, signing and hard gates stay with the founder", async () => {
    const { businessId, adminId, memberId } = r.A;
    const dept = await repos.departments.create(r.db, businessId, { name: "Routing dept" });
    const requester = await agent("Routing requester", { departmentIds: [dept.id] });
    const approver = await agent("Routing approver", { departmentIds: [dept.id] });
    await repos.departments.update(r.db, businessId, dept.id, {
      approvers: [
        { decisionType: "merge_to_main", handler: { kind: "agent", id: approver.id } },
        { decisionType: "message_customers", handler: { kind: "user", id: memberId } },
        { decisionType: "sign_contracts", handler: { kind: "agent", id: approver.id } },
        { decisionType: "publish_content", handler: { kind: "user", id: r.B.ownerId } },
      ],
    });
    // A merge to the default branch is the founder's even when an agent is delegated it: the agent never decides it.
    const merge = await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "github", tool: "merge_pr" });
    expect(merge).toMatchObject({ decisionType: "merge_to_main", handlerKind: null, outcome: null, resolvedAt: null });
    const message = await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "gmail", tool: "send_email" });
    expect(message).toMatchObject({ decisionType: "message_customers", handlerKind: "user", handlerId: memberId, outcome: null, resolvedAt: null });
    // An agent never decides a signature, and an explicit null (a hard gate) is not routed.
    expect(await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "dropbox_sign", tool: "send_envelope" })).toMatchObject({ decisionType: "sign_contracts", handlerKind: null, outcome: null });
    expect(await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "github", tool: "merge_pr", decisionType: null })).toMatchObject({ decisionType: null, handlerKind: null, outcome: null });
    // A handler who is not a member of this business hands it back to the founder.
    expect(await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "x", tool: "schedule_post" })).toMatchObject({ decisionType: "publish_content", handlerKind: null });
    // A paused agent handler hands it back too.
    await repos.agents.setStatus(r.db, businessId, approver.id, "paused");
    expect(await repos.approvals.create(r.db, businessId, { agentId: requester.id, connectorKey: "github", tool: "merge_pr" })).toMatchObject({ handlerKind: null, outcome: null });
    // An agent never approves its own request (the matrix names it for merges, but it asked): the founder answers.
    await repos.agents.setStatus(r.db, businessId, approver.id, "idle");
    expect(await repos.approvals.create(r.db, businessId, { agentId: approver.id, connectorKey: "github", tool: "merge_pr" })).toMatchObject({ decisionType: "merge_to_main", handlerKind: null, outcome: null, byKind: null });
    // An agent with no department goes by the business-wide handler, which needs every department to agree.
    const loose = await agent("Routing loose");
    expect(await repos.approvals.create(r.db, businessId, { agentId: loose.id, connectorKey: "gmail", tool: "send_email" })).toMatchObject({ handlerKind: null });
    expect(adminId).toBeTruthy();
  });
});

describe("training idempotency (RA-13) and the watch after a rollback (TPD-20)", () => {
  it("decide claims the run once; a second promote is refused and the version is promoted once", async () => {
    const { businessId } = r.A;
    const a = await agent("Decide agent", { initialVersion: { instructions: { role: "v1" } } });
    const draft = await repos.agents.createVersion(r.db, businessId, a.id, { instructions: { role: "v2" }, state: "draft" });
    const run = await repos.training.create(r.db, businessId, { agentId: a.id, fromVersionId: a.currentVersionId, toVersionId: draft.id, status: "awaiting_decision" });
    const results = await Promise.allSettled([repos.training.decide(r.db, businessId, run.id, "promoted"), repos.training.decide(r.db, businessId, run.id, "promoted")]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect((await repos.agents.get(r.db, businessId, a.id)).currentVersionId).toBe(draft.id);
  });

  it("createForDraft refuses a second run of a draft while one is active, and allows one after it ends", async () => {
    const { businessId } = r.A;
    const a = await agent("Run agent", { initialVersion: { instructions: { role: "v1" } } });
    const draft = await repos.agents.createVersion(r.db, businessId, a.id, { instructions: { role: "v2" }, state: "draft" });
    const results = await Promise.allSettled([
      repos.training.createForDraft(r.db, businessId, { agentId: a.id, fromVersionId: a.currentVersionId, toVersionId: draft.id }),
      repos.training.createForDraft(r.db, businessId, { agentId: a.id, fromVersionId: a.currentVersionId, toVersionId: draft.id }),
    ]);
    const ok = results.filter((x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof repos.training.create>>> => x.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(results.find((x) => x.status === "rejected")).toMatchObject({ reason: { code: "conflict", status: 409 } });
    expect((await repos.training.activeForVersion(r.db, businessId, draft.id))?.id).toBe(ok[0]!.value.id);
    await repos.training.update(r.db, businessId, ok[0]!.value.id, { status: "cancelled" });
    expect(await repos.training.activeForVersion(r.db, businessId, draft.id)).toBeNull();
    expect((await repos.training.createForDraft(r.db, businessId, { agentId: a.id, toVersionId: draft.id })).status).toBe("queued");
  });

  it("two saves at once number their versions one after the other", async () => {
    const { businessId } = r.A;
    const a = await agent("Version agent", { initialVersion: { instructions: { role: "v1" } } });
    const saved = await Promise.all([1, 2, 3].map((i) => repos.agents.createVersion(r.db, businessId, a.id, { instructions: { role: `draft ${i}` }, state: "draft" })));
    expect(saved.map((v) => v.version).sort()).toEqual([2, 3, 4]);
  });

  it("closeWatch ends the agent's open seven-day watch only", async () => {
    const { businessId } = r.A;
    const a = await agent("Watch agent", { initialVersion: { instructions: { role: "v1" } } });
    const draft = await repos.agents.createVersion(r.db, businessId, a.id, { instructions: { role: "v2" }, state: "draft" });
    const run = await repos.training.create(r.db, businessId, { agentId: a.id, fromVersionId: a.currentVersionId, toVersionId: draft.id, status: "awaiting_decision" });
    await repos.training.decide(r.db, businessId, run.id, "promoted", { watchUntil: new Date(Date.now() + 7 * 86_400_000) });
    const closed = await repos.training.closeWatch(r.db, businessId, a.id);
    expect(closed.map((c) => c.id)).toEqual([run.id]);
    expect((await repos.training.get(r.db, businessId, run.id)).watchUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await repos.training.closeWatch(r.db, businessId, a.id)).toEqual([]);
  });
});

describe("a promoted run writes its scores to the agent's ratings (founder: 'Training doesn't update ratings')", () => {
  const seedSkills = (agentId: string) =>
    repos.skills.upsertForAgent(r.db, r.A.businessId, agentId, [
      { skillKey: "testing", group: "craft", tested: 10, proven: null, nLive: 0, displayed: 10, potential: 10 },
      { skillKey: "speed", group: "execution", tested: 10, proven: 14, nLive: 20, displayed: 12, potential: 10 },
      { skillKey: "debugging", group: "craft", tested: 10, proven: null, nLive: 0, displayed: 10, potential: 10 },
      { skillKey: "library_release_notes", group: "craft", tested: null, proven: null, nLive: 0, displayed: 10, potential: 10 },
    ]);
  const trained = async (agentId: string, currentVersionId: string | null, results: Record<string, { old: number; new: number; tests?: number }>) => {
    const draft = await repos.agents.createVersion(r.db, r.A.businessId, agentId, { instructions: { role: "v2" }, state: "draft" });
    const run = await repos.training.create(r.db, r.A.businessId, { agentId, fromVersionId: currentVersionId, toVersionId: draft.id, status: "awaiting_decision" });
    return repos.training.update(r.db, r.A.businessId, run.id, { results });
  };
  const byKey = async (agentId: string) => new Map((await repos.skills.listForAgent(r.db, r.A.businessId, agentId)).map((s) => [s.skillKey, s]));

  it("promote writes each tested skill's score (tested, re-blended displayed, potential); skills the run did not test, or that have no tests, keep their rows", async () => {
    const { businessId } = r.A;
    const a = await agent("Promote ratings", { initialVersion: { instructions: { role: "v1" } } });
    await seedSkills(a.id);
    // The run tested three skills (one up, one down, one legacy result without a test count) and found no tests for the library skill.
    const run = await trained(a.id, a.currentVersionId, { testing: { old: 10, new: 13, tests: 12 }, speed: { old: 10, new: 8, tests: 12 }, debugging: { old: 10, new: 11 }, library_release_notes: { old: 10, new: 10, tests: 0 } });
    const decided = await repos.training.decide(r.db, businessId, run.id, "promoted");
    expect(decided.decision).toBe("promoted");
    expect(decided.ratings.map((x) => x.skillKey).sort()).toEqual(["debugging", "speed", "testing"]);
    const skills = await byKey(a.id);
    expect(skills.get("testing")).toMatchObject({ tested: "13.000", displayed: 13, potential: 13 });
    // Proven outcomes still weigh in: n = 20 → w = 0.5 → (8 + 14) / 2 = 11.
    expect(skills.get("speed")).toMatchObject({ tested: "8.000", proven: "14.000", nLive: 20, displayed: 11 });
    expect(skills.get("debugging")).toMatchObject({ tested: "11.000", displayed: 11, potential: 11 });
    // Nothing was invented for a skill with no tests: it stays untested at the baseline.
    expect(skills.get("library_release_notes")).toMatchObject({ tested: null, displayed: 10, potential: 10 });
  });

  it("potential is the best tested score across the agent's last five finished runs (BUILD §11.10)", async () => {
    const { businessId } = r.A;
    const a = await agent("Potential ratings", { initialVersion: { instructions: { role: "v1" } } });
    await seedSkills(a.id);
    const first = await trained(a.id, a.currentVersionId, { testing: { old: 10, new: 15, tests: 12 } });
    await repos.training.decide(r.db, businessId, first.id, "promoted");
    expect((await byKey(a.id)).get("testing")).toMatchObject({ tested: "15.000", potential: 15 });
    // A later promoted run scores lower: the rating follows it, the potential remembers the 15.
    const second = await trained(a.id, (await repos.agents.get(r.db, businessId, a.id)).currentVersionId, { testing: { old: 15, new: 12, tests: 12 } });
    await repos.training.decide(r.db, businessId, second.id, "promoted");
    expect((await byKey(a.id)).get("testing")).toMatchObject({ tested: "12.000", displayed: 12, potential: 15 });
  });

  it("a discarded run writes nothing, and a failed or canceled run cannot be decided", async () => {
    const { businessId } = r.A;
    const a = await agent("Discard ratings", { initialVersion: { instructions: { role: "v1" } } });
    await seedSkills(a.id);
    const before = await repos.skills.listForAgent(r.db, businessId, a.id);
    const run = await trained(a.id, a.currentVersionId, { testing: { old: 10, new: 16, tests: 12 } });
    const decided = await repos.training.decide(r.db, businessId, run.id, "discarded");
    expect(decided.ratings).toEqual([]);
    expect(await repos.skills.listForAgent(r.db, businessId, a.id)).toEqual(before);
    for (const status of ["failed", "cancelled"] as const) {
      const ended = await trained(a.id, a.currentVersionId, { testing: { old: 10, new: 16, tests: 12 } });
      await repos.training.update(r.db, businessId, ended.id, { status });
      await expect(repos.training.decide(r.db, businessId, ended.id, "promoted")).rejects.toThrow(/not awaiting a decision/);
    }
    expect(await repos.skills.listForAgent(r.db, businessId, a.id)).toEqual(before);
  });

  it("a rollback restores the ratings the promotion replaced (AC-11.10.6) and keeps the potential reached", async () => {
    const { businessId } = r.A;
    const a = await agent("Rollback ratings", { initialVersion: { instructions: { role: "v1" } } });
    await seedSkills(a.id);
    const run = await trained(a.id, a.currentVersionId, { testing: { old: 10, new: 14, tests: 12 }, library_release_notes: { old: 10, new: 10, tests: 0 } });
    await repos.training.decide(r.db, businessId, run.id, "promoted");
    const promoted = await repos.agents.get(r.db, businessId, a.id);
    expect((await byKey(a.id)).get("testing")).toMatchObject({ tested: "14.000", potential: 14 });
    const restored = await repos.training.revertPromotion(r.db, businessId, a.id, promoted.currentVersionId!);
    expect(restored.map((x) => x.skillKey)).toEqual(["testing"]);
    expect((await byKey(a.id)).get("testing")).toMatchObject({ tested: "10.000", displayed: 10, potential: 14 });
    expect((await byKey(a.id)).get("library_release_notes")).toMatchObject({ tested: null });
    // A version no promoted run made live has nothing to restore.
    expect(await repos.training.revertPromotion(r.db, businessId, a.id, a.currentVersionId!)).toEqual([]);
  });
});

describe("custom skill tests count once reviewed (AC-08)", () => {
  it("reviewTests keeps the chosen visible tests and every held-out one, archives the rest, and needs one visible test", async () => {
    const { businessId } = r.A;
    const def = await repos.skills.createCustomDefinition(r.db, businessId, { agentType: "engineer", skillKey: "custom_grant_writing", name: "Grant writing", group: "craft" });
    const mk = (title: string, heldOut: boolean) => repos.skills.createTest(r.db, businessId, { skillDefinitionId: def.id, task: { title, prompt: "Write it." }, heldOut, reviewed: false });
    const [keep, drop, held] = await Promise.all([mk("Keep me", false), mk("Drop me", false), mk("Held out", true)]);
    expect(await repos.skills.listTests(r.db, businessId, def.id, { reviewedOnly: true })).toEqual([]);
    expect((await repos.skills.listCustom(r.db, businessId, "engineer")).find((d) => d.id === def.id)).toMatchObject({ tests: 3, reviewed: 0, heldOut: 0 });
    await expect(repos.skills.reviewTests(r.db, businessId, def.id, [held.id])).rejects.toThrow(/Keep only tests drafted/);
    await expect(repos.skills.reviewTests(r.db, businessId, def.id, [])).rejects.toThrow(/at least one visible test/);
    expect(await repos.skills.reviewTests(r.db, businessId, def.id, [keep.id])).toEqual({ reviewed: 2, dropped: 1 });
    const counted = await repos.skills.listTests(r.db, businessId, def.id, { reviewedOnly: true, includeHeldOut: true });
    expect(counted.map((t) => t.id).sort()).toEqual([keep.id, held.id].sort());
    expect(counted.some((t) => t.id === drop.id)).toBe(false);
    expect((await repos.skills.listCustom(r.db, businessId, "engineer")).find((d) => d.id === def.id)).toMatchObject({ tests: 2, reviewed: 2, heldOut: 1 });
    expect(await repos.skills.findDefinition(r.db, businessId, "engineer", "custom_grant_writing")).toMatchObject({ id: def.id });
    expect(await repos.skills.findDefinition(r.db, r.B.businessId, "engineer", "custom_grant_writing")).toBeNull();
  });
});

describe("roster and profile reads from the rows themselves (TPD-08, TPD-29)", () => {
  it("rosterActivity: form of the last five ended sessions, the latest session with its task, 24h error rate", async () => {
    const { businessId } = r.A;
    const a = await agent("Roster agent");
    const task = await repos.tasks.create(r.db, businessId, { kind: "code", title: "Roster task", assigneeAgentId: a.id, status: "running" });
    const t0 = Date.now() - 3_600_000;
    const outcomes = ["failed", "done", "done", "blocked", "stopped", "done", "failed"];
    for (const [i, outcome] of outcomes.entries()) {
      const s = await repos.agents.createSession(r.db, businessId, { agentId: a.id, taskId: task.id, startedAt: new Date(t0 + i * 60_000) });
      await repos.agents.endSession(r.db, businessId, s.id, { outcome, endedAt: new Date(t0 + i * 60_000 + 30_000) });
    }
    const open = await repos.agents.createSession(r.db, businessId, { agentId: a.id, taskId: task.id, startedAt: new Date(t0 + 10 * 60_000) });
    const idle = await agent("Roster idle");
    const activity = await repos.agents.rosterActivity(r.db, businessId, [a.id, idle.id]);
    // "stopped" says nothing of the agent's form; the last five on their merits, oldest first.
    expect(activity.get(a.id)?.form).toEqual(["success", "success", "partial", "success", "failure"]);
    expect(activity.get(a.id)?.latest).toMatchObject({ open: true, taskId: task.id, taskTitle: "Roster task" });
    expect(activity.get(a.id)?.sessions24h).toBe(6);
    expect(activity.get(a.id)?.failed24h).toBe(2);
    expect(activity.get(idle.id)).toEqual({ form: [], latest: null, lastActivityAt: null, sessions24h: 0, failed24h: 0 });
    expect(open.id).toBeTruthy();
    // Another business's agent ids find nothing.
    expect((await repos.agents.rosterActivity(r.db, r.B.businessId, [a.id])).get(a.id)?.form).toEqual([]);
  });

  it("dailyActivity: tasks done, metered cost and rejected approvals per day", async () => {
    const { businessId } = r.A;
    const a = await agent("Daily agent");
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 15));
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const s = await repos.agents.createSession(r.db, businessId, { agentId: a.id, startedAt: day });
    await repos.agents.endSession(r.db, businessId, s.id, { outcome: "done", endedAt: day, costMinor: 40 });
    const f = await repos.agents.createSession(r.db, businessId, { agentId: a.id, startedAt: day });
    await repos.agents.endSession(r.db, businessId, f.id, { outcome: "failed", endedAt: day });
    await repos.usage.record(r.db, businessId, { agentId: a.id, kind: "tokens", costMinor: 125, occurredAt: day.toISOString() });
    const ap = await repos.approvals.create(r.db, businessId, { agentId: a.id, connectorKey: "search", tool: "lookup" });
    await repos.approvals.resolve(r.db, businessId, ap.id, { outcome: "rejected", byKind: "user", byId: r.A.ownerId });
    const rows = await repos.agents.dailyActivity(r.db, businessId, a.id, { from: new Date(now.getTime() - 7 * 86_400_000), to: new Date(now.getTime() + 86_400_000) });
    // The approval was rejected today (resolved now); the sessions and the metered cost are two days back.
    expect(rows).toEqual([
      { day: key(day), tasksDone: 1, sessions: 2, failed: 1, costMinor: 125, approvalsRejected: 0 },
      { day: key(now), tasksDone: 0, sessions: 0, failed: 0, costMinor: 0, approvalsRejected: 1 },
    ]);
    expect(await repos.agents.dailyActivity(r.db, r.B.businessId, a.id, { from: new Date(now.getTime() - 7 * 86_400_000), to: now })).toEqual([]);
  });

  it("latestPerAgent returns each agent's newest event of the type", async () => {
    const { businessId } = r.A;
    const a = await agent("Health agent");
    const write = (to: string, at: string) => repos.events.write(r.db, businessId, { type: "agent.health_changed", actor: { kind: "system", id: "health" }, payload: { agentId: a.id, from: "idle", to, reason: to, signals: {}, sessionId: null }, occurredAt: at });
    await write("failing", "2026-10-01T10:00:00.000Z");
    await write("injured", "2026-10-02T10:00:00.000Z");
    const latest = await repos.events.latestPerAgent(r.db, businessId, "agent.health_changed", [a.id]);
    expect((latest.get(a.id)?.payload as { to: string }).to).toBe("injured");
    expect((await repos.events.latestPerAgent(r.db, r.B.businessId, "agent.health_changed", [a.id])).size).toBe(0);
  });
});

describe("people (RUI-11, WEB-12)", () => {
  it("memberships.owner is the founder who created the business; founders.userIdByEmail finds an account", async () => {
    expect((await repos.memberships.owner(r.db, r.A.businessId))?.userId).toBe(r.A.ownerId);
    expect(await repos.founders.userIdByEmail(r.db, `${r.A.slug}-admin@test.local`.toUpperCase())).toBe(r.A.adminId);
    expect(await repos.founders.userIdByEmail(r.db, "nobody@test.local")).toBeNull();
  });
});

describe("plan requests (RA-13)", () => {
  it("audit.latestMatching finds the newest entry whose details hold the match; tasks.byIds stays in the business", async () => {
    const { businessId, ownerId, taskId, task2Id } = r.A;
    await repos.audit.append(r.db, businessId, { actorKind: "user", actorId: ownerId, action: "dev.tasks.plan", details: { planKey: "k1", taskIds: [taskId] } });
    const since = new Date(Date.now() - 60_000);
    expect((await repos.audit.latestMatching(r.db, businessId, "dev.tasks.plan", { planKey: "k1" }, since))?.details).toMatchObject({ taskIds: [taskId] });
    expect(await repos.audit.latestMatching(r.db, businessId, "dev.tasks.plan", { planKey: "k2" }, since)).toBeNull();
    expect(await repos.audit.latestMatching(r.db, r.B.businessId, "dev.tasks.plan", { planKey: "k1" }, since)).toBeNull();
    expect(await repos.audit.latestMatching(r.db, businessId, "dev.tasks.plan", { planKey: "k1" }, new Date(Date.now() + 60_000))).toBeNull();
    expect((await repos.tasks.byIds(r.db, businessId, [taskId, task2Id, r.B.taskId])).map((t) => t.id).sort()).toEqual([taskId, task2Id].sort());
  });
});
