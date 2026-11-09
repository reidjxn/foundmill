/**
 * chiefOfStaff.who / chiefOfStaff.answer (founder, Phase 3): the three answers come from Today's own facts, with no
 * model call, as the reader may see them, and only for someone in the business.
 */
import { repos, type ComposerItem } from "@foundmill/db";
import { CHIEF_QUESTIONS, ENTITY_MARKUP_RE, founderJargonHits, type ChiefQuestion } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "chief" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const CHIEF = "Ines Park";
const PAGE = { path: "/b/x/today" };

const note = (agentId: string, subject: string, blocksContinue = false): ComposerItem => ({
  type: blocksContinue ? "warning" : "decision",
  from_agent_id: agentId,
  subject,
  body_md: "Pick one.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: { options: [{ id: "a", label: "Start with search", recommended: true, consequence: "Slow and cheap.", cost_minor: 0, reversible: true }, { id: "b", label: "Start with ads", recommended: false, consequence: "Fast.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null },
  blocks_continue: blocksContinue,
  source_event_ids: [],
  entity_ids: [],
});

let n = 0;
async function business(name: string, options: { chief?: boolean } = {}) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`chief-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const chief = options.chief === false ? null : await repos.agents.create(hz.db, b.id, { name: CHIEF, agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  const worker = await repos.agents.create(hz.db, b.id, { name: "Juno Reyes", agentType: "engineer", layer: "worker", status: "healthy" });
  return { id: b.id, chief, worker, memberId: memberId!, owner: hz.caller({ userId: ownerId! }), member: hz.caller({ userId: memberId! }) };
}

const answer = (b: Awaited<ReturnType<typeof business>>, question: ChiefQuestion, page: { path: string; area?: string; purpose?: string } = PAGE) => b.owner.chiefOfStaff.answer({ businessId: b.id, question, page });

/** Every `[[ent:…]]` mention is whole and none is left half open. */
function expectValidMarkup(text: string) {
  expect(text.replace(ENTITY_MARKUP_RE, "")).not.toMatch(/\[\[|\]\]/);
}

describe("chiefOfStaff.who", () => {
  it("names the Chief of Staff, or null when the business has none", async () => {
    const b = await business("Chief Who");
    expect(await b.owner.chiefOfStaff.who({ businessId: b.id })).toMatchObject({ id: b.chief!.id, name: CHIEF });
    const none = await business("Chief None", { chief: false });
    expect(await none.owner.chiefOfStaff.who({ businessId: none.id })).toBeNull();
  });
});

describe("chiefOfStaff.answer", () => {
  it("answers all three questions on a fresh business in plain sentences, with the Chief of Staff named", async () => {
    const b = await business("Chief Fresh");
    for (const question of CHIEF_QUESTIONS) {
      const a = await answer(b, question);
      expect(a.question).toBe(question);
      expect(a.chiefOfStaff).toEqual({ id: b.chief!.id, name: CHIEF });
      expect(a.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.text.length).toBeGreaterThan(20);
      expect(founderJargonHits(a.text.replace(ENTITY_MARKUP_RE, "$2")), a.text).toEqual([]);
      expectValidMarkup(a.text);
    }
    expect((await answer(b, "blocking")).text).toBe("Nothing is blocking the team.");
  });

  it("What's happening? uses the sentences Today shows: the week's done line and the round line", async () => {
    const b = await business("Chief Happening");
    const done = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "tech", founderTitle: "Booking step", status: "ready" });
    await repos.tasks.setStatus(hz.db, b.id, done.id, "done", { force: true });
    await repos.tasks.create(hz.db, b.id, { kind: "code", title: "stripe", founderTitle: "Set up card payments", status: "ready" });
    const today = await b.owner.today.get({ businessId: b.id });
    const text = (await answer(b, "happening")).text;
    expect(text).toContain(today.week!.done[0]);
    expect(text).toContain(today.week!.next[0]);
    expect(text).toContain(today.week!.next.at(-1));
  });

  it("What's happening? names the agent doing the work as entity markup", async () => {
    const b = await business("Chief Running");
    const t = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "stripe", founderTitle: "Set up card payments", status: "ready", assigneeAgentId: b.worker.id });
    await repos.tasks.setStatus(hz.db, b.id, t.id, "running", { force: true });
    const text = (await answer(b, "happening")).text;
    expect(text).toContain(`[[ent:${b.worker.id}|Juno Reyes]] is working on “Set up card payments”.`);
    expectValidMarkup(text);
  });

  it("What's blocking us? counts Needs you, names the top note and its sender, and says what holds Continue", async () => {
    const b = await business("Chief Needs");
    await repos.inbox.createItem(hz.db, b.id, note(b.chief!.id, "Which channel first?", true));
    await repos.inbox.createItem(hz.db, b.id, note(b.chief!.id, "Pick a launch date"));
    const today = await b.owner.today.get({ businessId: b.id });
    const text = (await answer(b, "blocking")).text;
    expect(text).toContain("2 notes wait for you in Needs you.");
    expect(text).toContain(`“${today.needsYou!.items[0]!.subject}”, from [[ent:${b.chief!.id}|${CHIEF}]].`);
    expect(text).toContain("One holds Continue until you answer.");
    expectValidMarkup(text);
  });

  it("What's blocking us? says which blocked work waits for which, and counts it as Today does", async () => {
    const b = await business("Chief Blocked");
    const ahead = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "pause", founderTitle: "Subscription pause and skip", status: "ready" });
    const waiting = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "ui", founderTitle: "Refill schedule page", status: "ready" });
    await repos.tasks.addEdge(hz.db, b.id, ahead.id, waiting.id);
    await repos.tasks.setStatus(hz.db, b.id, waiting.id, "blocked", { force: true });
    const text = (await answer(b, "blocking")).text;
    expect(text).toContain("1 piece of work is waiting on something before it can go on.");
    expect(text).toContain("“Refill schedule page” is waiting for “Subscription pause and skip” to finish first.");
  });

  it("says the team is stopped, and why, in both happening and blocking", async () => {
    const b = await business("Chief Stopped");
    await repos.businesses.setAgentsStopped(hz.db, b.id, { reason: "kill_switch" });
    expect((await answer(b, "blocking")).text).toContain("The team is stopped because Stop all agents was pressed.");
    expect((await answer(b, "happening")).text.startsWith("The team is stopped because Stop all agents was pressed.")).toBe(true);
  });

  it("says when the founder is on vacation, in a US date, and does not count it as a blocker", async () => {
    const b = await business("Chief Vacation");
    await repos.holidays.start(hz.db, b.id, { untilAt: new Date("2099-03-04T12:00:00Z"), authority: {} });
    expect((await answer(b, "happening")).text).toContain("You are on vacation until Mar 4, 2099; the team keeps working on its own.");
    expect((await answer(b, "blocking")).text).toBe("Nothing is blocking the team.");
  });

  it("Why am I seeing this? gives the page's purpose and why it matters now, using the screen's own line when sent", async () => {
    const b = await business("Chief Why");
    await repos.inbox.createItem(hz.db, b.id, note(b.chief!.id, "Which channel first?"));
    const today = (await answer(b, "why")).text;
    expect(today).toContain("Today is the front door");
    expect(today).toContain("1 note waits for you in Needs you.");
    const tab = (await answer(b, "why", { path: "/b/x/d/finance/overview", area: "money", purpose: "How many months your cash lasts" })).text;
    expect(tab.startsWith("How many months your cash lasts.")).toBe(true);
    const area = (await answer(b, "why", { path: "/b/x/d/finance/overview", area: "money" })).text;
    expect(area.startsWith("Money is where the cash, the runway")).toBe(true);
  });

  it("follows the reader's walls: no Inbox read, no Needs you; no Development read, no work", async () => {
    const b = await business("Chief Walls");
    await repos.inbox.createItem(hz.db, b.id, note(b.chief!.id, "Which channel first?"));
    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { inbox: "none", development: "none" });
    const blocking = await b.member.chiefOfStaff.answer({ businessId: b.id, question: "blocking", page: PAGE });
    expect(blocking.text).toBe("Nothing is blocking the team.");
    const happening = await b.member.chiefOfStaff.answer({ businessId: b.id, question: "happening", page: PAGE });
    expect(happening.text).toBe("There is nothing to report yet: the team has not started, and no goal is set.");
  });

  it("is business-scoped: someone outside the business is refused, and a body cannot name another business", async () => {
    const b = await business("Chief Scope");
    const outsider = hz.caller({ userId: hz.A.ownerId });
    await expect(outsider.chiefOfStaff.answer({ businessId: b.id, question: "happening", page: PAGE })).rejects.toThrow();
    await expect(outsider.chiefOfStaff.who({ businessId: b.id })).rejects.toThrow();
  });

  it("refuses an unknown question and an oversized purpose line", async () => {
    const b = await business("Chief Input");
    await expect(b.owner.chiefOfStaff.answer({ businessId: b.id, question: "anything" as never, page: PAGE })).rejects.toThrow();
    await expect(b.owner.chiefOfStaff.answer({ businessId: b.id, question: "why", page: { path: "/b/x/today", purpose: "x".repeat(301) } })).rejects.toThrow();
  });

  it("makes no model call", async () => {
    const b = await business("Chief NoModel");
    const before = (await repos.usage.totals(hz.db, b.id, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) })).costMinor;
    for (const question of CHIEF_QUESTIONS) await answer(b, question);
    expect((await repos.usage.totals(hz.db, b.id, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) })).costMinor).toBe(before);
  });
});
