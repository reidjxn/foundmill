/**
 * The first days are about the product (founder, 2026-10-18), as the orchestrator keeps them: the brief carries the
 * product stage; the cycle planner holds channel work back in code until the business sells; an engine started before
 * the founder's Start distribution stops; a plan's enable_channel defers the engine; vacation and Automated mode never
 * sign off the product; the last task of a roadmap item offers Ready to start selling? once, with the demo task.
 */
import { openApprovalItem, repos, signoffDecisionBlock } from "@foundmill/db";
import { CHANNEL_META, DECISION_TYPES, defaultGoalFor, goalOptions, goalProposalSubject, goalSentence } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { CHANNEL_WAITS_REASON, createCycleActivities, idleSummary } from "../activities/cycle";
import { APPROVAL_IS_YOURS, autoDecideBlocking, createHolidayActivities, GOAL_IS_YOURS, SIGNOFF_IS_YOURS } from "../activities/holiday";
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

describe("the brief and the round of work planner", () => {
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
    expect(idle.summary).toContain("1 channel task waits until you start distribution from Customers › Board");
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

describe("Automated mode and vacation never answer an approval (a spend above the line is the founder's)", () => {
  it("an approval's note for a spend above the line stays open for the founder and its approval stays pending", async () => {
    const w = await waitingBusiness("Spend Line Co");
    await repos.businesses.update(t.db, w.id, { currency: "GBP" });
    const worker = await repos.agents.create(t.db, w.id, { name: "Juno", agentType: "researcher", layer: "worker", status: "idle" });
    // £600.00, above the default approval line (LIMITS.approvalThresholdMinorDefault); its options cost 0 themselves.
    const approval = await repos.approvals.create(t.db, w.id, { agentId: worker.id, connectorKey: "platform", tool: "approve_spend", args: { summary: "Book the trade show stand" }, reasons: ["amount above the approval threshold"], amountMinor: 60_000, currency: "GBP", decisionType: "spend_above_threshold" });
    const { item } = await openApprovalItem(t.db, w.id, approval, { agentId: worker.id, agentName: "Juno", taskTitle: null });
    expect(item.bodyMd).toContain("spending **£600.00**");
    // A note an agent's approval is linked to, whatever its options say, is the founder's too.
    const linked = await repos.inbox.createItem(t.db, w.id, { type: "decision", from_agent_id: worker.id, subject: "Juno asks to publish the post", body_md: "Juno wants to publish the post.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "go", label: "Go", recommended: true, consequence: "It happens", cost_minor: 0, reversible: true }, { id: "wait", label: "Wait", recommended: false, consequence: "Nothing", cost_minor: 0, reversible: true }], free_text: false, expires_at: null }, blocks_continue: true, source_event_ids: [], entity_ids: [] });
    const linkedApproval = await repos.approvals.create(t.db, w.id, { agentId: worker.id, inboxItemId: linked.id, connectorKey: "platform", tool: "publish_post", reasons: ["publishing asks first"] });

    const automated = DECISION_TYPES.filter((d) => d !== "sign_contracts");
    for (const spendCapMinor of [null, 100_000]) {
      const auto = await autoDecideBlocking(t.deps, w.id, { chiefOfStaffId: w.chief.id, authority: automated, auditAction: "automated_mode.decide", scope: "Automated mode", spendCapMinor });
      expect(auto.inboxItemIds).not.toContain(item.id);
      expect(auto.inboxItemIds).not.toContain(linked.id);
      expect(auto.decided).toBe(0);
      expect(auto.queuedGated).toBe(2);
    }
    // Both stay open in the founder's Respond tab (a decision no longer holds Continue, founder 2026-11-07).
    for (const id of [item.id, linked.id]) expect((await repos.inbox.get(t.db, w.id, id)).state).toBe("unread");
    expect((await repos.inbox.list(t.db, w.id, { tab: "respond", limit: 10 })).items.map((i) => i.id).sort()).toEqual([item.id, linked.id].sort());
    for (const id of [approval.id, linkedApproval.id]) expect((await repos.approvals.get(t.db, w.id, id)).outcome).toBeNull();
    expect((await repos.audit.list(t.db, w.id, { action: ["automated_mode.decide"], limit: 5 })).items).toHaveLength(0);

    // Vacation, with every authority it can be given: the same, with the reason the report lists.
    const acts = createHolidayActivities(t.deps);
    const started = t.clock.now();
    const h = await repos.holidays.start(t.db, w.id, { untilAt: new Date(started.getTime() + 2 * 86_400_000), authority: { decisionTypes: automated }, wakeEvents: [], startedAt: started });
    const loaded = await acts.loadHoliday({ businessId: w.id, holidayId: h.id });
    const decided = await acts.holidayAutoDecide({ businessId: w.id, holiday: loaded });
    expect(decided.inboxItemIds).toEqual([]);
    const reasons = Object.fromEntries(decided.waiting.map((x) => [x.inboxItemId, x.reason]));
    expect(reasons[item.id]).toBe(APPROVAL_IS_YOURS);
    expect(reasons[linked.id]).toBe(APPROVAL_IS_YOURS);
    for (const id of [approval.id, linkedApproval.id]) expect((await repos.approvals.get(t.db, w.id, id)).outcome).toBeNull();
    // The report counts each once, as the approval it answers.
    const ended = await acts.endHoliday({ businessId: w.id, holiday: loaded, reason: "founder_returned", wakeEventType: null, cyclesRun: 0 });
    expect(ended.gatedItemsQueued).toBe(2);
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
    // Nothing anyone can open (no site): no demo task (WP-07 T9, A4-18).
    expect(offered!.demoTaskId).toBeNull();
    expect(researcher.id).toBeTruthy();
    // Once per business.
    expect(await offerReadyToSellAfterTask(t.deps, w.id, second)).toBeNull();
    // A business that already sells is never asked.
    const sellingItem = await repos.product.upsertRoadmapItem(t.db, t.businessId, { title: "Shipped slice", horizon: "now" });
    const done = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Done work", roadmapItemId: sellingItem.id, status: "done" });
    expect(await offerReadyToSellAfterTask(t.deps, t.businessId, done)).toBeNull();
  });

  it("asks for a demo of the project's site, at its address, when it has one (WP-07 T9)", async () => {
    const w = await waitingBusiness("Site Co");
    const researcher = await repos.agents.create(t.db, w.id, { name: "Rhea", agentType: "researcher", layer: "worker", status: "idle" });
    const item = await repos.product.upsertRoadmapItem(t.db, w.id, { title: "Offer page", horizon: "now" });
    const done = await repos.tasks.create(t.db, w.id, { kind: "code", title: "Build the offer page", roadmapItemId: item.id, status: "done" });
    await repos.sites.ensure(t.db, w.id, { slug: `site-co-${Date.now().toString(36)}` });
    const release = await repos.sites.saveRelease(t.db, w.id, { files: [{ path: "index.html", sha256: "a".repeat(64), size: 1 }], state: "preview" });
    const offered = await offerReadyToSellAfterTask({ ...t.deps, env: { ...t.deps.env, SITES_DOMAIN: "sites.localhost" } }, w.id, done);
    const demo = await repos.tasks.get(t.db, w.id, offered!.demoTaskId!);
    expect(demo).toMatchObject({ kind: "research", status: "ready", assigneeAgentId: researcher.id, roadmapItemId: item.id });
    expect(demo.goalMd).toContain(`http://p-${release.previewToken}.sites.localhost/`);
    expect(demo.goalMd).toContain("Nothing is sent to anyone.");
  });

  it("on staging the note names only channels that can run, and says what opens first when none can (founder, 2026-11-11)", async () => {
    const staging = { ...t.deps, env: { ...t.deps.env, APP_ENV: "staging" as const, LIVE_CONNECTORS: "" } };
    const shipped = async (name: string) => {
      const w = await waitingBusiness(name);
      const item = await repos.product.upsertRoadmapItem(t.db, w.id, { title: "First slice", horizon: "now" });
      const task = await repos.tasks.create(t.db, w.id, { kind: "code", title: "Build it", roadmapItemId: item.id, status: "done" });
      return { w, task };
    };
    // Social is on the board and is the founder's own to post (tap-to-post, founder 2026-11-12): no engine waits for
    // the product, so it is never named as waiting; it is named as what is ready.
    const none = await shipped("Nothing Runs Co");
    await repos.channels.upsert(t.db, none.w.id, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false });
    const offered = await offerReadyToSellAfterTask(staging, none.w.id, none.task);
    const body = (await repos.inbox.get(t.db, none.w.id, offered!.inboxItemId)).bodyMd;
    expect(body).toContain("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you.");
    expect(body).toContain("Start distribution now so a channel starts the day it opens, or keep building first.");
    expect(body).toContain("Social media is ready now: you post each one with one press.");
    expect(body).not.toContain("are waiting for the product");
    expect(body).not.toMatch(/\bposted\b/);

    // Print in offline tracking runs no weekly engine for a real project (WP-08 T9), so it is not named as waiting.
    const offline = await shipped("Print Runs Co");
    await repos.channels.upsert(t.db, offline.w.id, { channelKey: "print", line: CHANNEL_META.print.line, enabled: true, kitMode: true });
    await repos.channels.upsert(t.db, offline.w.id, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false });
    const second = await offerReadyToSellAfterTask(staging, offline.w.id, offline.task);
    expect((await repos.inbox.get(t.db, offline.w.id, second!.inboxItemId)).bodyMd).not.toContain("(Print) are waiting for the product");
  });
});

describe("a plan never turns on a channel that cannot run (founder, 2026-11-11)", () => {
  it("on staging enable_channel fails with the founder's sentence and the channel stays off, print included", async () => {
    const plans = createPlanActivities({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging", LIVE_CONNECTORS: "" } });
    const w = await waitingBusiness("Plan Refuse Co");
    const plan = await repos.plans.create(t.db, w.id, {
      origin: "option",
      actions: [
        { type: "enable_channel", params: { channel: "affiliate" }, policyOutcome: "allow" },
        { type: "enable_channel", params: { channel: "print" }, policyOutcome: "allow" },
      ],
    });
    const refused = await plans.executePlanAction({ businessId: w.id, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: `plan:${plan.id}` });
    expect(refused.status).toBe("failed");
    expect(refused.result).toMatchObject({ error: "Affiliate is not available yet: the team cannot publish there yet." });
    expect(refused.spawn).toEqual([]);
    expect((await repos.channels.getByKey(t.db, w.id, "affiliate"))?.enabled ?? false).toBe(false);
    // Print no longer starts in offline tracking (WP-08 T9): with no publisher it is refused like any other.
    const print = await plans.executePlanAction({ businessId: w.id, planId: plan.id, actionId: plan.actions[1]!.id, workflowId: `plan:${plan.id}` });
    expect(print.status).toBe("failed");
    expect((await repos.channels.getByKey(t.db, w.id, "print"))?.enabled ?? false).toBe(false);
  });

  it("tap-to-post: on staging a plan may put social on the board, and no engine is recorded or started for it; a budget never puts it there", async () => {
    const plans = createPlanActivities({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging", LIVE_CONNECTORS: "" } });
    const w = await waitingBusiness("Plan Tap Co");
    await repos.businesses.startDistribution(t.db, w.id);
    const plan = await repos.plans.create(t.db, w.id, {
      origin: "option",
      actions: [
        { type: "set_budget", params: { channel: "social", amount_minor: 5_000 }, policyOutcome: "allow" },
        { type: "enable_channel", params: { channel: "social" }, policyOutcome: "allow" },
      ],
    });
    // A budget creates the row and leaves it off the board: there is nothing for the team to spend it on there.
    const budget = await plans.executePlanAction({ businessId: w.id, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: `plan:${plan.id}` });
    expect(budget.status).not.toBe("failed");
    expect((await repos.channels.getByKey(t.db, w.id, "social"))?.enabled).toBe(false);
    // Turning it on puts it on the board. No engine: the result says who posts, and nothing is spawned or recorded.
    const enabled = await plans.executePlanAction({ businessId: w.id, planId: plan.id, actionId: plan.actions[1]!.id, workflowId: `plan:${plan.id}` });
    expect(enabled.status).not.toBe("failed");
    expect(enabled.result).toMatchObject({ enabled: true, deferred: "the founder posts this channel with one press on each draft; no engine runs for it" });
    expect(enabled.spawn).toEqual([]);
    expect(await repos.channels.getByKey(t.db, w.id, "social")).toMatchObject({ enabled: true, kitMode: false, engineWorkflowId: null });
  });
});
