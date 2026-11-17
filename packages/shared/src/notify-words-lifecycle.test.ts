/**
 * The words of the lifecycle emails (WP-04 T11, T12): every stage's subject and body, the letters' signature and
 * reply line (D6), and the copy rules on every one of them: solo is complete, subtext never text, no promise that the
 * product stays free, nothing that ranks or says a person is behind.
 */
import { describe, expect, it } from "vitest";
import type { LifecycleFacts } from "./lifecycle-email";
import { NOTIFY_NO_REPLY_LINE } from "./notify-email";
import { cardEmail, isLetter, LETTER_REPLY_LINE, LETTER_SIGNATURE, retentionEmail, type RetentionEmailContext, type RetentionEmailPlan } from "./notify-words";

const NOW = new Date("2026-11-25T15:00:00Z");
const ctx: RetentionEmailContext = {
  appUrl: "https://foundmill.com",
  appName: "Foundmill",
  businessId: "b1",
  businessName: "Tutorlane",
  notificationId: "n1",
  recipientName: "Ada Lovelace",
  offLink: "https://ingest.foundmill.com/mail/notify/off?t=off",
  pauseLink: "https://foundmill.com/email/pause?t=x",
  oneClick: null,
  postalAddress: "Box 1, 11422 Stockholm, Sweden",
  pageUrl: "https://foundmill.com/p/tutorlane",
  now: NOW,
};
const draft: LifecycleFacts = { committedAt: new Date("2026-10-07T12:00:00Z"), page: { draftedAt: new Date("2026-11-17T03:30:00Z"), live: false, publishedAt: null, slug: "tutorlane", pitch: "Tutors for one subject, by the hour." }, outcomesAt: [], onVacation: false, projectLastSeenAt: null };
const live: LifecycleFacts = { ...draft, page: { ...draft.page!, live: true, publishedAt: new Date("2026-11-22T10:00:00Z") } };
const stats = { since: new Date(NOW.getTime() - 86_400_000), rounds: 0, tasksDone: 0, costMinor: 0, costCurrency: "USD", wins: [], milestones: [] };

/** Every lifecycle email, by name, with the words it renders. */
const ALL: [string, RetentionEmailPlan][] = [
  ["page_ready", { kind: "getting_started", stage: "page_ready", lifecycle: draft }],
  ["ask_five", { kind: "getting_started", stage: "ask_five", lifecycle: live }],
  ["day_14", { kind: "checkin", stage: "day_14", lifecycle: live, lastSeenAt: null }],
  ["day_30", { kind: "checkin", stage: "day_30", lifecycle: draft, lastSeenAt: null }],
  ["day_60", { kind: "checkin", stage: "day_60", lifecycle: draft, lastSeenAt: null }],
  ["day_1 brief", { kind: "daily_brief", day: "2026-10-08", stats, waiting: [], firstEdition: "day_1", lifecycle: draft }],
  ["first week", { kind: "weekly_review", day: "2026-10-14", stats, waiting: [], firstEdition: "first_week", lifecycle: draft }],
];
const CARDS = (["card_saved", "card_week"] as const).map((stage) => [stage, cardEmail({ stage, appName: "Foundmill", recipientName: "Ada", ideaTitle: "Tutorlane", link: "https://foundmill.com/new/commit/i1?via=email&n=n2", offLink: ctx.offLink, pauseLink: ctx.pauseLink, postalAddress: ctx.postalAddress })] as const);

