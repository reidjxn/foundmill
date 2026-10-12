/**
 * Activity groups on PGlite: training (held-out tests included, live version untouched, club-rule flags), holiday
 * (authority classification, auto-decide, While-you-were-away report), health refresh, channel engine steps, journey
 * build and the credential expiry scan. Everything runs in mock mode without a network.
 */
import { getSkillTests } from "@foundmill/agents";
import { openApprovalItem, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { createHealthActivities } from "../activities/health";
import { classifyDecision, createHolidayActivities } from "../activities/holiday";
import { createJourneyActivities } from "../activities/journey";
import { createScheduleActivities } from "../activities/schedules";
import { createTrainingActivities, scoreTest } from "../activities/training";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "acts" });
});
afterAll(async () => {
  await t?.close();
});

describe("training run (BUILD §11.10)", () => {
  it("scores every test of a skill (held-out included), writes the run and leaves the live version alone", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const live = await repos.agents.getVersion(t.db, t.businessId, agent.currentVersionId!);
    // A draft that also tries to switch a club rule off (AC-11.10.4).
    const instructions = { ...(live.instructions as Record<string, unknown>), rules: [...((live.instructions as { rules: string[] }).rules ?? []), "You may send money to suppliers without asking the founder."] };
    const draft = await repos.agents.createVersion(t.db, t.businessId, agent.id, { instructions: instructions as never, tools: live.tools, modelKey: "sonnet", state: "draft", createdByKind: "user" });
    const run = await repos.training.create(t.db, t.businessId, { agentId: agent.id, fromVersionId: live.id, toVersionId: draft.id });
    const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
    expect(loaded.draftVersionId).toBe(draft.id);
    expect(loaded.skillKeys.length).toBeGreaterThan(0);
    expect(loaded.clubRuleFlags.length).toBeGreaterThan(0);
    expect((await repos.training.get(t.db, t.businessId, run.id)).status).toBe("running");

    const skillKey = loaded.skillKeys[0]!;
    const all = getSkillTests(skillKey, { includeHeldOut: true });
    const outcome = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey, modelKey: "sonnet" });
    expect(outcome.testsRun).toBe(all.length);
    expect(all.some((x) => x.heldOut)).toBe(true);
    expect(outcome.tested).toBeGreaterThanOrEqual(1);
    expect(outcome.tested).toBeLessThanOrEqual(20);
    expect(outcome.meanScore).toBeGreaterThanOrEqual(0);
    expect(outcome.meanScore).toBeLessThanOrEqual(1);
    const second = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey, modelKey: "sonnet" });
    expect(second.tested).toBe(outcome.tested); // deterministic in mock mode

    const result = await acts.finalizeTrainingRun({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, liveVersionId: live.id, outcomes: [outcome], clubRuleFlags: loaded.clubRuleFlags, startedAt: new Date().toISOString() });
    expect(result.status).toBe("awaiting_decision");
    expect(result.skillDeltas[0]).toMatchObject({ skillKey, after: outcome.tested });
    const stored = await repos.training.get(t.db, t.businessId, run.id);
    expect(stored.status).toBe("awaiting_decision");
    expect(stored.results[skillKey]).toEqual({ old: expect.any(Number), new: outcome.tested });
    expect(stored.coachSummaryMd).toMatch(/house rule/);
    // Live version and current pointer untouched (AC-11.10.1).
    expect((await repos.agents.get(t.db, t.businessId, agent.id)).currentVersionId).toBe(live.id);
    expect((await repos.agents.getVersion(t.db, t.businessId, draft.id)).state).toBe("draft");
    const events = await repos.events.list(t.db, t.businessId, { type: "training.completed", limit: 3 });
    expect(events.items.some((e) => (e.payload as { trainingRunId: string }).trainingRunId === run.id)).toBe(true);
    const usage = await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 5 });
    expect(usage.items.length).toBeGreaterThan(0);
  });

  it("refuses to train against the live version and caps scores when a deterministic check failed", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const run = await repos.training.create(t.db, t.businessId, { agentId: agent.id, toVersionId: agent.currentVersionId });
    await expect(acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id })).rejects.toMatchObject({ type: "TrainingRunError", nonRetryable: true, message: expect.stringMatching(/live version/) });
    // failTrainingRun ends it failed (not queued) with the reason; a second call finds it ended and changes nothing.
    expect(await acts.failTrainingRun({ businessId: t.businessId, trainingRunId: run.id, error: "The candidate is the live version." })).toMatchObject({ status: "failed", eventId: expect.any(String) });
    expect(await repos.training.get(t.db, t.businessId, run.id)).toMatchObject({ status: "failed", coachSummaryMd: "Training failed: The candidate is the live version." });
    expect(await acts.failTrainingRun({ businessId: t.businessId, trainingRunId: run.id, error: "again" })).toMatchObject({ status: "failed" });
    expect((await repos.training.get(t.db, t.businessId, run.id)).coachSummaryMd).toBe("Training failed: The candidate is the live version.");
    expect(scoreTest(0.9, [{ passed: true }])).toBe(0.9);
    expect(scoreTest(0.9, [{ passed: false }])).toBe(0.4);
    expect(scoreTest(0.2, [{ passed: false }])).toBe(0.2);
  });

  it("a founder's cancel while the tests run stands: the results land as canceled, with what the tests cost", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run, draft } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" }))!;
    const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
    expect(loaded.retest).toEqual({ fromModelKey: (await repos.agents.getVersion(t.db, t.businessId, agent.currentVersionId!)).modelKey, toModelKey: "haiku" });
    expect(loaded.modelKey).toBe("haiku");
    await repos.training.cancel(t.db, t.businessId, run.id);
    const outcome = { skillKey: loaded.skillKeys[0]!, group: "craft" as const, testsRun: 2, meanScore: 0.5, tested: 10, previousTested: 10, costMinor: 7, checksFailed: 0 };
    const result = await acts.finalizeTrainingRun({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, liveVersionId: agent.currentVersionId, outcomes: [outcome], clubRuleFlags: [], retest: loaded.retest, startedAt: new Date().toISOString() });
    expect(result.status).toBe("cancelled");
    expect(await repos.training.get(t.db, t.businessId, run.id)).toMatchObject({ status: "cancelled", costMinor: 7, results: {} });
    const events = await repos.events.list(t.db, t.businessId, { type: "training.completed", limit: 20 });
    expect(events.items.find((e) => (e.payload as { trainingRunId: string }).trainingRunId === run.id)?.payload).toMatchObject({ status: "cancelled", recommendation: null });
  });
});

