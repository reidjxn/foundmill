/**
 * 0101 `page_quizzes`, `page_quiz_counts` and the view `public_page_quizzes` (the optional quiz on a public page).
 *
 * One row per business and no client inserts, so neither table is in the generated cross-tenant suite; this file covers
 * the same cases by hand and the ones only these tables have:
 *   - tenancy: members read their own; nobody reads, writes or deletes another business's quiz or counts; a viewer
 *     changes nothing; a non-member and anon get nothing;
 *   - no client inserts a quiz or a count (the team's draft and the counts are the service connection's);
 *   - a member edits a draft; approving, turning it on or off, and editing an approved quiz are an owner's or an admin's;
 *     a changed definition is a new version, back to draft; who approved it and when are the database's to record;
 *     what the draft rested on (`evidence`) and the version are never changed by hand;
 *   - the public view: exactly its four columns, a row only for a live quiz whose page is public, readable by the
 *     service role only; counts go only to the live quiz at its current version.
 */
import type { PageQuizDefinition, ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { PUBLIC_PAGE_QUIZ_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Coffee for cafes", about: "Roasted weekly.", forWhom: "", stage: "live", showFounders: false, followForm: true, ...over });
const quiz = (name = "Cafes that order every week"): PageQuizDefinition => ({
  intro: "",
  types: [
    { key: "t1", name, summary: "", offer: "o1" },
    { key: "t2", name: "People buying a gift", summary: "", offer: "o2" },
  ],
  offers: [
    { key: "o1", title: "Weekly coffee box", detail: "", action: { kind: "link", url: "https://pay.example.com/box", label: "Order" } },
    { key: "o2", title: "Follow the project", detail: "", action: { kind: "follow" } },
  ],
  questions: [
    { key: "q1", text: "Who is it for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone else", type: "t2" }] },
    { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Once", type: "t2" }] },
  ],
});
const evidence = { customers: 7, replies: 3, purchases: 9, perType: { t1: 4, t2: 3 } };

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

const commit = (businessId: string) => h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, businessId));
const stored = async (businessId: string) => (await h.db.select().from(s.pageQuizzes).where(eq(s.pageQuizzes.businessId, businessId)))[0]!;
const publicSlugs = async () => (await h.service().execute<{ slug: string }>(sql`select slug from public_page_quizzes order by slug`)).map((r) => r.slug);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "quiz-a");
  B = await createBusinessFixture(h, "quiz-b");
  outsiderId = await h.createUser("quiz-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  // Both have a public page and a drafted quiz; B's quiz is live before any test.
  for (const [f, slug] of [[A, "alpha-quiz"], [B, "bravo-quiz"]] as const) {
    await h.service().run((tx) => repos.pages.publish(tx, f.businessId, { content: page(), slug, userId: f.ownerId, at: new Date("2026-10-05T09:00:00Z") }));
    await h.service().run((tx) => repos.pageQuizzes.writeDraft(tx, f.businessId, { definition: quiz(), evidence, agentId: f.agentId }));
  }
  await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["draft"], to: "approved", userId: B.ownerId }));
  await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["approved"], to: "live", userId: B.ownerId }));
}, 120_000);
afterAll(() => h?.close());

