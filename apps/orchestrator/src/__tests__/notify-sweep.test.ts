/**
 * The notifier end to end on PGlite (retention plan, 2026-11-11; one sender since 2026-11-12): a win that came while the
 * owner and admin were away is asked of the gateway once for each, by ids only (`POST /v1/notify/email`); a refusal
 * that will not change is recorded as skipped so the sweep stops asking; one that may (a daily limit) is asked again;
 * nothing is asked while the person is in the app.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotifyActivities } from "../activities/notify";
import type { NotifyEmailRequest, NotifyEmailResponse } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const NOW = new Date("2026-11-11T15:00:00Z");
let winId = "";

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "notify" });
  await t.h.pg.query("update businesses set committed_at = $1, time_zone = 'UTC' where id = $2", ["2026-11-01T10:00:00Z", t.businessId]);
  // The brief hour is far from 15:00 UTC so only the win is due.
  for (const userId of [t.fixture.ownerId, t.fixture.adminId]) await repos.emailPrefs.update(t.db, userId, { briefHour: 2 });
  const { rows } = await t.h.pg.query<{ id: string }>("insert into inbox_items (business_id, type, subject, created_at) values ($1, 'customer_won', 'Ana from Bloom paid for the annual plan', $2) returning id", [t.businessId, new Date(NOW.getTime() - 20 * 60_000).toISOString()]);
  winId = rows[0]!.id;
}, 120_000);
afterAll(() => t?.close());

/** The gateway's answer for each person, in place of the offline client's "sent". */
function answering(by: (req: NotifyEmailRequest) => NotifyEmailResponse): NotifyEmailRequest[] {
  const asked: NotifyEmailRequest[] = [];
  t.gateway.notifyEmail = async (req) => {
    asked.push(req);
    return by(req);
  };
  return asked;
}

describe("founderNotificationsSweep", () => {
  it("asks the gateway by ids only, records a refusal that will not change, and asks again after one that may", async () => {
    const asked = answering((req) => (req.userId === t.fixture.ownerId ? { sent: false, reason: "per_person", message: "x" } : { sent: false, reason: "turned_off", message: "x" }));
    const acts = createNotifyActivities(t.deps);
    const first = await acts.founderNotificationsSweep({ businessIds: [t.businessId], at: NOW.toISOString() });
    expect(first.touched).toBe(0);
    expect(asked).toEqual(
      expect.arrayContaining([
        { userId: t.fixture.ownerId, kind: "win", businessId: t.businessId, data: { inboxItemId: winId } },
        { userId: t.fixture.adminId, kind: "win", businessId: t.businessId, data: { inboxItemId: winId } },
      ]),
    );
    expect(asked).toHaveLength(2);
    // Nothing the gateway did not read itself: no address, no words.
    expect(JSON.stringify(asked)).not.toMatch(/@|Ana from Bloom/);
    const admin = await repos.notifications.listForUser(t.db, t.businessId, t.fixture.adminId);
    expect(admin.find((r) => r.kind === "win")).toMatchObject({ status: "skipped", skipReason: "turned_off" });

    const again = answering(() => ({ sent: true, simulated: true, eventId: null }));
    const second = await acts.founderNotificationsSweep({ businessIds: [t.businessId], at: new Date(NOW.getTime() + 5 * 60_000).toISOString() });
    expect(again.map((r) => r.userId)).toEqual([t.fixture.ownerId]);
    expect(second.touched).toBe(1);
  });

  it("asks nothing while the person is in the app", async () => {
    await t.h.pg.query("insert into inbox_items (business_id, type, subject, created_at) values ($1, 'customer_won', 'Second order from Bloom', $2)", [t.businessId, new Date(NOW.getTime() + 10 * 60_000).toISOString()]);
    await repos.presence.ping(t.db, t.businessId, t.fixture.ownerId, { now: new Date(NOW.getTime() + 18 * 60_000) });
    await repos.presence.ping(t.db, t.businessId, t.fixture.adminId, { now: new Date(NOW.getTime() + 18 * 60_000) });
    const asked = answering(() => ({ sent: true, simulated: true, eventId: null }));
    const acts = createNotifyActivities(t.deps);
    await acts.founderNotificationsSweep({ businessIds: [t.businessId], at: new Date(NOW.getTime() + 20 * 60_000).toISOString() });
    expect(asked).toEqual([]);
  });
});
