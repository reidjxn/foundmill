/**
 * Playbooks on a schedule (founder, Nov 25, 2026): the sweep finds the playbooks whose time came due and starts each
 * time once; a run that would not fit the budget (credits, the monthly model budget, the spend cap per action) is
 * skipped with a note in the Inbox and the activity feed; a run that fits runs its steps to the end.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, PlanActionResult } from "../../activities";
import { createMiscActivities, playbookSkipNote } from "../../activities/misc";
import { playbook, playbookScheduleSweep } from "../../workflows";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "../harness";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
let t: OrchestratorTestHarness;
beforeAll(async () => {
  [rig, t] = await Promise.all([createTemporalRig(), setupOrchestratorHarness({ prefix: "pbsched" })]);
}, 180_000);
afterAll(async () => {
  await Promise.all([rig?.teardown(), t?.close()]);
});

const flow = (time: string) => ({ trigger: { schedule: { every: "day", time } }, steps: [{ action: { type: "create_task", params: { title: "Draft the update" } }, label: "Draft the update" }], approvals: [], stop: {} });
const tomorrowAt = (hhmm: string) => `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;

describe("the due list and the budget check (activities on PGlite)", () => {
  it("lists an enabled scheduled playbook once its time comes due, within the window, and never an event playbook", async () => {
    const acts = createMiscActivities(t.deps);
    const scheduled = await repos.playbooks.create(t.db, t.businessId, { name: "Daily update", sourceText: "Every day at 9am, draft the update.", compiled: flow("09:00"), enabled: true });
    await repos.playbooks.create(t.db, t.businessId, { name: "Off", sourceText: "x", compiled: flow("09:00"), enabled: false });
    await repos.playbooks.create(t.db, t.businessId, { name: "On reply", sourceText: "x", compiled: { ...flow("09:00"), trigger: { event: "lead.replied" } }, enabled: true });
    const due = await acts.listDueScheduledPlaybooks({ businessIds: [t.businessId], at: tomorrowAt("09:10") });
    expect(due.due).toEqual([{ businessId: t.businessId, playbookId: scheduled.id, scheduledFor: tomorrowAt("09:00") }]);
    expect((await acts.listDueScheduledPlaybooks({ businessIds: [t.businessId], at: tomorrowAt("08:59") })).due).toEqual([]);
    expect((await acts.listDueScheduledPlaybooks({ businessIds: [t.businessId], at: tomorrowAt("10:30") })).due).toEqual([]);
    await repos.playbooks.archive(t.db, t.businessId, scheduled.id);
  });

  it("skips a run over the spend cap or the model budget, and says so in the Inbox and the activity feed", async () => {
    const acts = createMiscActivities(t.deps);
    const spend = [{ action: { type: "approve_spend", params: { amount_minor: 5_000 } } }];
    expect(await acts.playbookRunFits({ businessId: t.businessId, steps: spend })).toEqual({ fits: true });
    await repos.businesses.setSpendCap(t.db, t.businessId, 1_000);
    expect(await acts.playbookRunFits({ businessId: t.businessId, steps: spend })).toEqual({ fits: false, reason: "spend_cap" });
    await repos.businesses.setSpendCap(t.db, t.businessId, null);
    await repos.businesses.setModelBudget(t.db, t.businessId, 0);
    expect(await acts.playbookRunFits({ businessId: t.businessId, steps: [] })).toEqual({ fits: false, reason: "model_budget" });
    await repos.businesses.setModelBudget(t.db, t.businessId, null);

    const pb = await repos.playbooks.create(t.db, t.businessId, { name: "Daily update", sourceText: "x", compiled: flow("09:00"), enabled: true });
    const { inboxItemId } = await acts.playbookRunSkipped({ businessId: t.businessId, playbookId: pb.id, scheduledFor: tomorrowAt("09:00"), reason: "credits" });
    const item = await repos.inbox.get(t.db, t.businessId, inboxItemId!);
    expect(item).toMatchObject({ type: "warning", subject: "A scheduled playbook was skipped", blocksContinue: false });
    expect(item.bodyMd).toContain('"Daily update" (Every day at 9:00 AM) did not start: this month\'s credits are used up');
    expect(item.bodyMd).toContain("Top up or add your own Anthropic key");
    const feed = await repos.audit.list(t.db, t.businessId, { action: "team.playbook.skip" });
    expect(feed.items[0]!.details).toMatchObject({ reason: "credits", scheduledFor: tomorrowAt("09:00") });
    await repos.playbooks.archive(t.db, t.businessId, pb.id);
  });

  it("words every reason with how to continue", () => {
    for (const reason of ["credits", "model_budget", "spend_cap"] as const) expect(playbookSkipNote("P", "Every day at 9:00 AM", reason).body).toMatch(/runs at its next time.*\n\nNothing was spent/s);
  });
});

describe("the sweep and the run (workflows)", () => {
  const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const PLAYBOOK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const SLOT = "2026-11-30T09:00:00.000Z";

  function activities(fits: boolean, log: string[]): Partial<Activities> {
    return {
      async listDueScheduledPlaybooks() {
        return { due: [{ businessId: BUSINESS, playbookId: PLAYBOOK, scheduledFor: SLOT }] };
      },
      async loadPlaybook(input) {
        return { playbookId: input.playbookId, enabled: true, steps: [{ action: { type: "create_task", params: {} } }], approvals: [], firstRun: false, stop: {}, departmentId: null };
      },
      async playbookRunFits() {
        log.push("fits?");
        return fits ? { fits: true } : { fits: false, reason: "credits" };
      },
      async playbookRunSkipped(input) {
        log.push(`skipped ${input.reason} ${input.scheduledFor}`);
        return { inboxItemId: null };
      },
      async playbookShouldStop() {
        return { stop: false, reason: null };
      },
      async playbookStepToPlan() {
        log.push("step");
        return { planId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", actionIds: ["a1"] };
      },
      async executePlanAction(): Promise<PlanActionResult> {
        return { actionId: "a1", status: "done", outcome: "allow", approvalId: null, result: {}, spawn: [], stop: [] };
      },
      async finishPlan() {
        return { status: "done", progress: 1 };
      },
      async markPlaybookRun() {
        log.push("ran");
      },
    };
  }

  it("starts each due time once, however many sweeps see it, and the run finishes its steps", async () => {
    const log: string[] = [];
    const out = await rig.run(activities(true, log), async (client, taskQueue) => {
      const first = await client.workflow.execute(playbookScheduleSweep, { workflowId: wfId("sweep"), taskQueue, args: [{}] });
      const second = await client.workflow.execute(playbookScheduleSweep, { workflowId: wfId("sweep"), taskQueue, args: [{}] });
      const run = await client.workflow.getHandle(`playbook:${PLAYBOOK}:at:${SLOT}`).result();
      return { first, second, run };
    });
    expect(out.first.touched).toBe(1);
    expect(out.second.touched).toBe(0);
    expect(out.run).toMatchObject({ stepsRun: 1, stoppedReason: null });
    expect(log).toEqual(["fits?", "step", "ran"]);
  });

  it("skips a run that would not fit, before any step, and tells the founder", async () => {
    const log: string[] = [];
    const run = await rig.run(activities(false, log), (client, taskQueue) => client.workflow.execute(playbook, { workflowId: wfId("playbook"), taskQueue, args: [{ businessId: BUSINESS, playbookId: PLAYBOOK, event: null, scheduledFor: SLOT }] }));
    expect(run).toMatchObject({ stepsRun: 0, stoppedReason: "skipped: credits" });
    expect(log).toEqual(["fits?", `skipped credits ${SLOT}`]);
  });

  it("an event-started run never checks the schedule budget (unchanged)", async () => {
    const log: string[] = [];
    const run = await rig.run(activities(false, log), (client, taskQueue) => client.workflow.execute(playbook, { workflowId: wfId("playbook"), taskQueue, args: [{ businessId: BUSINESS, playbookId: PLAYBOOK, event: null }] }));
    expect(run.stepsRun).toBe(1);
    expect(log).toEqual(["step", "ran"]);
  });
});
