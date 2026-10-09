/**
 * 0019 `business_foundations.progress` (audit P3): what the first-open drafting stored so far. A column on the row, so
 * it carries the row's 0018 policies: members of the business read it (the screens show the vision and the sections as
 * they land), nobody else does, and no app role writes it (only the api's service role and the orchestrator).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos } from "../../repos";
import { businessFoundations } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const progressOf = (slug: string) => ({ v: 1, outline: ["Problem", "Pricing"], vision: { statement: `${slug} exists so that teams close the month in a day.` }, sections: {} });

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "alpha");
  B = await createBusinessFixture(h, "bravo");
  outsiderId = await h.createUser("progress-outsider@test.local");
  for (const f of [A, B]) {
    await h.service().run(async (tx) => {
      await repos.foundations.create(tx, f.businessId, { door: "ideation" });
      await repos.foundations.claim(tx, f.businessId);
      await repos.foundations.writeProgress(tx, f.businessId, 1, { replace: progressOf(f.slug) as never });
    });
  }
}, 120_000);
afterAll(() => h?.close());

const readProgress = (businessId: string) => (tx: DbTx) => tx.select({ progress: businessFoundations.progress }).from(businessFoundations).where(eq(businessFoundations.businessId, businessId));

async function expectNoEffect(p: Promise<unknown[] | unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

describe("business_foundations.progress (0019)", () => {
  it("members and viewers of A read A's progress; nobody reads B's from A, an outsider or anon reads nothing", async () => {
    for (const userId of [A.ownerId, A.memberId, A.viewerId]) {
      const own = await h.asUser(userId).run(readProgress(A.businessId));
      expect(own).toEqual([{ progress: expect.objectContaining({ vision: { statement: "alpha exists so that teams close the month in a day." } }) }]);
      expect(await h.asUser(userId).run(readProgress(B.businessId))).toEqual([]);
    }
    expect(await h.asUser(outsiderId).run(readProgress(A.businessId))).toEqual([]);
    await expectNoEffect(h.anon().run(readProgress(A.businessId)));
  });

  it("no app role writes it, not even the owner on their own business; the service role does", async () => {
    const tamper = (businessId: string) => (tx: DbTx) =>
      tx.update(businessFoundations).set({ progress: { v: 1, outline: [], vision: { statement: "Wire the money." } } }).where(eq(businessFoundations.businessId, businessId)).returning({ id: businessFoundations.id });
    await expectNoEffect(h.asUser(A.ownerId).run(tamper(A.businessId)));
    await expectNoEffect(h.asUser(A.ownerId).run(tamper(B.businessId)));
    await expectNoEffect(h.asUser(A.memberId).run((tx) => repos.foundations.writeProgress(tx, A.businessId, 1, { set: { vision: null } })));
    await expectNoEffect(h.asUser(B.adminId).run((tx) => repos.foundations.writeProgress(tx, A.businessId, 1, { section: { section: "Pricing", content: { type: "doc", content: [] }, sourceRefs: [], labelled: 0 } as never })));
    const after = await h.service().run(readProgress(A.businessId));
    expect(after[0]!.progress).toMatchObject({ vision: { statement: "alpha exists so that teams close the month in a day." }, sections: {} });
    const written = await h.service().run((tx) => repos.foundations.writeProgress(tx, A.businessId, 1, { set: { openQuestions: ["Who signs?"] } }));
    expect(written).toMatchObject({ openQuestions: ["Who signs?"], vision: { statement: expect.stringContaining("alpha") } });
  });

  it("is a JSON object or null, and bounded in size", async () => {
    const set = (value: string) => h.service().run((tx) => tx.execute(sql`update business_foundations set progress = ${value}::jsonb where business_id = ${A.businessId}`));
    await expect(set("[1, 2]")).rejects.toThrow(/business_foundations_progress_object/);
    await expect(set(JSON.stringify({ blob: "x".repeat(1_100_000) }))).rejects.toThrow(/business_foundations_progress_size/);
    const rows = await h.service().run((tx) => tx.select({ id: businessFoundations.id }).from(businessFoundations).where(and(eq(businessFoundations.businessId, A.businessId))));
    expect(rows).toHaveLength(1);
  });
});
