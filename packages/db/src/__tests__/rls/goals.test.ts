/**
 * 0072 `goals`: the business's goal (founder, 2026-11-07). Standard tenancy: members of the business read its goals and
 * owner, admin and member propose and decide them; a viewer reads only; nobody reaches another business's goals (the
 * cross-tenant suite covers the generic cases; this one exercises the repo as the api and ingest use it).
 */
import { defaultGoalFor, goalOptions, goalProposalSubject, goalSentence } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { achieveGoalIfReached, goalCounters } from "../../goals";
import { repos, type ComposerItem, type ProposeGoalInput } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const TODAY = "2026-11-07";
const shape = defaultGoalFor({ payingCustomers: 0, today: TODAY });

const note = (agentId: string): ComposerItem => ({
  type: "decision",
  from_agent_id: agentId,
  subject: goalProposalSubject(shape, "first", TODAY),
  body_md: "I suggest we aim for this next. Approve it, or tell me what to change.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: { options: goalOptions(shape, "first"), free_text: true, expires_at: null },
  // A goal note never holds Continue (0071); the repo forces it off whatever the caller says.
  blocks_continue: true,
  source_event_ids: [],
  entity_ids: [],
});

const proposal = (agentId: string, over: Partial<ProposeGoalInput> = {}): ProposeGoalInput => ({
  sentence: goalSentence(shape, { today: TODAY, startValue: 0 }),
  kind: shape.kind,
  target: shape.target,
  dueOn: shape.dueOn,
  startValue: 0,
  reason: "first",
  agentId,
  item: note(agentId),
  ...over,
});

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "goal-a");
  B = await createBusinessFixture(h, "goal-b");
  outsiderId = await h.createUser("goal-outsider@test.local");
  await h.service().run((tx) => repos.goals.propose(tx, B.businessId, proposal(B.agentId)));
}, 120_000);
afterAll(() => h?.close());

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

