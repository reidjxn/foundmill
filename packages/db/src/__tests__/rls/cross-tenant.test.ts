/**
 * Generated cross-tenant suite: for every business-scoped table (see ./tables.ts) assert that
 *   - a member of business A cannot read, insert into, update or delete business B's rows,
 *   - a viewer can read but not write,
 *   - a non-member and anon see nothing,
 *   - the intended writer (member / admin / service) can write and others cannot.
 * Test names carry the table name so a failure says which table regressed.
 */
import { and, eq, getTableName, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { createTestDb, type Runner, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";
import { TENANT_TABLES, type TenantTable, type TenantTableSpec } from "./tables";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
/** id of the service-inserted row per table per business. */
const seeded = new Map<string, { a: string; b: string }>();

const insertRow = async (tx: DbTx, table: TenantTable, values: Record<string, unknown>) => {
  const rows = await tx.insert(table).values(values as never).returning({ id: table.id });
  return rows as { id: string }[];
};
const selectIds = async (tx: DbTx, table: TenantTable, businessId: string) =>
  (await tx.select({ id: table.id }).from(table).where(eq(table.businessId, businessId))) as { id: string }[];
const selectAll = async (tx: DbTx, table: TenantTable) => (await tx.select({ businessId: table.businessId }).from(table)) as { businessId: string }[];
const updateRows = async (tx: DbTx, table: TenantTable, businessId: string, patch: Record<string, unknown>) =>
  (await tx.update(table).set(patch as never).where(eq(table.businessId, businessId)).returning({ id: table.id })) as { id: string }[];
const deleteRows = async (tx: DbTx, table: TenantTable, businessId: string, id: string) =>
  (await tx.delete(table).where(and(eq(table.businessId, businessId), eq(table.id, id))).returning({ id: table.id })) as { id: string }[];

const countAs = (runner: Runner, table: TenantTable, businessId: string) => runner.run((tx) => selectIds(tx, table, businessId)).then((r) => r.length);

/** A write that must not happen: either Postgres refuses it, or RLS silently filters every row. */
async function expectNoEffect(p: Promise<unknown[]>) {
  try {
    const rows = await p;
    expect(rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "alpha");
  B = await createBusinessFixture(h, "bravo");
  outsiderId = await h.createUser("outsider@test.local");
  // One service-written row per table per business.
  for (const t of TENANT_TABLES) {
    const [a, b] = await h.service().run(async (tx) => {
      const ra = await insertRow(tx, t.table, { ...t.sample(A), businessId: A.businessId });
      const rb = await insertRow(tx, t.table, { ...t.sample(B), businessId: B.businessId });
      return [ra[0]!.id, rb[0]!.id] as const;
    });
    seeded.set(t.name, { a, b });
  }
});

afterAll(async () => {
  await h?.close();
});

const patchFor = (t: TenantTableSpec) => t.patch ?? { updatedAt: new Date() };

describe.each(TENANT_TABLES.map((t) => [t.name, t] as const))("%s", (_name, t) => {
  const table = t.table;

  it(`${t.name}: service wrote one row per business (fixture sanity)`, async () => {
    expect(getTableName(table)).toBe(t.name);
    expect(await countAs(h.service(), table, A.businessId)).toBeGreaterThanOrEqual(1);
    expect(await countAs(h.service(), table, B.businessId)).toBeGreaterThanOrEqual(1);
  });

  it(`${t.name}: member of A cannot read B's rows`, async () => {
    expect(await countAs(h.asUser(A.memberId), table, B.businessId)).toBe(0);
    const visible = await h.asUser(A.memberId).run((tx) => selectAll(tx, table));
    expect(visible.every((r) => r.businessId === A.businessId)).toBe(true);
  });

  it(`${t.name}: member of A cannot insert into B`, async () => {
    await expect(h.asUser(A.memberId).run((tx) => insertRow(tx, table, { ...t.sample(B), businessId: B.businessId }))).rejects.toThrow(RLS_DENIED);
  });

  it(`${t.name}: owner of A cannot insert into B`, async () => {
    await expect(h.asUser(A.ownerId).run((tx) => insertRow(tx, table, { ...t.sample(B), businessId: B.businessId }))).rejects.toThrow(RLS_DENIED);
  });

  it(`${t.name}: member of A cannot update B's rows`, async () => {
    await expectNoEffect(h.asUser(A.memberId).run((tx) => updateRows(tx, table, B.businessId, patchFor(t))));
  });

  it(`${t.name}: member of A cannot delete B's rows`, async () => {
    const seededB = seeded.get(t.name)!.b;
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => deleteRows(tx, table, B.businessId, seededB)));
    expect(await countAs(h.service(), table, B.businessId)).toBeGreaterThanOrEqual(1);
  });

  it(`${t.name}: member of A can read A's rows`, async () => {
    expect(await countAs(h.asUser(A.memberId), table, A.businessId)).toBeGreaterThanOrEqual(1);
  });

  it(`${t.name}: viewer of A can read A's rows but not B's`, async () => {
    expect(await countAs(h.asUser(A.viewerId), table, A.businessId)).toBeGreaterThanOrEqual(1);
    expect(await countAs(h.asUser(A.viewerId), table, B.businessId)).toBe(0);
  });

  it(`${t.name}: viewer of A cannot insert into A`, async () => {
    await expect(h.asUser(A.viewerId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }))).rejects.toThrow(RLS_DENIED);
  });

  it(`${t.name}: viewer of A cannot update A's rows`, async () => {
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => updateRows(tx, table, A.businessId, patchFor(t))));
  });

  it(`${t.name}: viewer of A cannot delete A's rows`, async () => {
    const seededA = seeded.get(t.name)!.a;
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => deleteRows(tx, table, A.businessId, seededA)));
  });

  it(`${t.name}: non-member sees nothing`, async () => {
    const visible = await h.asUser(outsiderId).run((tx) => selectAll(tx, table));
    expect(visible).toHaveLength(0);
  });

  it(`${t.name}: anon sees nothing`, async () => {
    await expectNoEffect(h.anon().run((tx) => selectAll(tx, table)));
  });

  if (t.write === "member" || t.write === "append") {
    it(`${t.name}: member of A can insert into A`, async () => {
      const rows = await h.asUser(A.memberId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }));
      expect(rows).toHaveLength(1);
      const check = await h.service().run((tx) => tx.select({ b: table.businessId }).from(table).where(eq(table.id, rows[0]!.id)));
      expect((check as { b: string }[])[0]?.b).toBe(A.businessId);
    });
  }

  if (t.write === "member") {
    it(`${t.name}: member of A can update A's rows`, async () => {
      const seededA = seeded.get(t.name)!.a;
      const rows = await h
        .asUser(A.memberId)
        .run((tx) => tx.update(table).set(patchFor(t) as never).where(and(eq(table.businessId, A.businessId), eq(table.id, seededA))).returning({ id: table.id }));
      expect(rows).toHaveLength(1);
    });
  }

  if (t.write === "append") {
    it(`${t.name}: member of A cannot update or delete A's rows (append-only)`, async () => {
      await expect(h.asUser(A.ownerId).run((tx) => updateRows(tx, table, A.businessId, patchFor(t)))).rejects.toThrow(/append-only|permission denied/);
      const seededA = seeded.get(t.name)!.a;
      await expect(h.asUser(A.ownerId).run((tx) => deleteRows(tx, table, A.businessId, seededA))).rejects.toThrow(/append-only|permission denied/);
    });
  }

  if (t.write === "admin") {
    it(`${t.name}: member of A cannot insert into A (admin-only table)`, async () => {
      await expect(h.asUser(A.memberId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }))).rejects.toThrow(RLS_DENIED);
    });
    it(`${t.name}: admin and owner of A can insert into A`, async () => {
      const r1 = await h.asUser(A.adminId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }));
      const r2 = await h.asUser(A.ownerId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }));
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  }

  if (t.write === "service") {
    it(`${t.name}: owner of A cannot insert into A (service-written table)`, async () => {
      await expect(h.asUser(A.ownerId).run((tx) => insertRow(tx, table, { ...t.sample(A), businessId: A.businessId }))).rejects.toThrow(RLS_DENIED);
    });
    it(`${t.name}: owner of A cannot update A's rows (service-written table)`, async () => {
      // journeys is the one exception: members may mark a journey as viewed.
      if (t.name === "journeys") return;
      await expectNoEffect(h.asUser(A.ownerId).run((tx) => updateRows(tx, table, A.businessId, patchFor(t))));
    });
  }
});

describe("tenant tables catalogue", () => {
  it("covers every table that has a not-null business_id column", async () => {
    const res = await h.db.execute(sql`
      select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'business_id' and is_nullable = 'NO'
         and table_name in (select tablename from pg_tables where schemaname = 'public')
       order by table_name`);
    const inSql = (res as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    const covered = new Set([...TENANT_TABLES.map((t) => t.name), "memberships", "credentials", "dashboard_layouts", "inbox_item_reads", "project_pages"]);
    const missing = inSql.filter((n) => !covered.has(n));
    expect(missing).toEqual([]);
  });
});
