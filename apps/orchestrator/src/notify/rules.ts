/**
 * The notifier's rules (retention plan, founder 2026-11-11; one sender since 2026-11-12), pure so every case is a unit
 * test. One sweep looks at one business and one person and answers which emails are due now: nothing while they are in
 * the app, nothing that happened before they were last there, nothing older than a day, and the morning brief (or, on
 * Monday, the weekly review) once a day at their hour.
 *
 * The lifecycle emails (WP-04 T11: setup help, check-ins) are `dueLifecycle`'s, in
 * packages/shared, so the gateway asks the same question before it sends. A project on vacation is emailed nothing.
 *
 * The rules decide only what and when. A waiting decision is the api's notify pass's (30 minutes after the person left
 * when it holds up the team's work, a day otherwise); every other kind is planned here. Everything else (the person's
 * walls, the pause, their address, the limits, the words, the record) is the gateway's, which reads it all again
 * (`POST /v1/notify/email`, apps/gateway/src/notify-email.ts). A plan carries the ids the gateway needs and the dedupe
 * key the gateway records it under (`<kind>:<id or day>`), so the sweep asks about each one once.
 */
import { CREDITS_SUBJECTS, dayHourIn, dueLifecycle, FOUNDER_NOTIFICATION_LIMITS, isPresent, projectDayOf, type BusinessNotifyFacts, type EmailNotificationKind, type LifecycleSent, type LifecycleStage } from "@foundmill/shared";
import type { EmailPrefs } from "@foundmill/db";

const BRIEF_WINDOW_HOURS = 3;
/** Run ends worth telling a person who left: the run finished its work or hit the day's limits. */
export const RUN_END_REASONS_TOLD: ReadonlySet<string> = new Set(["done", "daily_cycles", "daily_spend", "hard_stop"]);

export interface RecipientFacts {
  userId: string;
  prefs: EmailPrefs;
  lastSeenAt: Date | null;
  /** This person's lifecycle emails about this business (WP-04 T11); none when not loaded. */
  lifecycle?: readonly LifecycleSent[];
}


/** One email due now: the kind, the ids the gateway reads it from, and the key it is recorded under. */
export interface NotificationPlan {
  kind: Exclude<EmailNotificationKind, "decision_waiting">;
  data: { inboxItemId?: string; milestoneId?: string; runId?: string; day?: string; stage?: LifecycleStage };
  dedupeKey: string;
}

const ms = (d: Date) => d.getTime();

/** The key the gateway records an email under (`founder_notifications.dedupe_key`). */
export function dedupeKeyOf(kind: NotificationPlan["kind"], data: NotificationPlan["data"]): string {
  return `${kind}:${data.inboxItemId ?? data.milestoneId ?? data.runId ?? data.day ?? ""}`;
}

const plan = (kind: NotificationPlan["kind"], data: NotificationPlan["data"]): NotificationPlan => ({ kind, data, dedupeKey: dedupeKeyOf(kind, data) });

/** Something the person has not seen: after their last visit and inside the lookback. */
function unseen(at: Date, r: RecipientFacts, now: Date): boolean {
  if (ms(at) < ms(now) - FOUNDER_NOTIFICATION_LIMITS.lookbackMs) return false;
  return r.lastSeenAt === null || ms(at) > ms(r.lastSeenAt);
}

/**
 * The brief due now, if any: at or after the person's hour (in their zone, else the business's), for up to three
 * hours, once a local day. Monday's is the weekly review when that is on; otherwise the daily brief.
 */
export function dueBrief(b: Pick<BusinessNotifyFacts, "now" | "timeZone" | "lifecycle">, r: RecipientFacts): { kind: "daily_brief" | "weekly_review"; day: string } | null {
  const zone = r.prefs.timeZone ?? b.timeZone;
  const { day, hour } = dayHourIn(b.now, zone);
  if (hour < r.prefs.briefHour || hour >= r.prefs.briefHour + BRIEF_WINDOW_HOURS) return null;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 1 && r.prefs.email.weekly_review) return { kind: "weekly_review", day };
  // A project's seventh day is its first week's review, whatever the weekday (WP-04 T11).
  if (b.lifecycle && r.prefs.email.weekly_review && projectDayOf(b.lifecycle.committedAt, day, zone) === 7) return { kind: "weekly_review", day };
  if (r.prefs.email.daily_brief) return { kind: "daily_brief", day };
  return null;
}

/** The emails due now for one person in one business, before the gateway's own checks. */
export function planNotifications(b: BusinessNotifyFacts, r: RecipientFacts): NotificationPlan[] {
  // Paused, or every switch this sweep plans off: nothing to ask the gateway about.
  if (r.prefs.emailsPausedAt) return [];
  // On vacation: no email about the project at all (account-safety notices are the api's and are not planned here).
  if (b.lifecycle?.onVacation) return [];
  const now = b.now;
  const plans: NotificationPlan[] = [];
  if (!isPresent(r.lastSeenAt ? ms(r.lastSeenAt) : null, ms(now))) {
    // Used-up credits: the team cannot work until someone acts.
    for (const item of b.recentItems) {
      if (item.type === "warning" && CREDITS_SUBJECTS.includes(item.subject) && item.state !== "answered" && item.state !== "archived" && unseen(item.createdAt, r, now)) plans.push(plan("credits", { inboxItemId: item.id }));
    }
    for (const item of b.recentItems) {
      if (item.type === "customer_won" && unseen(item.createdAt, r, now)) plans.push(plan("win", { inboxItemId: item.id }));
      if (item.type === "milestone" && unseen(item.createdAt, r, now)) plans.push(plan("milestone", { inboxItemId: item.id }));
    }
    for (const m of b.milestones) if (unseen(m.achievedAt, r, now)) plans.push(plan("milestone", { milestoneId: m.id }));
    // A run the person started and then left: tell them it finished.
    for (const run of b.runEnds) {
      if (run.startedBy === r.userId && RUN_END_REASONS_TOLD.has(run.reason) && unseen(run.endedAt, r, now)) plans.push(plan("run_finished", { runId: run.runId }));
    }
  }
  // Lifecycle emails come after the project's own news, so under the day's limit that news goes first.
  if (b.lifecycle) {
    for (const due of dueLifecycle(b.businessId, b.lifecycle, { lastSeenAt: r.lastSeenAt, history: r.lifecycle ?? [] }, now)) {
      plans.push({ kind: due.kind, data: { stage: due.stage }, dedupeKey: due.dedupeKey });
    }
  }
  const brief = dueBrief(b, r);
  if (brief) plans.push(plan(brief.kind, { day: brief.day }));
  return plans.filter((p) => r.prefs.email[p.kind]);
}
