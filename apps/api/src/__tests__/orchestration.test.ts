/**
 * Cycles, vacations, Automated mode, playbooks and retried messages through the api (audit W01): a cycle exists from the
 * press of Continue and Pause reaches it, a dead workflow does not hold Continue, resume leaves a hand-paused task
 * alone, two vacations never run at once, "Come back" twice ends it once, Automated mode starts its autopilot, a playbook
 * can be created, and a message sent twice is one message.
 */
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reconcileWorkflows } from "../services/workflow-reconcile";
import { silentLog } from "../services/log";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const DAY = 86_400_000;

describe("a cycle exists from the press of Continue (audit SOAK-05, RUI-15, OL-25, O-07)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient({ rejectDuplicates: true });
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "orch-cycle", temporalClient: temporal });
  }, 120_000);
  afterEach(() => vi.useRealTimers());
  afterAll(() => hz.close());

  it("a press is queued at once, a second press (or a second tab) starts nothing and audits nothing", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const first = await owner.business.continue({ businessId });
    expect(first.action).toBe("started");
    expect(first.status).toMatchObject({ running: true, queued: true, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, mode: "temporal" });
    expect(first.continueState.kind).toBe("processing");

    const second = await owner.business.continue({ businessId });
    expect(second.action).toBe("already_running");
    // Another tab that never saw the first press asks Temporal for the same cycle: it answers "already started".
    const third = await hz.caller({ userId: hz.A.ownerId }).business.continue({ businessId });
    expect(third.action).toBe("already_running");
    expect(temporal.starts.filter((s) => s.type === "businessCycle")).toHaveLength(1);
    expect((await repos.audit.list(hz.db, businessId, { action: "business.continue" })).items).toHaveLength(1);

    // The cycle number is taken: a failed-before-start cycle cannot be given the same workflow id again.
    expect((await owner.cycle.status({ businessId })).nextCycleNumber).toBe(2);
  });

  it("Pause reaches a cycle that is still queued or planning and Continue resumes it", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused.paused).toBe(true);
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "pause" });
    expect(paused.status.paused).toBe(true);
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");

    const resumed = await owner.business.continue({ businessId });
    expect(resumed.action).toBe("resumed");
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "resume" });
  });

  it("pausing holds the dispatch and resuming puts back only the tasks the pause paused, not one the founder paused by hand (audit OL-25)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const cycleId = crypto.randomUUID();
    await repos.events.write(hz.db, businessId, { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, trigger: "continue", timeBoxAgentHours: 4, plannedTaskIds: [hz.A.taskId], budget: null } });
    const running = await repos.tasks.create(hz.db, businessId, { kind: "code", title: "Running now", status: "ready" });
    await repos.tasks.reassign(hz.db, businessId, running.id, hz.A.agent2Id);
    await repos.tasks.setStatus(hz.db, businessId, running.id, "running", { force: true });
    const byHand = await repos.tasks.create(hz.db, businessId, { kind: "code", title: "Paused by the founder", status: "ready" });
    await repos.tasks.setStatus(hz.db, businessId, byHand.id, "paused", { force: true });

    const status = await owner.cycle.status({ businessId });
    expect(status.paused).toBe(false);
    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused.paused).toBe(true);
    expect(paused.status.pausedTaskIds).toContain(running.id);
    expect(paused.status.pausedTaskIds).not.toContain(byHand.id);
    // The signal names the tasks it pauses, so the workflow reaches those sessions and no others.
    expect(temporal.signals.at(-1)).toMatchObject({ signal: "pause", args: [expect.objectContaining({ taskIds: expect.arrayContaining([running.id]) })] });

    const resumed = await owner.business.resumeCycle({ businessId });
    expect(resumed.resumed).toBe(true);
    expect((await repos.tasks.get(hz.db, businessId, running.id)).status).toBe("running");
    expect((await repos.tasks.get(hz.db, businessId, byHand.id)).status).toBe("paused");
    expect(temporal.signals.at(-1)).toMatchObject({ signal: "resume", args: [expect.objectContaining({ taskIds: expect.arrayContaining([running.id]) })] });
    expect(temporal.signals.at(-1)!.args[0]).toEqual(expect.objectContaining({ taskIds: expect.not.arrayContaining([byHand.id]) }));
  });

  it("a cycle whose workflow is gone is closed as failed, with one Inbox note, so Continue is not stuck on processing", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    // The orchestrator never wrote cycle.started for number 2 and its workflow was terminated.
    const hz2 = await createApiHarness({ prefix: "orch-dead", temporalClient: temporal });
    try {
      const o2 = hz2.caller({ userId: hz2.A.ownerId });
      const b2 = hz2.A.businessId;
      const press = await o2.business.continue({ businessId: b2 });
      expect(press.status.queued).toBe(true);
      temporal.statuses.set(`cycle:${b2}:1`, "TERMINATED");
      // Two minutes on: old enough to be asked about.
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 120_000 });
      const status = await o2.cycle.status({ businessId: b2 });
      expect(status).toMatchObject({ running: false, lastOutcome: "failed" });
      expect((await o2.cycle.continueState({ businessId: b2 })).kind).toBe("idle");
      const warnings = (await o2.inbox.list({ businessId: b2, type: "warning", limit: 20 })).items.filter((i) => i.subject === "Cycle 1 did not finish");
      expect(warnings).toHaveLength(1);
      // Asking again does not write a second note.
      await o2.cycle.status({ businessId: b2 });
      expect((await o2.inbox.list({ businessId: b2, type: "warning", limit: 20 })).items.filter((i) => i.subject === "Cycle 1 did not finish")).toHaveLength(1);
      // The next press takes number 2.
      vi.useRealTimers();
      expect((await o2.business.continue({ businessId: b2 })).status.cycleNumber).toBe(2);
    } finally {
      vi.useRealTimers();
      await hz2.close();
    }
    void owner;
    void businessId;
  });
});