describe("page_quizzes: tenancy", () => {
  it("every member reads their own quiz and nobody else's", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect((await h.asUser(userId).run((tx) => repos.pageQuizzes.get(tx, A.businessId)))?.status).toBe("draft");
      expect(await h.asUser(userId).run((tx) => repos.pageQuizzes.get(tx, B.businessId))).toBeNull();
    }
  });

  it("a non-member and anon read nothing", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.pageQuizzes))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.pageQuizCounts))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.pageQuizzes)));
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.pageQuizCounts)));
  });

  it("nobody writes, turns off or deletes another business's quiz", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => repos.pageQuizzes.save(tx, B.businessId, { definition: quiz("Taken over"), userId })));
      await expectNoEffect(h.asUser(userId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["live"], to: "approved", userId })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.pageQuizzes).where(eq(s.pageQuizzes.businessId, B.businessId)).returning({ id: s.pageQuizzes.id })));
    }
    expect(await stored(B.businessId)).toMatchObject({ status: "live", version: 1 });
    expect((await stored(B.businessId)).definition.types[0]!.name).toBe("Cafes that order every week");
  });

  it("no client inserts a quiz, in its own business or another", async () => {
    const c = await createBusinessFixture(h, "quiz-c");
    for (const [userId, businessId] of [[c.ownerId, c.businessId], [A.ownerId, c.businessId]] as const) {
      await expect(h.asUser(userId).run((tx) => tx.insert(s.pageQuizzes).values({ businessId, definition: quiz() }))).rejects.toThrow(RLS_DENIED);
    }
    expect(await repos.pageQuizzes.get(h.db as never, c.businessId)).toBeNull();
  });

  it("a viewer changes nothing", async () => {
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => repos.pageQuizzes.save(tx, A.businessId, { definition: quiz("Viewer"), userId: A.viewerId })));
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.delete(s.pageQuizzes).where(eq(s.pageQuizzes.businessId, A.businessId)).returning({ id: s.pageQuizzes.id })));
  });
});

describe("page_quizzes: approving and turning on are an owner's or an admin's", () => {
  it("a member edits a draft; the edit is a new version", async () => {
    const saved = await h.asUser(A.memberId).run((tx) => repos.pageQuizzes.save(tx, A.businessId, { definition: quiz("Cafes that restock on Mondays"), userId: A.memberId }));
    expect(saved).toMatchObject({ status: "draft", version: 2, updatedBy: A.memberId });
  });

  it("a member cannot approve or turn it on, through the repo or a direct write", async () => {
    await expect(h.asUser(A.memberId).run((tx) => repos.pageQuizzes.setStatus(tx, A.businessId, { from: ["draft"], to: "approved", userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.pageQuizzes).set({ approvedAt: new Date() }).where(eq(s.pageQuizzes.businessId, A.businessId)))).rejects.toThrow(RLS_DENIED);
    expect((await stored(A.businessId)).status).toBe("draft");
  });

  it("nobody turns on a quiz that was not approved", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, A.businessId, { from: ["draft"], to: "live", userId: A.ownerId }))).rejects.toThrow(/approved before it is turned on/);
  });

  it("an admin approves; the database records who and when, whatever the client sent", async () => {
    await h.asUser(A.adminId).run((tx) => tx.update(s.pageQuizzes).set({ status: "approved", approvedAt: new Date("2020-01-01T00:00:00Z"), approvedBy: A.ownerId }).where(eq(s.pageQuizzes.businessId, A.businessId)));
    const row = await stored(A.businessId);
    expect(row).toMatchObject({ status: "approved", approvedBy: A.adminId });
    expect(Math.abs(row.approvedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("a member cannot edit an approved quiz; an owner's edit puts it back to draft", async () => {
    await expect(h.asUser(A.memberId).run((tx) => repos.pageQuizzes.save(tx, A.businessId, { definition: quiz("Member edit"), userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    const edited = await h.asUser(A.ownerId).run((tx) => repos.pageQuizzes.save(tx, A.businessId, { definition: quiz("Owner edit"), userId: A.ownerId }));
    expect(edited).toMatchObject({ status: "draft", version: 3, approvedAt: null, approvedBy: null });
  });

  it("what the draft rested on and the version are never changed by hand", async () => {
    for (const set of [{ evidence: { customers: 500 } }, { version: 9 }, { draftedByAgentId: null }]) {
      await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.pageQuizzes).set(set).where(eq(s.pageQuizzes.businessId, A.businessId)))).rejects.toThrow(RLS_DENIED);
    }
    expect((await stored(A.businessId)).evidence).toEqual(evidence);
  });

  it("a new draft from the team replaces the definition as a new version, off the page", async () => {
    const before = await stored(B.businessId);
    const redrafted = await h.service().run((tx) => repos.pageQuizzes.writeDraft(tx, B.businessId, { definition: quiz("Redrafted"), evidence, agentId: B.agentId }));
    expect(redrafted).toMatchObject({ status: "draft", version: before.version + 1, approvedAt: null });
    expect(await publicSlugs()).not.toContain("bravo-quiz");
    await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["draft"], to: "approved", userId: B.ownerId }));
    await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["approved"], to: "live", userId: B.ownerId }));
  });
});

