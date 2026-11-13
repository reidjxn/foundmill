/**
 * Founder notices (security review P2-3, Nov 13, 2026): when a founder's role goes below a founder's, a founder is
 * removed, or a project's deletion is asked for or canceled, every founder hears it by email (the gateway's one sender,
 * `ACCOUNT_SAFETY_EMAIL_KINDS`), and so does the person it happened to, even once they are out. A founder removed (or
 * demoted) by another founder can still cancel a pending deletion of that project for `FORMER_FOUNDER_CANCEL_WINDOW_MS`:
 * from the email's one-click link (`/a/<token>`) or from the card on their home.
 *
 * Plain data and words, no Zod and no crypto, so the browser and the gateway read the same sentences. Every name in them
 * is written by a person, so the email builder sends each through `withoutLinks` and onto one line (people-email.ts).
 * None of them says or implies that working alone is a problem: they say who did what, when, and what the reader can do.
 */
import { isOwnerRole, type FounderNotice, type MembershipRole } from "./constants";
import { withoutLinks } from "./notify-email";

/** The audit actions a notice is read from (the gateway reads the entry again; the api sends its id only). */
export const FOUNDER_NOTICE_ACTIONS = {
  role: "team.humans.role",
  remove: "team.humans.remove",
  requestDeletion: "business.request_deletion",
  cancelDeletion: "business.cancel_deletion",
} as const;

/** A notice is sent about an audit entry at most this long after it was written (a retry the next day sends nothing). */
export const FOUNDER_NOTICE_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * The suppression reasons that stop a founder notice: the address bounced, or its owner marked our mail as spam
 * (`suppressionReasonOf` in @foundmill/connectors writes these words). An unsubscribe, a "stop" reply and "Don't send me
 * invitations" do not: they are about a project's mail or invitations, not about who runs a project the person founded.
 */
export const SUPPRESSION_REASON_BOUNCED = "bounced";
export const SUPPRESSION_REASON_SPAM = "marked the message as spam";
export const HARD_SUPPRESSION_REASONS: readonly string[] = [SUPPRESSION_REASON_BOUNCED, SUPPRESSION_REASON_SPAM];

/** What a role reads as in these notices: "a cofounder", "an admin". */
export function rolePhrase(role: MembershipRole | string): string {
  switch (role) {
    case "owner":
      return "a founder";
    case "cofounder":
      return "a cofounder";
    case "admin":
      return "an admin";
    case "member":
      return "a member";
    case "viewer":
      return "a viewer";
    case "advisor":
      return "an advisor";
    case "collaborator":
      return "a collaborator";
    default:
      return "a member";
  }
}

/**
 * An essential notice (final review): it skips the ordinary notices' ceilings and the per-project fold, and is bounded on
 * its own instead (`FOUNDER_NOTICE_LIMITS.essentialPerRecipientDay` per person a day across every project, and the
 * reserved circuit breaker), past which the person gets one folded email for the day that still carries the latest
 * deletion they may cancel. Essential:
 *   - (a) an email that carries the one-click cancel;
 *   - (b) the removal's email to the person removed;
 *   - a deletion request's email to a founder now, to the person who asked (the receipt), and to a former founder for
 *     that request (`inWindow`: someone else took their standing away within 30 days before it, or after it).
 * Everything else is ordinary, the emails to someone taken out longer ago about a deletion and its cancel included.
 */
export function isEssentialFounderNotice(f: { notice: FounderNotice; reader: "founder" | "subject" | "former" | "self"; carriesCancel: boolean; inWindow?: boolean }): boolean {
  if (f.carriesCancel) return true;
  if (f.notice === "removed" && f.reader === "subject") return true;
  if (f.notice !== "deletion_requested") return false;
  return f.reader === "founder" || f.reader === "self" || (f.reader === "former" && f.inWindow === true);
}

/** Which notice an audit entry is, or null when it is not one (a role change that keeps a founder's standing, say). */
export function founderNoticeOf(entry: { action: string; details: Record<string, unknown> }): FounderNotice | null {
  const d = entry.details;
  switch (entry.action) {
    case FOUNDER_NOTICE_ACTIONS.role:
      return isOwnerRole(typeof d.fromRole === "string" ? d.fromRole : null) && typeof d.role === "string" && !isOwnerRole(d.role) ? "role_changed" : null;
    case FOUNDER_NOTICE_ACTIONS.remove:
      // A founder is stepped down before they can be removed: `formerRole` is the founder's role they had until lately.
      return isOwnerRole(typeof d.role === "string" ? d.role : null) || isOwnerRole(typeof d.formerRole === "string" ? d.formerRole : null) ? "removed" : null;
    case FOUNDER_NOTICE_ACTIONS.requestDeletion:
      return "deletion_requested";
    case FOUNDER_NOTICE_ACTIONS.cancelDeletion:
      return "deletion_canceled";
    default:
      return null;
  }
}

/** "Nov 13, 2026 at 3:45 PM EST" in the reader's zone (US English, 12-hour); UTC when the zone is unknown or not valid. */
export function noticeMoment(at: Date, timeZone: string | null | undefined): string {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone, timeZoneName: "short" }).formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} ${get("timeZoneName")}`;
  };
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // An unknown zone reads in UTC.
    }
  }
  return format("UTC");
}

/** "Nov 20, 2026" (US dates), in the reader's zone, UTC when unknown. */
export function noticeDay(at: Date, timeZone: string | null | undefined): string {
  const format = (zone: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(at);
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // An unknown zone reads in UTC.
    }
  }
  return format("UTC");
}

const clip = (value: string, max: number): string => {
  const v = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};

/** Markdown's own characters, backslashed, so a name in a note's body stays the words it is (no link, no emphasis). */
export const escapeMarkdown = (value: string): string => value.replace(/[\\`*_[\]()<>!#|~]/g, (c) => `\\${c}`);

