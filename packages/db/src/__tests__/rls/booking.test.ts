/**
 * 0157 booking: `booking_settings`, `booking_services` and `bookings` are read by the members of their business and
 * written by the services only. The generated suite (`tables.ts`) covers every role; this file states the posture in
 * one place, with real rows of each table, and checks that `public_booking_pages` is the service connection's alone.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type Runner, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const NOW = new Date("2026-12-01T12:00:00Z");
const TABLES = [
  ["booking_settings", s.bookingSettings],
  ["booking_services", s.bookingServices],
  ["bookings", s.bookings],
] as const;

/** A live setup with one service and one confirmed booking, on a published page of a committed business. */
async function seed(f: BusinessFixture, slug: string) {
  await h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, f.businessId));
  await h.service().run(async (tx) => {
    const setup = await repos.booking.saveSetup(tx, f.businessId, { timeZone: "America/Chicago", weeklyHours: { "1": [{ start: 540, end: 1020 }] }, currency: "USD", services: [{ name: "Lesson", durationMin: 60 }] });
    await repos.booking.setLive(tx, f.businessId, true, f.ownerId, NOW);
    await repos.pages.publish(tx, f.businessId, { content: { pitch: "Lessons", about: "One to one.", forWhom: "", stage: "building", showFounders: false, followForm: false }, slug, userId: f.ownerId });
    const holdTokenHash = `hold-${randomUUID()}`;
    await repos.booking.hold(tx, f.businessId, { service: setup.services[0]!, start: new Date("2027-01-04T15:00:00Z"), holdTokenHash, test: false, now: NOW });
    await repos.booking.confirm(tx, f.businessId, { holdTokenHash, customerName: "Grace Hopper", customerEmail: "grace@example.test", answers: [], consentText: "I agree.", visitorTimeZone: null, entityId: null, now: NOW });
  });
}

const idsIn = (runner: Runner, table: string, businessId: string) => runner.execute<{ id: string }>(sql`select id from ${sql.identifier(table)} where business_id = ${businessId}`);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "bookrls-a");
  B = await createBusinessFixture(h, "bookrls-b");
  await seed(A, "bookrls-alpha");
  await seed(B, "bookrls-bravo");
});
afterAll(() => h?.close());

describe.each(TABLES)("%s", (name, table) => {
  it(`${name}: a member reads their own business's rows and none of another business's`, async () => {
    // The member sees exactly what the service connection sees of their business (the fixture adds a service of its own).
    expect((await idsIn(h.asUser(A.memberId), name, A.businessId)).length).toBe((await idsIn(h.service(), name, A.businessId)).length);
    expect((await idsIn(h.asUser(A.memberId), name, A.businessId)).length).toBeGreaterThan(0);
    expect(await idsIn(h.asUser(A.memberId), name, B.businessId)).toHaveLength(0);
    const all = await h.asUser(A.memberId).execute<{ business_id: string }>(sql`select business_id from ${sql.identifier(name)}`);
    expect(all.every((r) => r.business_id === A.businessId)).toBe(true);
  });

  it(`${name}: an owner cannot insert, update or delete any row, of their own business or another's`, async () => {
    const before = [(await idsIn(h.service(), name, A.businessId)).length, (await idsIn(h.service(), name, B.businessId)).length];
    for (const businessId of [A.businessId, B.businessId]) {
      await expect(h.asUser(A.ownerId).execute(sql`update ${sql.identifier(name)} set updated_at = now() where business_id = ${businessId}`)).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(A.ownerId).execute(sql`delete from ${sql.identifier(name)} where business_id = ${businessId}`)).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(A.ownerId).run((tx) => tx.insert(table).values({ businessId } as never))).rejects.toThrow(RLS_DENIED);
    }
    expect([(await idsIn(h.service(), name, A.businessId)).length, (await idsIn(h.service(), name, B.businessId)).length]).toEqual(before);
  });

  it(`${name}: anon reads nothing`, async () => {
    await expect(h.anon().execute(sql`select id from ${sql.identifier(name)}`)).rejects.toThrow(RLS_DENIED);
  });
});

describe("public_booking_pages", () => {
  it("is read by the service connection: the live setups of published pages", async () => {
    const rows = await h.service().execute<{ slug: string; business_id: string }>(sql`select slug, business_id from public_booking_pages where slug in ('bookrls-alpha', 'bookrls-bravo') order by slug`);
    expect(rows).toEqual([
      { slug: "bookrls-alpha", business_id: A.businessId },
      { slug: "bookrls-bravo", business_id: B.businessId },
    ]);
  });

  it("is not readable by a signed-in member nor by anon", async () => {
    await expect(h.asUser(A.ownerId).execute(sql`select slug from public_booking_pages`)).rejects.toThrow(/permission denied/);
    await expect(h.anon().execute(sql`select slug from public_booking_pages`)).rejects.toThrow(/permission denied/);
  });
});
