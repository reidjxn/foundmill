/**
 * The collaborator's walls, the Finance fields (Nov 14, 2026; the follow-ups of the events walls). A collaborator reads
 * Product, Development, Customers, the Inbox and the Team, never Finance (@foundmill/shared `COLLABORATOR_SECTIONS`), and
 * no procedure they may call hands them a Finance figure. The same holds for any member walled off Finance. Each case
 * also checks that the owner and a member with Finance read still get the figure:
 *
 *   - `cycle.status` and the status Continue's controls answer with (`business.pauseCycle`): no `lastCost`;
 *     `cycle.history` carries no cost; the vacation's condition on Continue loses its figures;
 *   - Today: the Needs you subjects masked (Today carries no cost figure for anyone, WP-14 T4);
 *   - the Team's agent health still explains a status, read from the event with its budget cut;
 *   - goals: `goal.approve` answers a revenue goal without its money, as `goal.current` shows it;
 *   - approvals: `team.approvals.resolve` answers without the amount, its currency or the call's arguments;
 *   - `journey.ribbon`: each day's and each chapter's spend and revenue read 0, a revenue milestone's amount is hidden;
 *     the counts are the same as the owner's;
 *   - `crm.entity.get`: a payment's amount is null, with `moneyHidden`;
 *   - the Inbox: what a note cost to write is null.
 */
import { repos, type ComposerItem } from "@foundmill/db";
import { addDaysToDay, dayKeyIn, goalOptions } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let bid: string;
let collaboratorId: string;
let walledId: string;
type Caller = ReturnType<ApiHarness["caller"]>;
let owner: Caller;
let member: Caller;
let collaborator: Caller;
let walled: Caller;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "collab-finance" });
  bid = hz.A.businessId;
  [collaboratorId, walledId] = await Promise.all([hz.h.createUser("collab-finance-collaborator@test.local"), hz.h.createUser("collab-finance-walled@test.local")]);
  await repos.memberships.add(hz.db, bid, { userId: collaboratorId, role: "collaborator" });
  await repos.memberships.add(hz.db, bid, { userId: walledId, role: "member", sectionPermissions: { finance: "none" } });
  owner = hz.caller({ userId: hz.A.ownerId });
  member = hz.caller({ userId: hz.A.memberId });
  collaborator = hz.caller({ userId: collaboratorId });
  walled = hz.caller({ userId: walledId });
}, 120_000);
afterAll(() => hz?.close());

