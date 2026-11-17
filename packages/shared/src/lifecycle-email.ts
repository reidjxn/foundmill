/**
 * When the lifecycle emails are due (WP-04 T11, T12, T16; s2 §6.2): the rules, pure, shared by the orchestrator's
 * notifier (which asks) and the gateway's one sender (which reads the facts again and asks the same question before it
 * sends). The words are in notify-words.ts; this file decides only whether a stage is due and the key it is kept under.
 *
 * - `getting_started` in a project's first week: `page_ready` once its page is drafted and not published, 30 minutes
 *   after the person left; `ask_five` once the page has been live two days with nothing real since (a follower, a reply,
 *   a payment, an email sent). With no project yet (T12): `card_saved` an hour after a card was kept, `card_week` a
 *   week after.
 * - `checkin` after 14, 30 and 60 days without a visit by anyone in the project, one stage at a time, never past day 90;
 *   the count starts again after a visit. Only for a visit (or a start) on or after `LIFECYCLE_EMAIL_START`: a project
 *   quiet since before these emails began gets none (T16's win-back letters were dropped by the founder, Nov 17, 2026).
 *
 * Across all of them: nothing while the person is in the app, nothing on vacation, one lifecycle email at a time per
 * project, at most one `getting_started` a day and four in all, and three lifecycle emails in a row that brought nobody back end the sequence.
 */
import { isPresent } from "./founder-return";
import { dayKeyIn } from "./time-zone";

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * The day these emails start (WP-04 T11). Check-ins count only from a visit or a start on or after it, so a project
 * quiet since before then is never emailed for it (the founder knows those people, Nov 17, 2026).
 */
export const LIFECYCLE_EMAIL_START = new Date("2026-11-18T00:00:00Z");

export const LIFECYCLE_TIMING = {
  pageReadyAfterLeaveMs: 30 * MIN,
  firstWeekMs: 7 * DAY,
  askFiveAfterPublishMs: 2 * DAY,
  askFiveWithinMs: 14 * DAY,
  checkinDays: [14, 30, 60] as const,
  checkinLastDay: 90,
  cardFirstAfterMs: 60 * MIN,
  cardSecondAfterMs: 7 * DAY,
  /** Stop looking at a card after this long. */
  cardWithinMs: 14 * DAY,
  gettingStartedMax: 4,
  unopenedStop: 3,
} as const;

export type GettingStartedStage = "page_ready" | "ask_five";
export type CardStage = "card_saved" | "card_week";
export type CheckinStage = "day_14" | "day_30" | "day_60";
export type LifecycleStage = GettingStartedStage | CardStage | CheckinStage;
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = ["page_ready", "ask_five", "card_saved", "card_week", "day_14", "day_30", "day_60"];
export const isLifecycleStage = (v: unknown): v is LifecycleStage => typeof v === "string" && (LIFECYCLE_STAGES as readonly string[]).includes(v);

/** The kind each stage is sent as (and turned off by). */
export function kindOfStage(stage: LifecycleStage): "getting_started" | "checkin" {
  return stage === "page_ready" || stage === "ask_five" || stage === "card_saved" || stage === "card_week" ? "getting_started" : "checkin";
}

/** The page as the lifecycle emails read it: drafted (a row exists) and when it last went live. */
export interface LifecyclePage {
  draftedAt: Date;
  /** Live now (published and not taken down). */
  live: boolean;
  publishedAt: Date | null;
  slug: string;
  /** The live page's one line, else the draft's. */
  pitch: string | null;
}

/** What a project's lifecycle emails read (packages/db `loadNotifyFacts`). */
export interface LifecycleFacts {
  committedAt: Date;
  page: LifecyclePage | null;
  /**
   * When each real outcome of the last 90 days happened (morning-brief `realOutcomes`: a follower, a reply, a payment,
   * an email sent; the page going live left out; nothing simulated).
   */
  outcomesAt: readonly Date[];
  onVacation: boolean;
  /** The latest visit of anyone in the project: a check-in waits while someone is working in it. */
  projectLastSeenAt: Date | null;
}