describe("vacations (audit #73, #77, #86, #239, VOL-X2)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "orch-vac" });
  }, 120_000);
  afterAll(() => hz.close());

  const start = (until: { kind: "return" } | { kind: "date"; date: Date } | { kind: "condition"; condition: string }) => hz.caller({ userId: hz.A.ownerId }).business.startHoliday({ businessId: hz.A.businessId, until });

  it("two starts at once run one vacation: the second answers with the first, and only one is recorded", async () => {
    const [a, b] = await Promise.all([start({ kind: "return" }), start({ kind: "return" })]);
    expect(a.holiday!.id).toBe(b.holiday!.id);
    const list = await repos.holidays.list(hz.db, hz.A.businessId);
    expect(list.filter((h) => h.endedAt === null)).toHaveLength(1);
    const started = await repos.events.list(hz.db, hz.A.businessId, { type: "holiday.started", limit: 10 });
    expect(started.items).toHaveLength(1);
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "business.start_holiday" })).items).toHaveLength(1);
  });

  it("the top bar reads 'On vacation until you return', not 'until until I return' (audit VOL-X2)", async () => {
    const cs = await hz.caller({ userId: hz.A.ownerId }).cycle.continueState({ businessId: hz.A.businessId });
    expect(cs).toEqual({ kind: "holiday", until: null, untilLabel: "you return" });
  });

  it("Continue is refused while the vacation runs, and 'Come back' twice ends it once", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.business.continue({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "CONFLICT" });
    const one = await owner.business.endHoliday({ businessId: hz.A.businessId, reason: "founder_returned" });
    const two = await owner.business.endHoliday({ businessId: hz.A.businessId, reason: "founder_returned" });
    expect(one.holiday?.endedAt).toBeTruthy();
    expect(two.holiday).toBeNull();
    const ended = await repos.events.list(hz.db, hz.A.businessId, { type: "holiday.ended", limit: 10 });
    expect(ended.items).toHaveLength(1);
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "business.end_holiday" })).items).toHaveLength(1);
    expect((await owner.cycle.continueState({ businessId: hz.A.businessId })).kind).not.toBe("holiday");
  });

  it("a dated vacation whose date has passed no longer blocks Continue, and a new one can start", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const started = new Date(Date.now() - 3 * DAY);
    await repos.holidays.start(hz.db, hz.A.businessId, { untilAt: new Date(Date.now() - DAY), startedAt: started });
    expect((await owner.cycle.continueState({ businessId: hz.A.businessId })).kind).not.toBe("holiday");
    const next = await start({ kind: "condition", condition: "when the launch ships" });
    expect(next.holiday!.id).toBeTruthy();
    expect(await owner.cycle.continueState({ businessId: hz.A.businessId })).toEqual({ kind: "holiday", until: null, untilLabel: "the launch ships" });
  });
});

