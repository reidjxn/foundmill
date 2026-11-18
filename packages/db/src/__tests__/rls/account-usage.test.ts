/**
 * account_usage (0138, WP-09 T2): model calls before a project exists. No client role reads or writes a row, the
 * person's own included; the service role adds rows and sums them, and never changes or deletes one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUsageRepo } from "../../repos/account-usage";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";

let h: TestHarness;
let ada: string;
let bo: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada-usage@test.local");
  bo = await h.createUser("bo-usage@test.local");
});
afterAll(() => h?.close());

const row = (userId: string, costMicroMinor: number, occurredAt = new Date()) =>
  accountUsageRepo.record(h.db, { userId, kind: "ideation", route: "ideation", modelKey: "opus", quantity: 1_000, costMicroMinor, occurredAt, details: {} });

describe("account_usage", () => {
  it("no client role reads or writes a row, the person's own included", async () => {
    await row(ada, 5_000);
    for (const role of [() => h.anon(), () => h.asUser(ada)]) {
      await expect(role().run((tx) => tx.select().from(s.accountUsage))).rejects.toThrow(/permission denied/);
      await expect(role().run((tx) => tx.insert(s.accountUsage).values({ userId: ada, kind: "ideation", route: "ideation" }))).rejects.toThrow(/permission denied/);
    }
    const policies = await h.pg.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'account_usage'");
    expect(policies.rows[0]!.n).toBe(0);
  });

  it("the service role adds and reads rows but cannot change or delete them", async () => {
    const grants = await h.pg.query<{ privilege_type: string }>("select privilege_type from information_schema.role_table_grants where table_name = 'account_usage' and grantee = 'service_role' order by 1");
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("sums one person's exact cost since a moment, and nobody else's", async () => {
    const now = new Date("2026-11-16T12:00:00Z");
    await row(bo, 100, new Date(now.getTime() - 2 * 86_400_000));
    await row(bo, 250, new Date(now.getTime() - 3_600_000));
    await row(bo, 7, new Date(now.getTime() - 60_000));
    expect(await accountUsageRepo.spentMicro(h.db, bo, new Date(now.getTime() - 86_400_000))).toBe(257);
    expect(await accountUsageRepo.spentMicro(h.db, bo, new Date(now.getTime() - 30 * 86_400_000))).toBe(357);
  });
});
