/**
 * The team plans the roadmap and keeps a cycle going (lead, 2026-10-24): Now items without tasks are planned into
 * tasks by the cycle itself (at most `LIMITS.cyclePlanRoadmapItems` a cycle, never before the sign-off, never twice),
 * the planner orders but never gates (free agent slots are filled in code), and a session that finishes mid-cycle
 * hands the tasks it unblocked to the same cycle (`followUpStarts`). Mock models on PGlite.
 */
import { LIMITS } from "@foundmill/config";
import { repos, stopBusinessAgents, resumeBusinessAgents } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { FOLLOW_UP_PRIORITY, FOLLOW_UP_REASON, SLOT_FREE_REASON, SLOTS_TAKEN_REASON, createCycleActivities, withRoadmapNote } from "../activities/cycle";
import { ROADMAP_PLAN_AUDIT_ACTION, createRoadmapPlanActivities, roadmapPlanHold, roadmapPlanNote } from "../activities/roadmap-plan";
import type { BusinessBrief } from "../activities/types";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let roadmapActs: ReturnType<typeof createRoadmapPlanActivities>;
let cycleActs: ReturnType<typeof createCycleActivities>;
let briefActs: ReturnType<typeof createBriefActivities>;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "roadmap" });
  roadmapActs = createRoadmapPlanActivities(t.deps);
  cycleActs = createCycleActivities(t.deps);
  briefActs = createBriefActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

const B = () => t.businessId;
const brief = () => briefActs.loadBrief({ businessId: B() });
const nowItem = (title: string) => repos.product.upsertRoadmapItem(t.db, B(), { title, descriptionMd: `${title}: what the founder asked for.`, horizon: "now", ownerRef: { kind: "department", id: t.fixture.departmentId } });
const tasksOf = async (roadmapItemId: string) => (await repos.tasks.list(t.db, B(), { roadmapItemId, limit: 50 })).items;
/** Plan every Now item an earlier test left without tasks, so each test starts from a clear Now. */
async function drain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const b = await brief();
    if (!b.untaskedRoadmap?.some((r) => r.horizon === "now")) return;
    await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 100 + i, brief: b });
  }
}