/** One lifecycle email already decided on for this person (`founder_notifications`, kinds getting_started and checkin). */
export interface LifecycleSent {
  dedupeKey: string;
  status: string;
  sentAt: Date | null;
  openedAt: Date | null;
}

export interface LifecycleRecipient {
  lastSeenAt: Date | null;
  /** This person's lifecycle emails about this project (or, for a card, with no project), any age. */
  history: readonly LifecycleSent[];
}

export interface LifecycleDue {
  kind: "getting_started" | "checkin";
  stage: LifecycleStage;
  dedupeKey: string;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

const latest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a.getTime() >= b.getTime() ? a : b) : (a ?? b));

/** Real outcomes at or after `since` (all of them for null). */
export function outcomesSince(f: Pick<LifecycleFacts, "outcomesAt">, since: Date | null): number {
  return since ? f.outcomesAt.filter((d) => d.getTime() >= since.getTime()).length : f.outcomesAt.length;
}

/**
 * The key a lifecycle email is kept under (`founder_notifications.dedupe_key`, unique per person, so it names the
 * project or the card). A check-in carries the day of the visit it counts from, so the count starts again after a return.
 */
export function lifecycleDedupeKey(stage: LifecycleStage, ref: string, anchor?: Date | null): string {
  const kind = kindOfStage(stage);
  return stage.startsWith("day_") ? `${kind}:${stage}:${ref}:${utcDay(anchor ?? new Date(0))}` : `${kind}:${stage}:${ref}`;
}

const sentRows = (h: readonly LifecycleSent[]) => h.filter((s) => s.status === "sent" && s.sentAt);

/**
 * Three lifecycle emails sent since the last visit, none of them opened through its links: the sequence has ended.
 * A visit (or a return through a link) starts it again.
 */
export function lifecycleEnded(r: LifecycleRecipient): boolean {
  const since = r.lastSeenAt?.getTime() ?? 0;
  const after = sentRows(r.history).filter((s) => s.sentAt!.getTime() > since);
  return after.length >= LIFECYCLE_TIMING.unopenedStop && after.every((s) => s.openedAt === null);
}

/** One `getting_started` a day and four in all. */
function gettingStartedRoom(r: LifecycleRecipient, now: Date): boolean {
  const sent = sentRows(r.history).filter((s) => s.dedupeKey.startsWith("getting_started:"));
  if (sent.length >= LIFECYCLE_TIMING.gettingStartedMax) return false;
  return !sent.some((s) => now.getTime() - s.sentAt!.getTime() < DAY);
}

/** The check-in stage whose band `days` away falls in (14 to 29, 30 to 59, 60 to 89), else null. */
export function checkinStageFor(daysAway: number): CheckinStage | null {
  if (daysAway >= LIFECYCLE_TIMING.checkinLastDay) return null;
  if (daysAway >= 60) return "day_60";
  if (daysAway >= 30) return "day_30";
  if (daysAway >= 14) return "day_14";
  return null;
}

/**
 * The lifecycle emails due now for one person in one project, in the order to ask for them (setup help before a
 * check-in).
 */
