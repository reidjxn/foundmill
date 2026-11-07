/**
 * The first days are about the product (founder, 2026-10-18), as the orchestrator keeps them: the brief carries the
 * product stage; the cycle planner holds channel work back in code until the business sells; an engine started before
 * the founder's Start distribution stops; a plan's enable_channel defers the engine; vacation and Automated mode never
 * sign off the product; the last task of a roadmap item offers Ready to start selling? once, with the demo task.
 */
import { repos, signoffDecisionBlock } from "@foundmill/db";
import { CHANNEL_META, defaultGoalFor, goalOptions, goalProposalSubject, goalSentence } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { CHANNEL_WAITS_REASON, createCycleActivities, idleSummary } from "../activities/cycle";
import { autoDecideBlocking, createHolidayActivities, GOAL_IS_YOURS, SIGNOFF_IS_YOURS } from "../activities/holiday";
import { createPlanActivities } from "../activities/plan";
import { offerReadyToSellAfterTask, READY_TO_SELL_SUBJECT } from "../activities/session";
import type { BusinessBrief } from "../activities/types";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "first-days" });
});
afterAll(async () => {
  await t?.close();
});

/** A committed business whose founder has not started distribution (the fixture's has). */
async function waitingBusiness(name: string) {
  const b = await repos.businesses.create(t.db, { name, archetype: "b2b_saas" });
  await repos.businesses.commit(t.db, b.id, { archetype: "b2b_saas" });
  const chief = await repos.agents.create(t.db, b.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  return { id: b.id, chief };
}

describe("the brief and the cycle planner", () => {
  it("the brief names the product stage (the fixture sells); the planner holds channel work back until selling and says why", async () => {
    const brief = createBriefActivities(t.deps);
    const cycle = createCycleActivities(t.deps);
    const channelTask = await repos.tasks.create(t.db, t.businessId, { kind: "channel", title: "Score the 15 channels and propose 3-6 starters", assigneeAgentId: t.workerId, departmentId: t.fixture.departmentId, status: "ready" });
    const financeTask = await repos.tasks.create(t.db, t.businessId, { kind: "finance", title: "Set up the first runway forecast", assigneeAgentId: t.workerId, departmentId: t.fixture.departmentId, status: "ready" });
    const b = await brief.loadBrief({ businessId: t.businessId });
    expect(b.productStage).toBe("selling");
    expect(b.distributionStarted).toBe(true);
    expect(b.text).toContain("## Product stage\nselling: distribution has started");

    const building: BusinessBrief = { ...b, productStage: "building", distributionStarted: false };
    const plan = await cycle.planCycle({ businessId: t.businessId, cycleNumber: 1, trigger: "continue", brief: building });
    expect(plan.starts.map((s) => s.taskId)).not.toContain(channelTask.id);
    expect(plan.deferred).toContainEqual({ taskId: channelTask.id, reason: CHANNEL_WAITS_REASON });
    // Groundwork is never held back for this reason (the mock planner may still defer it for capacity).
    expect(plan.deferred.find((d) => d.taskId === financeTask.id)?.reason).not.toBe(CHANNEL_WAITS_REASON);

    // Selling: the channel task is a candidate like any other.
    const selling = await cycle.planCycle({ businessId: t.businessId, cycleNumber: 2, trigger: "continue", brief: b });
    expect(selling.deferred.find((d) => d.taskId === channelTask.id)?.reason).not.toBe(CHANNEL_WAITS_REASON);

    // Nothing but channel work: the idle note says what it waits for, and no model is paid for.
    const onlyChannel: BusinessBrief = { ...building, openTasks: building.openTasks.filter((task) => task.id === channelTask.id) };
    const idle = await cycle.planCycle({ businessId: t.businessId, cycleNumber: 3, trigger: "continue", brief: onlyChannel });
    expect(idle).toMatchObject({ starts: [], costMinor: 0, idle: true });
    expect(idle.summary).toContain("1 channel task waits until you start distribution from Distribution › Board");
    expect(idleSummary({ ...onlyChannel, productStage: "awaiting_signoff" }, [])).toContain("The specification and roadmap are waiting for your sign-off in the Inbox; building starts when both are approved");
    await repos.tasks.setStatus(t.db, t.businessId, channelTask.id, "stopped", { force: true });
    await repos.tasks.setStatus(t.db, t.businessId, financeTask.id, "stopped", { force: true });
  });
});

describe("engines wait for Start distribution", () => {
  it("an engine step for a business that has not started distribution stops; the fixture's (started) runs its plan step", async () => {
    const acts = createChannelActivities(t.deps);
    const w = await waitingBusiness("Engines Wait Co");
    const channel = await repos.channels.upsert(t.db, w.id, { channelKey: "seo", line: CHANNEL_META.seo.line, enabled: true });
    const stopped = await acts.channelStep({ businessId: w.id, channelId: channel.id, channelKey: "seo", step: "plan", weekIndex: 0, state: emptyChannelState() });
    expect(stopped).toMatchObject({ stop: true, note: "distribution has not started; engine stopping" });
    await repos.businesses.startDistribution(t.db, w.id);
    const planned = await acts.channelStep({ businessId: w.id, channelId: channel.id, channelKey: "seo", step: "plan", weekIndex: 0, state: emptyChannelState() });
    expect(planned.stop).toBe(false);
  });

  it("a plan's enable_channel keeps the channel on the board but defers its engine until distribution starts", async () => {
    const plans = createPlanActivities(t.deps);
    const w = await waitingBusiness("Plan Enable Co");
    const plan = await repos.plans.create(t.db, w.id, { origin: "option", actions: [{ type: "enable_channel", params: { channel: "affiliate" }, policyOutcome: "allow" }] });
    const res = await plans.executePlanAction({ businessId: w.id, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: `plan:${plan.id}` });
    expect(res.spawn).toEqual([]);
    expect(res.result).toMatchObject({ enabled: true, deferred: "distribution has not started; the engine starts with it" });
    const channel = await repos.channels.getByKey(t.db, w.id, "affiliate");
    expect(channel).toMatchObject({ enabled: true, engineWorkflowId: null });
  });
});

describe("vacation and Automated mode never sign off the product", () => {
  it("a sign-off note waits for the founder with its reason; Automated mode leaves it queued", async () => {
    const note = (kind: "spec" | "roadmap") => ({ type: "decision" as const, from_agent_id: t.chiefId, subject: kind === "spec" ? "Sign off the product specification" : "Sign off the product roadmap", body_md: "Approve it or ask for changes in your own words.", status_strip: [], exhibit: { kind: "none" as const, spec_ref: null }, decision: signoffDecisionBlock(kind), blocks_continue: true, source_event_ids: [], entity_ids: [] });
    const spec = await repos.productSignoffs.open(t.db, t.businessId, { kind: "spec", item: note("spec") });
    const roadmap = await repos.productSignoffs.open(t.db, t.businessId, { kind: "roadmap", item: note("roadmap") });
    // Automated mode: the recommended option is free and reversible, and still nobody takes it for the founder.
    const auto = await autoDecideBlocking(t.deps, t.businessId, { chiefOfStaffId: t.chiefId, authority: ["publish_content", "spend_above_threshold", "merge_to_main", "message_customers", "hire_agents", "change_models"], auditAction: "automated_mode.decide", scope: "Automated mode" });
    expect(auto.inboxItemIds).not.toContain(spec.item!.id);
    expect(auto.inboxItemIds).not.toContain(roadmap.item!.id);
    expect(auto.queuedGated).toBeGreaterThanOrEqual(2);
    // Vacation: the same, with the reason the report lists.
    const acts = createHolidayActivities(t.deps);
    const started = t.clock.now();
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 2 * 86_400_000), authority: { decisionTypes: ["publish_content", "spend_above_threshold"] }, wakeEvents: [], startedAt: started });
    const loaded = await acts.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    const decided = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(decided.inboxItemIds).not.toContain(spec.item!.id);
    const reasons = Object.fromEntries(decided.waiting.map((w) => [w.inboxItemId, w.reason]));
    expect(reasons[spec.item!.id]).toBe(SIGNOFF_IS_YOURS);
    expect(reasons[roadmap.item!.id]).toBe(SIGNOFF_IS_YOURS);
    for (const id of [spec.item!.id, roadmap.item!.id]) expect((await repos.inbox.get(t.db, t.businessId, id)).state).toBe("unread");
    await repos.holidays.end(t.db, t.businessId, h.id, { endedAt: t.clock.now() });
  });
});

