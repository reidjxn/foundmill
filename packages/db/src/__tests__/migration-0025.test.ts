/**
 * 0025 — the business currency: backfilled from what commit wrote (departments, then channels, then the founder's
 * profile, then USD); a business amount written without a currency takes the business's instead of EUR; only owners
 * and admins of the business itself change it.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { repos } from "../repos";
import * as s from "../schema";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0025_business_currency";

describe("0025 applied over existing businesses", () => {
  let h: TestHarness;
  const ids = { fromDepartments: "", fromChannels: "", fromProfile: "", nothing: "" };

  beforeAll(async () => {
    const all = readMigrations();
    h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
    const [usd, gbp, sek] = await Promise.all([h.createUser("usd@m.test"), h.createUser("gbp@m.test"), h.createUser("sek@m.test")]);
    await h.pg.query(`insert into founder_profiles (user_id, display_name, currency) values ($1, 'USD founder', 'USD'), ($2, 'GBP founder', 'GBP'), ($3, 'SEK founder', 'SEK')`, [usd, gbp, sek]);
    const business = async (slug: string, createdBy: string | null) =>
      ((await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by) values ($1, $1, $2) returning id`, [slug, createdBy])).rows[0]!.id);
    // Committed by a SEK founder with USD chosen at commit: the departments say USD (two of three), the profile SEK.
    ids.fromDepartments = await business("from-departments", sek);
    await h.pg.query(`insert into departments (business_id, name, slug, currency) values ($1, 'Product', 'product', 'USD'), ($1, 'Finance', 'finance', 'USD'), ($1, 'Legal', 'legal', 'EUR')`, [ids.fromDepartments]);
    ids.fromChannels = await business("from-channels", usd);
    await h.pg.query(`insert into channels (business_id, channel_key, line, currency) values ($1, 'seo', 'midfield', 'GBP')`, [ids.fromChannels]);
    ids.fromProfile = await business("from-profile", gbp);
    ids.nothing = await business("nothing", null);
    await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
  });
  afterAll(() => h?.close());

  const currencyOf = async (id: string) => (await h.db.select({ currency: s.businesses.currency }).from(s.businesses).where(eq(s.businesses.id, id)))[0]!.currency;

  it("takes the departments' currency, else the channels', else the founder's, else USD", async () => {
    expect(await currencyOf(ids.fromDepartments)).toBe("USD");
    expect(await currencyOf(ids.fromChannels)).toBe("GBP");
    expect(await currencyOf(ids.fromProfile)).toBe("GBP");
    expect(await currencyOf(ids.nothing)).toBe("USD");
  });

  it("then holds the column to a not-null, three-letter code defaulting to USD", async () => {
    const created = (await h.pg.query<{ currency: string }>(`insert into businesses (name, slug) values ('later', 'later') returning currency`)).rows[0]!;
    expect(created.currency).toBe("USD");
    await expect(h.pg.query(`update businesses set currency = 'usd' where id = $1`, [ids.nothing])).rejects.toThrow(/businesses_currency_code/);
    await expect(h.pg.query(`update businesses set currency = null where id = $1`, [ids.nothing])).rejects.toThrow(/null/);
  });
});

describe("business amounts take the business currency", () => {
  let h: TestHarness;
  let A: BusinessFixture;
  let B: BusinessFixture;

  beforeAll(async () => {
    h = await createTestDb();
    A = await createBusinessFixture(h, "cur-a");
    B = await createBusinessFixture(h, "cur-b");
    await h.db.update(s.businesses).set({ currency: "GBP" }).where(eq(s.businesses.id, A.businessId));
    await h.db.update(s.businesses).set({ currency: "SEK" }).where(eq(s.businesses.id, B.businessId));
  });
  afterAll(() => h?.close());

  it("every business-money table lost its EUR default and fills a missing currency from the business", async () => {
    const r = (await h.db.execute(sql`
      select c.table_name, c.column_default, exists (
        select 1 from pg_trigger t where t.tgrelid = (quote_ident(c.table_name))::regclass and t.tgname = c.table_name || '_business_currency'
      ) as filled
        from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'currency' order by 1`)) as unknown as { rows: { table_name: string; column_default: string | null; filled: boolean }[] };
    const filled = r.rows.filter((x) => x.filled).map((x) => x.table_name);
    expect(filled).toEqual(["accounts", "agents", "campaigns", "cap_table_entries", "channel_metrics", "channels", "contracts", "conversions", "departments", "forecasts", "holiday_periods", "ledger_snapshots", "legal_entities", "securities", "tasks", "transactions"]);
    for (const row of r.rows.filter((x) => x.filled)) expect(row.column_default, row.table_name).toBeNull();
    // Model costs are metered in the pricing currency, whatever the business uses.
    const modelCost = r.rows.filter((x) => ["agent_metrics", "agent_sessions", "inbox_items", "training_runs"].includes(x.table_name));
    expect(modelCost).toHaveLength(4);
    for (const row of modelCost) expect(row.column_default, row.table_name).toMatch(/^'USD'/);
  });

  it("a hire, a department, a task and a vacation written without a currency use the business's (service role)", async () => {
    await h.service().run(async (tx) => {
      const agent = await repos.agents.create(tx, A.businessId, { name: "Docs Writer", role: "Writer", agentType: "docs_writer", layer: "worker", modelKey: "haiku", wageCapMinor: 15_000 });
      expect(agent.currency).toBe("GBP");
      const dept = await repos.departments.create(tx, B.businessId, { name: "Research", slug: "research", budgetMinor: 50_000 });
      expect(dept.currency).toBe("SEK");
      const task = await repos.tasks.create(tx, A.businessId, { kind: "research", title: "Price check", budgetMinor: 2_000 });
      expect(task.currency).toBe("GBP");
      const holiday = await repos.holidays.start(tx, A.businessId, { untilAt: null, untilCondition: { text: "until I return" }, authority: { decisionTypes: [] }, budgetCeilingMinor: null, wakeEvents: [] });
      expect(holiday.currency).toBe("GBP");
    });
  });

  it("an explicit currency is kept (a USD bank account in a GBP business)", async () => {
    const account = await h.service().run((tx) => repos.finance.upsertAccount(tx, A.businessId, { provider: "tink", externalId: "usd-1", name: "Dollar account", currency: "USD", balanceMinor: 1_000 }));
    expect(account.currency).toBe("USD");
  });

  it("fills from the business the row belongs to when a member writes through RLS", async () => {
    const task = await h.asUser(A.memberId).run((tx) => repos.tasks.create(tx, A.businessId, { kind: "ops", title: "Member task" }));
    expect(task.currency).toBe("GBP");
  });

  it("only owners and admins of the business change its currency; another business's owner cannot", async () => {
    const byMember = await h.asUser(A.memberId).run((tx) => tx.update(s.businesses).set({ currency: "EUR" }).where(eq(s.businesses.id, A.businessId)).returning());
    expect(byMember).toHaveLength(0);
    const byB = await h.asUser(B.ownerId).run((tx) => tx.update(s.businesses).set({ currency: "EUR" }).where(eq(s.businesses.id, A.businessId)).returning());
    expect(byB).toHaveLength(0);
    const byAdmin = await h.asUser(A.adminId).run((tx) => repos.businesses.update(tx, A.businessId, { currency: "usd" }));
    expect(byAdmin.currency).toBe("USD");
    await expect(h.asUser(A.adminId).run((tx) => repos.businesses.update(tx, A.businessId, { currency: "US1" }))).rejects.toThrow(/Invalid business update/);
  });
});
