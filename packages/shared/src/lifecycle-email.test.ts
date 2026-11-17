/** The lifecycle emails' rules (WP-04 T11, T12, T16): which stage is due, when it stops, and the win-back switch. */
import { describe, expect, it } from "vitest";
import { checkinStageFor, dueCardEmail, dueLifecycle, firstEditionOf, LIFECYCLE_EMAIL_START, lifecycleDedupeKey, lifecycleEnded, projectDayOf, type LifecycleFacts, type LifecycleSent } from "./lifecycle-email";

const MIN = 60_000;
const DAY = 86_400_000;
const B = "b1";
const NOW = new Date("2026-11-25T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const facts = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  committedAt: ago(2 * 60 * MIN),
  page: { draftedAt: ago(110 * MIN), live: false, publishedAt: null, slug: "tutorlane", pitch: "Tutors for one subject" },
  outcomesAt: [],
  onVacation: false,
  projectLastSeenAt: null,
  ...over,
});
const sent = (dedupeKey: string, sentAt: Date, openedAt: Date | null = null): LifecycleSent => ({ dedupeKey, status: "sent", sentAt, openedAt });
const stages = (f: LifecycleFacts, lastSeenAt: Date | null, history: LifecycleSent[] = []) => dueLifecycle(B, f, { lastSeenAt, history }, NOW).map((d) => d.stage);

describe("getting_started in the first week", () => {
  it("asks for the page check 30 minutes after the person left, not before, and never while they are here", () => {
    expect(stages(facts(), ago(31 * MIN))).toEqual(["page_ready"]);
    expect(stages(facts(), ago(20 * MIN))).toEqual([]);
    expect(stages(facts(), ago(1 * MIN))).toEqual([]);
  });

  it("stops the moment its action is done: a published page gets no page check", () => {
    const live = facts({ page: { ...facts().page!, live: true, publishedAt: ago(60 * MIN) } });
    expect(stages(live, ago(40 * MIN))).toEqual([]);
  });

  it("asks five people two days after the page went live, only while nothing real has happened since", () => {
    const live = facts({ committedAt: ago(3 * DAY), page: { ...facts().page!, live: true, publishedAt: ago(2 * DAY + MIN) } });
    expect(stages(live, ago(DAY))).toEqual(["ask_five"]);
    expect(stages({ ...live, outcomesAt: [ago(DAY)] }, ago(DAY))).toEqual([]);
    // An outcome before the page went live does not count against it.
    expect(stages({ ...live, outcomesAt: [ago(3 * DAY)] }, ago(DAY))).toEqual(["ask_five"]);
  });

  it("sends one getting_started a day and four in all", () => {
    const f = facts();
    expect(stages(f, ago(DAY), [sent("getting_started:card_saved:x", ago(2 * 60 * MIN))])).toEqual([]);
    const four = [1, 2, 3, 4].map((n) => sent(`getting_started:s${n}:${B}`, ago((n + 1) * DAY), ago((n + 1) * DAY - MIN)));
    expect(stages(f, ago(DAY), four)).toEqual([]);
  });

  it("sends nothing on vacation", () => {
    expect(stages(facts({ onVacation: true }), ago(DAY))).toEqual([]);
  });
});