/** A person-written name for a note: one line, no link, no address (`withoutLinks`); `md` also escapes it for a body. */
const nameIn = (value: string, max: number, md: boolean): string => {
  const plain = clip(withoutLinks(value), max);
  return md ? escapeMarkdown(plain) : plain;
};

/**
 * The Inbox note the business gets when a founder's role is lowered or a founder is removed (the Chief of Staff writes
 * it; every founder reads the project's Inbox). Written only when another founder than the one who made the change is
 * there to read it: nobody is told about what they just did themselves.
 */
export function founderChangeNote(f: { notice: "role_changed" | "removed"; actorName: string | null; subjectName: string | null; fromRole: string; toRole?: string | null; when: string }): { subject: string; body: string } {
  // The subject is plain text; the body is markdown, so the names in it are escaped as well.
  const actorText = f.actorName ? nameIn(f.actorName, 60, false) : "One of the founders";
  const subjectText = f.subjectName ? nameIn(f.subjectName, 60, false) : "a founder";
  const actor = f.actorName ? nameIn(f.actorName, 60, true) : "One of the founders";
  const subject = f.subjectName ? nameIn(f.subjectName, 60, true) : "a founder";
  if (f.notice === "role_changed") {
    return {
      subject: clip(`${actorText} changed ${subjectText}'s role`, 80),
      body: `${actor} changed ${subject}'s role from ${rolePhrase(f.fromRole)} to ${rolePhrase(f.toRole ?? "member")} on ${f.when}. If this wasn't agreed, a founder can change it back in Settings › People.`,
    };
  }
  return {
    subject: clip(`${actorText} removed ${subjectText}`, 80),
    body: `${actor} removed ${subject}, who was ${rolePhrase(f.fromRole)}, from the project on ${f.when}. If this wasn't agreed, a founder can invite them back from Settings › People.`,
  };
}

/** The line the "Deletion canceled" note adds when someone who was a founder until recently canceled it. */
export function formerFounderCanceledLine(name: string | null, until: string): string {
  return `${name ? nameIn(name, 60, true) : "Someone who was a founder"}, a founder of this project until ${until}, canceled it. Canceling gave them nothing else: they are still out of the project.`;
}

/** The card on the home of a founder who was removed (or demoted) while a deletion of that project waits. */
export const FORMER_PROJECT_CARD = {
  title: (projectName: string) => `${clip(projectName, 80)} is set to be deleted`,
  body: (f: { scheduledFor: string; until: string }) => `It will be permanently deleted on ${f.scheduledFor}. You were one of its founders until recently, so you can cancel the deletion until ${f.until}.`,
  note: "Canceling keeps the project as it is. It does not give you your place back: to rejoin, one of the founders sends you a new invitation.",
  button: "Cancel the deletion",
  confirm: "Yes, cancel the deletion",
  keep: "Not now",
  done: (projectName: string) => `The deletion of ${clip(projectName, 80)} is canceled, and every founder was told.`,
} as const;

/**
 * The email that stands for every further founder notice about one project in the window, once a person has had the
 * window's share (`FOUNDER_NOTICE_LIMITS`): it says there were more changes and where to look, and keeps the cancel
 * when the notice it stands for carried one.
 */
export const FOUNDER_NOTICE_MORE = {
  subject: (projectName: string) => `More changes in ${clip(withoutLinks(projectName), 120)}`,
  lead: (projectName: string) => `There were more changes to who runs ${clip(withoutLinks(projectName), 120)}, or to whether it is deleted, than we email about one by one. We won't email about each of them for a while.`,
  founder: "Open the project to see where things stand: Settings › People and Settings › Danger zone.",
  other: "If you are still one of its founders, open Settings › People and Settings › Danger zone to see where things stand. If a deletion waits that you can still cancel, your home shows it.",
  /** The one folded email a person gets for the day once their essential notices reach their share, across every project. */
  all: {
    subject: "More changes to who runs your projects",
    lead: "Today there were more changes to who runs projects you are, or were, a founder of, or to whether they are deleted, than we email about one by one. We won't email about each of them again until tomorrow.",
    body: "Open each project to see where things stand: Settings › People and Settings › Danger zone. Your home shows every deletion you can still cancel.",
  },
} as const;

/** The words of `/a/<token>` when the link cancels a deletion. */
export function cancelLinkWords(state: "ready" | "canceled" | "used" | "expired" | "unavailable", opts: { justCanceled?: boolean } = {}): { title: string; description: string } {
  switch (state) {
    case "ready":
      return { title: "Cancel the deletion", description: FORMER_PROJECT_CARD.note };
    case "canceled":
      return opts.justCanceled ? { title: "Deletion canceled", description: "Nothing will be deleted. Every founder was told that you canceled it." } : { title: "Already canceled", description: "This deletion was canceled already. Nothing will be deleted." };
    case "used":
      return { title: "Already used", description: "This link has been used. Each link works once." };
    case "expired":
      return { title: "This link has expired", description: "A deletion can be canceled until the day it is set to happen." };
    default:
      return { title: "This link no longer works", description: "The deletion was canceled or changed, or you can no longer cancel it." };
  }
}
