/** presenceRepo (0083): sessions from pings, visit days in the business's time zone, and the retention report. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presenceRepo } from "../../repos/presence";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "presence-a");
});
afterAll(() => h?.close());

const t = (iso: string) => new Date(iso);

describe("presenceRepo.ping", () => {
  it("starts a session, keeps it within 30 minutes, and starts the next after a longer gap", async () => {
    const run = (iso: string, via?: "email") => h.asUser(A.adminId).run((tx) => presenceRepo.ping(tx, A.businessId, A.adminId, { now: t(iso), timeZone: "America/New_York", via }));
    const first = await run("2026-11-10T14:00:00Z");
    expect(first).toMatchObject({ newSession: true, previousSeenAt: null, sessions: 1, lastVia: "direct", day: "2026-11-10" });
    const same = await run("2026-11-10T14:25:00Z");
    expect(same).toMatchObject({ newSession: false, sessions: 1, lastSeenAt: "2026-11-10T14:25:00.000Z" });
    // 03:30 UTC on the 11th is still the 10th in New York.
    const next = await run("2026-11-11T03:30:00Z", "email");
    expect(next).toMatchObject({ newSession: true, previousSeenAt: "2026-11-10T14:25:00.000Z", sessions: 2, lastVia: "email", day: "2026-11-10" });
    const late = await run("2026-11-11T03:00:00Z");
    expect(late.lastSeenAt).toBe("2026-11-11T03:30:00.000Z");
    const days = await h.service().run((tx) => tx.select().from(s.founderVisitDays).where(eq(s.founderVisitDays.userId, A.adminId)));
    expect(days.map((d) => [d.day, d.pings])).toEqual([["2026-11-10", 4]]);
  });
});

describe("presenceRepo.retentionReport", () => {
  it("reports activation and habit for owners of businesses committed in the range", async () => {
    const committedAt = t("2026-11-02T10:00:00Z");
    await h.service().run(async (tx) => {
      await tx.update(s.businesses).set({ committedAt, timeZone: "UTC" }).where(eq(s.businesses.id, A.businessId));
      await tx.insert(s.productSignoffs).values([
        { businessId: A.businessId, kind: "spec", status: "approved", decidedAt: t("2026-11-02T11:00:00Z") },
        { businessId: A.businessId, kind: "roadmap", status: "approved", decidedAt: t("2026-11-02T12:00:00Z") },
      ]);
      await tx.insert(s.events).values({ businessId: A.businessId, type: "cycle.run_started", occurredAt: t("2026-11-02T12:30:00Z"), actor: { kind: "user", id: A.ownerId }, payload: {} });
      await tx.insert(s.events).values({ businessId: A.businessId, type: "founder.session_started", actor: { kind: "user", id: A.ownerId }, payload: { via: "email" } });
    });
    for (const day of ["2026-11-03", "2026-11-05", "2026-11-09", "2026-11-12"]) await h.asUser(A.ownerId).run((tx) => presenceRepo.ping(tx, A.businessId, A.ownerId, { now: t(`${day}T09:00:00Z`), timeZone: "UTC" }));
    const report = await presenceRepo.retentionReport(h.db, { from: t("2026-11-01T00:00:00Z"), to: t("2026-11-08T00:00:00Z") });
    const row = report.rows.find((r) => r.businessId === A.businessId)!;
    expect(row.activation).toEqual({ activated: true, activatedAt: t("2026-11-02T12:30:00Z"), missing: [] });
    expect(row.habit).toEqual({ habit: true, returnDays: ["2026-11-03", "2026-11-05", "2026-11-09"] });
    expect(row.returnsFromNotifications).toBe(1);
    expect(report).toMatchObject({ activated: 1, habit: 1 });
    // Outside the range: not reported.
    expect((await presenceRepo.retentionReport(h.db, { from: t("2026-11-03T00:00:00Z"), to: t("2026-11-08T00:00:00Z") })).rows.map((r) => r.businessId)).not.toContain(A.businessId);
  });
});