describe("check-ins", () => {
  const quiet = facts({ committedAt: new Date("2026-11-20T10:00:00Z"), page: { ...facts().page!, live: true, publishedAt: new Date("2026-11-20T11:00:00Z") } });

  it("are due at 14, 30 and 60 days away, one band at a time, and never from day 90", () => {
    expect([13, 14, 29, 30, 59, 60, 89, 90].map(checkinStageFor)).toEqual([null, "day_14", "day_14", "day_30", "day_30", "day_60", "day_60", null]);
    const lastSeen = new Date("2026-12-01T10:00:00Z");
    const due = (days: number) => dueLifecycle(B, quiet, { lastSeenAt: lastSeen, history: [] }, new Date(lastSeen.getTime() + days * DAY + MIN)).map((d) => d.stage);
    expect([13, 14, 30, 60, 90].map(due)).toEqual([[], ["day_14"], ["day_30"], ["day_60"], []]);
    expect(lastSeen.getTime()).toBeGreaterThan(LIFECYCLE_EMAIL_START.getTime());
  });

  it("wait while anyone else in the project is working in it", () => {
    const lastSeen = new Date("2026-12-01T10:00:00Z");
    const at = new Date(lastSeen.getTime() + 20 * DAY);
    expect(dueLifecycle(B, { ...quiet, projectLastSeenAt: new Date(at.getTime() - DAY) }, { lastSeenAt: lastSeen, history: [] }, at)).toEqual([]);
  });

  it("start again after a return: the key carries the day of the visit they count from", () => {
    const a = lifecycleDedupeKey("day_14", B, new Date("2026-12-01T10:00:00Z"));
    const b = lifecycleDedupeKey("day_14", B, new Date("2026-12-20T10:00:00Z"));
    expect(a).toBe("checkin:day_14:b1:2026-12-01");
    expect(a).not.toBe(b);
  });

  it("are never planned for a project quiet since before these emails began (the founder knows those people)", async () => {
    const old = facts({ committedAt: new Date("2026-10-10T10:00:00Z") });
    expect(stages(old, new Date("2026-10-11T10:00:00Z"))).toEqual([]);
    expect(stages(old, null)).toEqual([]);
    // A visit after they began starts the count.
    const back = new Date("2026-11-19T10:00:00Z");
    expect(dueLifecycle(B, old, { lastSeenAt: back, history: [] }, new Date(back.getTime() + 15 * DAY)).map((d) => d.stage)).toEqual(["day_14"]);
  });
});

describe("the sequence ends", () => {
  it("after three lifecycle emails since the last visit that brought nobody back", () => {
    const last = ago(40 * DAY);
    const three = [3, 2, 1].map((n) => sent(`checkin:x${n}:${B}`, ago(n * DAY)));
    expect(lifecycleEnded({ lastSeenAt: last, history: three })).toBe(true);
    expect(lifecycleEnded({ lastSeenAt: last, history: [...three.slice(0, 2), sent("checkin:x1:b1", ago(DAY), ago(DAY - MIN))] })).toBe(false);
    expect(lifecycleEnded({ lastSeenAt: ago(MIN * 60), history: three })).toBe(false);
  });
});

describe("the card email (T12)", () => {
  const card = { ideaId: "i1", title: "Tutorlane", keptAt: ago(61 * MIN) };
  it("is due an hour after the card, then a week after, then never", () => {
    expect(dueCardEmail({ ...card, keptAt: ago(30 * MIN) }, { lastSeenAt: null, history: [] }, NOW)).toBeNull();
    expect(dueCardEmail(card, { lastSeenAt: null, history: [] }, NOW)).toEqual({ kind: "getting_started", stage: "card_saved", dedupeKey: "getting_started:card_saved:i1" });
    const week = { ...card, keptAt: ago(7 * DAY + MIN) };
    const first = sent("getting_started:card_saved:i1", ago(7 * DAY));
    expect(dueCardEmail(week, { lastSeenAt: null, history: [first] }, NOW)?.stage).toBe("card_week");
    expect(dueCardEmail(week, { lastSeenAt: null, history: [first, sent("getting_started:card_week:i1", ago(MIN))] }, NOW)).toBeNull();
    expect(dueCardEmail({ ...card, keptAt: ago(15 * DAY) }, { lastSeenAt: null, history: [first] }, NOW)).toBeNull();
  });
});

describe("first editions", () => {
  it("are the brief on the project's day 1 and the review on its day 7, in the zone given", () => {
    const committed = new Date("2026-11-10T22:00:00Z"); // Nov 10 in New York, Nov 10 in UTC
    expect(projectDayOf(committed, "2026-11-11", "America/New_York")).toBe(1);
    expect(firstEditionOf("daily_brief", committed, "2026-11-11", "America/New_York")).toBe("day_1");
    expect(firstEditionOf("daily_brief", committed, "2026-11-12", "America/New_York")).toBeUndefined();
    expect(firstEditionOf("weekly_review", committed, "2026-11-17", "America/New_York")).toBe("first_week");
    expect(firstEditionOf("weekly_review", committed, "2026-11-16", "America/New_York")).toBeUndefined();
  });
});