describe("goals (0072)", () => {
  it("a member proposes once with the Chief of Staff's note (never holding Continue); a second proposal returns the open one", async () => {
    const first = await h.asUser(A.memberId).run((tx) => repos.goals.propose(tx, A.businessId, proposal(A.agentId)));
    expect(first.created).toBe(true);
    expect(first.goal).toMatchObject({ revision: 1, status: "proposed", metricKind: "paying_customers", targetValue: 10, dueOn: "2026-12-19", sentence: "Get the first 10 paying customers by Dec 19", proposedByAgentId: A.agentId });
    expect(first.item).toMatchObject({ type: "decision", blocksContinue: false, subject: "Your first goal: get 10 paying customers by Dec 19", fromAgentId: A.agentId });
    const again = await h.asUser(A.ownerId).run((tx) => repos.goals.propose(tx, A.businessId, proposal(A.agentId, { target: 20 })));
    expect(again).toMatchObject({ created: false, goal: { id: first.goal.id } });
    expect(await repos.goals.forInboxItem(h.db as never, A.businessId, first.item!.id)).toMatchObject({ id: first.goal.id });
    expect(await repos.goals.current(h.db as never, A.businessId)).toMatchObject({ active: null, proposed: { id: first.goal.id } });
  });

  it("a viewer, an outsider and anon cannot propose; nobody reads another business's goals", async () => {
    const d = await createBusinessFixture(h, "goal-d");
    await expectNoEffect(h.asUser(d.viewerId).run((tx) => repos.goals.propose(tx, d.businessId, proposal(d.agentId)).then((r) => (r.created ? [r] : []))));
    // An outsider does not even see the business's agent, so the note is refused before any row.
    await expect(h.asUser(outsiderId).run((tx) => repos.goals.propose(tx, d.businessId, proposal(d.agentId)))).rejects.toThrow();
    expect(await repos.goals.recent(h.db as never, d.businessId)).toEqual([]);
    const aProposal = (await repos.goals.current(h.db as never, A.businessId)).proposed!;
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => repos.goals.requestChange(tx, A.businessId, aProposal.id, { words: "20 customers" })));
    for (const userId of [A.ownerId, A.memberId, A.viewerId]) {
      const own = await h.asUser(userId).run((tx) => repos.goals.current(tx, A.businessId));
      expect(own.proposed?.businessId).toBe(A.businessId);
      expect(await h.asUser(userId).run((tx) => repos.goals.current(tx, B.businessId))).toEqual({ active: null, proposed: null });
    }
    expect(await h.asUser(outsiderId).run((tx) => repos.goals.current(tx, A.businessId))).toEqual({ active: null, proposed: null });
    await expectNoEffect(h.anon().run((tx) => repos.goals.recent(tx, A.businessId)));
    const bProposal = (await repos.goals.current(h.db as never, B.businessId)).proposed!;
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => repos.goals.approve(tx, B.businessId, bProposal.id, { approvedBy: A.ownerId })));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => repos.goals.requestChange(tx, B.businessId, bProposal.id, { words: "20 customers" })));
    expect((await repos.goals.get(h.db as never, B.businessId, bProposal.id))?.status).toBe("proposed");
  });

  it("approve is once: proposed → active; the next approval replaces the active goal; a viewer cannot decide", async () => {
    const { proposed } = await repos.goals.current(h.db as never, A.businessId);
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => repos.goals.approve(tx, A.businessId, proposed!.id, { approvedBy: A.viewerId })));
    const approved = await h.asUser(A.memberId).run((tx) => repos.goals.approve(tx, A.businessId, proposed!.id, { approvedBy: A.memberId, startValue: 0 }));
    expect(approved).toMatchObject({ goal: { status: "active", approvedBy: A.memberId }, replaced: null });
    expect(await h.asUser(A.ownerId).run((tx) => repos.goals.approve(tx, A.businessId, proposed!.id, { approvedBy: A.ownerId }))).toBeNull();

    // A change request closes a proposal with the founder's words; the active goal stays.
    const second = await h.asUser(A.ownerId).run((tx) => repos.goals.propose(tx, A.businessId, proposal(A.agentId, { reason: "next", target: 20, sentence: "Reach 20 paying customers by Dec 19" })));
    expect(second.goal.revision).toBe(2);
    const changed = await h.asUser(A.ownerId).run((tx) => repos.goals.requestChange(tx, A.businessId, second.goal.id, { words: "30 customers by Jan 31" }));
    expect(changed).toMatchObject({ status: "replaced", changeRequest: "30 customers by Jan 31" });
    expect(await h.asUser(A.ownerId).run((tx) => repos.goals.requestChange(tx, A.businessId, second.goal.id, { words: "again" }))).toBeNull();
    expect((await repos.goals.current(h.db as never, A.businessId)).active?.id).toBe(proposed!.id);

    const third = await h.asUser(A.ownerId).run((tx) => repos.goals.propose(tx, A.businessId, proposal(A.agentId, { reason: "revised", target: 30, dueOn: "2027-01-31", sentence: "Reach 30 paying customers by Jan 31", replacesGoalId: second.goal.id })));
    const swapped = await h.asUser(A.ownerId).run((tx) => repos.goals.approve(tx, A.businessId, third.goal.id, { approvedBy: A.ownerId }));
    expect(swapped).toMatchObject({ goal: { id: third.goal.id, status: "active", revision: 3 }, replaced: { id: proposed!.id, status: "replaced" } });
    expect(await repos.goals.current(h.db as never, A.businessId)).toMatchObject({ active: { id: third.goal.id }, proposed: null });
  });

  it("the shape is checked: a custom goal has no number, a revenue goal names its currency", async () => {
    await expect(h.service().run((tx) => repos.goals.propose(tx, B.businessId, proposal(B.agentId, { kind: "custom", target: 10 })))).rejects.toThrow(/custom goal/);
    await expect(h.service().run((tx) => repos.goals.seedActive(tx, B.businessId, { sentence: "Reach £5,000 of revenue in a month by Dec 19", kind: "revenue_month", target: 500_000, dueOn: "2026-12-19", approvedAt: new Date() }))).rejects.toThrow(/currency/);
  });

  it("achieveGoalIfReached marks the active goal reached once with the Chief of Staff's milestone note", async () => {
    const c = await createBusinessFixture(h, "goal-c");
    const n = (await goalCounters(h.db as never, c.businessId)).payingCustomers;
    const seeded = await h.service().run((tx) => repos.goals.seedActive(tx, c.businessId, { sentence: `Reach ${n + 1} paying customers by Dec 19`, kind: "paying_customers", target: n + 1, dueOn: "2026-12-19", startValue: n, approvedAt: new Date("2026-11-01T00:00:00Z"), agentId: c.agentId }));
    expect(seeded).toMatchObject({ status: "active" });
    // Seeded twice: the active goal stays.
    expect(await h.service().run((tx) => repos.goals.seedActive(tx, c.businessId, { sentence: "Other", kind: "signups", target: 5, dueOn: "2026-12-19", approvedAt: new Date() }))).toBeNull();
    expect(await h.service().run((tx) => achieveGoalIfReached(tx, c.businessId))).toBeNull();
    await h.service().run((tx) => repos.journeys.recordConversion(tx, c.businessId, { kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: new Date(), firstPayment: true }));
    expect((await goalCounters(h.db as never, c.businessId)).payingCustomers).toBe(n + 1);
    const reached = await h.service().run((tx) => achieveGoalIfReached(tx, c.businessId, { now: new Date("2026-12-02T12:00:00Z") }));
    expect(reached?.goal).toMatchObject({ id: seeded!.id, status: "achieved", achievedValue: n + 1 });
    expect(reached?.item).toMatchObject({ type: "milestone", subject: `Goal reached: ${n + 1} paying customers`, fromAgentId: c.agentId, blocksContinue: false });
    expect(reached?.item?.bodyMd).toContain("Reached on Dec 2, 17 days early.");
    expect(await h.service().run((tx) => achieveGoalIfReached(tx, c.businessId))).toBeNull();
  });
});