describe("planRoadmap: the cycle plans Now roadmap items into tasks", () => {
  it("writes the Planner's tasks as planned, with edges and the owner department, audits it, and never plans the same item twice", async () => {
    const item = await nowItem("Repository context for code sessions");
    const b = await brief();
    // The fixture business has started distribution: past the sign-off either way.
    expect(["building", "selling"]).toContain(b.productStage);
    expect(b.untaskedRoadmap?.map((r) => r.id)).toContain(item.id);

    const planned = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 1, brief: b });
    expect(planned.skipped).toBeNull();
    expect(planned.failed).toEqual([]);
    expect(planned.planned).toHaveLength(1);
    const [p] = planned.planned;
    expect(p).toMatchObject({ roadmapItemId: item.id, title: item.title });
    expect(p!.taskIds.length).toBeGreaterThanOrEqual(2);

    const tasks = await tasksOf(item.id);
    expect(tasks.map((x) => x.id).sort()).toEqual([...p!.taskIds].sort());
    expect(tasks.every((x) => x.status === "planned" && x.departmentId === t.fixture.departmentId && x.assigneeAgentId === null)).toBe(true);
    const edges = await repos.tasks.listEdges(t.db, B(), tasks.map((x) => x.id));
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const audit = (await repos.audit.list(t.db, B(), { action: ROADMAP_PLAN_AUDIT_ACTION, limit: 10 })).items.find((e) => (e.details as { taskIds: string[] }).taskIds.includes(tasks[0]!.id));
    expect(audit).toMatchObject({ actorKind: "system", details: expect.objectContaining({ cycleNumber: 1, title: item.title, tasks: tasks.length }) });

    // The summary says what was planned, in front of the Chief of Staff's own words.
    expect(roadmapPlanNote(planned)).toBe(`Planned ${tasks.length} tasks for ${item.title}.`);
    expect(withRoadmapNote("Starting: …", planned)).toBe(`Planned ${tasks.length} tasks for ${item.title}.\n\nStarting: …`);
    expect(roadmapPlanNote({ planned: [], failed: [], skipped: "x", costMinor: 0 })).toBeNull();

    // A second cycle: the item has tasks, so the brief no longer lists it and nothing is planned.
    const again = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 2, brief: await brief() });
    expect(again.planned).toEqual([]);
    expect(again.skipped).toMatch(/no roadmap item in Now/);
    // A retried activity with the same (stale) brief finds the tasks and writes no second plan.
    const retried = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 1, brief: b });
    expect(retried.planned).toEqual([]);
    expect(await tasksOf(item.id)).toHaveLength(tasks.length);
  });

  it("plans at most LIMITS.cyclePlanRoadmapItems items a cycle, Now first, and the rest wait for the next cycle", async () => {
    await drain();
    const items = await Promise.all(["Cap item one", "Cap item two", "Cap item three"].map((title) => nowItem(title)));
    const first = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 3, brief: await brief() });
    expect(first.planned).toHaveLength(LIMITS.cyclePlanRoadmapItems);
    expect(first.planned.every((p) => items.some((i) => i.id === p.roadmapItemId))).toBe(true);
    const second = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 4, brief: await brief() });
    expect(second.planned).toHaveLength(items.length - LIMITS.cyclePlanRoadmapItems);
    for (const i of items) expect((await tasksOf(i.id)).length).toBeGreaterThan(0);
    // Next and Later items are not planned by the cycle (the fixture's "Billing" is in Next).
    expect((await brief()).untaskedRoadmap?.some((r) => r.horizon === "next")).toBe(true);
    expect((await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 5, brief: await brief() })).planned).toEqual([]);
  });

  it("plans nothing before the sign-off, while the team is stopped or when a budget gate is closed", async () => {
    await drain();
    const item = await nowItem("Held item");
    const b = await brief();
    expect(roadmapPlanHold({ ...b, productStage: "awaiting_signoff" })).toMatch(/not signed off/);
    expect(roadmapPlanHold({ ...b, productStage: "drafting" })).toMatch(/not signed off/);
    expect(roadmapPlanHold({ ...b, agentsStopped: true })).toMatch(/stopped/);
    expect(roadmapPlanHold({ ...b, budgetRemainingMinor: 0 })).toMatch(/credits/);
    expect(roadmapPlanHold({ ...b, modelBudgetRemainingMinor: 0 })).toMatch(/model budget/);
    expect(roadmapPlanHold({ ...b, productStage: "selling" })).toBeNull();
    const waiting = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 6, brief: { ...b, productStage: "awaiting_signoff" } });
    expect(waiting).toMatchObject({ planned: [], failed: [], costMinor: 0 });
    expect(waiting.skipped).toMatch(/not signed off/);
    expect(await tasksOf(item.id)).toEqual([]);
    // The real stop flag, read by the brief.
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    try {
      expect((await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 7, brief: await brief() })).skipped).toMatch(/stopped/);
    } finally {
      await resumeBusinessAgents(t.db, B());
    }
    expect(await tasksOf(item.id)).toEqual([]);
    // Once the gates are open it is planned like any other.
    expect((await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 8, brief: await brief() })).planned.map((p) => p.roadmapItemId)).toEqual([item.id]);
  });

  it("a Planner that fails for one item never fails the activity: the item is named as failed and tried again next cycle", async () => {
    await drain();
    const item = await nowItem("Flaky item");
    const complete = t.deps.models.complete.bind(t.deps.models);
    t.deps.models.complete = (async () => {
      throw new Error("Anthropic unavailable after 4 attempts");
    }) as typeof t.deps.models.complete;
    let failed;
    try {
      failed = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 9, brief: await brief() });
    } finally {
      t.deps.models.complete = complete;
    }
    expect(failed.planned).toEqual([]);
    expect(failed.failed).toEqual([{ roadmapItemId: item.id, title: item.title, reason: "the Planner did not answer" }]);
    expect(roadmapPlanNote(failed)).toBe(`Could not plan ${item.title} (the Planner did not answer); the team tries again next cycle.`);
    // The plan's summary carries it, and no plumbing word reaches the founder.
    const plan = await cycleActs.planCycle({ businessId: B(), cycleNumber: 9, trigger: "continue", brief: await brief(), roadmapPlanned: failed });
    expect(plan.summary.startsWith(`Could not plan ${item.title}`)).toBe(true);
    expect(plan.summary).not.toMatch(/Anthropic/);
    // Next cycle: still untasked, planned now that the Planner answers.
    const next = await roadmapActs.planRoadmap({ businessId: B(), cycleNumber: 10, brief: await brief() });
    expect(next.planned.map((p) => p.roadmapItemId)).toEqual([item.id]);
  });
});

