/**
 * The business's goal (founder, 2026-11-07: "Your goal"): the Chief of Staff (by its stored name) proposes once both
 * sign-offs are approved and a round of work finished after the roadmap's approval; any member who can write approves in
 * one tap or asks for a change in words (the goal route in mock mode, the deterministic reader as the fallback), which
 * yields a revised proposal; a reached goal is marked achieved with "Goal reached: …" and the next is proposed; a missed
 * date proposes a new one while the old stays active. Goal notes never hold Continue; viewers never write.
 */
import { repos, signoffDecisionBlock, type ComposerItem } from "@foundmill/db";
import { MockModelClient, ModelUnavailableError } from "@foundmill/models";
import { GOAL_SAY_A_NUMBER, addDaysToDay, dayKeyIn, defaultGoalFor, goalProposalSubject, goalSentence, parseGoalWords } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "goals" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const today = () => dayKeyIn(new Date(), "UTC");
const CHIEF = "Ines Park";

const signoffNote = (agentId: string, kind: "spec" | "roadmap"): ComposerItem => ({ type: "decision", from_agent_id: agentId, subject: kind === "spec" ? "Sign off the product specification" : "Sign off the product roadmap", body_md: "Approve it or ask for changes.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: signoffDecisionBlock(kind), blocks_continue: false, source_event_ids: [], entity_ids: [] });

let n = 0;
/** A committed business with an owner, a member and a viewer, a Chief of Staff named Ines Park, and open sign-offs. */
async function business(name: string) {
  n += 1;
  const [ownerId, memberId, viewerId] = await Promise.all(["owner", "member", "viewer"].map((r) => hz.h.createUser(`goals-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const chief = await repos.agents.create(hz.db, b.id, { name: CHIEF, agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  const owner = hz.caller({ userId: ownerId! });
  const member = hz.caller({ userId: memberId! });
  const viewer = hz.caller({ userId: viewerId! });
  return { id: b.id, chief, owner, member, viewer, ownerId: ownerId! };
}

/** Both sign-offs approved now, then a round of work finished a second later. */
async function signedOffAndWorked(b: Awaited<ReturnType<typeof business>>) {
  const spec = await repos.productSignoffs.open(hz.db, b.id, { kind: "spec", item: signoffNote(b.chief.id, "spec") });
  const roadmap = await repos.productSignoffs.open(hz.db, b.id, { kind: "roadmap", item: signoffNote(b.chief.id, "roadmap") });
  await repos.productSignoffs.decide(hz.db, b.id, spec.signoff.id, { status: "approved", decidedBy: b.ownerId });
  await repos.productSignoffs.decide(hz.db, b.id, roadmap.signoff.id, { status: "approved", decidedBy: b.ownerId });
  await repos.events.write(hz.db, b.id, { type: "cycle.completed", occurredAt: new Date(Date.now() + 1_000), actor: { kind: "system", id: "cycle" }, payload: { cycleId: "c1" } });
}

const goalItems = async (caller: ReturnType<ApiHarness["caller"]>, businessId: string) => (await caller.inbox.list({ businessId, tab: "respond", limit: 100 })).items.filter((i) => /goal/i.test(i.subject));

describe("goal.ensure: when the Chief of Staff proposes the first goal", () => {
  it("waits for both sign-offs and a round of work after the roadmap's approval; proposes once; viewers never write", async () => {
    const b = await business("Goal Timing Co");
    const spec = await repos.productSignoffs.open(hz.db, b.id, { kind: "spec", item: signoffNote(b.chief.id, "spec") });
    const roadmap = await repos.productSignoffs.open(hz.db, b.id, { kind: "roadmap", item: signoffNote(b.chief.id, "roadmap") });
    // Sign-offs pending: nothing.
    expect(await b.owner.goal.ensure({ businessId: b.id })).toMatchObject({ proposedNow: false, active: null, proposed: null });
    await repos.events.write(hz.db, b.id, { type: "cycle.completed", actor: { kind: "system", id: "cycle" }, payload: { cycleId: "c0" } });
    await repos.productSignoffs.decide(hz.db, b.id, spec.signoff.id, { status: "approved", decidedBy: b.ownerId });
    await repos.productSignoffs.decide(hz.db, b.id, roadmap.signoff.id, { status: "approved", decidedBy: b.ownerId });
    // Both approved, but the only round of work finished before the roadmap's approval: nothing yet.
    expect((await b.owner.goal.ensure({ businessId: b.id })).proposedNow).toBe(false);
    await repos.events.write(hz.db, b.id, { type: "cycle.completed", occurredAt: new Date(Date.now() + 1_000), actor: { kind: "system", id: "cycle" }, payload: { cycleId: "c1" } });
    // A viewer's visit writes nothing, even now.
    expect(await b.viewer.goal.ensure({ businessId: b.id })).toMatchObject({ proposedNow: false, proposed: null, canDecide: false });
    expect(await repos.goals.recent(hz.db, b.id)).toEqual([]);

    const first = await b.member.goal.ensure({ businessId: b.id });
    const shape = defaultGoalFor({ payingCustomers: 0, today: today() });
    expect(first).toMatchObject({ proposedNow: true, canDecide: true, active: null, proposed: { revision: 1, status: "proposed", kind: "paying_customers", target: 10, dueOn: addDaysToDay(today(), 42), reason: "first", proposedBy: { id: b.chief.id, name: CHIEF } } });
    expect(first.proposed!.sentence).toBe(goalSentence(shape, { today: today(), startValue: 0 }));
    expect(first.proposed!.sentence).toMatch(/^Get the first 10 paying customers by [A-Z][a-z]{2} \d{1,2}$/);
    // Idempotent: a second visit (any member) writes nothing more.
    expect((await b.owner.goal.ensure({ businessId: b.id })).proposedNow).toBe(false);
    expect(await repos.goals.recent(hz.db, b.id)).toHaveLength(1);

    const notes = await goalItems(b.owner, b.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "decision", fromAgentId: b.chief.id, blocksContinue: false, subject: goalProposalSubject(shape, "first", today()) });
    expect(notes[0]!.bodyMd).toContain("I suggest we aim for this next, so every round of work moves one thing. Approve it, or tell me what to change.");
    expect((notes[0]!.decision as { options: { id: string; label: string; recommended: boolean; because?: string }[] }).options).toEqual([
      expect.objectContaining({ id: "approve", label: "Approve this goal", recommended: true, because: "Recommended because the first customers tell us what to build next." }),
      expect.objectContaining({ id: "change", label: "Change it", recommended: false }),
    ]);
    // A goal note never holds Continue (0071).
    expect((await b.owner.inbox.list({ businessId: b.id, tab: "respond" })).continueState).toEqual({ kind: "idle" });
    const events = await repos.events.list(hz.db, b.id, { type: "goal.proposed" });
    expect(events.items.map((e) => (e.payload as { reason: string; source: string }).reason)).toEqual(["first"]);
    // Viewers read the goal but cannot decide it.
    expect((await b.viewer.goal.current({ businessId: b.id })).proposed?.id).toBe(first.proposed!.id);
    await expect(b.viewer.goal.approve({ businessId: b.id, goalId: first.proposed!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(b.viewer.goal.requestChange({ businessId: b.id, goalId: first.proposed!.id, notes: "20 customers" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(b.viewer.inbox.decide({ businessId: b.id, itemId: notes[0]!.id, chosenOption: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The open proposal is answered, never filed away.
    await expect(b.owner.inbox.archive({ businessId: b.id, itemId: notes[0]!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("deciding the goal from the Inbox", () => {
  it("Change it in words gives a revised proposal (the goal route in mock mode); words with no number or date replace nothing", async () => {
    const b = await business("Goal Change Co");
    await signedOffAndWorked(b);
    const { proposed } = await b.owner.goal.ensure({ businessId: b.id });
    const note = (await goalItems(b.owner, b.id))[0]!;
    // "Change it" with no words asks for them; words the reader cannot use replace nothing.
    await expect(b.owner.inbox.decide({ businessId: b.id, itemId: note.id, chosenOption: "change" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(b.owner.goal.requestChange({ businessId: b.id, goalId: proposed!.id, notes: "Make it more ambitious please" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: GOAL_SAY_A_NUMBER });
    expect((await repos.goals.get(hz.db, b.id, proposed!.id))?.status).toBe("proposed");

    const words = "20 customers by Jan 31";
    const decided = await b.member.inbox.decide({ businessId: b.id, itemId: note.id, freeText: words });
    expect(decided.item.state).toBe("answered");
    expect(decided.decision).toMatchObject({ chosenOption: "change", freeText: words });
    expect(decided.plan.actions.map((a) => a.type)).toEqual(["reply_only"]);
    const expected = parseGoalWords(words, { base: defaultGoalFor({ payingCustomers: 0, today: today() }), today: today(), currency: "EUR" })!;
    expect(decided.followUp).toMatchObject({ type: "decision", fromAgentId: b.chief.id, subject: goalProposalSubject(expected, "revised", today()), blocksContinue: false });
    expect(decided.followUp!.bodyMd).toContain(`You asked: “${words}”.`);
    const after = await b.owner.goal.current({ businessId: b.id });
    expect(after.proposed).toMatchObject({ revision: 2, reason: "revised", kind: "paying_customers", target: 20, dueOn: expected.dueOn, sentence: goalSentence(expected, { today: today(), startValue: 0 }) });
    expect(after.proposed!.sentence).toMatch(/^Get the first 20 paying customers by Jan 31/);
    expect(await repos.goals.get(hz.db, b.id, proposed!.id)).toMatchObject({ status: "replaced", changeRequest: words });
    const changed = await repos.events.list(hz.db, b.id, { type: "goal.change_requested" });
    expect(changed.items[0]?.payload).toMatchObject({ goalId: proposed!.id, words, revisedGoalId: after.proposed!.id, via: "inbox" });
    // The changed proposal cannot be approved any more.
    await expect(b.owner.goal.approve({ businessId: b.id, goalId: proposed!.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // Approve this goal: one tap from the Inbox; it becomes the active goal and leaves Needs you.
    const revisedNote = decided.followUp!;
    const approved = await b.owner.inbox.decide({ businessId: b.id, itemId: revisedNote.id, chosenOption: "approve" });
    expect(approved.item.state).toBe("answered");
    expect(approved.followUp).toBeNull();
    const active = await b.owner.goal.current({ businessId: b.id });
    expect(active).toMatchObject({ proposed: null, active: { id: after.proposed!.id, status: "active", startValue: 0, progress: { current: 0 } } });
    expect(active.active!.progress!.pace).toMatch(/^0 of 20 so far, \d+ days left: at this pace about 0 by Jan 31 \(Forecast\)\.$/);
    expect(await goalItems(b.owner, b.id)).toEqual([]);
    expect((await repos.events.list(hz.db, b.id, { type: "goal.approved" })).items[0]?.payload).toMatchObject({ goalId: after.proposed!.id, via: "inbox", replacedGoalId: null });
    await expect(b.owner.inbox.decide({ businessId: b.id, itemId: revisedNote.id, chosenOption: "approve" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the model not answering, or answering outside the rules, falls back to the deterministic reader", async () => {
    const b = await business("Goal Fallback Co");
    await signedOffAndWorked(b);
    const { proposed } = await b.owner.goal.ensure({ businessId: b.id });
    // A caller reads the model client when it is made, so each swap below makes a new one.
    const working = hz.deps.models;
    try {
      hz.deps.models = new MockModelClient({ failWith: { goalProposal: new ModelUnavailableError("upstream 529 overloaded") } });
      const res = await hz.caller({ userId: b.ownerId }).goal.requestChange({ businessId: b.id, goalId: proposed!.id, notes: "50 signups in 8 weeks" });
      expect(res.revised).toMatchObject({ metricKind: "signups", targetValue: 50, dueOn: addDaysToDay(today(), 56), status: "proposed" });
      expect((await repos.events.list(hz.db, b.id, { type: "goal.proposed" })).items.map((e) => (e.payload as { source: string }).source)).toContain("parser");

      // A date in the past is outside the rules: the reader's answer stands.
      hz.deps.models = new MockModelClient({ overrides: { goalProposal: () => ({ changed: true, kind: "signups", target: 999, due_on: "2020-01-01", custom_words: null }) } });
      const second = await hz.caller({ userId: b.ownerId }).goal.requestChange({ businessId: b.id, goalId: res.revised!.id, notes: "make it 80" });
      expect(second.revised).toMatchObject({ metricKind: "signups", targetValue: 80, dueOn: addDaysToDay(today(), 56) });

      // A valid model answer is used as it is (the words are the model's to read).
      hz.deps.models = new MockModelClient({ overrides: { goalProposal: () => ({ changed: true, kind: "custom", target: null, due_on: addDaysToDay(today(), 30), custom_words: "Launch the booking page" }) } });
      const third = await hz.caller({ userId: b.ownerId }).goal.requestChange({ businessId: b.id, goalId: second.revised!.id, notes: "Actually I want the booking page live first" });
      expect(third.revised).toMatchObject({ metricKind: "custom", targetValue: null, dueOn: addDaysToDay(today(), 30) });
      expect(third.revised!.sentence).toMatch(/^Launch the booking page by [A-Z][a-z]{2} \d{1,2}$/);
      const view = await b.owner.goal.current({ businessId: b.id });
      expect(view.proposed).toMatchObject({ kind: "custom", progress: null });
    } finally {
      hz.deps.models = working;
    }
  });
});

describe("reaching and missing a goal", () => {
  it("a reached goal is marked achieved with the Chief of Staff's note, and the next goal is proposed", async () => {
    const b = await business("Goal Reached Co");
    await repos.goals.seedActive(hz.db, b.id, { sentence: "Get the first 2 paying customers by Dec 19", kind: "paying_customers", target: 2, dueOn: addDaysToDay(today(), 20), startValue: 0, approvedAt: new Date(Date.now() - 5 * 86_400_000), agentId: b.chief.id });
    await repos.journeys.recordConversion(hz.db, b.id, { kind: "payment", amountMinor: 4_900, currency: "EUR", firstPayment: true });
    expect((await b.owner.goal.ensure({ businessId: b.id })).achievedNow).toBe(false);
    await repos.journeys.recordConversion(hz.db, b.id, { kind: "payment", amountMinor: 4_900, currency: "EUR", firstPayment: true });
    const res = await b.owner.goal.ensure({ businessId: b.id });
    expect(res).toMatchObject({ achievedNow: true, proposedNow: true, active: null, proposed: { reason: "next", kind: "paying_customers", target: 10 } });
    const inbox = (await b.owner.inbox.list({ businessId: b.id, limit: 100 })).items;
    const reached = inbox.find((i) => i.subject === "Goal reached: 2 paying customers");
    expect(reached).toMatchObject({ type: "milestone", fromAgentId: b.chief.id, blocksContinue: false });
    expect(reached!.bodyMd).toMatch(/^Reached on [A-Z][a-z]{2} \d{1,2}, 20 days early\. The goal was: get the first 2 paying customers by Dec 19\./);
    expect(inbox.find((i) => i.subject.startsWith("Your next goal: get 10 paying customers by "))).toBeTruthy();
    expect((await repos.events.list(hz.db, b.id, { type: "goal.achieved" })).items[0]?.payload).toMatchObject({ achievedValue: 2, inboxItemId: reached!.id });
  });

  it("a missed date proposes the same aim with a new date; the old goal stays active until the founder approves", async () => {
    const b = await business("Goal Missed Co");
    const old = await repos.goals.seedActive(hz.db, b.id, { sentence: "Get the first 10 paying customers by Nov 1", kind: "paying_customers", target: 10, dueOn: addDaysToDay(today(), -3), startValue: 0, approvedAt: new Date(Date.now() - 45 * 86_400_000), agentId: b.chief.id });
    const res = await b.owner.goal.ensure({ businessId: b.id });
    expect(res).toMatchObject({ proposedNow: true, active: { id: old!.id, status: "active" }, proposed: { reason: "missed", target: 10, dueOn: addDaysToDay(today(), 42) } });
    expect(res.active!.progress!.pace).toMatch(/passed at 0 of 10\.$/);
    const note = (await goalItems(b.owner, b.id))[0]!;
    expect(note.subject).toMatch(/^A new date for your goal: get 10 paying customers by /);
    expect(note.bodyMd).toContain("passed at 0 of 10. I suggest the same aim with a new date. The current goal stays until you approve this one.");
    expect(note.blocksContinue).toBe(false);
    // Asked again before the founder answers: still one proposal.
    expect((await b.owner.goal.ensure({ businessId: b.id })).proposedNow).toBe(false);
    await b.member.goal.approve({ businessId: b.id, goalId: res.proposed!.id });
    const after = await b.owner.goal.current({ businessId: b.id });
    expect(after).toMatchObject({ proposed: null, active: { id: res.proposed!.id } });
    expect((await repos.goals.get(hz.db, b.id, old!.id))?.status).toBe("replaced");
    expect((await b.owner.inbox.get({ businessId: b.id, itemId: note.id })).item.state).toBe("answered");
  });
});
