/** The notifier's rules (retention plan, 2026-11-11; one sender since 2026-11-12): which emails are due, and when. */
import { DEFAULT_EMAIL_PREFS, type NotifyItem } from "@foundmill/db";
import type { BusinessNotifyFacts } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { dedupeKeyOf, dueBrief, planNotifications, type RecipientFacts } from "../notify/rules";

const NOW = new Date("2026-11-11T15:00:00Z"); // a Wednesday; 10:00 AM in New York
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const item = (id: string, type: string, createdMinAgo: number, extra: Partial<NotifyItem> = {}): NotifyItem => ({ id, type, subject: `Subject ${id}`, createdAt: ago(createdMinAgo), state: "unread", decision: null, blocksContinue: false, ...extra });

const facts = (over: Partial<BusinessNotifyFacts> = {}): BusinessNotifyFacts => ({ businessId: "b1", name: "Tutorlane", timeZone: "America/New_York", now: NOW, openDecisions: [], recentItems: [], milestones: [], runEnds: [], cycles: [], ...over });
const founder = (over: Partial<RecipientFacts> = {}): RecipientFacts => ({ userId: "u1", prefs: { ...DEFAULT_EMAIL_PREFS, email: { ...DEFAULT_EMAIL_PREFS.email }, briefHour: 20 }, lastSeenAt: ago(240), ...over });
const keys = (f: BusinessNotifyFacts, r: RecipientFacts) => planNotifications(f, r).map((p) => p.dedupeKey);

describe("planNotifications", () => {
  it("never plans a waiting decision: the api's notify pass asks for those", () => {
    expect(keys(facts({ openDecisions: [item("d1", "decision", 90)] }), founder())).toEqual([]);
  });

  it("sends nothing about events while the person is in the app", () => {
    expect(keys(facts({ recentItems: [item("w1", "customer_won", 20)] }), founder({ lastSeenAt: ago(3) }))).toEqual([]);
  });

  it("asks for wins, milestone notes, reached milestones and used-up credits, by id, under the gateway's keys", () => {
    const f = facts({
      recentItems: [item("w1", "customer_won", 20), item("m1", "milestone", 20), item("c1", "warning", 20, { subject: "Credits used up: team paused" }), item("x", "warning", 20, { subject: "Something else" })],
      milestones: [{ id: "t1", label: "First customer", achievedAt: ago(15) }],
    });
    expect(planNotifications(f, founder())).toEqual([
      { kind: "credits", data: { inboxItemId: "c1" }, dedupeKey: "credits:c1" },
      { kind: "win", data: { inboxItemId: "w1" }, dedupeKey: "win:w1" },
      { kind: "milestone", data: { inboxItemId: "m1" }, dedupeKey: "milestone:m1" },
      { kind: "milestone", data: { milestoneId: "t1" }, dedupeKey: "milestone:t1" },
    ]);
    expect(dedupeKeyOf("daily_brief", { day: "2026-11-11" })).toBe("daily_brief:2026-11-11");
  });

  it("never asks about what happened before the person's last visit or more than a day ago", () => {
    expect(keys(facts({ recentItems: [item("w1", "customer_won", 300), item("w2", "customer_won", 60 * 30)] }), founder({ lastSeenAt: ago(200) }))).toEqual([]);
  });

  it("tells the person a run they started finished after they left", () => {
    const run = { runId: "r1", endedAt: ago(30), reason: "done", rounds: 3, costMinor: 42, currency: "USD", startedBy: "u1", startedAt: ago(120) };
    expect(keys(facts({ runEnds: [run, { ...run, runId: "r2", startedBy: "someone-else" }, { ...run, runId: "r3", reason: "paused" }] }), founder())).toEqual(["run_finished:r1"]);
  });

  it("asks nothing for a kind turned off, or while every email is paused", () => {
    const off = founder();
    off.prefs.email.win = false;
    expect(keys(facts({ recentItems: [item("w1", "customer_won", 20)] }), off)).toEqual([]);
    expect(keys(facts({ recentItems: [item("w1", "customer_won", 20)] }), founder({ prefs: { ...founder().prefs, emailsPausedAt: NOW.toISOString() } }))).toEqual([]);
  });
});

describe("the morning brief", () => {
  it("is due from the person's hour for three hours, in their zone or the business's", () => {
    expect(dueBrief(facts(), founder({ prefs: { ...founder().prefs, briefHour: 10 } }))).toEqual({ kind: "daily_brief", day: "2026-11-11" });
    expect(dueBrief(facts(), founder({ prefs: { ...founder().prefs, briefHour: 6 } }))).toBeNull();
    expect(dueBrief(facts(), founder({ prefs: { ...founder().prefs, briefHour: 11 } }))).toBeNull();
    expect(dueBrief(facts(), founder({ prefs: { ...founder().prefs, briefHour: 15, timeZone: "UTC" } }))).toEqual({ kind: "daily_brief", day: "2026-11-11" });
  });

  it("is the weekly review on Monday, and nothing when both are off", () => {
    const monday = new Date("2026-11-09T14:00:00Z");
    expect(dueBrief(facts({ now: monday }), founder({ prefs: { ...founder().prefs, briefHour: 8 } }))).toEqual({ kind: "weekly_review", day: "2026-11-09" });
    const off = founder({ prefs: { ...founder().prefs, briefHour: 10 } });
    off.prefs.email.daily_brief = false;
    off.prefs.email.weekly_review = false;
    expect(dueBrief(facts(), off)).toBeNull();
  });

  it("is asked for even while the person is here (the gateway sends it once a day)", () => {
    expect(keys(facts(), founder({ lastSeenAt: ago(1), prefs: { ...founder().prefs, briefHour: 10 } }))).toEqual(["daily_brief:2026-11-11"]);
  });
});
