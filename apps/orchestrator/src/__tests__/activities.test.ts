/**
 * Activity groups on PGlite: training (held-out tests included, live version untouched, club-rule flags), holiday
 * (authority classification, decisions run as plans, what waits for the founder, While-you-were-away report), health
 * refresh, channel engine steps, journey
 * build and the credential expiry scan. Everything runs in mock mode without a network.
 */
import { getSkillTests } from "@foundmill/agents";
import { openApprovalItem, periodOf, repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { createModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { createCycleActivities } from "../activities/cycle";
import { ComposerRequestError, ComposerUnavailableError, createComposerClient } from "../composer-client";
import { createHealthActivities } from "../activities/health";
import { AWAITING_GO_AHEAD, classifyDecision, createHolidayActivities, vacationVerdict, type VacationContext } from "../activities/holiday";
import { createJourneyActivities } from "../activities/journey";
import { createPlanActivities } from "../activities/plan";
import { createScheduleActivities } from "../activities/schedules";
import { createTrainingActivities, scoreTest } from "../activities/training";
import { usageSink } from "../deps";
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
    // The calls are booked once by the model client; the training row counts tests and never books their cost again
    // (nor in a currency of its own).
    for (const u of usage.items) expect({ cost: Number(u.costMinor), currency: u.currency }).toEqual({ cost: 0, currency: "USD" });
    const completed = events.items.find((e) => (e.payload as { trainingRunId: string }).trainingRunId === run.id)!;
    expect((completed.payload as { cost: { currency: string } }).cost.currency).toBe("USD");
  });

  it("books each model call once: the run's own row is a count of tests at no cost (O-19, BILL-10)", async () => {
    // The mock client metered like the live one: every answer and grader call reaches the ledger through the usage sink.
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const metered = { ...t.deps, models: createModelClient({ mode: "mock", onUsage: usageSink(t.db, log as never) }) };
    const acts = createTrainingActivities(metered);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const live = await repos.agents.getVersion(t.db, t.businessId, agent.currentVersionId!);
    const draft = await repos.agents.createVersion(t.db, t.businessId, agent.id, { instructions: live.instructions as never, tools: live.tools, modelKey: "opus", state: "draft", createdByKind: "user" });
    const run = await repos.training.create(t.db, t.businessId, { agentId: agent.id, fromVersionId: live.id, toVersionId: draft.id });
    const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
    const seen = new Set((await repos.usage.list(t.db, t.businessId, { agentId: agent.id, limit: 500 })).items.map((u) => u.id));
    const outcome = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey: loaded.skillKeys[0]!, modelKey: "opus" });
    const rows = (await repos.usage.list(t.db, t.businessId, { agentId: agent.id, limit: 500 })).items.filter((u) => !seen.has(u.id));
    const calls = rows.filter((u) => u.kind === "tokens" && ["training", "skill_grader"].includes((u.details as { kind?: string }).kind ?? ""));
    expect(calls.length).toBe(outcome.testsRun * 2);
    const summary = rows.filter((u) => u.kind === "training");
    expect(summary).toHaveLength(1);
    // The marker says how many tests, costs nothing, and is in US dollars (not the column default EUR).
    expect(summary[0]).toMatchObject({ quantity: outcome.testsRun, unit: "tests", currency: "USD", billedTo: "credits" });
    expect(Number(summary[0]!.costMinor)).toBe(0);
    expect(Number(summary[0]!.costMicroMinor)).toBe(0);
    // What the ledger holds for the run is the calls' exact cost, once; the run reports the same figure.
    const micro = rows.reduce((a, u) => a + Number(u.costMicroMinor), 0);
    expect(micro).toBeGreaterThan(0);
    expect(outcome.costMicroMinor).toBe(micro);
    expect(outcome.costMinor).toBe(Math.round(micro / 1_000_000));
    // Payroll's training column is those calls: part of the cost, not on top of it.
    const wage = (await repos.usage.wages(t.db, t.businessId, periodOf(new Date()))).find((w) => w.agentId === agent.id);
    expect(wage?.trainingMinor).toBeGreaterThan(0);
    expect(wage?.trainingMinor).toBeLessThanOrEqual(wage?.costMinor ?? 0);
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
    const { run, draft } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
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

  it("failing a run whose results already landed changes nothing and reports them", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
    await repos.training.transition(t.db, t.businessId, run.id, ["queued"], { status: "awaiting_decision", coachSummaryMd: "Results.", endedAt: new Date() });
    expect(await acts.failTrainingRun({ businessId: t.businessId, trainingRunId: run.id, error: "late" })).toMatchObject({ status: "awaiting_decision", eventId: null });
    expect(await repos.training.get(t.db, t.businessId, run.id)).toMatchObject({ status: "awaiting_decision", coachSummaryMd: "Results." });
  });
});