describe("page_quiz_counts", () => {
  it("no client writes a count; members read their own only", async () => {
    const q = await stored(B.businessId);
    for (const userId of [B.ownerId, A.ownerId, outsiderId]) {
      await expect(h.asUser(userId).run((tx) => tx.insert(s.pageQuizCounts).values({ businessId: B.businessId, quizId: q.id, version: q.version, typeKey: "t1", finished: 100 }))).rejects.toThrow(RLS_DENIED);
    }
    expect(await h.service().run((tx) => repos.pageQuizzes.public.recordResult(tx, { slug: "bravo-quiz", version: q.version, typeKey: "t1" }))).toBe(true);
    await expectNoEffect(h.asUser(B.ownerId).run((tx) => tx.update(s.pageQuizCounts).set({ finished: 100 }).where(eq(s.pageQuizCounts.quizId, q.id)).returning({ id: s.pageQuizCounts.id })));
    expect(await h.asUser(B.memberId).run((tx) => repos.pageQuizzes.counts(tx, B.businessId, q.id, q.version))).toEqual({ t1: 1 });
    expect(await h.asUser(A.ownerId).run((tx) => repos.pageQuizzes.counts(tx, B.businessId, q.id, q.version))).toEqual({});
  });

  it("only the live quiz at its current version, and a type it can have, is counted", async () => {
    const q = await stored(B.businessId);
    const record = (slug: string, version: number, typeKey: string) => h.service().run((tx) => repos.pageQuizzes.public.recordResult(tx, { slug, version, typeKey }));
    expect(await record("bravo-quiz", q.version - 1, "t1")).toBe(false);
    expect(await record("bravo-quiz", q.version, "t9")).toBe(false);
    expect(await record("alpha-quiz", (await stored(A.businessId)).version, "t1")).toBe(false);
    expect(await record("bravo-quiz", q.version, "t2")).toBe(true);
    expect(await repos.pageQuizzes.counts(h.db as never, B.businessId, q.id, q.version)).toEqual({ t1: 1, t2: 1 });
  });
});

describe("public_page_quizzes", () => {
  it("exactly four columns, readable by the service role only", async () => {
    const cols = (await h.db.execute(sql`select column_name from information_schema.columns where table_name = 'public_page_quizzes' order by ordinal_position`)) as unknown as { rows: { column_name: string }[] };
    expect(cols.rows.map((c) => c.column_name)).toEqual([...PUBLIC_PAGE_QUIZ_COLUMNS]);
    await expect(h.anon().execute(sql`select * from public_page_quizzes`)).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.ownerId).execute(sql`select * from public_page_quizzes`)).rejects.toThrow(RLS_DENIED);
    const live = await h.service().run((tx) => repos.pageQuizzes.public.bySlug(tx, "bravo-quiz"));
    expect(live).toMatchObject({ slug: "bravo-quiz", followForm: true });
    expect(live!.definition.types).toHaveLength(2);
    expect(JSON.stringify(live)).not.toMatch(/perType|customers/);
  });

  it("a row only while the quiz is live and its page is public", async () => {
    expect(await publicSlugs()).toEqual(["bravo-quiz"]);
    await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["live"], to: "approved", userId: B.ownerId }));
    expect(await publicSlugs()).toEqual([]);
    await h.asUser(B.ownerId).run((tx) => repos.pageQuizzes.setStatus(tx, B.businessId, { from: ["approved"], to: "live", userId: B.ownerId }));
    expect(await publicSlugs()).toEqual(["bravo-quiz"]);
    await h.service().run((tx) => repos.pages.unpublish(tx, B.businessId, { userId: B.ownerId }));
    expect(await publicSlugs()).toEqual([]);
    expect(await h.service().run((tx) => repos.pageQuizzes.public.bySlug(tx, "bravo-quiz"))).toBeNull();
  });
});
