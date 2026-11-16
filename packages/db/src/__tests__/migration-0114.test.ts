/**
 * 0114 over a database that already has people (WP-04 T13, single-key shortcuts off by default): the new
 * `account_preferences.keyboard_shortcuts` column is false for a new row and for a guided account, and true for an
 * account that had turned guidance off before it (an operator who already sees the key caps keeps the keys).
 *
 * The migration's number may change when branches merge: `TAG` below is the one place this file names it.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0114_keyboard_shortcuts_pref";

let h: TestHarness;
let guided = "";
let operator = "";
let noRow = "";

const shortcutsOf = async (userId: string) => {
  const r = (await h.db.execute(sql`select keyboard_shortcuts from account_preferences where user_id = ${userId}::uuid`)) as unknown as { rows: { keyboard_shortcuts: boolean }[] };
  return r.rows.map((x) => x.keyboard_shortcuts);
};

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  [guided, operator, noRow] = await Promise.all([h.createUser("m114-guided@test.local"), h.createUser("m114-operator@test.local"), h.createUser("m114-none@test.local")]);
  // By named columns: the schema's insert would name the column this migration adds.
  await h.db.execute(sql`insert into account_preferences (user_id, guidance) values (${guided}::uuid, 'on'), (${operator}::uuid, 'off')`);
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
}, 120_000);
afterAll(() => h?.close());

describe(`${TAG}: single-key shortcuts`, () => {
  it("are on for an account that had turned guidance off, off for a guided one", async () => {
    expect(await shortcutsOf(operator)).toEqual([true]);
    expect(await shortcutsOf(guided)).toEqual([false]);
  });

  it("are off on a row created after it", async () => {
    await h.db.execute(sql`insert into account_preferences (user_id) values (${noRow}::uuid)`);
    expect(await shortcutsOf(noRow)).toEqual([false]);
  });
});
