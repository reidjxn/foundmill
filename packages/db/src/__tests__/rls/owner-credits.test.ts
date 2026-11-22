/**
 * 0151 — the owner's shared included budget (founder, Nov 19, 2026): `owner_credits` is account-scoped. A person who is
 * a member (not a collaborator) of a project the owner took charge of reads the owner's row, as they read that
 * project's own credits; nobody else does; no client role writes it, the owner included: the budget cannot be topped
 * up by hand. One row a person and month, never below zero, US dollars only, and it goes with the account.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let collaborator: string;

const insert = (userId: string, period: string, granted = 500, balance = 500) => h.service().execute(sql`insert into owner_credits (user_id, period, granted_minor, balance_minor) values (${userId}, ${period}, ${granted}, ${balance})`);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "ocr-a");
  B = await createBusinessFixture(h, "ocr-b");
  collaborator = await h.createUser("ocr-collaborator@test.local");
  await h.service().execute(sql`update businesses set created_by = ${A.ownerId} where id = ${A.businessId}`);
  await h.service().execute(sql`insert into memberships (business_id, user_id, role) values (${A.businessId}, ${collaborator}, 'collaborator')`);
  await insert(A.ownerId, "2027-01");
  await insert(B.ownerId, "2027-01");
}, 120_000);
afterAll(() => h?.close());

const ids = async (runner: ReturnType<TestHarness["asUser"]>) => {
  const out = (await runner.execute(sql`select user_id from owner_credits order by user_id`)) as unknown as { user_id: string }[] | { rows: { user_id: string }[] };
  return (Array.isArray(out) ? out : out.rows).map((r) => r.user_id);
};

describe("owner_credits", () => {
  it("is read by the members of the owner's projects (a collaborator excepted) and by nobody else", async () => {
    for (const member of [A.ownerId, A.adminId, A.memberId, A.viewerId]) expect(await ids(h.asUser(member))).toEqual([A.ownerId]);
    expect(await ids(h.asUser(B.ownerId))).toEqual([B.ownerId]);
    expect(await ids(h.asUser(collaborator))).toEqual([]);
    await expect(h.anon().execute(sql`select user_id from owner_credits`)).rejects.toThrow(/permission denied/);
  });

  it("is written by no client role, the owner's own included", async () => {
    for (const runner of [h.anon(), h.asUser(A.ownerId), h.asUser(A.adminId), h.asUser(collaborator)]) {
      await expect(runner.execute(sql`insert into owner_credits (user_id, period) values (${A.ownerId}, '2027-02')`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`update owner_credits set balance_minor = 999999`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`delete from owner_credits`)).rejects.toThrow(/permission denied/);
    }
    expect(await ids(h.asUser(A.ownerId))).toEqual([A.ownerId]);
  });

  it("holds one row a person and month, a balance never below zero, and US dollars", async () => {
    await expect(insert(A.ownerId, "2027-01")).rejects.toThrow();
    await expect(insert(A.ownerId, "2027-04", 500, -1)).rejects.toThrow();
    await expect(h.service().execute(sql`insert into owner_credits (user_id, period, currency) values (${A.ownerId}, '2027-05', 'EUR')`)).rejects.toThrow();
    await expect(insert(A.ownerId, "2027-5")).rejects.toThrow();
  });

  it("goes with the account: deleting the person deletes the row", async () => {
    const gone = await h.createUser("ocr-gone@test.local");
    await insert(gone, "2027-06");
    await h.pg.query(`delete from auth.users where id = $1`, [gone]);
    const { rows } = await h.pg.query(`select 1 from owner_credits where user_id = $1`, [gone]);
    expect(rows).toHaveLength(0);
  });
});
