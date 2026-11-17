/**
 * today.get, the business's front door (founder, 2026-11-07): the first three notes of Needs you with a one-tap answer
 * only where no plan compiler is needed (an agent's request, a sign-off, the goal), "This week and next" in plain
 * sentences from data, and the week's spend in each currency, never added together. Each part follows the reader's
 * section access.
 */
import { APPROVAL_OPTIONS, openApprovalItem, planDecisionBlock, repos, signoffDecisionBlock, type ComposerItem } from "@foundmill/db";
import { GOAL_OPTION_IDS, WEEK_PRESS_CONTINUE, founderJargonHits } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "today" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const CHIEF = "Ines Park";

const note = (agentId: string, subject: string, decision: ComposerItem["decision"]): ComposerItem => ({ type: "decision", from_agent_id: agentId, subject, body_md: "Pick one.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision, blocks_continue: false, source_event_ids: [], entity_ids: [] });
const oneOption = {
  options: [
    { id: "a", label: "Start with search", recommended: true, consequence: "Slow and cheap.", cost_minor: 0, reversible: true },
    { id: "b", label: "Start with ads", recommended: false, consequence: "Fast and costly.", cost_minor: 0, reversible: true },
  ],
  free_text: true,
  expires_at: null,
};
const goalOptions = {
  options: [
    { id: GOAL_OPTION_IDS.approve, label: "Approve this goal", recommended: true, consequence: "The team aims at it.", cost_minor: 0, reversible: true },
    { id: GOAL_OPTION_IDS.change, label: "Change it", recommended: false, consequence: "Tell me what to change.", cost_minor: 0, reversible: true },
  ],
  free_text: true,
  expires_at: null,
};

let n = 0;
async function business(name: string) {
  n += 1;
  const [ownerId, memberId, viewerId] = await Promise.all(["owner", "member", "viewer"].map((r) => hz.h.createUser(`today-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const chief = await repos.agents.create(hz.db, b.id, { name: CHIEF, agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  return { id: b.id, chief, ownerId: ownerId!, memberId: memberId!, owner: hz.caller({ userId: ownerId! }), member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }) };
}

const proposeGoal = (b: { id: string; chief: { id: string } }) =>
  repos.goals.propose(hz.db, b.id, { sentence: "Get the first 10 paying customers by Dec 19", kind: "paying_customers", target: 10, currency: null, dueOn: "2026-12-19", startValue: 0, reason: "first", agentId: b.chief.id, replacesGoalId: null, item: note(b.chief.id, "Your first goal: get 10 paying customers by Dec 19", goalOptions) });

describe("today.get", () => {
  it("on a fresh business: nothing needs you, the week in three plain sentences, no spend, the Chief of Staff by name", async () => {
    const b = await business("Today Fresh");
    const view = await b.owner.today.get({ businessId: b.id });
    expect(view.needsYou).toEqual({ items: [], total: 0 });
    expect(view.chiefOfStaff).toEqual({ id: b.chief.id, name: CHIEF });
    expect(view.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const sentences = [...view.week!.done, ...view.week!.next];
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences.length).toBeLessThanOrEqual(5);
    expect(sentences.at(-1)).toBe(WEEK_PRESS_CONTINUE);
    for (const s of sentences) expect(founderJargonHits(s), s).toEqual([]);
    expect(view.spend).toEqual({ aiUsage: { amountMinor: 0, currency: "USD" }, channel: { amountMinor: 0, currency: "USD", otherCurrencies: [] } });
  });

  it("offers one tap on a sign-off and the goal, opens anything else; viewers get no taps", async () => {
    const b = await business("Today Needs");
    await repos.productSignoffs.open(hz.db, b.id, { kind: "spec", item: note(b.chief.id, "Sign off the product specification", signoffDecisionBlock("spec")) });
    await repos.inbox.createItem(hz.db, b.id, note(b.chief.id, "Which channel first?", oneOption));
    await proposeGoal(b);

    const view = await b.member.today.get({ businessId: b.id });
    expect(view.needsYou!.total).toBe(3);
    const byKind = new Map(view.needsYou!.items.map((i) => [i.kind, i]));
    expect(byKind.get("signoff")).toMatchObject({ subject: "Sign off the product specification", quickOption: { id: "approve", label: "Approve the specification" }, fromAgent: { id: b.chief.id, name: CHIEF } });
    // The sender carries its role and persona key, so the web names it as the Inbox does (One name everywhere, Nov 8, 2026).
    const chief = await repos.agents.get(hz.db, b.id, b.chief.id);
    expect(byKind.get("signoff")!.fromAgent).toEqual({ id: chief.id, name: chief.name, role: chief.role || null, personaKey: chief.personaKey, layer: chief.layer });
    expect(chief.personaKey).toBeTruthy();
    expect(byKind.get("goal")).toMatchObject({ quickOption: { id: GOAL_OPTION_IDS.approve, label: "Approve this goal" }, blocksContinue: false });
    expect(byKind.get("decision")).toMatchObject({ subject: "Which channel first?", quickOption: null });
    // The Inbox's own order: the first notes of Needs you.
    const respond = (await b.member.inbox.list({ businessId: b.id, tab: "respond", limit: 10 })).items.map((i) => i.id);
    expect(view.needsYou!.items.map((i) => i.id)).toEqual(respond);

    // A viewer reads the same notes and gets no taps.
    const asViewer = await b.viewer.today.get({ businessId: b.id });
    expect(asViewer.needsYou!.items).toHaveLength(3);
    expect(asViewer.needsYou!.items.every((i) => i.quickOption === null)).toBe(true);
  });

  it("shows at most three notes and counts the rest", async () => {
    const b = await business("Today Many");
    for (const word of ["one", "two", "three", "four", "five"]) await repos.inbox.createItem(hz.db, b.id, note(b.chief.id, `Question ${word}`, oneOption));
    const view = await b.owner.today.get({ businessId: b.id });
    expect(view.needsYou!.items).toHaveLength(3);
    expect(view.needsYou!.total).toBe(5);
  });

  it("the goal's one tap approves it through inbox.decide, and it leaves Needs you", async () => {
    const b = await business("Today Goal Tap");
    await proposeGoal(b);
    const item = (await b.owner.today.get({ businessId: b.id })).needsYou!.items[0]!;
    expect(item).toMatchObject({ kind: "goal", quickOption: { id: GOAL_OPTION_IDS.approve } });
    await b.owner.inbox.decide({ businessId: b.id, itemId: item.id, chosenOption: item.quickOption!.id });
    expect((await b.owner.today.get({ businessId: b.id })).needsYou).toEqual({ items: [], total: 0 });
    expect((await b.owner.goal.current({ businessId: b.id })).active).toMatchObject({ status: "active" });
  });

  it("an agent's request gets Approve in one tap for a reader who can write what it touches", async () => {
    const b = await business("Today Approval");
    const action = (await repos.plans.create(hz.db, b.id, { origin: "option", summaryMd: "Launch.", status: "executing", actions: [{ type: "reply_only", params: {}, agentId: b.chief.id, policyOutcome: "allow" }] })).actions[0]!;
    const approval = await repos.approvals.create(hz.db, b.id, { planActionId: action.id, agentId: b.chief.id, connectorKey: "platform", tool: "launch_campaign", args: { channelKey: "seo" } });
    const { item } = await openApprovalItem(hz.db, b.id, approval, { agentId: b.chief.id, agentName: CHIEF });
    const row = (await b.owner.today.get({ businessId: b.id })).needsYou!.items.find((i) => i.id === item.id);
    expect(row).toMatchObject({ kind: "approval", quickOption: { id: APPROVAL_OPTIONS.approve } });
  });

  it("names the week's work by its founder titles and the roadmap item most of it was for", async () => {
    const b = await business("Today Week");
    const item = await repos.product.upsertRoadmapItem(hz.db, b.id, { title: "Online booking", horizon: "now", targetEnd: "2099-12-04" });
    for (const [i, roadmapItemId] of [item.id, item.id, null].entries()) {
      const t = await repos.tasks.create(hz.db, b.id, { kind: "code", title: `tech-${i}`, founderTitle: `Booking step ${i}`, roadmapItemId, status: "ready" });
      await repos.tasks.setStatus(hz.db, b.id, t.id, "done", { force: true });
    }
    await repos.tasks.create(hz.db, b.id, { kind: "code", title: "stripe-integration", founderTitle: "Set up card payments", status: "ready" });
    const view = await b.owner.today.get({ businessId: b.id });
    expect(view.week!.done[0]).toBe("This week the team finished 3 pieces of work, 2 of them for “Online booking”.");
    expect(view.week!.next[0]).toBe("Next: Set up card payments.");
    expect(view.week!.next[1]).toBe("“Online booking” is planned for Dec 4, 2099 (Estimate).");
  });

  it("keeps AI usage in dollars and channel spend in the business's currency, never added; walls hide each part", async () => {
    const b = await business("Today Spend");
    await repos.businesses.update(hz.db, b.id, { currency: "GBP" });
    await repos.usage.record(hz.db, b.id, { kind: "tokens", costMinor: 420 });
    const seo = await repos.channels.upsert(hz.db, b.id, { channelKey: "seo", line: "defence", enabled: true });
    const ads = await repos.channels.upsert(hz.db, b.id, { channelKey: "paid_ads", line: "attack", enabled: true, currency: "USD" });
    const day = new Date().toISOString().slice(0, 10);
    await repos.channels.upsertMetric(hz.db, b.id, { channelId: seo.id, day, spendMinor: 10_000 });
    await repos.channels.upsertMetric(hz.db, b.id, { channelId: ads.id, day, spendMinor: 9_000, currency: "USD" });
    const view = await b.owner.today.get({ businessId: b.id });
    expect(view.spend).toEqual({ aiUsage: { amountMinor: 420, currency: "USD" }, channel: { amountMinor: 10_000, currency: "GBP", otherCurrencies: [{ currency: "USD", amountMinor: 9_000 }] } });

    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { finance: "none", development: "none", inbox: "none" });
    expect(await b.member.today.get({ businessId: b.id })).toMatchObject({ spend: null, week: null, needsYou: null, chiefOfStaff: { name: CHIEF } });
  });

  it("is business-scoped: someone outside the business cannot read it", async () => {
    const b = await business("Today Walls");
    await expect(hz.caller({ userId: hz.A.ownerId }).today.get({ businessId: b.id })).rejects.toThrow();
  });
});

describe("today.get › firstWeek", () => {
  it("a new business gets the three steps with Day 1 now, for every member; the dates are estimates", async () => {
    const b = await business("Today First Week");
    const view = await b.viewer.today.get({ businessId: b.id });
    expect(view.firstWeek!.title).toBe("Your first week");
    expect(view.firstWeek!.steps.map((s) => [s.label, s.state])).toEqual([["Day 1", "now"], ["Days 2–3", "next"], ["Week 1", "next"]]);
    for (const s of view.firstWeek!.steps) expect(s.when).toMatch(/\(Estimate\)$/);
    expect(view.firstWeek!.paused).toBeNull();
  });

  it("reads Day 1 from the page and the sign-offs (package 1.3): both sign-offs leave the page to publish", async () => {
    const b = await business("Today First Week Facts");
    expect((await b.owner.today.get({ businessId: b.id })).firstWeek!.steps[0]).toMatchObject({ team: "Your team drafts your page first, then your plan.", asks: "You are asked to publish your page and approve your plan." });
    await repos.productSignoffs.seedApproved(hz.db, b.id, { spec: { at: new Date() }, roadmap: { at: new Date() }, decidedBy: b.ownerId });
    const signed = await b.owner.today.get({ businessId: b.id });
    expect(signed.firstWeek!.steps.map((s) => s.state)).toEqual(["now", "next", "next"]);
    expect(signed.firstWeek!.steps[0]!.asks).toBe("You are asked to publish your page.");
    const content = { pitch: "Same-day cafe shifts for students", about: "Cafes post a shift in the morning.", forWhom: "", stage: "idea" as const, showFounders: false };
    await repos.pages.publish(hz.db, b.id, { content, slug: `today-week-${b.id.slice(0, 8)}`, userId: b.ownerId });
    const view = await b.owner.today.get({ businessId: b.id });
    expect(view.firstWeek!.steps.map((s) => s.state)).toEqual(["done", "now", "next"]);
    expect(view.firstWeek!.steps[0]!.when).toMatch(/^Done [A-Z][a-z]{2} \d{1,2}$/);
  });

  it("says which day of the project it is: 1 on the day it was created (WP-04 T7)", async () => {
    const b = await business("Today Project Day");
    expect(await b.owner.today.get({ businessId: b.id })).toMatchObject({ projectDay: 1, firstDay: true });
    await hz.db.execute(sql`update businesses set created_at = now() - interval '1 day' where id = ${b.id}`);
    expect(await b.viewer.today.get({ businessId: b.id })).toMatchObject({ projectDay: 2, firstDay: false });
    await hz.db.execute(sql`update businesses set created_at = now() - interval '30 days' where id = ${b.id}`);
    expect((await b.owner.today.get({ businessId: b.id })).projectDay).toBe(31);
    // A project created today that is already selling is past its first day.
    const selling = await business("Today Project Day Selling");
    await repos.businesses.startDistribution(hz.db, selling.id, { at: new Date() });
    expect(await selling.owner.today.get({ businessId: selling.id })).toMatchObject({ projectDay: 1, firstDay: false });
  });

  it("is away for a business past its first days and for one that is already selling", async () => {
    const old = await business("Today First Week Old");
    expect((await old.owner.today.get({ businessId: old.id })).firstWeek).not.toBeNull();
    await hz.db.execute(sql`update businesses set created_at = now() - interval '30 days' where id = ${old.id}`);
    expect((await old.owner.today.get({ businessId: old.id })).firstWeek).toBeNull();

    const selling = await business("Today First Week Selling");
    await repos.businesses.startDistribution(hz.db, selling.id, { at: new Date() });
    expect((await selling.owner.today.get({ businessId: selling.id })).firstWeek).toBeNull();
  });
});

describe("today.get › founderTask (WP-04 T9)", () => {
  const content = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "", stage: "idea" as const, showFounders: false };
  const uuid = () => crypto.randomUUID();
  const follow = (b: { id: string }, actor: { kind: "system" | "user"; id: string }) => repos.events.write(hz.db, b.id, { type: "page.followed", actor, payload: { pageId: null, entityId: uuid(), consentId: uuid() } });

  it("goes publish, share, approve the plan, ask five, and is null once a real follow came in", async () => {
    const b = await business("Today Task");
    await repos.productSignoffs.open(hz.db, b.id, { kind: "spec", item: note(b.chief.id, "Your plan is ready", planDecisionBlock()) });
    const first = (await b.owner.today.get({ businessId: b.id })).founderTask!;
    expect(first).toMatchObject({ id: "publish_page", title: "Check your page and publish it", action: { kind: "open_page" }, doneToday: false });
    // No overnight shift on this project: the line without it.
    expect(first.tomorrow).toBe("Come back when you have heard from someone, or press Continue for a round of work.");

    const slug = `today-task-${b.id.slice(0, 8)}`;
    await repos.pages.publish(hz.db, b.id, { content, slug, userId: b.ownerId });
    const share = (await b.owner.today.get({ businessId: b.id })).founderTask!;
    // Published today: one a day, so it is done for today and names the share for tomorrow.
    expect(share).toMatchObject({ id: "share_page", action: { kind: "share" }, doneToday: true });
    expect(share.action.text).toMatch(new RegExp(`^I'm starting Today Task \\d+\\. Candles that smell like a walk in the woods\\. Would you use this\\?\\n\\nhttps?://[^\\s]+/p/${slug}\\?via=`));

    await b.owner.share.opened({ businessId: b.id, kind: "page", network: null, target: "copy" });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask).toMatchObject({ id: "approve_plan", action: { kind: "open_note" } });

    const signoffs = await repos.productSignoffs.latest(hz.db, b.id);
    await repos.productSignoffs.decide(hz.db, b.id, signoffs.spec!.id, { status: "approved", decidedBy: b.ownerId });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask).toMatchObject({ id: "ask_five", title: "Ask five people the question on your page", action: { kind: "copy" } });

    // A simulated or hand-written follow never counts; one the public page wrote does.
    await follow(b, { kind: "system", id: "simulate" });
    await follow(b, { kind: "user", id: b.ownerId });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask?.id).toBe("ask_five");
    await follow(b, { kind: "system", id: "public-page" });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask).toBeNull();
  });

  it("a share of a milestone is not a share of the page; a page taken down asks to publish again", async () => {
    const b = await business("Today Task Shares");
    await repos.pages.publish(hz.db, b.id, { content, slug: `today-shares-${b.id.slice(0, 8)}`, userId: b.ownerId });
    await repos.events.write(hz.db, b.id, { type: "share.opened", actor: { kind: "user", id: b.ownerId }, payload: { network: null, kind: "draft", refId: null, target: "device" } });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask?.id).toBe("share_page");
    await repos.pages.unpublish(hz.db, b.id, { userId: b.ownerId });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask?.id).toBe("publish_page");
  });

  it("names tomorrow morning when the overnight shift is on, and not once it is paused", async () => {
    const b = await business("Today Task Overnight");
    await repos.autopilot.set(hz.db, b.id, { enabled: true, cadence: "daily", dailyHour: 2 });
    expect((await b.owner.today.get({ businessId: b.id })).founderTask!.tomorrow).toBe("Tomorrow morning: what your team found overnight, and one thing to do.");
    await hz.db.execute(sql`update businesses set autopilot_paused_reason = 'credits_exhausted' where id = ${b.id}`);
    expect((await b.owner.today.get({ businessId: b.id })).founderTask!.tomorrow).toMatch(/^Come back when/);
  });

  it("is null for a sample business and for a reader without Product read", async () => {
    const b = await business("Today Task Walls");
    expect((await b.viewer.today.get({ businessId: b.id })).founderTask?.id).toBe("publish_page");
    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { product: "none" });
    expect((await b.member.today.get({ businessId: b.id })).founderTask).toBeNull();
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
    expect((await b.owner.today.get({ businessId: b.id })).founderTask).toBeNull();
  });
});