describe("vacation and Automated mode never answer the goal (founder, 2026-11-07)", () => {
  it("the Chief of Staff's goal note waits for the founder with its reason; Automated mode leaves it queued", async () => {
    const today = t.clock.now().toISOString().slice(0, 10);
    const shape = defaultGoalFor({ payingCustomers: 0, today });
    const sentence = goalSentence(shape, { today, startValue: 0 });
    const proposed = await repos.goals.propose(t.db, t.businessId, {
      sentence,
      kind: shape.kind,
      target: shape.target,
      dueOn: shape.dueOn,
      startValue: 0,
      reason: "first",
      agentId: t.chiefId,
      item: { type: "decision", from_agent_id: t.chiefId, subject: goalProposalSubject(shape, "first", today), body_md: "I suggest we aim for this next. Approve it, or tell me what to change.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: goalOptions(shape, "first"), free_text: true, expires_at: null }, blocks_continue: false, source_event_ids: [], entity_ids: [] },
    });
    const itemId = proposed.item!.id;
    // Its recommended option is free and reversible, and still nobody takes it for the founder.
    const auto = await autoDecideBlocking(t.deps, t.businessId, { chiefOfStaffId: t.chiefId, authority: ["publish_content", "spend_above_threshold", "merge_to_main", "message_customers", "hire_agents", "change_models"], auditAction: "automated_mode.decide", scope: "Automated mode" });
    expect(auto.inboxItemIds).not.toContain(itemId);
    const acts = createHolidayActivities(t.deps);
    const started = t.clock.now();
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 2 * 86_400_000), authority: { decisionTypes: ["publish_content", "spend_above_threshold"] }, wakeEvents: [], startedAt: started });
    const loaded = await acts.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    const decided = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(decided.inboxItemIds).not.toContain(itemId);
    expect(Object.fromEntries(decided.waiting.map((w) => [w.inboxItemId, w.reason]))[itemId]).toBe(GOAL_IS_YOURS);
    expect((await repos.inbox.get(t.db, t.businessId, itemId)).state).toBe("unread");
    expect((await repos.goals.get(t.db, t.businessId, proposed.goal.id))?.status).toBe("proposed");
    await repos.holidays.end(t.db, t.businessId, h.id, { endedAt: t.clock.now() });
  });
});

