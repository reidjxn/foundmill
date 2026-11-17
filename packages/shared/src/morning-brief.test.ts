/** The morning brief's four sections (item 10, Nov 13, 2026): real outcomes only under What worked. */
import { describe, expect, it } from "vitest";
import { briefDayWords, briefWhenWords, isRealOutcome, isSimulatedEvent, morningBrief, realOutcomes, type BriefEventLike, type MorningBriefInput } from "./morning-brief";
import { retentionEmail, type BriefStats, type RetentionEmailContext } from "./notify-words";

// Fri, Nov 13, 2026, 8:05 AM in New York.
const NOW = new Date("2026-11-13T13:05:00Z");
const ZONE = "America/New_York";
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let n = 0;
const ev = (type: string, hoursAgo: number, payload: Record<string, unknown>, actor: BriefEventLike["actor"] = { kind: "webhook", id: "stripe" }): BriefEventLike => ({ id: `e${(n += 1)}`, type, occurredAt: ago(hoursAgo), actor, payload });

/** One of each real outcome, and a simulated twin of each beside it. */
const FIXTURE: BriefEventLike[] = [
  ev("payment.received", 3, { conversionId: "c1", amount: { amountMinor: 4_900, currency: "USD" }, firstPayment: true }),
  ev("customer.converted", 2.9, { conversionId: "c1", captainChannelKey: "seo" }, { kind: "system", id: "journey" }),
  ev("payment.received", 4, { conversionId: "c2", amount: { amountMinor: 99_900, currency: "USD" }, firstPayment: true }, { kind: "system", id: "simulate" }),
  ev("mail.sent", 5, { agentId: "a1", channelKey: "email_automation", simulated: false }, { kind: "agent", id: "a1" }),
  ev("mail.sent", 5, { agentId: "a1", channelKey: "email_automation", simulated: false }, { kind: "agent", id: "a1" }),
  ev("mail.sent", 6, { agentId: "a1", channelKey: "email_automation", simulated: true }, { kind: "agent", id: "a1" }),
  ev("mail.sent", 6, { agentId: "a2", channelKey: null }, { kind: "agent", id: "a2" }),
  ev("lead.replied", 7, { channelKey: "email_automation", sentiment: "positive", requestsMeeting: true }, { kind: "webhook", id: "platform_mail" }),
  ev("lead.replied", 7, { channelKey: "email_automation", sentiment: "unsubscribe", requestsMeeting: false }, { kind: "webhook", id: "platform_mail" }),
  ev("lead.replied", 7, { channelKey: "email_automation", sentiment: "positive", requestsMeeting: false }, { kind: "system", id: "simulate" }),
  ev("page.followed", 8, { pageId: "p1", entityId: "x", consentId: "y" }, { kind: "system", id: "public-page" }),
  ev("page.published", 9, { pageId: "p1", slug: "tutorlane", url: "https://foundmill.com/p/tutorlane" }, { kind: "user", id: "u1" }),
  // Outside the window: before the last brief.
  ev("payment.received", 40, { conversionId: "c3", amount: { amountMinor: 1_000, currency: "USD" }, firstPayment: false }),
];

const base = (over: Partial<MorningBriefInput> = {}): MorningBriefInput => ({
  weekly: false,
  now: NOW,
  since: ago(24),
  timeZone: ZONE,
  outcomes: [],
  work: { rounds: 0, tasksDone: 0, costMinor: 0, costCurrency: "USD" },
  waiting: [],
  booked: [],
  next: { running: [], queued: [], autopilotNextAt: null, stopped: false },
  ...over,
});

