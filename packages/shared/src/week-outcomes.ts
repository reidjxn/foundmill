/**
 * Today's headline (WP-14 T4; founder's brief of Nov 17, 2026, A11): the week's real outcomes as one count, with what
 * they were. An outcome is the north star's (`realOutcomes`, ./morning-brief): the page live, an email sent, a follower,
 * a reply, a payment. Nothing simulated counts, and nothing here is a cost.
 *
 * A week with none has no count line: Today never shows a zero as a score. It says what the team is working toward
 * instead (the goal, else the page, else the work in hand), or nothing when none of those is known.
 */
import { countOf } from "./copy";
import { OUTCOME_SECTION, type RealOutcome, type RealOutcomeKind } from "./morning-brief";
import type { Section } from "./permissions";

export interface WeekOutcomesWords {
  /** Real outcomes in the window that this reader may see. */
  count: number;
  /** "This week: 23 real outcomes". Null for a week with none. */
  headline: string | null;
  /** "Your page went live, 3 emails sent, 2 new followers". Null for a week with none. */
  detail: string | null;
  /** "Working toward: Get the first 10 paying customers by Dec 19". Only for a week with none; null when nothing is known. */
  toward: string | null;
}

/** What the team is working toward, first known wins: the active goal, the page not yet live, the work in hand or next. */
export interface WeekTowardFacts {
  goal: string | null;
  pageNotLive: boolean;
  work: string | null;
}

export const WEEK_OUTCOMES_PAGE_TOWARD = "your public page, live";

const KIND_ORDER: readonly RealOutcomeKind[] = ["payment", "reply", "follower", "post_visited", "page_live", "email_sent"];

const kindWords = (kind: RealOutcomeKind, n: number): string => {
  switch (kind) {
    case "payment":
      return countOf(n, "payment");
    case "reply":
      return countOf(n, "reply", "replies");
    case "follower":
      return countOf(n, "new follower");
    case "post_visited":
      return n === 1 ? "someone opened a post you shared" : `${n.toLocaleString("en-US")} people opened posts you shared`;
    case "page_live":
      return n === 1 ? "your page went live" : `your page went live and was updated ${countOf(n - 1, "time")}`;
    case "email_sent":
      return `${countOf(n, "email")} sent`;
  }
};

const sentenceCase = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const plainTitle = (s: string): string => s.trim().replace(/[.!?]+$/, "");

export function weekTowardLine(facts: WeekTowardFacts): string | null {
  const what = facts.goal ? plainTitle(facts.goal) : facts.pageNotLive ? WEEK_OUTCOMES_PAGE_TOWARD : facts.work ? plainTitle(facts.work) : null;
  return what ? `Working toward: ${what}` : null;
}

/** The headline's words from the window's real outcomes, behind each kind's own wall (`OUTCOME_SECTION`). */
export function weekOutcomesWords(outcomes: readonly RealOutcome[], canRead: (section: Section) => boolean, toward: WeekTowardFacts): WeekOutcomesWords {
  const counts = new Map<RealOutcomeKind, number>();
  for (const o of outcomes) if (canRead(OUTCOME_SECTION[o.kind])) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  const count = [...counts.values()].reduce((a, b) => a + b, 0);
  if (count === 0) return { count: 0, headline: null, detail: null, toward: weekTowardLine(toward) };
  const parts = KIND_ORDER.filter((k) => counts.has(k)).map((k) => kindWords(k, counts.get(k)!));
  return { count, headline: `This week: ${countOf(count, "real outcome")}`, detail: sentenceCase(parts.join(", ")), toward: null };
}
