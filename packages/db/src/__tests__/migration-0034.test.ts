/**
 * 0034 over payments that already exist (audit JM-02): renewals and repeat orders recorded before the column existed stop
 * counting as customers (the source event said firstPayment false, or the same CRM record had paid earlier), first
 * payments keep counting, and journey_daily counts customers from first payments but revenue from every payment.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0034_first_payments";
let h: TestHarness;
let businessId: string;
const ids: Record<string, string> = {};

const one = async (text: string, params: unknown[]): Promise<string> => ((await h.pg.query<{ id: string }>(text, params)).rows[0]!).id;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  const owner = await h.createUser("owner-0034@m.test");
  businessId = await one(`insert into businesses (name, slug, created_by) values ('M0034', 'm-0034', $1) returning id`, [owner]);
  const anna = await one(`insert into entities (business_id, kind, display_name) values ($1, 'person', 'Anna') returning id`, [businessId]);
  const omar = await one(`insert into entities (business_id, kind, display_name) values ($1, 'person', 'Omar') returning id`, [businessId]);
  const payment = (first: boolean) => one(`insert into events (business_id, type, payload) values ($1, 'payment.received', $2::jsonb) returning id`, [businessId, JSON.stringify({ firstPayment: first })]);
  const conversion = (entityId: string | null, amount: number, day: string, eventId: string | null) =>
    one(`insert into conversions (business_id, entity_id, kind, amount_minor, occurred_at, source_event_id) values ($1, $2, 'payment', $3, $4::timestamptz, $5) returning id`, [businessId, entityId, amount, `${day}T10:00:00Z`, eventId]);
  ids.annaFirst = await conversion(anna, 4_900, "2026-08-01", await payment(true));
  // Anna's renewal: Stripe said firstPayment false.
  ids.annaRenewal = await conversion(anna, 4_900, "2026-09-01", await payment(false));
  // Omar's second order arrived before the connector reported orders_count: only his earlier payment tells.
  ids.omarFirst = await conversion(omar, 2_900, "2026-08-02", await payment(true));
  ids.omarRepeat = await conversion(omar, 3_100, "2026-09-01", await payment(true));
  // A payer never linked to the CRM whose event says it was a renewal.
  ids.unlinkedRenewal = await conversion(null, 1_000, "2026-09-01", await payment(false));
  // A payer never linked to the CRM with nothing saying it was a repeat stays a customer.
  ids.unlinkedFirst = await conversion(null, 1_500, "2026-09-01", await payment(true));
  ids.signup = await one(`insert into conversions (business_id, entity_id, kind, occurred_at) values ($1, $2, 'signup', '2026-09-01T09:00:00Z') returning id`, [businessId, anna]);
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe("0034 applied over existing payments", () => {
  it("marks renewals and repeat orders as revenue only, and keeps every first payment and other conversion", async () => {
    const rows = (await h.db.execute(sql`select id, first_payment from conversions where business_id = ${businessId}::uuid`)) as unknown as { rows: { id: string; first_payment: boolean }[] };
    const firstPayment = Object.fromEntries(rows.rows.map((r) => [r.id, r.first_payment]));
    expect(firstPayment[ids.annaFirst!]).toBe(true);
    expect(firstPayment[ids.annaRenewal!]).toBe(false);
    expect(firstPayment[ids.omarFirst!]).toBe(true);
    expect(firstPayment[ids.omarRepeat!]).toBe(false);
    expect(firstPayment[ids.unlinkedRenewal!]).toBe(false);
    expect(firstPayment[ids.unlinkedFirst!]).toBe(true);
    expect(firstPayment[ids.signup!]).toBe(true);
  });

  it("rebuilds journey_daily with customers from first payments and revenue from every payment", async () => {
    await h.db.execute(sql`refresh materialized view journey_daily_mv`);
    const day = (await h.db.execute(sql`select payments, revenue_minor, signups from journey_daily_mv where business_id = ${businessId}::uuid and day = '2026-09-01'`)) as unknown as { rows: { payments: number; revenue_minor: string | number; signups: number }[] };
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0]).toMatchObject({ payments: 1, signups: 1 });
    expect(Number(day.rows[0]!.revenue_minor)).toBe(4_900 + 3_100 + 1_000 + 1_500);
  });
});
