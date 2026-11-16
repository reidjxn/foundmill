/**
 * The first days are about the product (founder, 2026-10-18): Take charge posts a welcome note and no Board decision;
 * the drafted foundations ask for two sign-offs (the specification, the roadmap); approving the specification publishes
 * a version; Request changes needs the founder's words and gives the Product lead a revision task; the second approval
 * plans the first build and starts the next cycle; distribution (engines, the channel-scoring task, the Board's
 * question) waits for an explicit Start distribution, from the Board or the Ready to start selling? note.
 */
import { CHANNEL_SCORING_TASK } from "@foundmill/agents";
import { repos, signoffDecisionBlock } from "@foundmill/db";
import { DIGEST_SUBJECT } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runFoundationsLocally } from "../services/foundations";
import { REVISION_TASK_PRIORITY, buildingStartsBody } from "../services/signoff";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "signoff", temporalClient: temporal });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

/** A founder with a fresh Door A business whose foundations are drafted (in-process, as the e2e stack drafts them). */
async function freshBusiness(email: string, name: string) {
  const userId = await hz.h.createUser(email);
  const caller = hz.caller({ userId, email });
  await caller.founder.profile.update({ confirmAdult: true, displayName: "Reid", experience: "first-time", skills: { engineering: 14, sales: 8 }, targetMarkets: ["Nordics"], riskAppetite: "medium", budgetMinor: 2_500_000 });
  const generated = await caller.idea.generate({ prompt: "bookkeeping for independent accountants in the Nordics" });
  const result = await caller.idea.commit({ ideaId: generated.ideas[0]!.id, name, archetype: "b2b_saas", gameMode: "personal" });
  const businessId = result.business.id;
  const claimed = await repos.foundations.claim(hz.db, businessId, ["pending"]);
  await runFoundationsLocally({ db: hz.db, models: hz.deps.models, temporal: hz.deps.temporal, log: hz.deps.log }, businessId, claimed!.attempt);
  return { userId, caller, businessId, result };
}

/**
 * Notes by subject, Archive included: in a project's first week an agent's update (the Product lead's follow-ups) is
 * stored archived and listed in the Chief of Staff's note of the day (WP-04 T8).
 */
const bySubject = async (caller: ReturnType<ApiHarness["caller"]>, businessId: string, subject: string) => {
  const [open, archived] = await Promise.all([caller.inbox.list({ businessId, limit: 100 }), caller.inbox.list({ businessId, tab: "archive", limit: 100 })]);
  return [...open.items, ...archived.items].filter((i) => i.subject === subject);
};