// Copied from packages/shared/src/solo-guard.ts (WP-12 T0, branch claude/wp12-t0-t2-solo-guard-invite, not on main yet)
// and evals/src/team-call.ts `SUBTEXT_PATTERNS`; switch to the imports when the guard merges.
const SOLO_GUARD = [/invite (someone|a |your )/i, /co-?founder/i, /collaborator/i, /find (a )?partner/i, /team up/i, /\b0 people\b/i, /no people yet/i, /add (a person|someone)/i];
const SUBTEXT = [
  /\b(?<!(?:my|our|its|their|team's|agent's|the team's|that's the)\s)(?:day[-\s]?)?jobs?\b/i,
  /\b(?:employ(?:ment|ed|ers?|ees?)|unemploy\w*|careers?|salar(?:y|ies)|9[-\s]?to[-\s]?5|laid[-\s]off)\b/i,
  /\b(?:need|find|get|bring\s+in|look\s+for|recruit)\s+(?:a\s+|another\s+|some\s+)?(?:partner|teammate|human\s+help)\b/i,
];
/** Until sign-up opens nothing may promise the product stays free (CLAUDE.md, Nov 17); and no ranking or "behind". */
const NEVER = [/\bfree\b/i, /\bbehind\b/i, /\bfalling\b/i, /\branked?\b/i, /\bothers (are|have)\b/i, /\byou (still )?haven't\b/i, /\bunlike\b/i, /—.*—/];

describe("the lifecycle emails' words", () => {
  it.each(ALL)("%s keeps every copy rule in its subject and body", (_name, plan) => {
    const e = retentionEmail(plan, ctx);
    for (const text of [e.subject, e.text]) {
      for (const re of [...SOLO_GUARD, ...SUBTEXT, ...NEVER]) expect(text, `${re}`).not.toMatch(re);
    }
    expect(e.subject.length).toBeLessThanOrEqual(60);
    expect(e.text).toContain("Postal address: Foundmill, Box 1, 11422 Stockholm, Sweden.");
    expect(e.text).toContain(ctx.offLink);
  });

  it.each(CARDS)("%s (a card, no project) keeps every copy rule and links to its Commit", (_name, e) => {
    for (const text of [e.subject, e.text]) for (const re of [...SOLO_GUARD, ...SUBTEXT, ...NEVER]) expect(text, `${re}`).not.toMatch(re);
    expect(e.text).toContain("Start Tutorlane: https://foundmill.com/new/commit/i1?via=email&n=n2");
    expect(e.text).toContain("Hi Ada,");
    expect(e.text).toContain(NOTIFY_NO_REPLY_LINE);
  });

  it("gives each stage its subject", () => {
    const subjects = Object.fromEntries(ALL.map(([name, plan]) => [name, retentionEmail(plan, ctx).subject]));
    expect(subjects).toEqual({
      page_ready: "Your page for Tutorlane is ready to check",
      ask_five: "Five people, one question",
      day_14: "Tutorlane is still here",
      day_30: "A question about Tutorlane",
      day_60: "Keep Tutorlane or archive it?",
      "day_1 brief": "Tutorlane, day 2: one thing to do today",
      "first week": "Tutorlane: your first week",
    });
    expect(CARDS.map(([, e]) => e.subject)).toEqual(["Your card for Tutorlane is saved", "Tutorlane is still saved"]);
  });

  it("signs the day-3 note, the check-ins and the win-back letters as the team, and drops the no-reply line from them only", () => {
    for (const [name, plan] of ALL) {
      const e = retentionEmail(plan, ctx);
      const letter = name === "ask_five" || (name.startsWith("day_") && plan.kind === "checkin");
      expect(isLetter(plan), name).toBe(letter);
      expect(e.text.includes(LETTER_SIGNATURE), name).toBe(letter);
      expect(e.text.includes(NOTIFY_NO_REPLY_LINE), name).toBe(!letter);
    }
    expect(retentionEmail(ALL[2]![1], ctx).text).toContain(LETTER_REPLY_LINE);
  });

  it("greets by first name only, and without one says Hi", () => {
    expect(retentionEmail(ALL[0]![1], ctx).text.startsWith("Hi Ada, your page for Tutorlane")).toBe(true);
    expect(retentionEmail(ALL[0]![1], { ...ctx, recipientName: null }).text.startsWith("Hi, your page")).toBe(true);
  });

  it("quotes the page and its one line in the day-3 note's message, and asks the day-30 question for a reply", () => {
    expect(retentionEmail(ALL[1]![1], ctx).text).toContain("“I'm starting Tutorlane. Tutors for one subject, by the hour. Would you use this? https://foundmill.com/p/tutorlane”");
    expect(retentionEmail(ALL[3]![1], ctx).text).toContain("One line back is plenty.");
  });

  it("puts the one thing first on day 1, and on the first week with nothing outside says so once with the step", () => {
    expect(retentionEmail(ALL[5]![1], ctx).text).toContain("TODAY'S ONE THING\n\nCheck your page and publish it.");
    expect(retentionEmail(ALL[6]![1], ctx).text).toContain("Nothing has reached anyone outside yet. That is common in a first week, and the next step takes two minutes: check your page and publish it.");
  });

  it("never carries a link written into the project's name", () => {
    const e = retentionEmail(ALL[3]![1], { ...ctx, businessName: "Tutorlane https://evil.example" });
    expect(e.text).not.toContain("evil.example");
  });
});
