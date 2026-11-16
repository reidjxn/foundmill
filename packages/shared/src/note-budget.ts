/**
 * The first week's note budget (WP-04 T8; s2 §5.3): real projects got 4 to 17 notes on day one and read few of them. In
 * a project's first days an agent's plain update (an `update` or a `report` with nothing to decide and nothing holding
 * Continue, from anyone but the Chief of Staff) is folded: stored archived and listed in one Chief of Staff note, "What
 * your team did today", which replaces itself. Decisions, approvals, warnings, wins, milestones and people's messages
 * always reach the Inbox. A sample business gets every note. The repo applies it (`inboxRepo.createItem`); the number of
 * days is `LIMITS.firstWeekDays` in @foundmill/config, passed in so this package stays free of config.
 */
import type { InboxItemType } from "./constants";

export type NoteVerdict = "deliver" | "fold";

export interface NoteFacts {
  type: InboxItemType;
  hasDecision: boolean;
  blocksContinue: boolean;
  fromChiefOfStaff: boolean;
  /** When the project was committed; null before (nothing is folded). */
  committedAt: Date | null;
  isDemo: boolean;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a new note reaches the Inbox or is folded into the day's digest. */
export function noteVerdict(f: NoteFacts, firstWeekDays: number): NoteVerdict {
  if (f.isDemo || f.committedAt === null) return "deliver";
  if (f.type !== "update" && f.type !== "report") return "deliver";
  if (f.hasDecision || f.blocksContinue || f.fromChiefOfStaff) return "deliver";
  return f.now.getTime() < f.committedAt.getTime() + firstWeekDays * DAY_MS ? "fold" : "deliver";
}

export const DIGEST_SUBJECT = "What your team did today";

/** Lines the digest shows; the rest are counted. */
export const DIGEST_MAX_LINES = 8;

/** The digest's body: a template, no model call. One line per folded note, newest first as given. */
export function digestBody(lines: readonly { agentName: string; subject: string }[]): string {
  const shown = lines.slice(0, DIGEST_MAX_LINES).map((l) => `- ${l.agentName}: ${l.subject}`);
  const more = lines.length - shown.length;
  return [
    "Here is what your team did today. Each full note is in the Inbox, under Archive.",
    "",
    ...shown,
    ...(more > 0 ? ["", `And ${more} more in the Inbox.`] : []),
  ].join("\n");
}