describe("planCycle: the planner orders, it never gates", () => {
  it("starts every dispatchable task the planner left out while an agent slot is free, keeps its reason as a note, and defers only what no slot is left for", async () => {
    const b = await brief();
    const candidates = b.openTasks.filter((x) => !x.blocked && !x.awaitingApproval && x.status !== "paused");
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = candidates;
    // The model picks one task and defers one with a reason; the code fills the slots left.
    const complete = t.deps.models.complete.bind(t.deps.models);
    t.deps.models.complete = (async (...args: Parameters<typeof complete>) => {
      const out = await complete(...args);
      return { ...out, json: { summary: "One task only.", time_box_hours: 4, departments: [{ department_id: first!.departmentId ?? "general", priorities: [], tasks_to_start: [{ task_id: first!.id, agent_id: null, priority: 1, reason: "first" }] }], deferred: [{ task_id: second!.id, reason: "wait for a quieter week" }], approvals_needed: [] } };
    }) as typeof t.deps.models.complete;
    try {
      const open = await cycleActs.planCycle({ businessId: B(), cycleNumber: 11, trigger: "continue", brief: { ...b, maxAgents: 3 } });
      expect(open.starts).toHaveLength(3);
      expect(open.starts[0]).toMatchObject({ taskId: first!.id, priority: 1, reason: "first" });
      expect(open.starts.find((s) => s.taskId === second!.id)?.reason).toBe(`${SLOT_FREE_REASON}; the plan noted: wait for a quieter week`);
      expect(open.starts.find((s) => s.taskId === third!.id)?.reason).toBe(SLOT_FREE_REASON);
      expect(open.deferred.some((d) => d.taskId === second!.id)).toBe(false);
      const left = candidates.slice(3);
      for (const x of left) expect(open.deferred.find((d) => d.taskId === x.id)?.reason).toBe(SLOTS_TAKEN_REASON);
      expect(open.summary.startsWith("Starting: ")).toBe(true);

      // One slot: the planner's pick starts, its deferral stands with its own reason.
      const tight = await cycleActs.planCycle({ businessId: B(), cycleNumber: 12, trigger: "continue", brief: { ...b, maxAgents: 1 } });
      expect(tight.starts.map((s) => s.taskId)).toEqual([first!.id]);
      expect(tight.deferred.find((d) => d.taskId === second!.id)?.reason).toBe("wait for a quieter week");
      expect(tight.deferred.find((d) => d.taskId === third!.id)?.reason).toBe(SLOTS_TAKEN_REASON);

      // A planner that picks nothing (Foundmill cycle 12) still starts the work.
      t.deps.models.complete = (async (...args: Parameters<typeof complete>) => {
        const out = await complete(...args);
        return { ...out, json: { summary: "Nothing this time.", time_box_hours: 4, departments: [], deferred: [], approvals_needed: [] } };
      }) as typeof t.deps.models.complete;
      const empty = await cycleActs.planCycle({ businessId: B(), cycleNumber: 13, trigger: "continue", brief: { ...b, maxAgents: 2 } });
      expect(empty.starts).toHaveLength(2);
      expect(empty.starts.every((s) => s.reason === SLOT_FREE_REASON)).toBe(true);
      expect(empty.summary).toMatch(/^Starting: /);
    } finally {
      t.deps.models.complete = complete;
    }
  });

  it("the idle note says the team plans the roadmap, never that the founder builds a task graph", async () => {
    const b = await brief();
    const blocked: BusinessBrief = { ...b, openTasks: b.openTasks.map((x) => ({ ...x, blocked: true })), untaskedRoadmap: [{ id: "r1", title: "Pricing experiment", horizon: "now" }] };
    const idle = await cycleActs.planCycle({ businessId: B(), cycleNumber: 14, trigger: "continue", brief: blocked });
    expect(idle.idle).toBe(true);
    expect(idle.summary).toContain("1 roadmap item has no tasks yet (Pricing experiment); the team plans it in the next rounds of work");
    expect(idle.summary).not.toMatch(/task graph|Development › Plan/);
  });
});

describe("followUpStarts: a cycle keeps going when a session finishes (decision 8)", () => {
  it("hands back the tasks a finished session unblocked, with an agent, and never one the cycle already holds", async () => {
    const earlier = await repos.tasks.create(t.db, B(), { kind: "code", title: "Follow-up: earlier work", status: "ready", departmentId: t.fixture.departmentId });
    const dependent = await repos.tasks.create(t.db, B(), { kind: "code", title: "Follow-up: dependent work", status: "planned", departmentId: t.fixture.departmentId, dependsOn: [earlier.id] });
    const others = (await repos.tasks.planningCandidates(t.db, B())).items.map((x) => x.id).filter((id) => id !== dependent.id);
    const ask = (exclude: string[], extra: Partial<Parameters<typeof cycleActs.followUpStarts>[0]> = {}) => cycleActs.followUpStarts({ businessId: B(), cycleId: "cycle-1", exclude, ...extra });

    // While the earlier task runs, the dependent one is still blocked: nothing to start.
    expect(await ask(others)).toEqual([]);
    // The earlier task finished: the dependent one starts, on the worker that does code work.
    await repos.tasks.setStatus(t.db, B(), earlier.id, "done", { force: true });
    const starts = await ask(others, { busyAgentIds: [] });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ taskId: dependent.id, agentId: t.workerId, departmentId: t.fixture.departmentId, kind: "code", priority: FOLLOW_UP_PRIORITY, reason: FOLLOW_UP_REASON });
    // Already pending or started in this cycle: not offered again. A limit of zero offers nothing.
    expect(await ask([...others, dependent.id])).toEqual([]);
    expect(await ask(others, { limit: 0 })).toEqual([]);
    // Without an exclude list every dispatchable task is offered, most important first, each once.
    const all = await ask([], { limit: 50 });
    expect(all.map((s) => s.taskId)).toContain(dependent.id);
    expect(new Set(all.map((s) => s.taskId)).size).toBe(all.length);
    // A stopped team: nothing.
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    try {
      expect(await ask(others)).toEqual([]);
    } finally {
      await resumeBusinessAgents(t.db, B());
    }
  });
});