export function dueLifecycle(businessId: string, f: LifecycleFacts, r: LifecycleRecipient, now: Date): LifecycleDue[] {
  const t = now.getTime();
  if (f.onVacation) return [];
  if (isPresent(r.lastSeenAt ? r.lastSeenAt.getTime() : null, t)) return [];
  if (lifecycleEnded(r)) return [];
  const had = new Set(r.history.map((h) => h.dedupeKey));
  const out: LifecycleDue[] = [];
  const add = (stage: LifecycleStage, anchor?: Date | null) => {
    const dedupeKey = lifecycleDedupeKey(stage, businessId, anchor);
    if (!had.has(dedupeKey)) out.push({ kind: kindOfStage(stage), stage, dedupeKey });
  };
  const sinceCommit = t - f.committedAt.getTime();
  const page = f.page;

  // Setup help, in the first week (the page) and the first two (five people).
  if (gettingStartedRoom(r, now)) {
    const left = r.lastSeenAt ? t - r.lastSeenAt.getTime() : sinceCommit;
    if (page && !page.live && sinceCommit <= LIFECYCLE_TIMING.firstWeekMs && left >= LIFECYCLE_TIMING.pageReadyAfterLeaveMs) add("page_ready");
    else if (page?.live && page.publishedAt && t - page.publishedAt.getTime() >= LIFECYCLE_TIMING.askFiveAfterPublishMs && sinceCommit <= LIFECYCLE_TIMING.askFiveWithinMs && outcomesSince(f, page.publishedAt) === 0) add("ask_five");
  }

  // Away: counted from the project's latest visit by anyone, so nobody is asked about a project someone else is working
  // in; and only from a visit or a start since these emails began.
  const anchor = latest(r.lastSeenAt, f.projectLastSeenAt) ?? f.committedAt;
  if (anchor.getTime() >= LIFECYCLE_EMAIL_START.getTime()) {
    const stage = checkinStageFor(Math.floor((t - anchor.getTime()) / DAY));
    if (stage) add(stage, anchor);
  }
  // One lifecycle email a day per project at most: the first due.
  return out.slice(0, 1);
}

/** True when `stage` is due now (the gateway's second read asks this). */
export function lifecycleStageDue(businessId: string, stage: LifecycleStage, f: LifecycleFacts, r: LifecycleRecipient, now: Date): LifecycleDue | null {
  return dueLifecycle(businessId, f, r, now).find((d) => d.stage === stage) ?? null;
}

/** A kept card of a person with no project (T12). */
export interface CardFact {
  ideaId: string;
  title: string;
  keptAt: Date;
}

/**
 * The card email due now, if any: an hour after the card was kept, then a week after, then nothing; never while the
 * person is here, and only within two weeks of the card. One card at a time: the newest.
 */
export function dueCardEmail(card: CardFact, r: LifecycleRecipient, now: Date): LifecycleDue | null {
  const t = now.getTime();
  const age = t - card.keptAt.getTime();
  if (age > LIFECYCLE_TIMING.cardWithinMs) return null;
  if (isPresent(r.lastSeenAt ? r.lastSeenAt.getTime() : null, t)) return null;
  const had = new Set(r.history.map((h) => h.dedupeKey));
  const first = lifecycleDedupeKey("card_saved", card.ideaId);
  const second = lifecycleDedupeKey("card_week", card.ideaId);
  if (age >= LIFECYCLE_TIMING.cardSecondAfterMs && had.has(first) && !had.has(second)) return { kind: "getting_started", stage: "card_week", dedupeKey: second };
  if (age >= LIFECYCLE_TIMING.cardFirstAfterMs && age < LIFECYCLE_TIMING.cardSecondAfterMs && !had.has(first)) return { kind: "getting_started", stage: "card_saved", dedupeKey: first };
  return null;
}

/**
 * Which day of the project `day` is (0 the day it started, in the zone given): the first morning brief is day 1 and the
 * first week's review day 7.
 */
export function projectDayOf(committedAt: Date, day: string, timeZone: string | null): number {
  const start = dayKeyIn(committedAt, timeZone);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY);
}

/** The first editions (WP-04 T11): the day-1 brief and the day-7 review go out even with no news. */
export function firstEditionOf(kind: "daily_brief" | "weekly_review", committedAt: Date, day: string, timeZone: string | null): "day_1" | "first_week" | undefined {
  const n = projectDayOf(committedAt, day, timeZone);
  if (kind === "daily_brief" && n === 1) return "day_1";
  if (kind === "weekly_review" && n === 7) return "first_week";
  return undefined;
}
