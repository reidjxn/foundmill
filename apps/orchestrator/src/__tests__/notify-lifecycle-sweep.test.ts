/**
 * The lifecycle emails end to end on PGlite (WP-04 T11, T12): a started project whose page waits is asked about once,
 * by ids only, 30 minutes after its founder left; a person with a kept card and no project is asked about an hour after
 * the card and again a week after, then never; a person with a project gets no card email; a project quiet since before
 * these emails began gets no check-in.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotifyActivities } from "../activities/notify";
import type { NotifyEmailRequest, NotifyEmailResponse } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const NOW = new Date("2026-11-25T15:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
let cardHolder = "";
let ideaId = "";

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "lifecycle" });
  // Started two hours ago, its page drafted and not published; the owner left 40 minutes ago, the admin never came.
  await t.h.pg.query("update businesses set committed_at = $1, time_zone = 'UTC' where id = $2", [new Date(NOW.getTime() - 120 * MIN).toISOString(), t.businessId]);
  await t.h.pg.query(`insert into project_pages (business_id, slug, draft) values ($1, 'lifecycle-test', '{"pitch":"Tutors by the hour","about":"x","forWhom":"","stage":"idea","showFounders":false}'::jsonb)`, [t.businessId]);
  for (const userId of [t.fixture.ownerId, t.fixture.adminId]) await repos.emailPrefs.update(t.db, userId, { briefHour: 2 });
  await repos.presence.ping(t.db, t.businessId, t.fixture.ownerId, { now: new Date(NOW.getTime() - 40 * MIN) });
  // A person with a profile and a kept card, and no project.
  cardHolder = await t.h.createUser("card-holder@example.com");
  await t.h.pg.query("insert into founder_profiles (user_id, display_name) values ($1, 'Ada')", [cardHolder]);
  await t.h.pg.query("insert into account_admissions (user_id, how) values ($1, 'open')", [cardHolder]);
  const { rows } = await t.h.pg.query<{ id: string }>("insert into ideas (owner_user_id, title, created_at) values ($1, 'Tutorlane', $2) returning id", [cardHolder, new Date(NOW.getTime() - 61 * MIN).toISOString()]);
  ideaId = rows[0]!.id;
  // The owner of the test project also keeps a card: they have a project, so no card email.
  await t.h.pg.query("insert into ideas (owner_user_id, title, created_at) values ($1, 'Second idea', $2)", [t.fixture.ownerId, new Date(NOW.getTime() - 61 * MIN).toISOString()]);
}, 120_000);
afterAll(() => t?.close());

function answering(by: (req: NotifyEmailRequest) => NotifyEmailResponse): NotifyEmailRequest[] {
  const asked: NotifyEmailRequest[] = [];
  t.gateway.notifyEmail = async (req) => {
    asked.push(req);
    return by(req);
  };
  return asked;
}

describe("the lifecycle sweep", () => {
  it("asks for the page check for the person who left 30 minutes ago, by ids only", async () => {
    const asked = answering(() => ({ sent: false, reason: "turned_off", message: "x" }));
    await createNotifyActivities(t.deps).founderNotificationsSweep({ businessIds: [t.businessId], at: NOW.toISOString() });
    const lifecycle = asked.filter((a) => a.kind === "getting_started");
    expect(lifecycle.map((a) => a.userId).sort()).toEqual([t.fixture.adminId, t.fixture.ownerId].sort());
    expect(lifecycle[0]).toEqual({ userId: lifecycle[0]!.userId, kind: "getting_started", businessId: t.businessId, data: { stage: "page_ready" } });
    // A refusal that will not change is recorded under the lifecycle key, so it is asked once.
    const again = answering(() => ({ sent: true, simulated: true, eventId: null }));
    await createNotifyActivities(t.deps).founderNotificationsSweep({ businessIds: [t.businessId], at: new Date(NOW.getTime() + 5 * MIN).toISOString() });
    expect(again.filter((a) => a.kind === "getting_started")).toEqual([]);
  });

  it("asks again after a simulated answer (never recorded) and logs it once", async () => {
    await t.h.pg.query("delete from founder_notifications where business_id = $1", [t.businessId]);
    const asked = answering(() => ({ sent: false, reason: "simulated", message: "x" }));
    await createNotifyActivities(t.deps).founderNotificationsSweep({ businessIds: [t.businessId], at: NOW.toISOString() });
    expect(asked.filter((a) => a.kind === "getting_started").length).toBeGreaterThan(0);
    expect(await repos.notifications.lifecycleHistory(t.db, t.businessId, [t.fixture.ownerId])).toEqual(new Map([[t.fixture.ownerId, []]]));
  });
});

describe("the card sweep (T12)", () => {
  it("asks for one email an hour after the card, for the card holder only", async () => {
    const asked = answering(() => ({ sent: true, simulated: true, eventId: null }));
    const acts = createNotifyActivities(t.deps);
    await acts.cardEmailsSweep({ at: NOW.toISOString() });
    expect(asked).toEqual([{ userId: cardHolder, kind: "getting_started", businessId: null, data: { ideaId, stage: "card_saved" } }]);
  });

  it("then one a week after (once the first is recorded), then none", async () => {
    // The gateway's record of the first one.
    await repos.notifications.claim(t.db, null, { userId: cardHolder, kind: "getting_started", dedupeKey: `getting_started:card_saved:${ideaId}`, subject: "s", bodyText: "t", bodyHtml: "h" });
    const acts = createNotifyActivities(t.deps);
    const sameDay = answering(() => ({ sent: true, simulated: true, eventId: null }));
    await acts.cardEmailsSweep({ at: new Date(NOW.getTime() + 2 * 60 * MIN).toISOString() });
    expect(sameDay).toEqual([]);
    const week = answering(() => ({ sent: false, reason: "turned_off", message: "x" }));
    await acts.cardEmailsSweep({ at: new Date(NOW.getTime() + 7 * DAY).toISOString() });
    expect(week).toEqual([{ userId: cardHolder, kind: "getting_started", businessId: null, data: { ideaId, stage: "card_week" } }]);
    const after = answering(() => ({ sent: true, simulated: true, eventId: null }));
    await acts.cardEmailsSweep({ at: new Date(NOW.getTime() + 8 * DAY).toISOString() });
    expect(after).toEqual([]);
  });
});

describe("a project quiet since before these emails began", () => {
  it("gets no check-in (T16's win-back was dropped by the founder)", async () => {
    await t.h.pg.query("delete from founder_notifications where business_id = $1", [t.businessId]);
    await t.h.pg.query("update businesses set committed_at = '2026-10-10T10:00:00Z' where id = $1", [t.businessId]);
    await t.h.pg.query("update founder_presence set last_seen_at = '2026-10-11T10:00:00Z' where business_id = $1", [t.businessId]);
    const asked = answering(() => ({ sent: false, reason: "turned_off", message: "x" }));
    await createNotifyActivities(t.deps).founderNotificationsSweep({ businessIds: [t.businessId], at: NOW.toISOString() });
    expect(asked.filter((a) => a.kind === "checkin")).toEqual([]);
  });
});
