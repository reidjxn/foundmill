/**
 * pageQuiz.* and publicQuiz.* — the optional quiz on a project's public page (services/page-quiz.ts, 0101), on the mock
 * model. Too few real customers is refused before any call and writes nothing; a draft comes only from the project's
 * own customers (an archived contact, an unverified name the Composer guessed and a lead are not customers); a member
 * edits a draft but only an owner or an admin approves and turns it on; approving puts nothing on the page; the public
 * read carries no evidence; an answer counts its result type once, against the live version only; an edit takes it off
 * the page; pressure words are refused at approval; events go through the outbox.
 */
import { interactions, repos } from "@foundmill/db";
import { PAGE_QUIZ_MIN_CUSTOMERS, type PageQuizDefinition, type ProjectPageContent } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { answerPublicQuiz, PUBLIC_QUIZ_LIMITS } from "../services/page-quiz";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "quiz" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bike repairs at your door", about: "We come to you with a van full of parts.", forWhom: "", stage: "live", showFounders: false, followForm: true, ...over });

let n = 0;
async function project(name: string) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`quiz-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  const owner = hz.caller({ userId: ownerId! });
  const slug = (await owner.page.publish({ businessId: b.id, content: page() })).page.slug;
  return { id: b.id, slug, owner, member: hz.caller({ userId: memberId! }) };
}

/** Real customers: `people` people and `orgs` organizations in the `customer` role, each with one reply of their own. */
async function customers(businessId: string, people: number, orgs: number) {
  for (const [kind, count] of [["person", people], ["organisation", orgs]] as const) {
    for (let i = 0; i < count; i++) {
      const e = await repos.entities.create(hz.db, businessId, { kind, displayName: `${kind} ${i}`, source: "user" });
      await repos.entities.addRole(hz.db, businessId, e.id, { role: "customer" });
    }
  }
}

/** A project whose quiz is drafted, approved and on its live page. */
async function live(name: string) {
  const b = await project(name);
  await customers(b.id, 4, 3);
  const drafted = await b.owner.pageQuiz.draft({ businessId: b.id });
  if (drafted.outcome !== "drafted") throw new Error(drafted.message);
  await b.owner.pageQuiz.approve({ businessId: b.id, definition: drafted.view.quiz!.definition as never });
  const on = await b.owner.pageQuiz.setLive({ businessId: b.id, on: true });
  return { ...b, version: on.quiz!.version };
}

const anon = () => hz.caller(null);
const events = async (businessId: string, type: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === type).map((o) => o.event);
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "error");

describe("pageQuiz: drafting only from real customers", () => {
  it("too few customers: a plain refusal with the real count, and nothing written", async () => {
    const b = await project("Thin");
    await customers(b.id, 2, 1);
    // Not customers: a lead, an archived customer and a name the Composer guessed.
    const lead = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Lead", source: "user" });
    await repos.entities.addRole(hz.db, b.id, lead.id, { role: "lead" });
    const archived = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Gone", source: "user" });
    await repos.entities.addRole(hz.db, b.id, archived.id, { role: "customer" });
    await repos.entities.archive(hz.db, b.id, archived.id);
    const guessed = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Maybe", source: "composer:unverified:00000000-0000-4000-8000-000000000001" });
    await repos.entities.addRole(hz.db, b.id, guessed.id, { role: "customer" });

    const view = await b.owner.pageQuiz.get({ businessId: b.id });
    expect(view).toMatchObject({ quiz: null, readiness: { customers: 3, need: PAGE_QUIZ_MIN_CUSTOMERS, ready: false }, canEdit: true, canApprove: true });
    const answer = await b.owner.pageQuiz.draft({ businessId: b.id });
    expect(answer).toMatchObject({ outcome: "refused", message: `You have 3 customers on record. The team drafts a quiz from at least ${PAGE_QUIZ_MIN_CUSTOMERS} real customers, so nothing was drafted.` });
    expect(await repos.pageQuizzes.get(hz.db, b.id)).toBeNull();
  });
});

describe("pageQuiz: review, approve, turn on, count", () => {
  it("drafts, keeps it off the page until an owner approves and turns it on, then counts results anonymously", async () => {
    const b = await project("Doorstep");
    await customers(b.id, 4, 3);

    const drafted = await b.member.pageQuiz.draft({ businessId: b.id });
    if (drafted.outcome !== "drafted") throw new Error(drafted.message);
    const quiz = drafted.view.quiz!;
    expect(quiz).toMatchObject({ status: "draft", version: 1, evidence: { customers: 7, perType: { t1: 4, t2: 3 } } });
    expect(quiz.definition.offers).toEqual([{ key: "o1", title: expect.stringMatching(/^Follow Doorstep/), detail: "", action: { kind: "follow" } }]);
    expect(drafted.view.problems).toEqual([]);
    expect(await anon().publicQuiz.bySlug({ slug: b.slug })).toBeNull();

    // A member edits the draft but cannot approve it or turn it on.
    const edited: PageQuizDefinition = { ...quiz.definition, intro: "Two quick questions." };
    expect((await b.member.pageQuiz.save({ businessId: b.id, definition: edited as never })).quiz).toMatchObject({ status: "draft", version: 2 });
    expect(await code(b.member.pageQuiz.approve({ businessId: b.id, definition: edited as never }))).toBe("FORBIDDEN");
    expect(await code(b.member.pageQuiz.setLive({ businessId: b.id, on: true }))).toBe("FORBIDDEN");
    expect(await code(b.owner.pageQuiz.setLive({ businessId: b.id, on: true }))).toBe("BAD_REQUEST");

    // Pressure is refused at approval, with the reason.
    await expect(b.owner.pageQuiz.approve({ businessId: b.id, definition: { ...edited, intro: "Hurry, spots left" } as never })).rejects.toThrow(/Take out "Hurry"/);

    const approved = await b.owner.pageQuiz.approve({ businessId: b.id, definition: edited as never });
    expect(approved.quiz).toMatchObject({ status: "approved", version: 2 });
    expect(await anon().publicQuiz.bySlug({ slug: b.slug })).toBeNull();
    expect((await events(b.id, "quiz.approved"))[0]!.payload).toMatchObject({ version: 2, typeCount: 2, questionCount: 2 });

    const on = await b.owner.pageQuiz.setLive({ businessId: b.id, on: true });
    expect(on.quiz?.status).toBe("live");
    expect((await events(b.id, "quiz.published"))[0]!.payload).toMatchObject({ slug: b.slug, version: 2 });

    const pub = (await anon().publicQuiz.bySlug({ slug: b.slug }))!;
    expect(pub).toMatchObject({ slug: b.slug, version: 2, followForm: true, intro: "Two quick questions." });
    expect(JSON.stringify(pub)).not.toMatch(/evidence|perType|"customers":/);

    const all = (key: "a1" | "a2") => Object.fromEntries(pub.questions.map((q) => [q.key, key]));
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 2, answers: all("a1") })).toEqual({ outcome: "result", type: "t1" });
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 2, answers: all("a2") })).toEqual({ outcome: "result", type: "t2" });
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 2, answers: all("a2") })).toEqual({ outcome: "result", type: "t2" });
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 2, answers: { q1: "a1" } })).toEqual({ outcome: "unanswered" });
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 1, answers: all("a1") })).toEqual({ outcome: "changed" });
    expect((await b.owner.pageQuiz.get({ businessId: b.id })).counts).toEqual({ t1: 1, t2: 2 });

    // An owner's edit of the live quiz takes it off the page; the counts of the new version start at nothing.
    const changed = await b.owner.pageQuiz.save({ businessId: b.id, definition: { ...edited, intro: "Three quick questions." } as never });
    expect(changed).toMatchObject({ quiz: { status: "draft", version: 3 }, counts: {} });
    expect(await anon().publicQuiz.bySlug({ slug: b.slug })).toBeNull();
    expect(await anon().publicQuiz.answer({ slug: b.slug, version: 2, answers: all("a1") })).toEqual({ outcome: "changed" });

    // Turned off: the quiz leaves the page, the approved copy stays.
    await b.owner.pageQuiz.approve({ businessId: b.id, definition: changed.quiz!.definition as never });
    await b.owner.pageQuiz.setLive({ businessId: b.id, on: true });
    const off = await b.owner.pageQuiz.setLive({ businessId: b.id, on: false });
    expect(off.quiz?.status).toBe("approved");
    expect(await anon().publicQuiz.bySlug({ slug: b.slug })).toBeNull();
    expect(await events(b.id, "quiz.unpublished")).toHaveLength(1);
  });

  it("an offer pointing to the Follow form needs the form on the page", async () => {
    const b = await project("NoForm");
    await customers(b.id, 3, 3);
    const drafted = await b.owner.pageQuiz.draft({ businessId: b.id });
    if (drafted.outcome !== "drafted") throw new Error(drafted.message);
    await b.owner.page.publish({ businessId: b.id, content: page({ followForm: false }) });
    expect((await b.owner.pageQuiz.get({ businessId: b.id })).problems.map((p) => p.path)).toEqual(["offers.0.action"]);
    await expect(b.owner.pageQuiz.approve({ businessId: b.id, definition: drafted.view.quiz!.definition as never })).rejects.toThrow(/no Follow form/);
  });

  it("another project's people read and change nothing", async () => {
    const a = await project("Alpha");
    const other = await project("Other");
    expect(await code(other.owner.pageQuiz.get({ businessId: a.id }))).toBe("FORBIDDEN");
    expect(await code(other.owner.pageQuiz.draft({ businessId: a.id }))).toBe("FORBIDDEN");
  });
});

describe("pageQuiz: security review fixes (Nov 13, 2026)", () => {
  it("names, addresses and phone numbers in replies and payment descriptions never reach the model; a description naming someone is never an offer", async () => {
    const b = await project("Private");
    await customers(b.id, 4, 3);
    const named = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Priya Natarajan", identifiers: { email: "priya.n@example.com" }, source: "user" });
    await repos.entities.addRole(hz.db, b.id, named.id, { role: "customer" });
    await hz.db.insert(interactions).values({ businessId: b.id, kind: "email", direction: "inbound", entityIds: [named.id], summary: "Priya Natarajan: ring me on 0161 555 0101 or priya.n@example.com" });
    const account = await repos.finance.upsertAccount(hz.db, b.id, { provider: "manual", externalId: "acc-1", name: "Sales" });
    await repos.finance.upsertTransactions(hz.db, b.id, [{ accountId: account.id, externalId: "t1", bookedAt: new Date("2026-11-01"), amountMinor: 2500, counterpartyEntityId: named.id, description: "Gift box for Priya Natarajan" }]);

    const seen: string[] = [];
    const complete = hz.deps.models.complete.bind(hz.deps.models);
    hz.deps.models.complete = (async (req: Parameters<typeof complete>[0]) => {
      seen.push(JSON.stringify([req.system, req.messages]));
      return complete(req);
    }) as typeof complete;
    try {
      const drafted = await b.owner.pageQuiz.draft({ businessId: b.id });
      expect(seen.length).toBeGreaterThan(0);
      for (const s of ["Priya", "Natarajan", "priya.n@example.com", "0161 555 0101", "Gift box for"]) expect(seen.join("\n"), s).not.toContain(s);
      if (drafted.outcome === "drafted") expect(JSON.stringify(drafted.view.quiz!.definition)).not.toMatch(/Priya|Natarajan|example\.com/);
    } finally {
      hz.deps.models.complete = complete;
    }
  });

  it("a flood of answers never stops a visitor getting their result; only the counting stops, per caller and page", async () => {
    const b = await live("Flood");
    const ctx = { db: hz.db, env: hz.deps.env, limits: hz.limits, clientAddress: "203.0.113.9" };
    const answers = { q1: "a1", q2: "a1" };
    const results: string[] = [];
    for (let i = 0; i < 150; i++) results.push((await answerPublicQuiz(ctx, { slug: b.slug, version: b.version, answers })).outcome);
    expect(new Set(results)).toEqual(new Set(["result"]));
    const counted = (await b.owner.pageQuiz.get({ businessId: b.id })).counts.t1 ?? 0;
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThanOrEqual(PUBLIC_QUIZ_LIMITS.countPerCallerPage.limit);
    // Another page answered from the same address still counts: one page's flood leaves the others alone.
    const other = await live("Other page");
    expect(await answerPublicQuiz(ctx, { slug: other.slug, version: other.version, answers })).toEqual({ outcome: "result", type: "t1" });
    expect((await other.owner.pageQuiz.get({ businessId: other.id })).counts).toEqual({ t1: 1 });
  });

  it("turning a quiz on checks it again: an offer pointing to a Follow form the page no longer has is refused", async () => {
    const b = await project("Recheck");
    await customers(b.id, 3, 3);
    const drafted = await b.owner.pageQuiz.draft({ businessId: b.id });
    if (drafted.outcome !== "drafted") throw new Error(drafted.message);
    await b.owner.pageQuiz.approve({ businessId: b.id, definition: drafted.view.quiz!.definition as never });
    await b.owner.page.publish({ businessId: b.id, content: page({ followForm: false }) });
    await expect(b.owner.pageQuiz.setLive({ businessId: b.id, on: true })).rejects.toThrow(/no Follow form/);
    expect((await repos.pageQuizzes.get(hz.db, b.id))?.status).toBe("approved");
  });
});