const COST = { amountMinor: 120, currency: "USD" };
const note = (agentId: string, subject: string): ComposerItem => ({ type: "decision", from_agent_id: agentId, subject, body_md: "Pick one.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "a", label: "Yes", recommended: true, consequence: "Ads start today.", cost_minor: 0, reversible: true }, { id: "b", label: "No", recommended: false, consequence: "Nothing starts.", cost_minor: 0, reversible: true }], free_text: false, expires_at: null }, blocks_continue: false, source_event_ids: [], entity_ids: [] });

describe("rounds of work and Continue", () => {
  beforeAll(async () => {
    const at = Date.now() + 5_000;
    await repos.events.write(hz.db, bid, { type: "cycle.started", occurredAt: new Date(at), actor: { kind: "system", id: "cycle" }, payload: { cycleId: "cf-1", cycleNumber: 41, workflowId: "cycle:cf-1", trigger: "continue", budget: COST, plannedTaskIds: [] } });
    await repos.events.write(hz.db, bid, { type: "cycle.completed", occurredAt: new Date(at + 1_000), actor: { kind: "system", id: "cycle" }, payload: { cycleId: "cf-1", cycleNumber: 41, workflowId: "cycle:cf-1", outcome: "completed", tasksDispatched: 2, tasksCompleted: 2, inboxItemIds: [], durationMs: 1_000, cost: COST } });
  });

  it("cycle.status: the last round's cost for the owner and a member, none for a collaborator or a member walled off Finance", async () => {
    for (const c of [owner, member]) expect((await c.cycle.status({ businessId: bid })).lastCost).toEqual(COST);
    for (const c of [collaborator, walled]) {
      const status = await c.cycle.status({ businessId: bid });
      expect(status.lastCost).toBeNull();
      // Everything else is the same as the owner's.
      expect(status).toMatchObject({ completedCount: expect.any(Number), lastOutcome: "completed", nextCycleNumber: 42 });
    }
  });

  it("cycle.history carries no cost or budget for anyone, and the same rounds for a collaborator", async () => {
    const theirs = await collaborator.cycle.history({ businessId: bid, limit: 20 });
    const ours = await owner.cycle.history({ businessId: bid, limit: 20 });
    expect(theirs).toEqual(ours);
    expect(theirs.cycles.find((c) => c.cycleId === "cf-1")).toMatchObject({ outcome: "completed", tasksCompleted: 2 });
    expect(JSON.stringify(theirs)).not.toMatch(/amountMinor|budget|"cost"/);
  });

  it("the status Continue's controls answer with (business.pauseCycle) has no cost for a collaborator", async () => {
    const theirs = await collaborator.business.pauseCycle({ businessId: bid });
    expect(theirs.status.lastCost).toBeNull();
    expect((await owner.business.pauseCycle({ businessId: bid })).status.lastCost).toEqual(COST);
  });

  it("a vacation's condition on Continue loses its figures behind a Finance wall", async () => {
    const holiday = await repos.holidays.start(hz.db, bid, { untilCondition: { text: "MRR hits €10,000" }, startedBy: hz.A.ownerId });
    try {
      const ours = await owner.cycle.continueState({ businessId: bid });
      expect(ours).toMatchObject({ kind: "holiday", untilLabel: expect.stringContaining("€10,000") });
      for (const c of [collaborator, walled]) {
        const theirs = await c.cycle.continueState({ businessId: bid });
        expect(theirs.kind).toBe("holiday");
        const label = (theirs as { untilLabel: string | null }).untilLabel;
        expect(label).toContain("(amount hidden)");
        expect(label).not.toContain("10,000");
      }
    } finally {
      await repos.holidays.end(hz.db, bid, holiday.id);
    }
  });
});

describe("Today", () => {
  it("the Needs you subjects masked for a collaborator; the owner reads them", async () => {
    await repos.inbox.createItem(hz.db, bid, note(hz.A.agentId, "Approve €2,000 for the launch ads"));
    const ours = await owner.today.get({ businessId: bid });
    expect(ours.needsYou?.items.map((i) => i.subject)).toContain("Approve €2,000 for the launch ads");
    const theirs = await collaborator.today.get({ businessId: bid });
    expect(JSON.stringify(theirs.needsYou)).not.toContain("2,000");
    expect(theirs.needsYou?.items.some((i) => i.subject.includes("(amount hidden)"))).toBe(true);
  });
});

describe("the Team", () => {
  it("an agent's health is still explained to a collaborator, from the event without its budget", async () => {
    await repos.agents.setStatus(hz.db, bid, hz.A.agent2Id, "paused");
    await repos.events.write(hz.db, bid, { type: "agent.health_changed", actor: { kind: "system", id: "health" }, entityIds: [], payload: { agentId: hz.A.agent2Id, from: "healthy", to: "paused", reason: "wage cap reached for the period", signals: { loopDetected: true, budgetRemaining: 0 } } });
    for (const c of [owner, collaborator]) {
      const rows = (await c.team.agents.list({ businessId: bid })).agents;
      const row = rows.find((a) => a.id === hz.A.agent2Id);
      expect(row?.health).toMatchObject({ reason: "wage cap reached for the period", loopDetected: true });
      expect(JSON.stringify(row?.health)).not.toContain("budgetRemaining");
    }
  });
});

describe("goals", () => {
  it("goal.approve answers a revenue goal without its money to a member walled off Finance; the owner reads it", async () => {
    const dueOn = addDaysToDay(dayKeyIn(new Date(), "UTC"), 60);
    const proposed = await repos.goals.propose(hz.db, bid, { sentence: "Reach €5,000 revenue in a month by Jan 13", kind: "revenue_month", target: 500_000, currency: "EUR", dueOn, startValue: 0, reason: "first", agentId: hz.A.agentId, item: { ...note(hz.A.agentId, "A goal for the next weeks: Reach €5,000 revenue in a month"), decision: { options: goalOptions({ kind: "revenue_month" }, "first"), free_text: true, expires_at: null } } });
    expect((await collaborator.goal.current({ businessId: bid })).proposed).toMatchObject({ target: null, startValue: null });
    expect((await owner.goal.current({ businessId: bid })).proposed).toMatchObject({ target: 500_000 });
    const answer = await walled.goal.approve({ businessId: bid, goalId: proposed.goal.id });
    expect(answer.goal).toMatchObject({ id: proposed.goal.id, status: "active", targetValue: null, startValue: null, achievedValue: null });
    expect(answer.goal.sentence).not.toContain("5,000");
    expect((await owner.goal.current({ businessId: bid })).active).toMatchObject({ id: proposed.goal.id, target: 500_000 });
    // A collaborator reads the Inbox, never writes it: no goal decisions at all.
    await expect(collaborator.goal.approve({ businessId: bid, goalId: proposed.goal.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("approvals", () => {
  it("team.approvals.resolve answers without the amount to an admin walled off Finance; the pending list hides it from a collaborator", async () => {
    const task = await repos.tasks.create(hz.db, bid, { kind: "ops", title: "Buy the domain", goalMd: "x", assigneeAgentId: hz.A.agentId, status: "running" });
    const session = await repos.agents.createSession(hz.db, bid, { agentId: hz.A.agentId, taskId: task.id, modelKey: "sonnet" });
    const approval = await repos.approvals.create(hz.db, bid, { agentId: hz.A.agentId, sessionId: session.id, connectorKey: "github", tool: "run_migration", args: { file: "0019_idx.sql", note: "costs $99" }, reasons: ["spends $99 of your money"], amountMinor: 9_900, currency: "USD" });
    const pendingOurs = (await owner.team.approvals.pending({ businessId: bid })).find((a) => a.id === approval.id);
    expect(pendingOurs).toMatchObject({ amountMinor: 9_900, currency: "USD" });
    const pendingTheirs = (await collaborator.team.approvals.pending({ businessId: bid })).find((a) => a.id === approval.id);
    expect(pendingTheirs).toMatchObject({ amountMinor: null, currency: null, amountHidden: true, args: {} });
    await repos.memberships.setSectionPermissions(hz.db, bid, hz.A.adminId, { finance: "none" });
    try {
      const answer = await hz.caller({ userId: hz.A.adminId }).team.approvals.resolve({ businessId: bid, approvalId: approval.id, outcome: "rejected", note: "Not now" });
      expect(answer).toMatchObject({ id: approval.id, outcome: "rejected", amountMinor: null, currency: null, args: {} });
      expect(answer.reasons.join(" ")).not.toContain("$99");
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, bid, hz.A.adminId, {});
    }
    expect(await repos.approvals.get(hz.db, bid, approval.id)).toMatchObject({ outcome: "rejected", amountMinor: 9_900 });
  });
});

describe("the Ribbon and the Customers screens", () => {
  beforeAll(async () => {
    await repos.journeys.createMilestone(hz.db, bid, { kind: "revenue", label: "€10k MRR", achievedAt: new Date() });
    await repos.journeys.refreshDaily(hz.db);
  });

  it("journey.ribbon: every day's and every chapter's spend and revenue read 0 for a collaborator, with the same counts", async () => {
    const ours = await owner.journey.ribbon({ businessId: bid });
    expect(ours.rows.reduce((n, r) => n + r.revenueMinor, 0)).toBeGreaterThan(0);
    expect(ours.chapters.reduce((n, c) => n + c.summary.revenueMinor, 0)).toBeGreaterThan(0);
    expect(ours.milestones.map((m) => m.label)).toContain("€10k MRR");
    for (const c of [collaborator, walled]) {
      const theirs = await c.journey.ribbon({ businessId: bid });
      expect(theirs.redacted).toContain("finance");
      expect(theirs.rows.length).toBe(ours.rows.length);
      expect(theirs.rows.every((r) => r.revenueMinor === 0 && r.spendMinor === 0)).toBe(true);
      expect(theirs.chapters.every((ch) => ch.summary.revenueMinor === 0 && ch.summary.spendMinor === 0)).toBe(true);
      expect(theirs.chapters.map((ch) => ch.id)).toEqual(ours.chapters.map((ch) => ch.id));
      expect(theirs.conversionCount).toBe(ours.conversionCount);
      expect(theirs.customers).toEqual(ours.customers);
      expect(theirs.conversions.every((x) => x.amountMinor === 0)).toBe(true);
      expect(theirs.milestones.map((m) => m.label)).toContain("(amount hidden) MRR");
      expect(JSON.stringify(theirs.milestones)).not.toContain("10k");
    }
  });

  it("crm.entity.get: a payment's amount is null with moneyHidden for a collaborator; the owner reads it", async () => {
    const ours = await owner.crm.entity.get({ businessId: bid, entityId: hz.A.entityId });
    expect(ours.moneyHidden).toBe(false);
    expect(ours.conversions.filter((c) => c.kind === "payment").map((c) => c.amountMinor)).toContain(4_900);
    for (const c of [collaborator, walled]) {
      const theirs = await c.crm.entity.get({ businessId: bid, entityId: hz.A.entityId });
      expect(theirs.moneyHidden).toBe(true);
      expect(theirs.conversions.map((x) => x.id).sort()).toEqual(ours.conversions.map((x) => x.id).sort());
      expect(theirs.conversions.every((x) => x.amountMinor === null)).toBe(true);
    }
  });

  it("a Customer Update keeps its shape for a collaborator, its amount 0 (journey.list, journey.get)", async () => {
    const payment = (await repos.journeys.listConversions(hz.db, bid, { kind: "payment", limit: 1 })).items[0]!;
    const journey = await repos.journeys.create(hz.db, bid, { conversionId: payment.id, matchdayLevel: "league" });
    const list = await collaborator.journey.list({ businessId: bid });
    expect(list.items.find((j) => j.id === journey.id)?.conversion).toMatchObject({ id: payment.id, amountMinor: 0 });
    const detail = await collaborator.journey.get({ businessId: bid, journeyId: journey.id });
    expect(detail.conversion.amountMinor).toBe(0);
    expect(detail.redacted).toContain("finance");
    expect((await owner.journey.get({ businessId: bid, journeyId: journey.id })).conversion.amountMinor).toBe(4_900);
  });
});

describe("the Inbox", () => {
  it("what a note cost to write is null for a collaborator; the owner reads it", async () => {
    const item = await repos.inbox.createItem(hz.db, bid, { ...note(hz.A.agentId, "Three options for the pricing page"), type: "update", decision: null }, { costMinor: 3, currency: "USD" });
    const find = async (c: Caller) => (await c.inbox.list({ businessId: bid, tab: "all", limit: 200 })).items.find((i) => i.id === item.id);
    expect((await find(owner))?.costMinor).toBe(3);
    expect((await find(collaborator))?.costMinor).toBeNull();
    expect((await collaborator.inbox.get({ businessId: bid, itemId: item.id })).item.costMinor).toBeNull();
  });
});