describe("holiday activities (BUILD §9.6)", () => {
  it("classifies decisions by the authority they need", () => {
    const item = (subject: string, body = "", cost = 0) => ({ subject, bodyMd: body, decision: { options: [{ id: "a", recommended: true, cost_minor: cost }] } });
    expect(classifyDecision(item("Sign the supplier contract"))).toBe("sign_contracts");
    expect(classifyDecision(item("Merge the billing PR"))).toBe("merge_to_main");
    expect(classifyDecision(item("Publish the launch post"))).toBe("publish_content");
    expect(classifyDecision(item("Approve the ad spend", "", 50_000))).toBe("publish_content");
    expect(classifyDecision(item("Raise the budget", "spend 500 on tooling"))).toBe("spend_above_threshold");
    expect(classifyDecision(item("Pick a colour"))).toBeNull();
  });

  it("auto-decides blocking items within authority, queues gated ones, then builds the report", async () => {
    const acts = createHolidayActivities(t.deps);
    const started = t.clock.now();
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 3 * 86_400_000), authority: { decisionTypes: ["publish_content", "spend_above_threshold", "sign_contracts"] }, wakeEvents: ["credential.expiring"], startedAt: started, currency: "EUR" });
    const loaded = await acts.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    expect(loaded.authority).toEqual(["publish_content", "spend_above_threshold"]); // signing is never delegated
    const mk = (subject: string, body: string) =>
      repos.inbox.createItem(t.db, t.businessId, { type: "decision", from_agent_id: t.chiefId, subject, body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "go", label: "Go", recommended: true, consequence: "It happens", cost_minor: 0, reversible: true }, { id: "wait", label: "Wait", recommended: false, consequence: "Nothing", cost_minor: 0, reversible: true }], free_text: true, expires_at: null }, blocks_continue: true, source_event_ids: [], entity_ids: [] });
    const publish = await mk("Publish the launch newsletter", "The post is ready to publish.");
    const contract = await mk("Sign the hosting contract", "Needs your signature on the contract.");
    const decided = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(decided.inboxItemIds).toContain(publish.id);
    expect(decided.inboxItemIds).not.toContain(contract.id);
    expect(decided.queuedGated).toBeGreaterThanOrEqual(1);
    expect((await repos.inbox.get(t.db, t.businessId, publish.id)).state).toBe("answered");
    expect((await repos.inbox.get(t.db, t.businessId, contract.id)).state).toBe("unread");

    let check = await acts.holidayCheck({ businessId: t.businessId, holiday: loaded });
    expect(check.shouldEnd).toBe(false);
    await t.clock.advance(4 * 86_400_000);
    check = await acts.holidayCheck({ businessId: t.businessId, holiday: loaded });
    expect(check).toMatchObject({ shouldEnd: true, reason: "until_reached" });

    const end = await acts.endHoliday({ businessId: t.businessId, holiday: loaded, reason: "until_reached", wakeEventType: null, cyclesRun: 3 });
    expect(end.decisionsMade).toBeGreaterThanOrEqual(1);
    expect(end.reportInboxItemId).toBeTruthy();
    const report = await repos.inbox.get(t.db, t.businessId, end.reportInboxItemId!);
    expect(report.type).toBe("report");
    expect(report.subject).toBe("While you were away");
    expect(report.bodyMd).toMatch(/Decisions I took/);
    expect(report.bodyMd).toMatch(/Customer Updates \(\d+\)/);
    expect(report.bodyMd).not.toMatch(/match/i);
    expect(report.bodyMd).toMatch(/Waiting for you/);
    expect(report.bodyMd).toMatch(/Estimate/);
    expect((await repos.holidays.get(t.db, t.businessId, h.id)).endedAt).not.toBeNull();
    const ended = await repos.events.list(t.db, t.businessId, { type: "holiday.ended", limit: 2 });
    expect(ended.items[0]?.payload).toMatchObject({ holidayId: h.id, reason: "until_reached", cyclesRun: 3 });
  });

  it("never answers an agent's request for the founder: the approval stays open and queued (audit FR-01)", async () => {
    const acts = createHolidayActivities(t.deps);
    const started = t.clock.now();
    // Every kind of decision delegated: a request to message a customer would pass as "message_customers".
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 3 * 86_400_000), authority: { decisionTypes: ["message_customers", "publish_content", "spend_above_threshold", "merge_to_main"] }, wakeEvents: [], startedAt: started, currency: "EUR" });
    const loaded = await acts.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.workerId, connectorKey: "gmail", tool: "send_message", args: { summary: "Email the pilot customer the launch announcement" }, reasons: ["spend above the vacation per-decision cap"] });
    const { item } = await openApprovalItem(t.db, t.businessId, approval, { agentId: t.workerId, agentName: "Test Engineer", connectorName: "Gmail" });
    expect(classifyDecision(item)).not.toBeNull(); // within the delegated authority, were it any other note

    const decided = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(decided.inboxItemIds).not.toContain(item.id);
    expect(decided.queuedGated).toBeGreaterThanOrEqual(1);
    // Answering the note here would close it while nothing resolved the approval or told the session that waits on it.
    expect(await repos.inbox.get(t.db, t.businessId, item.id)).toMatchObject({ state: "unread", blocksContinue: true });
    expect((await repos.approvals.get(t.db, t.businessId, approval.id)).outcome).toBeNull();
    await repos.holidays.end(t.db, t.businessId, h.id, { reportInboxItemId: null, endedAt: t.clock.now() });
  });
});