describe("the workflows that must exist for a row (audit OL-08, SOAK-01, #75)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient({ rejectDuplicates: true });
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "orch-auto", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("setting Automated mode starts the autopilot, and leaving it stops it", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" });
    await owner.business.setBusinessMode({ businessId, businessMode: "automated" });
    expect(temporal.starts.filter((s) => s.type === "autopilot")).toEqual([{ type: "autopilot", workflowId: `autopilot:${businessId}`, args: [{ businessId }] }]);
    await owner.business.setBusinessMode({ businessId, businessMode: "assisted" });
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `autopilot:${businessId}`, signal: "stop" });
  });

  it("the reconciler starts the autopilot of an Automated business and the workflow of a running vacation that have none, and nothing twice", async () => {
    const { businessId } = hz.A;
    await repos.businesses.setBusinessMode(hz.db, businessId, "automated");
    // The autopilot the previous test stopped has ended.
    temporal.statuses.delete(`autopilot:${businessId}`);
    const vacation = await repos.holidays.start(hz.db, hz.B.businessId, { untilCondition: { text: "you return" } });
    const before = temporal.starts.length;
    const first = await reconcileWorkflows({ db: hz.db, temporal: hz.deps.temporal, log: silentLog() });
    expect(first.reachable).toBe(true);
    expect(first.holidaysStarted).toBe(1);
    expect(temporal.starts.slice(before).map((s) => s.workflowId)).toEqual(expect.arrayContaining([`holiday:${vacation.id}`, `autopilot:${businessId}`]));
    const second = await reconcileWorkflows({ db: hz.db, temporal: hz.deps.temporal, log: silentLog() });
    expect(second).toMatchObject({ holidaysStarted: 0, autopilotsStarted: 0 });
    await repos.businesses.setBusinessMode(hz.db, businessId, "assisted");
  });

  it("does nothing, and says so, while Temporal cannot be reached", async () => {
    const down = await createApiHarness({ prefix: "orch-down" });
    try {
      await repos.holidays.start(down.db, down.A.businessId, { untilCondition: { text: "you return" } });
      expect(await reconcileWorkflows({ db: down.db, temporal: down.deps.temporal, log: silentLog() })).toEqual({ reachable: false, holidaysStarted: 0, autopilotsStarted: 0 });
    } finally {
      await down.close();
    }
  });
});