describe("real outcomes", () => {
  it("keeps every real outcome and leaves every simulated one out", () => {
    const o = realOutcomes(FIXTURE, ago(24), NOW);
    expect(o.map((x) => x.kind)).toEqual(["page_live", "follower", "reply", "email_sent", "email_sent", "payment"]);
    expect(o.find((x) => x.kind === "payment")).toMatchObject({ amountMinor: 4_900, channelKey: "seo" });
    // The simulated payment of $999, the simulated email, the mail.sent that never said it was real, the simulated reply.
    expect(o.some((x) => x.kind === "payment" && x.amountMinor === 99_900)).toBe(false);
    expect(o.filter((x) => x.kind === "email_sent")).toHaveLength(2);
    expect(o.filter((x) => x.kind === "reply")).toHaveLength(1);
  });

  it("reads anything the Simulate panel wrote, or that says it was simulated, as simulated", () => {
    expect(isSimulatedEvent({ actor: { kind: "system", id: "simulate" }, payload: {} })).toBe(true);
    expect(isSimulatedEvent({ actor: { kind: "agent", id: "a" }, payload: { simulated: true } })).toBe(true);
    expect(isSimulatedEvent({ actor: { kind: "agent", id: "a" }, payload: { simulated: false } })).toBe(false);
    expect(isSimulatedEvent({ actor: { kind: "user", id: "u" }, payload: {} })).toBe(false);
  });

  it("never lists a payment or a reply that did not come from a vendor's delivery", () => {
    const fake = [ev("payment.received", 1, { conversionId: "c9", amount: { amountMinor: 500, currency: "USD" }, firstPayment: true }, { kind: "system", id: "seed" }), ev("lead.replied", 1, { sentiment: "positive" }, { kind: "agent", id: "a1" })];
    expect(realOutcomes(fake, ago(24), NOW)).toEqual([]);
  });

  it("isRealOutcome is the per-event rule realOutcomes applies", () => {
    const inWindow = FIXTURE.filter((e) => e.occurredAt.getTime() >= ago(24).getTime());
    expect(inWindow.filter(isRealOutcome)).toHaveLength(realOutcomes(FIXTURE, ago(24), NOW).length);
    expect(FIXTURE.map(isRealOutcome)).toEqual([true, false, false, true, true, false, false, true, false, false, true, true, true]);
    // A page published by an agent, not the person, and a type that is not an outcome at all.
    expect(isRealOutcome({ type: "page.published", actor: { kind: "agent", id: "a1" }, payload: {} })).toBe(false);
    expect(isRealOutcome({ type: "task.completed", actor: { kind: "user", id: "u1" }, payload: {} })).toBe(false);
  });
});

