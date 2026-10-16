/**
 * Round trips to the database, counted on the wire (src/testing/wire.ts: postgres.js with prepared statements off, as
 * on Supabase's transaction pooler, answered by PGlite's protocol handler). Each one costs a network round trip in
 * production (about 28 ms from Railway's Amsterdam region to the eu-north-1 pooler), so these counts are the latency
 * budget of every procedure (docs/DECISIONS.md "Round trips per procedure").
 *
 * Until 2026-10-12 postgres.js asked the server for a statement's parameter types before sending its values (Drizzle
 * never prepares a statement): two round trips for every statement with parameters, and nothing else sent on the
 * connection in between. patches/postgres@3.4.9.patch sends a statement whose untyped values are strings, numbers or
 * null in one go; the reference for "the same answer" (`createWireDb(pg, { describe: true })`) still has the server
 * describe every statement first and serializes each value for the type it names, as before the patch.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRls } from "../client";
import { repos } from "../repos";
import { bypassesRls } from "../repos/_shared";
import { businesses, memberships } from "../schema";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createWireDb, type WireDb } from "../testing/wire";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

let h: TestHarness;
let wire: WireDb;
let described: WireDb;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "trips-a");
  B = await createBusinessFixture(h, "trips-b");
  wire = await createWireDb(h.pg);
  described = await createWireDb(h.pg, { describe: true });
}, 120_000);

afterAll(async () => {
  await wire?.close();
  await described?.close();
  await h?.close();
});

async function count<T>(fn: () => Promise<T>, on: WireDb = wire): Promise<{ value: T; trips: number; statements: string[] }> {
  on.reset();
  const value = await fn();
  return { value, trips: on.roundTrips(), statements: on.statements() };
}

describe("postgres.js with prepared statements off (patched)", () => {
  it("sends a statement whose values are strings and numbers in one round trip, like one without values", async () => {
    expect((await count(() => wire.db.select().from(businesses).where(and(eq(businesses.id, A.businessId), ne(businesses.slug, "x"))))).trips).toBe(1);
    expect((await count(() => wire.db.execute(sql`select ${42}::int + ${1.5}::float8 as n`))).trips).toBe(1);
    expect((await count(() => wire.db.execute(sql`select 1`))).trips).toBe(1);
  });

  it("still describes first a statement with a value of unknown type that is not a string or a number", async () => {
    // An untyped array is serialized for the server's type (text[] here), so it still needs the description.
    const { value, trips } = await count(() => wire.db.execute(sql`select ${sql.param(["a", 'b "c"', "d,e"])}::text[] as xs`));
    expect(trips).toBe(2);
    expect((value as unknown as Array<{ xs: string[] }>)[0]?.xs).toEqual(["a", 'b "c"', "d,e"]);
  });

  it("is compared with a reference that really has the server describe each statement first", async () => {
    // A statement the clients have not sent before (a prepared statement would be reused): two round trips on the
    // reference, as every statement with values took before the patch, and one on the patched driver.
    const fresh = (on: WireDb) => on.db.execute(sql`select ${7}::int as ${sql.identifier(`fresh_${Math.random().toString(36).slice(2)}`)}`);
    expect((await count(() => fresh(described), described)).trips).toBe(2);
    expect((await count(() => fresh(wire))).trips).toBe(1);
  });

  it("answers exactly what a client that describes every statement answers, for every kind of value Drizzle sends", async () => {
    const probe = sql`select
      ${`o'hara "q" \\ é ✓ \u0001`}::text as t, ${42}::int as i, ${-1.5}::float8 as f, ${"12.30"}::numeric as n,
      ${"9007199254740993"}::int8 as big, ${'{"a":[1,"x"],"b":null}'}::jsonb as j, ${'{"k":"v"}'}::json as js, ${"42"}::jsonb as jn,
      ${"2026-10-12T10:00:00.000Z"}::timestamptz as ts, ${"2026-10-12"}::date as d, ${'{a,"b c"}'}::text[] as arr,
      ${A.businessId}::uuid as u, ${null}::text as nul, ${true} as b, ${false} as bf, ${new Uint8Array([104, 105])}::bytea as bytes,
      ${new Date("2026-10-12T10:00:00.000Z").toISOString()}::timestamptz as iso, ${"active"} = 'active' as eq`;
    const patched = (await wire.db.execute(probe)) as unknown as Record<string, unknown>[];
    const reference = (await described.db.execute(probe)) as unknown as Record<string, unknown>[];
    expect(patched).toEqual(reference);
    expect(patched[0]).toMatchObject({ t: `o'hara "q" \\ é ✓ \u0001`, i: 42, f: -1.5, j: { a: [1, "x"], b: null }, jn: 42, arr: ["a", "b c"], nul: null, b: true, bf: false, eq: true });
    expect(Buffer.from(patched[0]!.bytes as Uint8Array).toString()).toBe("hi");
  });

  it("differs only for values Drizzle never binds: a string or a number for a boolean, a string for bytea", async () => {
    // Described, these went through postgres.js's JavaScript serializer for the type: anything but `true` became false,
    // and a string became the bytes of its characters. Undescribed, the text is read as Postgres reads a literal.
    // Drizzle binds a boolean as a JavaScript boolean and bytea as a Uint8Array, both typed before sending, so no
    // column or condition reaches either case.
    const odd = sql`select ${"true"}::boolean as bs, ${1}::boolean as b1, ${0}::boolean as b0, ${"\\x6869"}::bytea as bytes`;
    const [patched] = (await wire.db.execute(odd)) as unknown as Array<{ bs: boolean; b1: boolean; b0: boolean; bytes: Uint8Array }>;
    const [reference] = (await described.db.execute(odd)) as unknown as Array<{ bs: boolean; b1: boolean; b0: boolean; bytes: Uint8Array }>;
    expect({ ...patched, bytes: Buffer.from(patched!.bytes).toString() }).toEqual({ bs: true, b1: true, b0: false, bytes: "hi" });
    expect({ ...reference, bytes: Buffer.from(reference!.bytes).toString() }).toEqual({ bs: false, b1: false, b0: false, bytes: "\\x6869" });
  });

  it("writes rows that read back the same, through Drizzle's own builders", async () => {
    const write = async (on: WireDb, name: string) => {
      await on.db.update(businesses).set({ name, glossary: { revenue: `Takings "net" o'clock`, n: "1" }, kitPrimary: "#112233" }).where(eq(businesses.id, B.businessId));
      return (await h.db.select().from(businesses).where(eq(businesses.id, B.businessId)))[0];
    };
    const viaPatched = await write(wire, `B's "Co" ✓`);
    const viaReference = await write(described, `B's "Co" ✓`);
    expect({ ...viaPatched, updatedAt: null }).toEqual({ ...viaReference, updatedAt: null });
    expect(viaPatched?.glossary).toEqual({ revenue: `Takings "net" o'clock`, n: "1" });
  });

  it("keeps a statement outside a transaction on its connection until it is answered, and pipelines inside one", async () => {
    // Outside a transaction (a pooled connection through the transaction pooler) nothing is pipelined, as before.
    const apart = await count(() => Promise.all([wire.db.select().from(businesses).where(eq(businesses.id, A.businessId)), wire.db.select().from(businesses).where(eq(businesses.id, B.businessId))]));
    expect(apart.trips).toBe(2);
    // Inside one, the connection is the transaction's own: both go together.
    const together = await count(() => wire.db.transaction((tx) => Promise.all([tx.select().from(businesses).where(eq(businesses.id, A.businessId)), tx.select().from(businesses).where(eq(businesses.id, B.businessId))])));
    expect(together.trips).toBe(3);
    expect(together.value.map((rows) => rows[0]?.id)).toEqual([A.businessId, B.businessId]);
  });
});

describe("withRls", () => {
  it("sends its setup with the transaction's first statements: BEGIN, setup + first statement, COMMIT", async () => {
    const nobody = "00000000-0000-4000-8000-0000000000aa";
    const first = (tx: Parameters<Parameters<typeof withRls>[2]>[0]) => tx.select({ id: businesses.id }).from(businesses).where(ne(businesses.id, nobody));
    const { value, trips, statements } = await count(() => withRls(wire.db, { userId: A.ownerId }, first));
    // RLS applied before the first statement ran: the owner of A sees A only.
    expect(value.map((r) => r.id)).toEqual([A.businessId]);
    expect(statements[0]).toBe("begin ");
    expect(statements[1]).toBe("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('jit', 'off', true)");
    expect(statements[2]).toMatch(/^select "id" from "businesses"/);
    // Until 2026-10-12: 6 (BEGIN; the setup's parameter types, then its values; the select's, then its; COMMIT).
    expect(trips).toBe(3);

    // The setup awaited before fn, as it was, costs one more round trip even on the patched driver.
    const before = await count(() =>
      wire.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', ${"authenticated"}, true), set_config('request.jwt.claims', ${JSON.stringify({ sub: A.ownerId, role: "authenticated" })}, true)`);
        return first(tx);
      }),
    );
    expect(before.value).toEqual(value);
    expect(before.trips).toBe(4);
  });

  it("pipelines the statements fn sends together: business.get's seven reads cost one round trip", async () => {
    const { value, trips } = await count(() =>
      withRls(wire.db, { userId: A.memberId }, (tx) =>
        Promise.all([
          repos.holidays.current(tx, A.businessId),
          repos.inbox.countBlocking(tx, A.businessId),
          repos.departments.list(tx, A.businessId),
          repos.agents.countByStatus(tx, A.businessId),
          repos.logos.getMeta(tx, A.businessId),
          repos.foundations.get(tx, A.businessId),
          repos.inbox.countByTab(tx, A.businessId),
        ]),
      ),
    );
    expect(value[2].length).toBeGreaterThan(0);
    expect(trips).toBe(3);
  });

  it("applies RLS to a first statement sent synchronously by a callback that is not async", async () => {
    for (const user of [A.ownerId, B.memberId, A.viewerId]) {
      const rows = await withRls(wire.db, { userId: user }, (tx) => tx.select({ id: businesses.id }).from(businesses));
      expect(rows.map((r) => r.id)).toEqual([user === B.memberId ? B.businessId : A.businessId]);
    }
    // A stranger sees nothing, and the role does not leak past the transaction: the next statement is the service role.
    const stranger = await h.createUser("stranger@trips.test");
    expect(await withRls(wire.db, { userId: stranger }, (tx) => tx.select().from(businesses))).toEqual([]);
    const after = await wire.db.execute(sql`select current_user as role`);
    expect((after as unknown as Array<{ role: string }>)[0]?.role).toBe("postgres");
  });

  it("carries claims exactly, whatever they contain, as bound parameters", async () => {
    const email = `o'hara"); drop table businesses; --@example.com \\ é`;
    const { value: claims, statements } = await count(() =>
      withRls(wire.db, { userId: A.ownerId, claims: { email } }, async (tx) => (await tx.execute(sql`select current_setting('request.jwt.claims', true) as claims`)) as unknown as Array<{ claims: string }>),
    );
    expect(JSON.parse(claims[0]!.claims)).toEqual({ email, sub: A.ownerId, role: "authenticated" });
    expect(statements.join("\n")).not.toContain("o'hara");
    expect((await h.db.select().from(businesses)).length).toBeGreaterThanOrEqual(2);
    await expect(withRls(wire.db, { userId: A.ownerId, role: "postgres' --" as never }, async () => 1)).rejects.toThrow(/unknown role/);
  });

  it("rolls back and reports the callback's error, only once the callback is done with the connection", async () => {
    await expect(withRls(wire.db, { userId: A.ownerId }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    // A statement that fails (RLS refuses the write) aborts the transaction; the callback's own catch still runs inside
    // it, and the error that reaches the caller is the database's.
    let caught = false;
    const failed = await withRls(wire.db, { userId: A.viewerId }, async (tx) => {
      try {
        // RLS hides B's business from A's viewer (no row, no error), then refuses the membership outright.
        expect(await tx.update(businesses).set({ name: "Renamed by a viewer" }).where(eq(businesses.id, B.businessId)).returning()).toEqual([]);
        await tx.insert(memberships).values({ businessId: B.businessId, userId: A.viewerId, role: "owner" });
      } catch (err) {
        caught = true;
        throw err;
      }
    }).catch((err: Error & { cause?: Error }) => err);
    expect(caught).toBe(true);
    expect(String((failed as Error & { cause?: Error }).cause?.message)).toMatch(/row-level security|permission denied/);
    expect((await h.db.select().from(businesses).where(eq(businesses.id, B.businessId)))[0]?.name).not.toBe("Renamed by a viewer");
    // Nothing was written, and the connection is clean afterwards.
    expect((await h.db.select().from(memberships).where(and(eq(memberships.businessId, B.businessId), eq(memberships.userId, A.viewerId))))).toEqual([]);
    expect(await withRls(wire.db, { userId: A.ownerId }, (tx) => tx.select({ id: businesses.id }).from(businesses))).toHaveLength(1);
  });

  it("lets none of fn's statements take effect when the setup fails, and reports the setup's error", async () => {
    // fn starts before the setup is answered, so a failed setup must abort the transaction ahead of fn's statements.
    // The setup only fails when its role is missing (or the connection drops): rename the role for a moment. The write
    // is one service_role may make, so only the aborted transaction keeps it out.
    await h.db.execute(sql`alter role service_role rename to service_role_away`);
    let started = false;
    let failed: unknown;
    try {
      failed = await withRls(wire.db, { userId: A.ownerId, role: "service_role" }, async (tx) => {
        started = true;
        await tx.update(businesses).set({ name: "Written before RLS applied" }).where(eq(businesses.id, A.businessId));
      }).catch((err: unknown) => err);
    } finally {
      await h.db.execute(sql`alter role service_role_away rename to service_role`);
    }
    expect(started).toBe(true);
    expect(String((failed as Error).message)).toMatch(/role "service_role" does not exist/);
    expect((await h.db.select().from(businesses).where(eq(businesses.id, A.businessId)))[0]?.name).not.toBe("Written before RLS applied");
    // The connection is clean afterwards.
    expect(await withRls(wire.db, { userId: A.ownerId }, (tx) => tx.select({ id: businesses.id }).from(businesses))).toHaveLength(1);
  });

  it("turns JIT off for the transaction in the same statement, and only for it", async () => {
    const before = (await wire.db.execute(sql`select current_setting('jit') as jit`)) as unknown as Array<{ jit: string }>;
    const { value, trips } = await count(() => withRls(wire.db, { userId: A.ownerId }, async (tx) => (await tx.execute(sql`select current_setting('jit') as jit`)) as unknown as Array<{ jit: string }>));
    expect(value[0]?.jit).toBe("off");
    expect(trips).toBe(3);
    const after = (await wire.db.execute(sql`select current_setting('jit') as jit`)) as unknown as Array<{ jit: string }>;
    expect(after[0]?.jit).toBe(before[0]?.jit);
    const onPglite = await withRls(h.db as unknown as Parameters<typeof withRls>[0], { userId: A.ownerId }, async (tx) => (await tx.execute(sql`select current_setting('jit') as jit`)) as unknown as { rows: Array<{ jit: string }> });
    expect(onPglite.rows[0]?.jit).toBe("off");
  });

  it("says which role it runs as, so the Ribbon's reads need not ask the server (bypassesRls)", async () => {
    // Under the signed-in user: the view (RLS applies), answered without the `pg_roles` question (one round trip less).
    const asUser = await count(() => withRls(wire.db, { userId: A.ownerId }, (tx) => repos.journeys.dailyRange(tx, A.businessId, {})));
    expect(asUser.statements.some((q) => /pg_roles/.test(q))).toBe(false);
    expect(asUser.statements.some((q) => /from "journey_daily"/.test(q))).toBe(true);
    expect(asUser.trips).toBe(3);
    // As service_role inside withRls: the materialized view, still without asking.
    const asService = await count(() => withRls(wire.db, { userId: A.ownerId, role: "service_role" }, (tx) => repos.journeys.dailyRange(tx, A.businessId, {})));
    expect(asService.statements.some((q) => /pg_roles/.test(q))).toBe(false);
    expect(asService.statements.some((q) => /from "journey_daily_mv"/.test(q))).toBe(true);
    expect(asService.value).toEqual(await repos.journeys.dailyRange(h.db, A.businessId, {}));
    // Any other connection or transaction is asked, as before.
    const plain = await count(() => wire.db.transaction((tx) => bypassesRls(tx)));
    expect(plain.value).toBe(true);
    expect(plain.statements.some((q) => /pg_roles/.test(q))).toBe(true);
    expect(await withRls(wire.db, { userId: A.ownerId }, (tx) => bypassesRls(tx))).toBe(false);
    expect(await withRls(wire.db, { userId: A.ownerId, role: "anon" }, (tx) => bypassesRls(tx))).toBe(false);
  });

  it("does the same on PGlite's own driver (no postgres.js), where the setup is awaited", async () => {
    const rows = await withRls(h.db as unknown as Parameters<typeof withRls>[0], { userId: B.ownerId, claims: { email: "x'y@b.test" } }, async (tx) => {
      const claims = (await tx.execute(sql`select current_setting('request.jwt.claims', true) as claims`)) as unknown as { rows: Array<{ claims: string }> };
      return { visible: await tx.select({ id: businesses.id }).from(businesses), claims: JSON.parse(claims.rows[0]!.claims) as Record<string, string> };
    });
    expect(rows.visible.map((r) => r.id)).toEqual([B.businessId]);
    expect(rows.claims.email).toBe("x'y@b.test");
  });
});

describe("repos.journeys.countPayingCustomers", () => {
  it("names the business by value in both churn checks, so they can use its index under RLS", async () => {
    const { statements, value } = await count(() => withRls(wire.db, { userId: A.ownerId }, (tx) => repos.journeys.countPayingCustomers(tx, A.businessId, { from: new Date("2026-06-01"), to: new Date("2026-07-01") })));
    const query = statements.find((q) => /from "conversions"/.test(q)) ?? "";
    expect(query.match(/from entity_roles r where r\.business_id = \$\d+ and r\.business_id = "conversions"\."business_id"/g)).toHaveLength(2);
    expect(value).toBe(await repos.journeys.countPayingCustomers(h.db, A.businessId, { from: new Date("2026-06-01"), to: new Date("2026-07-01") }));
  });
});

describe("repos.memberships.access", () => {
  it("finds the membership and the business in one statement and one round trip", async () => {
    // Until 2026-10-12: two lookups on two connections, two round trips each (parameter types first).
    const { value, trips, statements } = await count(() => repos.memberships.access(wire.db, A.businessId, A.memberId));
    expect(statements).toHaveLength(1);
    expect(trips).toBe(1);
    expect(value.membership).toMatchObject({ businessId: A.businessId, userId: A.memberId, role: "member" });
    expect(value.business).toMatchObject({ id: A.businessId, slug: A.slug });
  });

  it("answers no membership for a non-member, whether or not the business exists", async () => {
    expect(await repos.memberships.access(h.db, A.businessId, B.ownerId)).toEqual({ membership: null, business: null });
    expect(await repos.memberships.access(h.db, "00000000-0000-4000-8000-0000000000aa", A.ownerId)).toEqual({ membership: null, business: null });
  });

  it("answers the membership without the business once the business is archived", async () => {
    const archived = await createBusinessFixture(h, "trips-archived");
    await h.db.update(businesses).set({ archivedAt: new Date() }).where(eq(businesses.id, archived.businessId));
    const access = await repos.memberships.access(h.db, archived.businessId, archived.ownerId);
    expect(access.membership?.role).toBe("owner");
    expect(access.business).toBeNull();
    expect((await h.db.select().from(memberships).where(and(eq(memberships.businessId, archived.businessId), eq(memberships.userId, archived.ownerId)))).length).toBe(1);
  });
});
