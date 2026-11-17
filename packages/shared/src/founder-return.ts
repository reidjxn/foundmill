/**
 * How we measure that founders come back (retention plan, founder 2026-11-11: "start with measurement and the return
 * loop"). One place for the definitions the api, the reports and the notifier share, so a report and a screen can never
 * disagree on what "a session", "activated" or "a habit" means.
 *
 * - A **session** is a run of presence pings with no gap longer than `PRESENCE.sessionGapMs`. The first ping after a
 *   longer gap starts a new session; the end of the one before it is what "Since you were last here" counts from.
 * - **Activated**: the founder signed off both foundations (the specification and the roadmap) and pressed Continue
 *   themselves, all within `ACTIVATION.windowMs` of commit.
 * - **Habit**: the founder came back on at least `HABIT.returnDays` different days in the `HABIT.windowDays` days after
 *   the day they committed (the commit day itself does not count; days are the business's own calendar days).
 */

/** How a founder arrived at the start of a session: on their own, from a founder email, or from a browser notification. */
export const FOUNDER_RETURN_VIA = ["direct", "email", "browser_notification"] as const;
export type FounderReturnVia = (typeof FOUNDER_RETURN_VIA)[number];

export const PRESENCE = {
  /** A gap longer than this between two pings starts a new session. */
  sessionGapMs: 30 * 60_000,
  /** How often an open, visible tab says it is still there. */
  pingEveryMs: 5 * 60_000,
  /** Seen within this long: the founder is in the app, so the notifier does not email what they can already see. */
  presentWindowMs: 10 * 60_000,
} as const;

export const ACTIVATION = { windowMs: 24 * 60 * 60_000 } as const;
export const HABIT = { windowDays: 7, returnDays: 3 } as const;

/** True when a ping at `nowMs` after one at `lastSeenMs` starts a new session (no last ping: always). */
export function startsNewSession(lastSeenMs: number | null, nowMs: number): boolean {
  return lastSeenMs === null || nowMs - lastSeenMs > PRESENCE.sessionGapMs;
}

/** True when the founder was seen recently enough to be in the app now. */
export function isPresent(lastSeenMs: number | null, nowMs: number): boolean {
  return lastSeenMs !== null && nowMs - lastSeenMs <= PRESENCE.presentWindowMs;
}

export interface ActivationFacts {
  committedAt: Date | null;
  specificationSignedOffAt: Date | null;
  roadmapSignedOffAt: Date | null;
  /** The first cycle the founder started by pressing Continue (trigger "founder"). */
  firstFounderContinueAt: Date | null;
  /** The project's first page published by a person (`page.published`, actor a user). Not part of `activated`. */
  firstPagePublishedAt?: Date | null;
}

export interface ActivationResult {
  activated: boolean;
  /** When the last of the three steps happened, if all three happened inside the window. */
  activatedAt: Date | null;
  /** The steps still missing (or done too late), in the order a founder meets them. */
  missing: ("specification" | "roadmap" | "continue")[];
  /** The first page went live within 24 hours of commit (WP-02 T10, FR-10 step 4). */
  pagePublishedWithin24h: boolean;
  /** Minutes from commit to the first published page; null without a commit or a page. */
  minutesToPage: number | null;
}

export function founderActivation(f: ActivationFacts): ActivationResult {
  const deadline = f.committedAt ? f.committedAt.getTime() + ACTIVATION.windowMs : null;
  const inTime = (d: Date | null | undefined) => d != null && deadline !== null && d.getTime() <= deadline;
  const page = f.firstPagePublishedAt ?? null;
  const minutesToPage = page && f.committedAt ? Math.round((page.getTime() - f.committedAt.getTime()) / 60_000) : null;
  const pageFacts = { pagePublishedWithin24h: inTime(page), minutesToPage };
  const missing: ActivationResult["missing"] = [];
  if (!inTime(f.specificationSignedOffAt)) missing.push("specification");
  if (!inTime(f.roadmapSignedOffAt)) missing.push("roadmap");
  if (!inTime(f.firstFounderContinueAt)) missing.push("continue");
  if (missing.length > 0) return { activated: false, activatedAt: null, missing, ...pageFacts };
  const at = Math.max(f.specificationSignedOffAt!.getTime(), f.roadmapSignedOffAt!.getTime(), f.firstFounderContinueAt!.getTime());
  return { activated: true, activatedAt: new Date(at), missing, ...pageFacts };
}

/** Adds whole days to a `YYYY-MM-DD` key (calendar arithmetic in UTC, which is exact for date keys). */
export function addDaysToKey(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface HabitResult {
  habit: boolean;
  /** Distinct return days inside the window, oldest first. */
  returnDays: string[];
}

/**
 * Return days in the week after commit. `visitDays` are `YYYY-MM-DD` keys in the business's time zone, in any order
 * and possibly repeated; `committedDay` is the commit's key in the same zone.
 */
export function founderHabit(committedDay: string, visitDays: readonly string[]): HabitResult {
  const last = addDaysToKey(committedDay, HABIT.windowDays);
  const returnDays = [...new Set(visitDays)].filter((d) => d > committedDay && d <= last).sort();
  return { habit: returnDays.length >= HABIT.returnDays, returnDays };
}