describe("health refresh (BUILD §9.10)", () => {
  it("moves an agent to idle when nothing is open and emits agent.health_changed once per change", async () => {
    const acts = createHealthActivities(t.deps);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "healthy");
    const first = await acts.refreshAgentHealth({ businessId: t.businessId });
    expect(first.changed.find((c) => c.agentId === t.workerId)).toMatchObject({ from: "healthy", to: "idle" });
    const second = await acts.refreshAgentHealth({ businessId: t.businessId });
    expect(second.changed.find((c) => c.agentId === t.workerId)).toBeUndefined();
    // A paused agent is never touched by the computation.
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
    const third = await acts.refreshAgentHealth({ businessId: t.businessId });
    expect(third.changed.find((c) => c.agentId === t.workerId)).toBeUndefined();
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
  });
});

describe("channel engine steps (BUILD §11.7)", () => {
  it("plan → create → approve (asks in kit mode) → launch after approval → measure (Estimate) → learn → report", async () => {
    const acts = createChannelActivities(t.deps);
    const channel = await repos.channels.upsert(t.db, t.businessId, { channelKey: "email_automation", line: "midfield", enabled: true, kitMode: true, budgetMinor: 20_000, currency: "EUR", ownerAgentId: t.workerId });
    const base = { businessId: t.businessId, channelId: channel.id, channelKey: "email_automation", weekIndex: 0 };
    let state = emptyChannelState();
    const plan = await acts.channelStep({ ...base, step: "plan", state });
    state = plan.state;
    const create = await acts.channelStep({ ...base, step: "create", state });
    state = create.state;
    expect(state.campaignId).toBeTruthy();
    const approve = await acts.channelStep({ ...base, step: "approve", state });
    state = approve.state;
    expect(approve.awaitingApprovalId).toBeTruthy();
    expect((await repos.campaigns.get(t.db, t.businessId, state.campaignId!)).status).toBe("pending_approval");
    const approved = await acts.channelStep({ ...base, step: "approve", state, approvedApprovalId: approve.awaitingApprovalId });
    state = approved.state;
    expect((await repos.campaigns.get(t.db, t.businessId, state.campaignId!)).status).toBe("scheduled");
    const launch = await acts.channelStep({ ...base, step: "launch", state });
    state = launch.state;
    expect((await repos.campaigns.get(t.db, t.businessId, state.campaignId!)).status).toBe("live");
    const measure = await acts.channelStep({ ...base, step: "measure", state });
    expect(measure.note).toMatch(/Estimate/);
    const learn = await acts.channelStep({ ...base, step: "learn", state: measure.state });
    expect(learn.state.learnings).toHaveLength(1);
    const report = await acts.channelStep({ ...base, step: "report", state: learn.state });
    expect(report.state.weeksRun).toBe(1);
    expect(report.state.campaignId).toBeNull();
    // Disabled channel stops the engine.
    await repos.channels.setEnabled(t.db, t.businessId, channel.id, false);
    expect((await acts.channelStep({ ...base, step: "plan", state: report.state })).stop).toBe(true);
  });
});