describe("training honours the team-wide stop (SEC3)", () => {
  it("a run that loads while the team is stopped ends canceled with the reason before anything is spent", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
    const usageBefore = (await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items.length;
    await stopBusinessAgents(t.db, t.businessId, { reason: "credits_exhausted" });
    try {
      await expect(acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id })).rejects.toMatchObject({ type: "TrainingRunError", nonRetryable: true, message: expect.stringMatching(/credits ran out/) });
      expect(await repos.training.get(t.db, t.businessId, run.id)).toMatchObject({ status: "cancelled", coachSummaryMd: "Training canceled: the credits ran out. Train again once the agents resume." });
      // The workflow's failTrainingRun then finds it ended and leaves it canceled.
      expect(await acts.failTrainingRun({ businessId: t.businessId, trainingRunId: run.id, error: "x" })).toMatchObject({ status: "cancelled" });
      expect((await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items.length).toBe(usageBefore);
    } finally {
      await resumeBusinessAgents(t.db, t.businessId);
    }
  });

  it("a stop while a skill's tests run: no further test starts, the run ends canceled, the tests that ran are booked, the next skill runs none", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    let answers = 0;
    // Stop all agents lands as soon as the first model answer is back (no signal reaches the activity).
    const models = new Proxy(t.deps.models, {
      get(target, prop, receiver) {
        if (prop !== "complete") return Reflect.get(target, prop, receiver);
        return async (...args: Parameters<typeof target.complete>) => {
          const result = await target.complete(...args);
          if (++answers === 1) await stopBusinessAgents(t.db, t.businessId, { reason: "kill_switch" });
          return result;
        };
      },
    });
    const acts = createTrainingActivities({ ...t.deps, models });
    const { run, draft } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "opus" })).retest!;
    const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
    const sized = loaded.skillKeys.map((skillKey) => ({ skillKey, tests: getSkillTests(skillKey, { includeHeldOut: true }).length })).sort((a, b) => b.tests - a.tests);
    const [big, next] = sized;
    // Four tests run at once, so a skill with more than four shows the stop.
    expect(big!.tests).toBeGreaterThan(4);
    const usageBefore = (await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items;
    try {
      const outcome = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey: big!.skillKey, modelKey: "opus" });
      expect(outcome.testsRun).toBeGreaterThan(0);
      expect(outcome.testsRun).toBeLessThan(big!.tests);
      expect(await repos.training.get(t.db, t.businessId, run.id)).toMatchObject({ status: "cancelled", coachSummaryMd: expect.stringMatching(/^Training canceled: Stop all agents\./) });
      const usage = (await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items.filter((u) => !usageBefore.some((b) => b.id === u.id));
      expect(usage).toHaveLength(1);
      expect(Number(usage[0]!.quantity)).toBe(outcome.testsRun);

      const calls = answers;
      const rest = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey: (next ?? big)!.skillKey, modelKey: "opus" });
      expect(rest.testsRun).toBe(0);
      expect(answers).toBe(calls);

      // The agents resume before the workflow's last skills run (a credits stop signals nothing): the run stays
      // canceled and spends nothing more.
      await resumeBusinessAgents(t.db, t.businessId);
      const afterResume = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey: big!.skillKey, modelKey: "opus" });
      expect(afterResume.testsRun).toBe(0);
      expect(answers).toBe(calls);
      expect((await repos.training.get(t.db, t.businessId, run.id)).status).toBe("cancelled");
    } finally {
      await resumeBusinessAgents(t.db, t.businessId);
    }
  });

  it("a founder's cancel whose signal never arrived: the next skill starts no test and books nothing", async () => {
    const acts = createTrainingActivities(t.deps);
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run, draft } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
    const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
    await repos.training.cancel(t.db, t.businessId, run.id);
    const usageBefore = (await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items.length;
    const outcome = await acts.runSkillTests({ businessId: t.businessId, trainingRunId: run.id, agentId: agent.id, draftVersionId: draft.id, skillKey: loaded.skillKeys[0]!, modelKey: "sonnet" });
    expect(outcome).toMatchObject({ testsRun: 0, costMinor: 0 });
    expect((await repos.usage.list(t.db, t.businessId, { agentId: agent.id, kind: "training", limit: 200 })).items.length).toBe(usageBefore);
    expect((await repos.training.get(t.db, t.businessId, run.id)).status).toBe("cancelled");
  });
});

