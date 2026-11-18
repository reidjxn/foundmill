import { describe, expect, it } from "vitest";
import { realOutcomes, type BriefEventLike } from "./morning-brief";
import { weekOutcomesWords, weekTowardLine } from "./week-outcomes";

const NOW = new Date("2026-11-17T12:00:00Z");
const SINCE = new Date(NOW.getTime() - 7 * 86_400_000);
let n = 0;
const event = (type: string, actor: BriefEventLike["actor"], payload: Record<string, unknown> = {}, at = "2026-11-16T10:00:00Z"): BriefEventLike => ({ id: `e${++n}`, type, occurredAt: new Date(at), actor, payload });
const all = () => true;
const NO_TOWARD = { goal: null, pageNotLive: false, work: null };

describe("weekOutcomesWords", () => {
  it("counts the week's real outcomes and says what they were", () => {
    const events = [
      event("page.published", { kind: "user", id: "u1" }),
      event("mail.sent", { kind: "agent", id: "a1" }, { simulated: false }),
      event("mail.sent", { kind: "agent", id: "a1" }, { simulated: false }),
      event("page.followed", { kind: "system", id: "public-page" }),
      event("lead.replied", { kind: "webhook", id: "w" }, { sentiment: "positive" }),
      event("payment.received", { kind: "webhook", id: "w" }, { amountMinor: 1900, currency: "USD" }),
    ];
    const words = weekOutcomesWords(realOutcomes(events, SINCE, NOW), all, { goal: "Get 10 customers", pageNotLive: false, work: null });
    expect(words).toEqual({ count: 6, headline: "This week: 6 real outcomes", detail: "1 payment, 1 reply, 1 new follower, your page went live, 2 emails sent", toward: null });
  });

  it("never counts a simulated result, or one from before the week", () => {
    const events = [
      event("mail.sent", { kind: "agent", id: "a1" }, { simulated: true }),
      event("payment.received", { kind: "system", id: "simulate" }, { amountMinor: 500, currency: "USD" }),
      event("page.published", { kind: "user", id: "u1" }, {}, "2026-11-01T10:00:00Z"),
      event("mail.sent", { kind: "agent", id: "a1" }, { simulated: false }),
    ];
    expect(weekOutcomesWords(realOutcomes(events, SINCE, NOW), all, NO_TOWARD)).toMatchObject({ count: 1, headline: "This week: 1 real outcome", detail: "1 email sent" });
  });

  it("a week with none has no count line and no zero: it says what the team is working toward", () => {
    const words = weekOutcomesWords([], all, { goal: "Get the first 10 paying customers by Dec 19.", pageNotLive: true, work: "Set up card payments" });
    expect(words).toEqual({ count: 0, headline: null, detail: null, toward: "Working toward: Get the first 10 paying customers by Dec 19" });
    expect(JSON.stringify(words)).not.toMatch(/\b0 /);
    expect(weekTowardLine({ goal: null, pageNotLive: true, work: "Set up card payments" })).toBe("Working toward: your public page, live");
    expect(weekTowardLine({ goal: null, pageNotLive: false, work: "Set up card payments" })).toBe("Working toward: Set up card payments");
    expect(weekTowardLine(NO_TOWARD)).toBeNull();
  });

  it("keeps each kind behind its own wall", () => {
    const events = [event("payment.received", { kind: "webhook", id: "w" }, { amountMinor: 1900, currency: "USD" }), event("page.published", { kind: "user", id: "u1" })];
    const words = weekOutcomesWords(realOutcomes(events, SINCE, NOW), (s) => s !== "finance", NO_TOWARD);
    expect(words).toMatchObject({ count: 1, detail: "Your page went live" });
  });
});
