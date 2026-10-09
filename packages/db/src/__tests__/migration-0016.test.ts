/** 0016 over data that already exists: blocked rows get a blocker, duplicate pairs collapse to one row, nothing else moves. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0016_live_hardening";
let h: TestHarness;
let A: string;
let B: string;
let C: string;
let D: string;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  [A, B, C, D] = await Promise.all([h.createUser("a@m.test"), h.createUser("b@m.test"), h.createUser("c@m.test"), h.createUser("d@m.test")]);
  // The old key only forbade a repeat in the same direction, so both directions of a pair could exist, in any mix of states.
  await h.pg.query(
    `insert into connections (from_user, to_user, status, created_at) values
       ($1, $2, 'blocked',   now() - interval '3 days'),
       ($2, $1, 'requested', now() - interval '1 day'),
       ($2, $3, 'accepted',  now() - interval '5 days'),
       ($3, $2, 'requested', now()),
       ($3, $1, 'requested', now() - interval '2 days'),
       ($1, $3, 'requested', now() - interval '1 day'),
       ($4, $1, 'requested', now())`,
    [A, B, C, D],
  );
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

const rows = async () => (await h.db.execute(sql`select from_user, to_user, status, blocked_by from connections order by status, created_at`) as unknown as { rows: { from_user: string; to_user: string; status: string; blocked_by: string | null }[] }).rows;

describe("0016 applied over existing connections", () => {
  it("keeps one row per pair, preferring a block, then an acceptance, then the newest request", async () => {
    const all = await rows();
    expect(all).toHaveLength(4);
    expect(all.find((r) => r.status === "blocked")).toMatchObject({ from_user: A, to_user: B });
    expect(all.find((r) => r.status === "accepted")).toMatchObject({ from_user: B, to_user: C });
    // The two requests between A and C leave the newer one (A asked C a day ago; C asked A two days ago).
    expect(all.filter((r) => r.status === "requested").map((r) => [r.from_user, r.to_user]).sort()).toEqual([[A, C], [D, A]].sort());
  });

  it("records the recipient as the blocker of a row blocked before the column existed, and no one else", async () => {
    const all = await rows();
    expect(all.find((r) => r.status === "blocked")!.blocked_by).toBe(B);
    expect(all.filter((r) => r.status !== "blocked").every((r) => r.blocked_by === null)).toBe(true);
  });

  it("then enforces the pair key, the blocker check, the update guard and the column grants", async () => {
    await expect(h.pg.query(`insert into connections (from_user, to_user) values ($1, $2)`, [C, A])).rejects.toThrow(/connections_pair_key|duplicate/);
    await expect(h.pg.query(`update connections set status = 'blocked' where from_user = $1 and to_user = $2`, [A, C])).rejects.toThrow(/connections_blocked_by_check/);
    await expect(h.pg.query(`update connections set to_user = $1 where from_user = $2 and to_user = $3`, [D, A, C])).rejects.toThrow(/cannot change who it is between/);
    const grants = (await h.db.execute(sql`select privilege_type from information_schema.column_privileges where table_name = 'connections' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by column_name`)) as unknown as { rows: { privilege_type: string }[] };
    expect(grants.rows).toHaveLength(3);
    const cols = (await h.db.execute(sql`select column_name from information_schema.column_privileges where table_name = 'connections' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by column_name`)) as unknown as { rows: { column_name: string }[] };
    expect(cols.rows.map((r) => r.column_name)).toEqual(["blocked_by", "responded_at", "status"]);
  });
});