describe("the brief's sections", () => {
  const outcomes = realOutcomes(FIXTURE, ago(24), NOW);

  it("What worked lists real outcomes with what caused them; the simulated $999 is nowhere", () => {
    const b = morningBrief(base({ outcomes, agentNames: { a1: "Rhea" }, recipientUserId: "u1" }));
    const lines = b.worked.lines.map((l) => `${l.text}${l.cause ? ` (${l.cause})` : ""}`);
    expect(lines).toEqual([
      "A new customer paid $49.00 (found you through SEO)",
      "A person replied to the team's outreach and asked to talk (through Email automation)",
      "A person chose to follow your project (they signed up on your public page and confirmed by email)",
      "Your public page went live (you published it)",
      "2 emails went out from your project's address (sent by Rhea for Email automation)",
    ]);
    expect(JSON.stringify(b)).not.toContain("999");
    expect(b.worked.empty).toBeNull();
    expect(b.lead).toBe("a payment came in");
  });

  it("a follow, a reply and a payment a shared post brought say which post; the ones it did not keep their own cause", () => {
    const credited = ev("page.followed", 6, { pageId: "p1", entityId: "x2", consentId: "y2" }, { kind: "system", id: "public-page" });
    const plain = ev("page.followed", 6, { pageId: "p1", entityId: "x3", consentId: "y3" }, { kind: "system", id: "public-page" });
    const reply = ev("lead.replied", 5, { channelKey: "email_automation", sentiment: "neutral", requestsMeeting: false }, { kind: "webhook", id: "platform_mail" });
    const paid = ev("payment.received", 4, { conversionId: "c9", amount: { amountMinor: 2_500, currency: "USD" }, firstPayment: false });
    const simulatedCredit = ev("page.followed", 6, { pageId: "p1", entityId: "x4", consentId: "y4" }, { kind: "system", id: "simulate" });
    // 03:00 UTC on Nov 12 is still Nov 11 in New York: the business's own day.
    const viaPosts = new Map([
      [credited.id, { network: "x" as const, sharedAt: new Date("2026-11-12T15:00:00Z") }],
      [reply.id, { network: "x" as const, sharedAt: new Date("2026-11-12T15:00:00Z") }],
      [paid.id, { network: null, sharedAt: new Date("2026-11-12T03:00:00Z") }],
      [simulatedCredit.id, { network: "threads" as const, sharedAt: new Date("2026-11-12T15:00:00Z") }],
    ]);
    const o = realOutcomes([credited, plain, reply, paid, simulatedCredit], ago(24), NOW, viaPosts);
    expect(o.filter((x) => x.kind === "follower").map((x) => ("viaPost" in x && x.viaPost ? x.viaPost.network : null))).toEqual(["x", null]);
    const lines = morningBrief(base({ outcomes: o })).worked.lines.map((l) => `${l.text}${l.cause ? ` (${l.cause})` : ""}`);
    expect(lines).toEqual([
      "A payment came in: $25.00 (from a link to your post, Nov 11)",
      "A person replied to the team's outreach (from your post on X, Nov 12)",
      "A person chose to follow your project (from your post on X, Nov 12)",
      "A person chose to follow your project (they signed up on your public page and confirmed by email)",
    ]);
    // A simulated follow never appears, whatever it was credited to; without the map nothing names a post.
    expect(lines.join(" ")).not.toContain("Threads");
    expect(morningBrief(base({ outcomes: realOutcomes([credited, plain], ago(24), NOW) })).worked.lines.map((l) => l.cause)).toEqual(["they signed up on your public page and confirmed by email"]);
  });

  it("hides amounts from a person walled from Money or Customers", () => {
    const b = morningBrief(base({ outcomes, hideAmounts: true }));
    expect(b.worked.lines[0]!.text).toBe("A new customer paid");
  });

  it("a quiet day reads as quiet, not as failure, and says nothing about anyone missing", () => {
    const b = morningBrief(base({ work: { rounds: 2, tasksDone: 5, costMinor: 42, costCurrency: "USD" } }));
    expect(b.worked.lines).toEqual([]);
    expect(b.worked.empty).toBe("A quiet stretch: nothing new went out since yesterday.");
    expect(b.behindTheScenes).toBe("Behind the scenes: 2 rounds of work, 5 tasks done, team spend $0.42 (Estimate).");
    expect(b.waiting.empty).toBe("Nothing needs you right now.");
    expect(b.next?.empty).toBe("Nothing is queued yet. Press Continue on Today when you want the team to plan the next steps.");
    expect(b.booked).toEqual([]);
    expect(b.hasNews).toBe(true);
    const words = JSON.stringify(b);
    for (const banned of [/fail/i, /cofounder/i, /missing/i, /alone/i, /\bjob\b/i]) expect(words).not.toMatch(banned);
  });

  it("has no news when nothing happened, nothing waits and nothing is due today or tomorrow", () => {
    expect(morningBrief(base()).hasNews).toBe(false);
    expect(morningBrief(base({ booked: [{ kind: "goal", title: "10 paying customers", at: null, day: "2026-11-25" }] })).hasNews).toBe(false);
    expect(morningBrief(base({ booked: [{ kind: "goal", title: "10 paying customers", at: null, day: "2026-11-14" }] })).hasNews).toBe(true);
  });

  it("What's booked reads US dates and 12-hour times in the person's zone", () => {
    const b = morningBrief(
      base({
        booked: [
          { kind: "goal", title: "Get the first 10 paying customers", at: null, day: "2026-11-25" },
          { kind: "campaign", title: "Launch week emails", at: new Date("2026-11-13T20:45:00Z"), day: null },
          { kind: "filing", title: "Annual report", at: new Date("2026-11-18T17:00:00Z"), day: null },
          { kind: "campaign", title: "Old", at: new Date("2026-11-01T10:00:00Z"), day: null },
        ],
      }),
    );
    expect(b.booked.map((l) => l.text)).toEqual(["“Launch week emails” starts today at 3:45 PM", "Filing due Wed, Nov 18: Annual report", "Your goal's date is Wed, Nov 25: Get the first 10 paying customers"]);
    expect(briefWhenWords(new Date("2026-11-14T14:00:00Z"), ZONE, NOW)).toBe("tomorrow at 9:00 AM");
    expect(briefDayWords("2026-10-07")).toBe("Wed, Oct 7");
  });

  it("Waiting on you counts every note and shows the first five", () => {
    const waiting = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, type: "decision", subject: `Pick ${i}` }));
    const b = morningBrief(base({ waiting }));
    expect(b.waiting.count).toBe(7);
    expect(b.waiting.items).toHaveLength(5);
    expect(b.waiting.intro).toBe("7 things need you; here are the first 5:");
    expect(b.lead).toBe("7 things need you");
  });

  it("What's next says what the team works on today, Autopilot's next start, or that it is stopped", () => {
    const b = morningBrief(base({ next: { running: ["Write the pricing page"], queued: ["Email 20 tutors", "Fix signup"], autopilotNextAt: new Date("2026-11-13T19:00:00Z"), stopped: false } }));
    expect(b.next?.lines).toEqual(["Working on: Write the pricing page", "Up next: Email 20 tutors", "Up next: Fix signup", "Autopilot starts the next round of work today at 2:00 PM."]);
    expect(morningBrief(base({ next: { running: ["x"], queued: [], autopilotNextAt: null, stopped: true } })).next?.empty).toMatch(/^The team is stopped for now\./);
    expect(morningBrief(base({ next: null })).next).toBeNull();
  });

  it("the weekly review says since when, in US dates", () => {
    expect(morningBrief(base({ weekly: true, since: ago(24 * 7) })).sinceWords).toBe("since Nov 6");
    expect(morningBrief(base({ since: ago(72) })).sinceWords).toBe("since Nov 10");
  });
});