describe("sign-offs: the specification and the roadmap (founder, 2026-10-18)", () => {
  let b: Awaited<ReturnType<typeof freshBusiness>>;
  beforeAll(async () => {
    b = await freshBusiness("signoff-a@test.local", "Signoff Books");
  }, 120_000);

  it("the drafted foundations ask for two sign-offs: decision notes from the Product lead that block Continue; the stage is awaiting_signoff", async () => {
    const view = await b.caller.product.signoff.get({ businessId: b.businessId });
    expect(view.stage).toBe("awaiting_signoff");
    expect(view.spec).toMatchObject({ round: 1, status: "pending", specVersion: null });
    expect(view.roadmap).toMatchObject({ round: 1, status: "pending" });
    expect(view.readyToSell).toBeNull();
    const inbox = await b.caller.inbox.list({ businessId: b.businessId, tab: "respond" });
    // With the Product lead's page note (package 1.3), drafted first: a decision that is not a sign-off.
    expect(inbox.items.map((i) => i.subject).sort()).toEqual(["Sign off the product roadmap", "Sign off the product specification", "Your project's page is ready"]);
    // Both wait in Needs you; neither holds Continue (0071, Nov 7, 2026): the Chief of Staff plans only groundwork until they are signed.
    expect(inbox.continueState).toEqual({ kind: "idle" });
    // The note knows it is a sign-off (the reading pane shows its notes field); its options are the fixed pair.
    const got = await b.caller.inbox.get({ businessId: b.businessId, itemId: view.spec!.inboxItemId! });
    expect(got.signoff).toMatchObject({ kind: "spec", round: 1, status: "pending" });
    expect((got.item.decision as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["approve", "request_changes"]);
    // Continue runs while the sign-offs wait (Nov 7, 2026): the Chief of Staff plans only groundwork until they are signed,
    // and vacation and Automated mode never take them (apps/orchestrator).
    await expect(b.caller.business.continue({ businessId: b.businessId })).resolves.toMatchObject({ action: expect.any(String) });
    // Nothing on distribution yet: no Board question, no scoring task, no engine.
    expect(await bySubject(b.caller, b.businessId, "Where should the first customer come from?")).toHaveLength(0);
    expect((await repos.tasks.list(hz.db, b.businessId, { limit: 100 })).items.some((t) => t.kind === "channel")).toBe(false);
    expect(temporal.starts.some((s) => s.type === "channelEngine" && s.args.some((a) => (a as { businessId: string }).businessId === b.businessId))).toBe(false);
  });

  it("Request changes without words is refused; with words it sends the round back, gives the Product lead a revision task and says so", async () => {
    const view = await b.caller.product.signoff.get({ businessId: b.businessId });
    await expect(b.caller.inbox.decide({ businessId: b.businessId, itemId: view.roadmap!.inboxItemId!, chosenOption: "request_changes" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(b.caller.product.signoff.decide({ businessId: b.businessId, kind: "roadmap", decision: "request_changes" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Free text on the note is the founder's request for changes: no plan compiler, no model call.
    const decided = await b.caller.inbox.decide({ businessId: b.businessId, itemId: view.roadmap!.inboxItemId!, freeText: "Move billing ahead of onboarding and drop the reporting item from Now." });
    expect(decided.item.state).toBe("answered");
    expect(decided.decision.freeText).toContain("Move billing ahead of onboarding");
    expect(decided.plan.actions.map((a) => a.type)).toEqual(["reply_only"]);
    expect(decided.followUp?.subject).toBe("Changes requested: the roadmap");
    const after = await b.caller.product.signoff.get({ businessId: b.businessId });
    expect(after.roadmap).toMatchObject({ round: 1, status: "changes_requested", notes: "Move billing ahead of onboarding and drop the reporting item from Now." });
    expect(after.stage).toBe("awaiting_signoff");
    const tasks = await repos.tasks.list(hz.db, b.businessId, { limit: 100 });
    // The title is the team's, never the founder's sentence cut off; their words are the goal. The revision is the next
    // thing the team does: it starts at once (an agentSession on the fake Temporal), ahead of every planned task.
    const revision = tasks.items.find((t) => t.title === "Revise the roadmap from your notes");
    expect(revision).toMatchObject({ kind: "research", status: "running", assigneeAgentId: decided.item.fromAgentId, priority: REVISION_TASK_PRIORITY });
    expect(revision!.goalMd).toContain("Move billing ahead of onboarding");
    expect(temporal.starts.some((s) => s.type === "agentSession" && s.args.some((a) => (a as { taskId: string }).taskId === revision!.id))).toBe(true);
    expect(decided.followUp?.bodyMd).toMatch(/is revising the roadmap now/);
    expect(decided.followUp?.bodyMd).toMatch(/nothing else is built until you approve it/);
    const events = await repos.events.list(hz.db, b.businessId, { type: "product.signoff_decided" });
    expect(events.items.map((e) => (e.payload as { kind: string; decision: string }).decision)).toEqual(["changes_requested"]);
    // One sign-off still waits in Needs you; Continue stays free.
    const waiting = await b.caller.inbox.list({ businessId: b.businessId, tab: "respond" });
    expect(waiting.items.some((i) => /^Sign off the /.test(i.subject))).toBe(true);
    expect(waiting.continueState).toEqual({ kind: "idle" });
  });

  it("approving the specification from its tab publishes a numbered version, answers the note and records the round", async () => {
    const before = await repos.product.listVersions(hz.db, b.businessId);
    const res = await b.caller.product.signoff.decide({ businessId: b.businessId, kind: "spec", decision: "approve", notes: "Looks right for a first version." });
    expect(res.signoff).toMatchObject({ kind: "spec", round: 1, status: "approved", notes: "Looks right for a first version." });
    expect(res.specVersion?.version).toBe(before.length + 1);
    expect(res.build).toBeNull();
    expect(res.followUpId).toBeTruthy();
    const view = await b.caller.product.signoff.get({ businessId: b.businessId });
    expect(view.spec).toMatchObject({ status: "approved", specVersion: before.length + 1, decidedBy: { kind: "user", id: b.userId } });
    expect(view.stage).toBe("awaiting_signoff");
    // The note was answered by the screen's decision: answered, no longer blocking, with the option recorded.
    const item = await b.caller.inbox.get({ businessId: b.businessId, itemId: view.spec!.inboxItemId! });
    expect(item.item.state).toBe("answered");
    expect(item.decisions[0]).toMatchObject({ chosenOption: "approve", freeText: "Looks right for a first version." });
    expect(item.signoff).toMatchObject({ status: "approved" });
    expect((await bySubject(b.caller, b.businessId, "Specification signed off"))[0]?.bodyMd).toMatch(/You approved the specification \(version \d+\) on [A-Z][a-z]{2} \d{1,2}, \d{4}\. Sign off the roadmap and the build starts\./);
    // A second approval of the same round is refused as already decided.
    await expect(b.caller.product.signoff.decide({ businessId: b.businessId, kind: "spec", decision: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    const audit = await repos.audit.list(hz.db, b.businessId, { action: "product.signoff.decide", limit: 10 });
    expect(audit.items.length).toBeGreaterThanOrEqual(2);
  });

  it("the second approval (the roadmap, re-approved from its tab after changes were requested) plans the first build and starts the next cycle", async () => {
    const now = (await repos.product.listRoadmap(hz.db, b.businessId, { horizon: "now" })).sort((x, y) => x.position - y.position);
    expect(now.length).toBeGreaterThan(0);
    const res = await b.caller.product.signoff.decide({ businessId: b.businessId, kind: "roadmap", decision: "approve" });
    expect(res.signoff.status).toBe("approved");
    expect(res.stage).toBe("building");
    const build = res.build!;
    expect(build.plannedTaskIds.length).toBeGreaterThanOrEqual(3);
    // At most LIMITS.signoffPlanRoadmapItems items in Now are planned, first by position, through the Planner (audited as dev.tasks.plan).
    expect(build.planned).toEqual(now.slice(0, 2).map((i) => i.title));
    expect(build.failed).toEqual([]);
    const tasks = await repos.tasks.byIds(hz.db, b.businessId, build.plannedTaskIds);
    expect(tasks.every((t) => t.status === "planned" && t.roadmapItemId !== null)).toBe(true);
    expect(new Set(tasks.map((t) => t.roadmapItemId))).toEqual(new Set(now.slice(0, 2).map((i) => i.id)));
    const plans = await repos.audit.list(hz.db, b.businessId, { action: "dev.tasks.plan", limit: 10 });
    expect(plans.items).toHaveLength(Math.min(2, now.length));
    // The next cycle as Continue starts it: here cycle 1 (started at commit on the fake Temporal, never finished) still
    // counts as running, so nothing new is queued and the follow-up says the build cycle is under way.
    expect(build.cycle).toMatchObject({ started: true, mode: "temporal", reason: "a cycle is already running" });
    expect(temporal.starts.filter((s) => s.type === "businessCycle" && s.workflowId.startsWith(`cycle:${b.businessId}:`)).length).toBeGreaterThanOrEqual(1);
    // The follow-up and the event say the build started; distribution still waits.
    const note = (await bySubject(b.caller, b.businessId, `Building starts: ${build.plannedTaskIds.length} tasks planned`))[0];
    expect(note?.bodyMd).toContain("Distribution waits until you start it from Customers › Board.");
    // The first week: folded into the Chief of Staff's note of the day, which lists it (WP-04 T8).
    expect(note?.state).toBe("archived");
    expect((await bySubject(b.caller, b.businessId, DIGEST_SUBJECT))[0]?.bodyMd).toContain(note!.subject);
    // No repository connected (WP-02 T5): the round of work starts, and nothing is said to go live.
    expect(note?.bodyMd).toContain("The first round of work is under way. The code is kept in your project; nothing goes live from it until a repository is connected.");
    expect(note?.bodyMd).not.toMatch(/build cycle/);
    expect((await b.caller.business.get({ businessId: b.businessId })).buildDestination).toBe("none");
    const events = await repos.events.list(hz.db, b.businessId, { type: "product.signoff_decided" });
    const last = events.items[0]!.payload as { buildStarted: boolean; plannedTaskIds: string[]; cycle: { queued: boolean; workflowId: string } | null };
    expect(last.buildStarted).toBe(true);
    expect(last.plannedTaskIds).toEqual(build.plannedTaskIds);
    expect(last.cycle?.workflowId).toBe(`cycle:${b.businessId}:1`);
    expect((await b.caller.business.get({ businessId: b.businessId })).productStage).toBe("building");
    expect((await repos.tasks.list(hz.db, b.businessId, { limit: 100 })).items.some((t) => t.kind === "channel")).toBe(false);
  });

  it("a specification published while its round was sent back asks for sign-off again (a new round and note)", async () => {
    const c = await freshBusiness("signoff-reopen@test.local", "Reopen Books");
    const first = await c.caller.product.signoff.get({ businessId: c.businessId });
    await c.caller.product.signoff.decide({ businessId: c.businessId, kind: "spec", decision: "request_changes", notes: "Shorten the pricing section." });
    expect((await c.caller.product.signoff.get({ businessId: c.businessId })).spec).toMatchObject({ round: 1, status: "changes_requested" });
    // The Product lead's revision lands as a published version: the round reopens.
    await c.caller.product.spec.publish({ businessId: c.businessId, changelogMd: "Pricing shortened to three lines." });
    const reopened = await c.caller.product.signoff.get({ businessId: c.businessId });
    expect(reopened.spec).toMatchObject({ round: 2, status: "pending" });
    expect(reopened.spec!.inboxItemId).not.toBe(first.spec!.inboxItemId);
    const note = await c.caller.inbox.get({ businessId: c.businessId, itemId: reopened.spec!.inboxItemId! });
    expect(note.item.subject).toBe("Sign off the revised specification");
    expect(note.item.bodyMd).toContain("Pricing shortened to three lines.");
    expect(note.item.blocksContinue).toBe(false);
    // Approving the new round from the note (option 1) closes it.
    const decided = await c.caller.inbox.decide({ businessId: c.businessId, itemId: reopened.spec!.inboxItemId!, chosenOption: "approve" });
    expect(decided.item.state).toBe("answered");
    expect((await c.caller.product.signoff.get({ businessId: c.businessId })).spec).toMatchObject({ round: 2, status: "approved" });
    // A pending sign-off note cannot be filed away: it is answered.
    const roadmap = (await c.caller.product.signoff.get({ businessId: c.businessId })).roadmap!;
    await expect(c.caller.inbox.archive({ businessId: c.businessId, itemId: roadmap.inboxItemId! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // An answered one (round 1, sent back; its answer is recorded) can: the open round lives on its own, newer note.
    expect((await c.caller.inbox.archive({ businessId: c.businessId, itemId: first.spec!.inboxItemId! })).state).toBe("archived");
  });
});

describe("distribution waits for an explicit start", () => {
  let d: Awaited<ReturnType<typeof freshBusiness>>;
  beforeAll(async () => {
    d = await freshBusiness("signoff-dist@test.local", "Distribution Books");
  }, 120_000);

  it("enabling a channel before the start keeps it on the board with no engine; Start distribution (owner) starts the engines, the scoring task and the Board question, once", async () => {
    const enabled = await d.caller.distribution.channels.enable({ businessId: d.businessId, channelKey: "affiliate" });
    expect(enabled.channel.enabled).toBe(true);
    expect(enabled.channel.engineWorkflowId).toBeNull();
    expect(enabled.workflow).toMatchObject({ queued: false, reason: "distribution_not_started" });
    expect(temporal.starts.some((s) => s.type === "channelEngine" && s.workflowId === `engine:${enabled.channel.id}`)).toBe(false);
    // A member may not start distribution.
    const memberId = await hz.h.createUser("signoff-member@test.local");
    await repos.memberships.add(hz.db, d.businessId, { userId: memberId, role: "member" });
    await expect(hz.caller({ userId: memberId }).business.startDistribution({ businessId: d.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const started = await d.caller.business.startDistribution({ businessId: d.businessId });
    expect(started.started).toBe(true);
    expect(started.boardItemId).toBeTruthy();
    expect(started.scoringTaskId).toBeTruthy();
    const channels = await repos.channels.list(hz.db, d.businessId, { enabled: true });
    expect(started.engines.map((e) => e.workflowId).sort()).toEqual(channels.map((c) => `engine:${c.id}`).sort());
    for (const c of channels) {
      expect(temporal.starts.some((s) => s.type === "channelEngine" && s.workflowId === `engine:${c.id}`)).toBe(true);
      expect(c.engineWorkflowId).toBe(`engine:${c.id}`);
    }
    const board = await d.caller.inbox.get({ businessId: d.businessId, itemId: started.boardItemId! });
    expect(board.item).toMatchObject({ type: "decision", subject: "Where should the first customer come from?", blocksContinue: false });
    expect((board.item.decision as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
    const scoring = await repos.tasks.get(hz.db, d.businessId, started.scoringTaskId!);
    expect(scoring).toMatchObject({ kind: "channel", title: CHANNEL_SCORING_TASK.title, status: "ready" });
    expect(scoring.assigneeAgentId).toBeTruthy();
    expect((await repos.agents.get(hz.db, d.businessId, scoring.assigneeAgentId!)).agentType).toBe("distribution_strategist");
    const business = await d.caller.business.get({ businessId: d.businessId });
    expect(business.distributionStartedAt).not.toBeNull();
    expect(business.productStage).toBe("selling");
    const events = await repos.events.list(hz.db, d.businessId, { type: "distribution.started" });
    expect(events.items).toHaveLength(1);
    expect((events.items[0]!.payload as { via: string; channelIds: string[] }).channelIds.sort()).toEqual(channels.map((c) => c.id).sort());
    expect((await repos.audit.list(hz.db, d.businessId, { action: "distribution.start", limit: 5 })).items).toHaveLength(1);
    const note = (await bySubject(d.caller, d.businessId, "Distribution has started"))[0];
    expect(note?.bodyMd).toMatch(/channels are on the board/);
    // Idempotent: nothing new on a second start.
    const again = await d.caller.business.startDistribution({ businessId: d.businessId });
    expect(again).toMatchObject({ started: false, boardItemId: null });
    expect(await bySubject(d.caller, d.businessId, "Where should the first customer come from?")).toHaveLength(1);
    // Enabling a channel after the start starts its engine as before (AC-11.7.2).
    const later = await d.caller.distribution.channels.enable({ businessId: d.businessId, channelKey: "pr" });
    expect(later.workflow.queued).toBe(true);
    expect(later.channel.engineWorkflowId).toBe(`engine:${later.channel.id}`);
  });

  it("the Ready to start selling? note: Not yet declines it and distribution stays off; Start distribution now from the note starts it", async () => {
    const e = await freshBusiness("signoff-ready@test.local", "Ready Books");
    const chief = (await repos.agents.chiefOfStaff(hz.db, e.businessId))!;
    const item = (await repos.product.listRoadmap(hz.db, e.businessId, { horizon: "now" }))[0]!;
    const offer = (note: string) => repos.productSignoffs.offerReadyToSell(hz.db, e.businessId, { roadmapItemId: item.id, title: item.title, chiefId: chief.id, item: { type: "decision", from_agent_id: chief.id, subject: "Ready to start selling?", body_md: note, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: signoffDecisionBlock("ready_to_sell"), blocks_continue: false, source_event_ids: [], entity_ids: [] } });
    const offered = (await offer(`${item.title} shipped: its tasks are done.`))!;
    expect(offered.item.blocksContinue).toBe(false);
    const declined = await e.caller.inbox.decide({ businessId: e.businessId, itemId: offered.item.id, chosenOption: "not_yet" });
    expect(declined.item.state).toBe("answered");
    expect(declined.followUp?.bodyMd).toContain("Start distribution any time from Customers › Board.");
    expect((await e.caller.product.signoff.get({ businessId: e.businessId })).readyToSell).toMatchObject({ status: "declined" });
    expect((await e.caller.business.get({ businessId: e.businessId })).distributionStartedAt).toBeNull();
    // Offered once per business: no second note.
    expect(await offer("again")).toBeNull();

    const f = await freshBusiness("signoff-ready2@test.local", "Ready Books Two");
    const chief2 = (await repos.agents.chiefOfStaff(hz.db, f.businessId))!;
    const item2 = (await repos.product.listRoadmap(hz.db, f.businessId, { horizon: "now" }))[0]!;
    const offered2 = (await repos.productSignoffs.offerReadyToSell(hz.db, f.businessId, { roadmapItemId: item2.id, title: item2.title, chiefId: chief2.id, item: { type: "decision", from_agent_id: chief2.id, subject: "Ready to start selling?", body_md: "Shipped.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: signoffDecisionBlock("ready_to_sell"), blocks_continue: false, source_event_ids: [], entity_ids: [] } }))!;
    const started = await f.caller.inbox.decide({ businessId: f.businessId, itemId: offered2.item.id, chosenOption: "start" });
    expect(started.item.state).toBe("answered");
    expect(started.followUp?.subject).toBe("Distribution has started");
    expect((await f.caller.product.signoff.get({ businessId: f.businessId })).readyToSell).toMatchObject({ status: "approved" });
    expect((await f.caller.business.get({ businessId: f.businessId })).productStage).toBe("selling");
    expect(await bySubject(f.caller, f.businessId, "Where should the first customer come from?")).toHaveLength(1);
  });
});

describe("buildingStartsBody (WP-02 T5)", () => {
  const build = { plannedTaskIds: ["t1"], planned: ["Landing page"], failed: [], cycle: { started: false, mode: null, workflowId: null, reason: null }, importItemId: null } as unknown as Parameters<typeof buildingStartsBody>[0];
  it("names a round of work, and says the code stays in the project only when there is no repository", () => {
    expect(buildingStartsBody(build, "none")).toContain("Press Continue to start the first round of work. The code is kept in your project; nothing goes live from it until a repository is connected.");
    expect(buildingStartsBody(build, "github")).toContain("Press Continue to start the first round of work. Distribution");
    expect(buildingStartsBody(build, "github")).not.toContain("kept in your project");
  });
});
