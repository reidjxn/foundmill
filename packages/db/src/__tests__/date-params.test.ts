/**
 * A `Date` in a raw `sql` template (Nov 14, 2026): Drizzle's postgres-js driver makes the date and time serializers pass
 * values through, so postgres.js handed the `Date` itself to its wire writer and the query threw. PGlite accepted it, so
 * only the real-Postgres run saw it (founder cancel links, credit lots, the post attribution week summary).
 * `withDateParams` writes a `Date` as its ISO string. The second block runs against a real Postgres when
 * RLS_TEST_DATABASE_URL is set, through `createDb` itself, with prepared statements on (direct) and off (pooler).
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { closeDb, createDb } from "../index";
import { realPostgresUrl } from "../testing/postgres";

describe("withDateParams", () => {
  it("createDb's client writes a Date as its ISO string for every date and time type, and leaves text alone", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 1 });
    const serializers = (db.$client as unknown as { options: { serializers: Record<string, (v: unknown) => unknown> } }).options.serializers;
    const at = new Date("2026-11-14T15:00:00.000Z");
    for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
      expect(serializers[type]!(at)).toBe("2026-11-14T15:00:00.000Z");
      expect(serializers[type]!("2026-11-14T15:00:00.000Z")).toBe("2026-11-14T15:00:00.000Z");
    }
    await closeDb(db);
  });
});

const url = realPostgresUrl();

describe.skipIf(!url)("a Date in a raw sql template, on a real Postgres", () => {
  for (const prepare of [true, false]) {
    it(`compares, sets and returns it (prepared statements ${prepare ? "on" : "off"})`, async () => {
      const db = createDb(url!, { max: 1, prepare });
      try {
        const at = new Date("2026-11-14T15:00:00.000Z");
        const rows = (await db.execute(sql`select ${at}::timestamptz = '2026-11-14T15:00:00Z'::timestamptz as same, now() > ${at} as later, ${new Date(0)} < now() as epoch`)) as unknown as Array<Record<string, unknown>>;
        expect(rows[0]).toEqual({ same: true, later: true, epoch: true });
        // A Date next to strings and numbers, as an update's where clause has them.
        const mixed = (await db.execute(sql`select count(*)::int as n from (values (1)) v(x) where ${"a"} = 'a' and ${1} = 1 and now() > ${at}`)) as unknown as Array<{ n: number }>;
        expect(mixed[0]!.n).toBe(1);
      } finally {
        await closeDb(db);
      }
    });
  }
});