describe("playbooks can be written, shown, edited and turned on (audit AC-07, #82)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "orch-pb" });
  }, 120_000);
  afterAll(() => hz.close());

  it("compiles a sentence into a flow, saves it off, and turns it on only when the flow is valid", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const text = "When a lead replies positively, draft a reply and book a call; I approve the first message.";
    const compiled = await owner.team.playbooks.compile({ businessId, text });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.playbook.trigger).toEqual({ event: "lead.replied", where: { sentiment: "positive" } });
    expect(compiled.preview.when).toBe("When a lead replies (sentiment is positive)");
    // Compiling saves nothing.
    expect((await owner.team.playbooks.list({ businessId })).playbooks.filter((p) => p.sourceText === text)).toHaveLength(0);

    const created = await owner.team.playbooks.create({ businessId, sourceText: text, flow: { trigger: compiled.playbook.trigger, steps: compiled.playbook.steps, approvals: compiled.playbook.approvals, stop: compiled.playbook.stop } });
    expect(created.enabled).toBe(false);
    expect(created.compiled?.steps.map((s) => s.action.type)).toEqual(["create_task", "schedule_meeting"]);
    expect(created.preview?.steps[0]).toMatchObject({ approval: "You approve the first run" });

    const on = await owner.team.playbooks.setEnabled({ businessId, id: created.id, enabled: true });
    expect(on.enabled).toBe(true);
    const edited = await owner.team.playbooks.update({ businessId, id: created.id, flow: { ...created.compiled, stop: { max_runs: 3 } } });
    expect(edited.compiled?.stop).toEqual({ max_runs: 3 });
    await expect(owner.team.playbooks.update({ businessId, id: created.id, flow: { trigger: { event: "not.an.event" }, steps: [] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.audit.list(hz.db, businessId, { action: "team.playbook.create" })).items).toHaveLength(1);
  });

  it("asks which event starts a rule that names none, and refuses a rule that includes a hard-gated step", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const vague = await owner.team.playbooks.compile({ businessId, text: "whenever the weather changes, create a win-back task" });
    expect(vague).toMatchObject({ ok: false });
    if (!vague.ok) expect(vague.question).toMatch(/which event/i);
    const gated = await owner.team.playbooks.compile({ businessId, text: "Whenever a payment arrives, pay the supplier" });
    expect(gated).toMatchObject({ ok: false });
  });

  it("is walled: another business's owner and a viewer cannot write playbooks", async () => {
    const { businessId } = hz.A;
    await expect(hz.caller({ userId: hz.B.ownerId }).team.playbooks.list({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.A.viewerId }).team.playbooks.create({ businessId, sourceText: "x", flow: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a message sent twice is one message (audit #238)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "orch-msg" });
  }, 120_000);
  afterAll(() => hz.close());

  it("a retry with the same client message id returns the stored exchange and asks the model nothing more", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const subject = { kind: "agent" as const, id: hz.A.agentId };
    const input = { businessId, subject, text: "How is the first week going?", clientMessageId: "client-msg-0001" };
    const first = await owner.agent.conversation.send(input);
    const usageBefore = await repos.usage.totals(hz.db, businessId, {});
    const again = await owner.agent.conversation.send(input);
    expect(again.messages.map((m) => m.id)).toEqual(first.messages.map((m) => m.id));
    expect((await repos.usage.totals(hz.db, businessId, {})).costMinor).toBe(usageBefore.costMinor);
    const view = await owner.agent.conversation.get({ businessId, subject });
    expect(view.messages.filter((m) => m.author === "founder" && m.bubbles.join(" ") === input.text)).toHaveLength(1);
    // A new message with a new id is a new exchange.
    await owner.agent.conversation.send({ ...input, text: "And the second?", clientMessageId: "client-msg-0002" });
    const after = await owner.agent.conversation.get({ businessId, subject });
    expect(after.messages.filter((m) => m.author === "founder")).toHaveLength(2);
  });

  it("two copies sent at once store one exchange", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const subject = { kind: "agent" as const, id: hz.A.agent2Id };
    const input = { businessId, subject, text: "Status?", clientMessageId: "client-msg-race" };
    const results = await Promise.allSettled([owner.agent.conversation.send(input), owner.agent.conversation.send(input)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const view = await owner.agent.conversation.get({ businessId, subject });
    expect(view.messages.filter((m) => m.author === "founder")).toHaveLength(1);
  });
});
