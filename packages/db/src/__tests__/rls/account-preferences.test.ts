/**
 * account_preferences (0022): one row per signed-in account, read and written only by that account. Cross-user checks
 * on the table itself and through `repos.preferences` under RLS (the path apps/api takes).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preferencesRepo } from "../../repos/preferences";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { RLS_DENIED } from "./fixtures";

let h: TestHarness;
let ada: string;
let bo: string;
let cy: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada@test.local");
  bo = await h.createUser("bo@test.local");
  cy = await h.createUser("cy@test.local");
});
afterAll(() => h?.close());

describe("account_preferences (table)", () => {
  it("a user creates and reads only their own row", async () => {
    await h.asUser(ada).run((tx) => tx.insert(s.accountPreferences).values({ userId: ada, dateFormat: "day_first", timeFormat: "24h" }));
    await h.asUser(bo).run((tx) => tx.insert(s.accountPreferences).values({ userId: bo, dateFormat: "iso" }));
    const seenByAda = await h.asUser(ada).run((tx) => tx.select().from(s.accountPreferences));
    expect(seenByAda.map((r) => [r.userId, r.dateFormat, r.timeFormat])).toEqual([[ada, "day_first", "24h"]]);
    const seenByBo = await h.asUser(bo).run((tx) => tx.select().from(s.accountPreferences));
    expect(seenByBo.map((r) => r.userId)).toEqual([bo]);
    // A third account with no row sees nothing at all, not even by naming the others.
    expect(await h.asUser(cy).run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)))).toHaveLength(0);
  });

  it("a user cannot create, change or delete someone else's row", async () => {
    await expect(h.asUser(cy).run((tx) => tx.insert(s.accountPreferences).values({ userId: ada, dateFormat: "us" }))).rejects.toThrow(RLS_DENIED);
    const changed = await h.asUser(cy).run((tx) => tx.update(s.accountPreferences).set({ dateFormat: "us", timeFormat: "12h" }).where(eq(s.accountPreferences.userId, ada)).returning());
    expect(changed).toHaveLength(0);
    // Nor move their own row onto another account.
    await expect(h.asUser(bo).run((tx) => tx.update(s.accountPreferences).set({ userId: ada }).where(eq(s.accountPreferences.userId, bo)))).rejects.toThrow(RLS_DENIED);
    // There is no delete grant: the row goes only with the account.
    await expect(h.asUser(ada).run((tx) => tx.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)))).rejects.toThrow(/permission denied/);
    const truth = await h.service().run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)));
    expect(truth.map((r) => [r.dateFormat, r.timeFormat])).toEqual([["day_first", "24h"]]);
  });

  it("signed-out visitors read and write nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.accountPreferences))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.insert(s.accountPreferences).values({ userId: cy }))).rejects.toThrow(/permission denied/);
  });

  it("only the known formats are stored, and a new row defaults to US and 12-hour", async () => {
    await expect(h.service().execute(sql`insert into account_preferences (user_id, date_format) values (${cy}::uuid, 'dmy')`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into account_preferences (user_id, time_format) values (${cy}::uuid, '24')`)).rejects.toThrow(/check constraint/);
    const [row] = await h.asUser(cy).run((tx) => tx.insert(s.accountPreferences).values({ userId: cy }).returning());
    expect([row!.dateFormat, row!.timeFormat]).toEqual(["us", "12h"]);
    await h.db.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, cy));
  });
});

describe("repos.preferences under RLS", () => {
  it("reads the defaults without writing a row, then upserts only what changed", async () => {
    const dee = await h.createUser("dee@test.local");
    expect(await h.asUser(dee).run((tx) => preferencesRepo.get(tx, dee))).toEqual({ date: "us", time: "12h" });
    expect(await h.service().run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, dee)))).toHaveLength(0);
    expect(await h.asUser(dee).run((tx) => preferencesRepo.update(tx, dee, { time: "24h" }))).toEqual({ date: "us", time: "24h" });
    expect(await h.asUser(dee).run((tx) => preferencesRepo.update(tx, dee, { date: "iso" }))).toEqual({ date: "iso", time: "24h" });
    expect(await h.asUser(dee).run((tx) => preferencesRepo.get(tx, dee))).toEqual({ date: "iso", time: "24h" });
  });

  it("another account cannot read or change the first one's choice through the repo", async () => {
    // Bo asking for Ada's row sees nothing, so reads the defaults; writing it fails the policy.
    expect(await h.asUser(bo).run((tx) => preferencesRepo.get(tx, ada))).toEqual({ date: "us", time: "12h" });
    await expect(h.asUser(bo).run((tx) => preferencesRepo.update(tx, ada, { date: "us", time: "12h" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(ada).run((tx) => preferencesRepo.get(tx, ada))).toEqual({ date: "day_first", time: "24h" });
    // Bo's own change touches Bo only.
    expect(await h.asUser(bo).run((tx) => preferencesRepo.update(tx, bo, { time: "24h" }))).toEqual({ date: "iso", time: "24h" });
    expect(await h.asUser(ada).run((tx) => preferencesRepo.get(tx, ada))).toEqual({ date: "day_first", time: "24h" });
  });

  it("refuses an empty change or an unknown format with a validation error", async () => {
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, {}))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { date: "dmy" } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { date: "us", extra: 1 } as never))).rejects.toThrow(/Invalid preferences/);
  });
});