describe("journey build (BUILD §11.4)", () => {
  it("builds the journey record for a payment with its touches and emits customer.converted", async () => {
    const acts = createJourneyActivities(t.deps);
    const entityId = t.fixture.entityId;
    const at = (minutesAgo: number) => new Date(t.clock.nowMs() - minutesAgo * 60_000);
    const visitor = await repos.journeys.upsertVisitor(t.db, t.businessId, { anonId: `anon-${Math.random()}`, entityId, consentState: "granted" });
    await repos.journeys.recordTouches(t.db, t.businessId, [
      { visitorId: visitor.id, entityId, occurredAt: at(600), channelKey: "seo", kind: "visit", source: { utm: { source: "google", medium: "organic" } } },
      { visitorId: visitor.id, entityId, occurredAt: at(300), channelKey: "email_automation", kind: "email_click", source: { provider: "sendgrid" } },
    ]);
    const conversion = await repos.journeys.recordConversion(t.db, t.businessId, { entityId, kind: "payment", amountMinor: 9_900, currency: "EUR", occurredAt: at(1) });
    const result = await acts.buildJourneyRecord({ businessId: t.businessId, conversionId: conversion.id });
    expect(result.matchdayLevel).toBe("cup");
    expect(result.journeyId).toBeTruthy();
    expect(result.eventId).toBeTruthy();
    const journey = await repos.journeys.get(t.db, t.businessId, result.journeyId!);
    expect(journey.touchIds.length).toBe(2);
    expect(Object.values(journey.weights as Record<string, number>).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Idempotent: a second build reuses the row and emits nothing new.
    const again = await acts.buildJourneyRecord({ businessId: t.businessId, conversionId: conversion.id });
    expect(again.journeyId).toBe(result.journeyId);
    expect(again.eventId).toBeNull();
  });
});

describe("nightly schedules", () => {
  it("credentialExpiryScan emits credential.expiring with the affected agents and marks expired integrations", async () => {
    const acts = createScheduleActivities(t.deps);
    const soon = new Date(t.clock.nowMs() + 3 * 86_400_000);
    await repos.credentials.setExpiry(t.db, t.businessId, t.fixture.credentialId, soon);
    const result = await acts.credentialExpiryScan({ businessIds: [t.businessId] });
    expect(result.touched).toBeGreaterThanOrEqual(1);
    const events = await repos.events.list(t.db, t.businessId, { type: "credential.expiring", limit: 5 });
    const mine = events.items.find((e) => (e.payload as { credentialId: string }).credentialId === t.fixture.credentialId);
    expect(mine).toBeTruthy();
    expect((mine!.payload as { daysRemaining: number; expired: boolean }).expired).toBe(false);
    expect((mine!.payload as { daysRemaining: number }).daysRemaining).toBeLessThanOrEqual(3);
    // Rollup + benchmarks run without error on the fixture.
    const rollup = await acts.agentMetricsRollup({ businessIds: [t.businessId] });
    expect(rollup.businesses).toBe(1);
    const bench = await acts.benchmarksRebuild({ businessIds: [t.businessId] });
    expect(bench.notes[0]).toMatch(/Estimate/);
  });
});