describe("Ready to start selling?", () => {
  it("is offered once when every task of a roadmap item is done, with the demo task for the researcher; never for a business that sells", async () => {
    const w = await waitingBusiness("Ships Co");
    const researcher = await repos.agents.create(t.db, w.id, { name: "Rhea", agentType: "researcher", layer: "worker", status: "idle" });
    await repos.product.createBlock(t.db, w.id, { section: "Customers", authoredByKind: "agent", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Independent accountants in the Nordics with 20 to 200 clients." }] }] } });
    const item = await repos.product.upsertRoadmapItem(t.db, w.id, { title: "Bank feed import", horizon: "now" });
    const first = await repos.tasks.create(t.db, w.id, { kind: "code", title: "Import transactions", roadmapItemId: item.id, status: "done" });
    const second = await repos.tasks.create(t.db, w.id, { kind: "code", title: "Match transactions", roadmapItemId: item.id, status: "ready" });
    // One task still open: nothing is offered.
    expect(await offerReadyToSellAfterTask(t.deps, w.id, first)).toBeNull();
    await repos.tasks.setStatus(t.db, w.id, second.id, "done", { force: true });
    const offered = await offerReadyToSellAfterTask(t.deps, w.id, second);
    expect(offered).not.toBeNull();
    const note = await repos.inbox.get(t.db, w.id, offered!.inboxItemId);
    expect(note).toMatchObject({ type: "decision", subject: READY_TO_SELL_SUBJECT, blocksContinue: false, fromAgentId: w.chief.id });
    expect(note.bodyMd).toContain("Bank feed import shipped: its 2 tasks are done.");
    expect((note.decision as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["start", "not_yet"]);
    expect((await repos.productSignoffs.latest(t.db, w.id)).readyToSell).toMatchObject({ status: "pending", snapshot: { roadmapItemId: item.id, title: "Bank feed import" } });
    const demo = await repos.tasks.get(t.db, w.id, offered!.demoTaskId!);
    expect(demo).toMatchObject({ kind: "research", status: "ready", assigneeAgentId: researcher.id, roadmapItemId: item.id });
    expect(demo.title).toBe("Record a demo of Bank feed import for Independent accountants in the Nordics with 20 to 200 clients.");
    expect(demo.goalMd).toContain("Nothing is sent to anyone.");
    // Once per business.
    expect(await offerReadyToSellAfterTask(t.deps, w.id, second)).toBeNull();
    // A business that already sells is never asked.
    const sellingItem = await repos.product.upsertRoadmapItem(t.db, t.businessId, { title: "Shipped slice", horizon: "now" });
    const done = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Done work", roadmapItemId: sellingItem.id, status: "done" });
    expect(await offerReadyToSellAfterTask(t.deps, t.businessId, done)).toBeNull();
  });
});