describe("the brief email", () => {
  const ctx: RetentionEmailContext = { appUrl: "https://foundmill.com", appName: "Foundmill", businessId: "b1", businessName: "Tutorlane", notificationId: "n1", recipientName: "Ada", offLink: "https://ingest.foundmill.com/mail/notify/off?t=off", pauseLink: "https://foundmill.com/email/pause?t=x", oneClick: null, now: NOW, postalAddress: "Box 1, 11422 Stockholm, Sweden" };
  const stats: BriefStats = { since: ago(24), rounds: 1, tasksDone: 3, costMinor: 0, costCurrency: "USD", wins: [], milestones: [] };

  it("is one page in four sections, with the one-click answer under the note it answers", () => {
    const waiting = [
      { id: "d1", type: "decision", subject: "Which name?", createdAt: ago(30), state: "unread", decision: null, blocksContinue: false },
      { id: "d2", type: "decision", subject: "Which price?", createdAt: ago(20), state: "unread", decision: null, blocksContinue: false },
    ];
    const e = retentionEmail(
      { kind: "daily_brief", day: "2026-11-13", stats, waiting, extras: { outcomes: realOutcomes(FIXTURE, ago(24), NOW), booked: [], next: { running: [], queued: ["Email 20 tutors"], autopilotNextAt: null, stopped: false }, timeZone: ZONE } },
      { ...ctx, oneClick: { itemId: "d2", label: "$19 a month", consequence: "Nothing is charged yet.", url: "https://foundmill.com/a/tok" } },
    );
    expect(e.subject).toBe("Tutorlane: a payment came in");
    const order = ["WHAT WORKED", "WAITING ON YOU", "WHAT'S NEXT"].map((h) => e.text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(e.text).not.toContain("WHAT'S BOOKED");
    expect(e.text).toContain("- Which price?\n  https://foundmill.com/b/b1/inbox/d2?via=email&n=n1\n  Answer “$19 a month” in one click: https://foundmill.com/a/tok");
    expect(e.text).toContain("Behind the scenes: 1 round of work, 3 tasks done.");
    expect(e.text).not.toContain("999");
    expect(e.html).toContain("<h2");
  });
});
