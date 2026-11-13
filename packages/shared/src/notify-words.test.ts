/** The words of Foundmill's retention emails (one sender since 2026-11-12), built by the gateway from its own reads. */
import { describe, expect, it } from "vitest";
import { briefIsEmpty, briefStats, retentionEmail, runTasksDone, type NotifyItemLike, type RetentionEmailContext } from "./notify-words";

const NOW = new Date("2026-11-11T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const item = (id: string, type: string, createdMinAgo: number, extra: Partial<NotifyItemLike> = {}): NotifyItemLike => ({ id, type, subject: `Subject ${id}`, createdAt: ago(createdMinAgo), state: "unread", decision: null, blocksContinue: false, ...extra });
const ctx: RetentionEmailContext = {
  appUrl: "https://foundmill.com",
  appName: "Foundmill",
  businessId: "b1",
  businessName: "Tutorlane",
  notificationId: "n1",
  recipientName: "Ada",
  offLink: "https://ingest.foundmill.com/mail/notify/off?t=off",
  pauseLink: "https://foundmill.com/email/pause?t=x",
  oneClick: null,
  postalAddress: "Box 1, 11422 Stockholm, Sweden",
};
const stats = (over: Partial<ReturnType<typeof briefStats>> = {}) => ({ since: ago(1440), rounds: 1, tasksDone: 1, costMinor: 0, costCurrency: "USD", wins: [], milestones: [], ...over });

describe("retentionEmail", () => {
  it("carries Foundmill's postal address in the footer of every kind (US CAN-SPAM)", () => {
    const e = retentionEmail({ kind: "win", item: item("w1", "customer_won", 5) }, ctx);
    expect(e.text.trimEnd().endsWith("Postal address: Foundmill, Box 1, 11422 Stockholm, Sweden.")).toBe(true);
    expect(e.html).toContain("<br>Postal address: Foundmill, Box 1, 11422 Stockholm, Sweden.</p>");
  });

  it("links back with where the person came from, and ends with the switch and the pause", () => {
    const e = retentionEmail({ kind: "win", item: item("w1", "customer_won", 5, { subject: "Ana from [[ent:abc|Bloom]] paid" }) }, ctx);
    expect(e.text).toContain("https://foundmill.com/b/b1/inbox/w1?via=email&n=n1");
    expect(e.text).toContain("https://foundmill.com/email/pause?t=x");
    expect(e.text).toContain("https://ingest.foundmill.com/mail/notify/off?t=off");
    expect(e.html).not.toContain("[[ent:");
  });

  it("never carries a link, a domain or an address written by an agent", () => {
    const e = retentionEmail({ kind: "win", item: item("w1", "customer_won", 5, { subject: "Paid: see https://evil.example/x or mail ana@evil.example" }) }, ctx);
    expect(e.text).not.toContain("evil.example");
    expect(e.html).not.toContain("evil.example");
    expect(e.subject).not.toContain("evil.example");
  });

  it("offers the one-click answer with its consequence", () => {
    const plan = { kind: "daily_brief" as const, day: "2026-11-11", waiting: [item("d1", "decision", 60)], stats: stats() };
    const e = retentionEmail(plan, { ...ctx, oneClick: { itemId: "d1", label: "Ask the strategist", consequence: "Nothing is spent until you pick.", url: "https://foundmill.com/a/tok" } });
    expect(e.text).toContain("Answer “Ask the strategist”: https://foundmill.com/a/tok");
    expect(e.text).toContain("can be changed later: Nothing is spent until you pick.");
  });

  it("names no customer or amount to a recipient walled from Customers or Money", () => {
    const e = retentionEmail({ kind: "win", item: item("w1", "customer_won", 5, { subject: "Ana from Bloom paid $1,200" }) }, { ...ctx, hideSubjects: true });
    expect(e.text).not.toContain("Ana");
    expect(e.text).not.toContain("1,200");
    expect(e.text).toContain("A customer paid");
  });

  it("tells the person what one visit does to their streak, from 2 days on", () => {
    const plan = { kind: "daily_brief" as const, day: "2026-11-12", waiting: [], stats: stats() };
    expect(retentionEmail(plan, { ...ctx, streak: { current: 4, visitedToday: false } }).text).toContain("You are on a 4-day streak. Open Today to make it 5.");
    expect(retentionEmail(plan, { ...ctx, streak: { current: 1, visitedToday: false } }).text).not.toContain("streak");
  });

  it("labels spend as an Estimate and escapes HTML", () => {
    const e = retentionEmail({ kind: "daily_brief", day: "2026-11-11", waiting: [item("d1", "decision", 60, { subject: "<b>Pick</b> a name" })], stats: stats({ rounds: 2, tasksDone: 3, costMinor: 42 }) }, ctx);
    expect(e.subject).toBe("Tutorlane: 1 decision needs you since yesterday");
    expect(e.text).toContain("Team spend $0.42 (Estimate)");
    expect(e.html).toContain("&lt;b&gt;Pick&lt;/b&gt;");
  });
});

describe("the brief's facts", () => {
  it("counts the day's work, and has no news when nothing happened and nothing waits", () => {
    const cycles = [{ id: "e1", type: "cycle.completed", occurredAt: ago(600), actor: { kind: "system", id: "x" }, payload: { tasksCompleted: 5, cost: { amountMinor: 37, currency: "USD" } } }];
    const s = briefStats({ cycles, recentItems: [], milestones: [] }, ago(1440));
    expect(s).toMatchObject({ rounds: 1, tasksDone: 5, costMinor: 37 });
    expect(briefIsEmpty(s, [])).toBe(false);
    expect(briefIsEmpty(briefStats({ cycles: [], recentItems: [], milestones: [] }, ago(1440)), [])).toBe(true);
  });

  it("counts the tasks a run finished between its start and its end", () => {
    const cycles = [60, 200].map((m, i) => ({ id: `e${i}`, type: "cycle.completed", occurredAt: ago(m), actor: { kind: "system", id: "x" }, payload: { tasksCompleted: 4 } }));
    expect(runTasksDone(cycles, { startedAt: ago(120), endedAt: ago(30) })).toBe(4);
  });
});