describe("cycle narration", () => {
  it("a cycle in which nothing finished still ends with a Chief of Staff note, in staging too, without asking the composer", async () => {
    const narrated: string[][] = [];
    const composer = { ...t.deps.composer, narrate: async (input: { eventIds: string[] }) => {
      narrated.push(input.eventIds);
      throw new ComposerUnavailableError("Composer /v1/narrate returned 503");
    } } as typeof t.deps.composer;
    const acts = createCycleActivities({ ...t.deps, composer, env: { ...t.deps.env, APP_ENV: "staging" } });
    const summary = "Plan: ship the pricing page.\n\nCycle 3: 0 sessions dispatched, 0 finished, 0 blocked; 2 tasks deferred.";
    const out = await acts.narrateCycle({ businessId: t.businessId, eventIds: [], summary, fallbackSubject: "Cycle 3 completed" });
    expect(narrated).toEqual([]);
    expect(out.viaComposer).toBe(false);
    expect(out.inboxItemIds).toHaveLength(1);
    const item = await repos.inbox.get(t.db, t.businessId, out.inboxItemIds[0]!);
    expect(item).toMatchObject({ type: "update", subject: "Cycle 3 completed", fromAgentId: t.chiefId });
    expect(item.bodyMd).toContain("2 tasks deferred");
    expect(item.bodyMd).not.toMatch(/service unavailable/);
    // With events to narrate, staging still surfaces a composer outage (the workflow retries it).
    await expect(acts.narrateCycle({ businessId: t.businessId, eventIds: ["00000000-0000-0000-0000-000000000001"], summary })).rejects.toThrow(ComposerUnavailableError);
  });

  it("a request the composer refuses (4xx) is not retried: the plain note goes out in staging too and the events count as narrated", async () => {
    const ev = await repos.events.write(t.db, t.businessId, { type: "task.completed", actor: { kind: "system", id: "test" }, payload: { probe: "narrate-refused" } });
    const composer = { ...t.deps.composer, narrate: async () => {
      throw new ComposerRequestError("validation", "Composer /v1/narrate returned 400", 400);
    } } as typeof t.deps.composer;
    const acts = createCycleActivities({ ...t.deps, composer, env: { ...t.deps.env, APP_ENV: "staging" } });
    const out = await acts.narrateCycle({ businessId: t.businessId, eventIds: [ev.id], summary: "Cycle 4: 1 session dispatched, 1 finished, 0 blocked.", fallbackSubject: "Cycle 4 completed" });
    expect(out).toMatchObject({ viaComposer: false, inboxItemIds: [expect.any(String)] });
    const item = await repos.inbox.get(t.db, t.businessId, out.inboxItemIds[0]!);
    expect(item).toMatchObject({ subject: "Cycle 4 completed", sourceEventIds: [ev.id] });
    expect(item.bodyMd).toMatch(/without the Inbox Composer/);
    expect((await repos.events.get(t.db, t.businessId, ev.id)).narrated).toBe(true);
  });

  it("the composer client tells a refusal (4xx) from an outage (5xx, timeouts, rate limits)", async () => {
    const answering = (status: number) => createComposerClient({ baseUrl: "http://composer.test", fetch: (async () => new Response(JSON.stringify({ error: "x" }), { status })) as typeof fetch });
    await expect(answering(400).narrate({ businessId: t.businessId, eventIds: [] })).rejects.toBeInstanceOf(ComposerRequestError);
    await expect(answering(404).narrate({ businessId: t.businessId, eventIds: [] })).rejects.toMatchObject({ status: 404 });
    for (const status of [409, 429, 503]) {
      const err = await answering(status).narrate({ businessId: t.businessId, eventIds: [] }).catch((e: unknown) => e);
      expect(err, String(status)).toBeInstanceOf(ComposerUnavailableError);
      expect(err, String(status)).not.toBeInstanceOf(ComposerRequestError);
    }
    // A body that is not JSON (a proxy's HTML page) does not change the verdict: a 4xx is still a refusal, a 5xx an outage.
    const html = (status: number) => createComposerClient({ baseUrl: "http://composer.test", fetch: (async () => new Response("<html>nope</html>", { status })) as typeof fetch });
    await expect(html(404).narrate({ businessId: t.businessId, eventIds: [] })).rejects.toBeInstanceOf(ComposerRequestError);
    const outage = await html(502).narrate({ businessId: t.businessId, eventIds: [] }).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(ComposerUnavailableError);
    expect(outage).not.toBeInstanceOf(ComposerRequestError);
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

  it("a vacation decision walks the founder's plan path: authority, the compiled plan, hard gates, money, policy, section walls", async () => {
    const agents = (await repos.agents.list(t.db, t.businessId, { limit: 200 })).items;
    const ctx: VacationContext = { business: { id: t.businessId, businessMode: "automated" }, agents, chiefOfStaffId: t.chiefId, authority: new Set(["publish_content", "hire_agents"]), actsFor: { role: "owner", sectionPermissions: {} }, currency: "USD" };
    const item = (subject: string, label: string, extra: Record<string, unknown> = {}) => ({ subject, bodyMd: "", fromAgentId: t.chiefId, decision: { options: [{ id: "a", label, recommended: true, cost_minor: 0, reversible: true, ...extra }, { id: "b", label: "Not now", recommended: false, cost_minor: 0, reversible: true }] } });
    const decided = vacationVerdict(item("Publish the launch post", "Go"), ctx);
    expect(decided).toMatchObject({ kind: "decide", option: { id: "a" }, decisionType: "publish_content" });
    // The same rules as the founder's option click: the agent who asked carries the choice out.
    expect(decided.kind === "decide" && decided.actions.map((a) => [a.action.type, a.action.agent_id, a.verdict.outcome])).toEqual([["create_task", t.chiefId, "allow"]]);
    expect(vacationVerdict(item("Sign the hosting contract", "Go"), ctx)).toEqual({ kind: "wait", reason: "signing is always yours" });
    expect(vacationVerdict(item("Merge the billing PR", "Go"), ctx)).toEqual({ kind: "wait", reason: "it is outside the authority you gave" });
    expect(vacationVerdict(item("Pick a color", "Go", { reversible: false }), ctx)).toEqual({ kind: "wait", reason: "the recommended option is not free and reversible" });
    // Money and hard gates are the founder's, whatever authority was given.
    expect(vacationVerdict(item("Publish the launch post", "Go", { cost_minor: 5_000 }), ctx)).toEqual({ kind: "wait", reason: "it costs money ($50.00)" });
    expect(vacationVerdict(item("Publish the launch ads", "Set the paid ads budget to $300"), ctx)).toEqual({ kind: "wait", reason: "it moves money (a budget)" });
    expect(vacationVerdict(item("Publish the launch post", "Pay the supplier invoice"), ctx)).toEqual({ kind: "wait", reason: "only you can do what it needs (a hard gate)" });
    // Never more than the person who handed over could do themselves (their section walls).
    const walled = { ...ctx, actsFor: { role: "admin" as const, sectionPermissions: { distribution: "read" as const } } };
    expect(vacationVerdict(item("Publish the launch ads", "Turn on LinkedIn ads"), walled)).toEqual({ kind: "wait", reason: "it changes Distribution, which the person who started the vacation cannot change" });
    expect(vacationVerdict(item("Publish the launch ads", "Turn on LinkedIn ads"), ctx)).toMatchObject({ kind: "decide" });
    expect(vacationVerdict(item("Publish the launch post", "Go"), { ...ctx, chiefOfStaffId: null })).toEqual({ kind: "wait", reason: "there is no Chief of Staff to decide it" });
    expect(vacationVerdict({ ...item("Publish the launch post", "Go"), decision: null }, ctx)).toEqual({ kind: "wait", reason: "it has no option to choose" });
    // An agent's gated call the policy asked about is answered by the founder's approval, never by an option plan.
    const approval = { subject: "Juno asks to run Publish post", bodyMd: "Juno wants to run **Publish post**.", fromAgentId: t.chiefId, decision: { options: [{ id: "approve_request", label: "Approve", recommended: true, cost_minor: 0, reversible: false }, { id: "reject_request", label: "Reject", recommended: false, cost_minor: 0, reversible: true }] } };
    expect(vacationVerdict(approval, ctx)).toEqual({ kind: "wait", reason: "an agent's call waits for your approval" });
  });

  it("decisions taken on vacation run as plans; money, signing and the founder's go-ahead wait; the stop flag wins; the report says which", async () => {
    const acts = createHolidayActivities(t.deps);
    const plans = createPlanActivities(t.deps);
    const started = t.clock.now();
    // A vacation without a budget ceiling is in the business's own currency (0025), never a fixed one.
    await repos.businesses.update(t.db, t.businessId, { currency: "GBP" });
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 3 * 86_400_000), authority: { decisionTypes: ["publish_content", "spend_above_threshold", "sign_contracts"] }, wakeEvents: ["credential.expiring"], startedAt: started });
    await repos.businesses.update(t.db, t.businessId, { currency: "USD" });
    const loaded = await acts.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    expect(loaded.currency).toBe("GBP");
    expect(loaded.authority).toEqual(["publish_content", "spend_above_threshold"]); // signing is never delegated
    const go = { id: "go", label: "Go", recommended: true, consequence: "It happens", cost_minor: 0, reversible: true };
    const wait = { id: "wait", label: "Wait", recommended: false, consequence: "Nothing", cost_minor: 0, reversible: true };
    const mk = (subject: string, body: string, options: (typeof go)[] = [go, wait]) =>
      repos.inbox.createItem(t.db, t.businessId, { type: "decision", from_agent_id: t.chiefId, subject, body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options, free_text: true, expires_at: null }, blocks_continue: true, source_event_ids: [], entity_ids: [] });
    const publish = await mk("Publish the launch newsletter", "The post is ready to publish.");
    const contract = await mk("Sign the hosting contract", "Needs your signature on the contract.");
    const budget = await mk("Raise the ads budget", "The ads convert; more budget would help.", [{ ...go, id: "raise", label: "Set the paid ads budget to $300" }, wait]);
    const stand = await mk("Book the trade show stand", "The organizer holds the stand until Friday.", [{ ...go, id: "book", label: "Book it", cost_minor: 120_000 }, wait]);
    // The founder answered this one before leaving; its plan is outside policy and waits for their go-ahead.
    const mine = await mk("Pick the first paid channel", "LinkedIn or Google.");
    await repos.inbox.decide(t.db, t.businessId, mine.id, { chosenOption: "go", decidedBy: t.fixture.ownerId });
    const minePlan = await repos.plans.create(t.db, t.businessId, { origin: "option", inboxItemId: mine.id, status: "pending_confirmation", actions: [{ type: "set_budget", params: { channel: "paid_ads", amount_minor: 50_000, currency: "EUR" }, policyOutcome: "ask" }] });
    // An agent's call the policy asked about: its note (Approve / Reject) is the founder's, and it is one approval.
    const asked = await mk("Juno asks to publish the post", "Juno wants to run **Publish post**.", [{ ...go, id: "approve_request", label: "Approve", reversible: false }, { ...wait, id: "reject_request", label: "Reject" }]);
    await repos.approvals.create(t.db, t.businessId, { agentId: t.chiefId, inboxItemId: asked.id, connectorKey: "platform", tool: "publish_post", reasons: ["publishing asks first"] });

    const decided = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(decided.inboxItemIds).toContain(publish.id);
    for (const other of [contract, budget, stand, mine, asked]) expect(decided.inboxItemIds).not.toContain(other.id);
    const reasons = Object.fromEntries(decided.waiting.map((w) => [w.inboxItemId, w.reason]));
    expect(reasons[asked.id]).toBe("an agent's call waits for your approval");
    expect(reasons[contract.id]).toBe("signing is always yours");
    expect(reasons[budget.id]).toBe("it moves money (a budget)");
    expect(reasons[stand.id]).toMatch(/^it costs money \(£1,200\.00\)$/);
    expect(reasons[mine.id]).toBe(AWAITING_GO_AHEAD);
    expect(decided.queuedGated).toBeGreaterThanOrEqual(4);
    expect((await repos.inbox.get(t.db, t.businessId, publish.id)).state).toBe("answered");
    for (const open of [contract, budget, stand]) expect((await repos.inbox.get(t.db, t.businessId, open.id)).state).toBe("unread");
    // Nobody confirmed the founder's plan for them.
    expect((await repos.plans.get(t.db, t.businessId, minePlan.id)).status).toBe("pending_confirmation");

    // The decision went down the founder's plan path: a holiday plan beside the decision, its workflow id recorded.
    const plan = (await repos.plans.forInboxItem(t.db, t.businessId, publish.id))!;
    expect(plan).toMatchObject({ origin: "holiday", status: "executing", workflowId: `plan:${plan.id}` });
    expect(plan.actions.map((a) => [a.type, a.agentId, a.policyOutcome])).toEqual([["create_task", t.chiefId, "allow"]]);
    expect(decided.planIds).toEqual([plan.id]);
    expect((await repos.inbox.decisionsFor(t.db, t.businessId, publish.id))[0]).toMatchObject({ chosenOption: "go", decidedByKind: "chief_of_staff", decidedBy: t.chiefId, planId: plan.id });
    const made = await repos.events.list(t.db, t.businessId, { type: "decision.made", limit: 50 });
    expect(made.items.find((e) => (e.payload as { inboxItemId?: string }).inboxItemId === publish.id)?.payload).toMatchObject({ decidedBy: "chief_of_staff", planId: plan.id, planActionCount: 1 });

    // planExecution's activities carry it out, as for a founder's plan: the task exists for the agent who asked.
    const toRun = await plans.loadPlan({ businessId: t.businessId, planId: plan.id });
    for (const a of toRun.actions) expect((await plans.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: a.id, workflowId: `plan:${plan.id}` })).status).toBe("done");
    expect((await plans.finishPlan({ businessId: t.businessId, planId: plan.id })).status).toBe("done");
    const tasks = await repos.tasks.list(t.db, t.businessId, { limit: 500 });
    expect(tasks.items.find((task) => task.planActionId === plan.actions[0]!.id)).toMatchObject({ title: "Go", assigneeAgentId: t.chiefId });

    // The next pass decides nothing twice and hands back no plan that already ran.
    const again = await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded });
    expect(again.inboxItemIds).not.toContain(publish.id);
    expect(again.planIds).not.toContain(plan.id);

    // The stop flag wins: a stopped team decides nothing.
    const later = await mk("Publish the follow-up post", "The second post is ready.");
    await repos.businesses.setAgentsStopped(t.db, t.businessId, { reason: "kill_switch" });
    expect(await acts.holidayAutoDecide({ businessId: t.businessId, holiday: loaded })).toEqual({ decided: 0, queuedGated: 0, inboxItemIds: [], planIds: [], waiting: [] });
    expect((await repos.inbox.get(t.db, t.businessId, later.id)).state).toBe("unread");

    let check = await acts.holidayCheck({ businessId: t.businessId, holiday: loaded });
    expect(check).toMatchObject({ shouldEnd: true, reason: "kill_switch" });
    await resumeBusinessAgents(t.db, t.businessId);
    check = await acts.holidayCheck({ businessId: t.businessId, holiday: loaded });
    expect(check.shouldEnd).toBe(false);
    await t.clock.advance(4 * 86_400_000);
    check = await acts.holidayCheck({ businessId: t.businessId, holiday: loaded });
    expect(check).toMatchObject({ shouldEnd: true, reason: "until_reached" });

    await repos.businesses.setAgentsStopped(t.db, t.businessId, { reason: "kill_switch" });
    const end = await acts.endHoliday({ businessId: t.businessId, holiday: loaded, reason: "kill_switch", wakeEventType: null, cyclesRun: 3 });
    await resumeBusinessAgents(t.db, t.businessId);
    expect(end.decisionsMade).toBeGreaterThanOrEqual(1);
    expect(end.gatedItemsQueued).toBeGreaterThanOrEqual(5);
    expect(end.reportInboxItemId).toBeTruthy();
    const report = await repos.inbox.get(t.db, t.businessId, end.reportInboxItemId!);
    expect(report.type).toBe("report");
    expect(report.subject).toBe("While you were away");
    expect(report.bodyMd).toMatch(/Decisions I took/);
    expect(report.bodyMd).toContain(`"Publish the launch newsletter", I chose "Go"; done (1 of 1 action).`);
    expect(report.bodyMd).toMatch(/Customer Updates \(\d+\)/);
    // Money in reads in the vacation's currency with its symbol; team spend is model cost, in the pricing currency.
    expect(report.bodyMd).toMatch(/\*\*Money\*\* — in: £[\d,]+\.\d{2} across/);
    expect(report.bodyMd).toMatch(/team spend: \$[\d,]+\.\d{2} \(Estimate\)/);
    expect(report.bodyMd).not.toMatch(/ EUR| GBP/);
    expect(report.bodyMd).not.toMatch(/match/i);
    expect(report.bodyMd).toMatch(/Waiting for you/);
    expect(report.bodyMd).toContain(`- "Sign the hosting contract": signing is always yours.`);
    expect(report.bodyMd).toContain(`- "Raise the ads budget": it moves money (a budget).`);
    expect(report.bodyMd).toContain(`- "Book the trade show stand": it costs money (£1,200.00).`);
    expect(report.bodyMd).toContain(`- "Pick the first paid channel": ${AWAITING_GO_AHEAD}.`);
    expect(report.bodyMd).toContain(`- "Publish the follow-up post": the agents were stopped before I could take it.`);
    // The approval's note is listed, but counted once, as the approval it answers (never as a decision as well).
    expect(report.bodyMd).toContain(`- "Juno asks to publish the post": an agent's call waits for your approval.`);
    const waitingFrom = report.bodyMd.slice(report.bodyMd.indexOf("**Waiting for you"));
    const [total, decisionsN, approvalsN, gatedN] = /^\*\*Waiting for you \((\d+)\)\*\* — (\d+) decisions? to take or confirm, (\d+) approvals? and (\d+) hard-gated/.exec(waitingFrom)!.slice(1).map(Number);
    const listed = waitingFrom.split("\n").filter((l) => l.startsWith(`- "`));
    expect(listed.length).toBeLessThan(10);
    expect(decisionsN).toBe(listed.length - 1);
    expect(approvalsN).toBeGreaterThanOrEqual(1);
    expect(total).toBe(decisionsN! + approvalsN! + gatedN!);
    expect(end.gatedItemsQueued).toBe(total);
    expect(report.bodyMd).toMatch(/Estimate/);
    expect((await repos.holidays.get(t.db, t.businessId, h.id)).endedAt).not.toBeNull();
    const ended = await repos.events.list(t.db, t.businessId, { type: "holiday.ended", limit: 2 });
    expect(ended.items[0]?.payload).toMatchObject({ holidayId: h.id, reason: "kill_switch", cyclesRun: 3 });
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
