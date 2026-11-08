/**
 * Pure helpers behind the LIVE pages (BUILD §11.14): /network, /communities, /leaderboards. No React, no Next.js, so
 * the rules are unit-tested on their own: who is on the other end of a connection, how a thread is titled, who may
 * speak as a business, and how a board and its metric read and how the form string becomes cells.
 */
import { APP_NAME } from "@foundmill/config";
import { WRITE_ROLES, type Visibility } from "@foundmill/shared/constants";
import type { FormResult } from "@foundmill/dugout";
import type { MetricFormat } from "@foundmill/widgets/shared/leaderboards";
import { formatNumber } from "@/lib/format";

// ---------------------------------------------------------------------------------------------------------------------
// Profile visibility
// ---------------------------------------------------------------------------------------------------------------------

export const VISIBILITY_OPTIONS: readonly { value: Visibility; label: string; description: string }[] = [
  { value: "public", label: "Public", description: `Anyone on ${APP_NAME} can see your name.` },
  { value: "connections", label: "Connections", description: "People you have connected with, and anyone you write to or ask to connect." },
  { value: "community", label: "Community", description: "Your connections, people in your communities, and anyone you write to or ask to connect." },
  { value: "private", label: "Private", description: "Nobody, except people you write to or ask to connect." },
];

export function visibilityLabel(value: string): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === value)?.label ?? "Private";
}

// ---------------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------------

export interface PersonCardLike {
  userId: string;
  displayName: string | null;
}

/** What to call someone whose profile keeps their name back. */
export const UNNAMED_PERSON = "A founder";

export function personName(card: PersonCardLike | undefined | null): string {
  return card?.displayName?.trim() || UNNAMED_PERSON;
}

/**
 * "Ana", "Ana and Ben", "Ana, Ben and 2 others". Unnamed people collapse into "A founder" / "3 founders". `all` names
 * everyone ("Ana, Ben, Cal and Dee"), for a header that must say who is in the conversation.
 */
export function joinNames(cards: readonly (PersonCardLike | undefined | null)[], options: { all?: boolean } = {}): string {
  const named = cards.flatMap((c) => (c?.displayName?.trim() ? [c.displayName.trim()] : []));
  const unnamed = cards.length - named.length;
  const parts = [...named, ...(unnamed === 1 ? [UNNAMED_PERSON] : unnamed > 1 ? [`${unnamed} founders`] : [])];
  if (parts.length === 0) return UNNAMED_PERSON;
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2 || options.all) return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} ${parts.length - 2 === 1 ? "other" : "others"}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Connections and message threads
// ---------------------------------------------------------------------------------------------------------------------

export interface ConnectionLike {
  id: string;
  fromUser: string;
  toUser: string;
  status: "requested" | "accepted" | "blocked";
}

/** The person on the other end of a connection row. */
export function counterpartId(c: Pick<ConnectionLike, "fromUser" | "toUser">, viewerId: string): string {
  return c.fromUser === viewerId ? c.toUser : c.fromUser;
}

export interface ConnectionGroups<T extends ConnectionLike> {
  /** Requests addressed to the viewer, waiting for an answer. */
  incoming: T[];
  /** Requests the viewer sent, not yet answered. */
  outgoing: T[];
  accepted: T[];
  blocked: T[];
}

export function groupConnections<T extends ConnectionLike>(rows: readonly T[], viewerId: string): ConnectionGroups<T> {
  const groups: ConnectionGroups<T> = { incoming: [], outgoing: [], accepted: [], blocked: [] };
  for (const row of rows) {
    if (row.status === "accepted") groups.accepted.push(row);
    else if (row.status === "blocked") groups.blocked.push(row);
    else if (row.toUser === viewerId) groups.incoming.push(row);
    else groups.outgoing.push(row);
  }
  return groups;
}

export interface ThreadLike {
  id: string;
  participantIds: readonly string[];
  subject: string | null;
  /** `group` for a thread started with two or more people, even once it is down to two (0027). */
  kind?: "direct" | "group";
}

export function otherParticipants(thread: Pick<ThreadLike, "participantIds">, viewerId: string): string[] {
  return thread.participantIds.filter((id) => id !== viewerId);
}

/**
 * Who the thread is with: the other participants' names, never the subject. The subject is whatever the first sender
 * typed, so it cannot stand in for who wrote ("Foundmill Support: verify your account"); it is shown beside the names
 * (`threadSubject`).
 */
export function threadTitle(thread: ThreadLike, viewerId: string, nameOf: (userId: string) => PersonCardLike | undefined): string {
  return joinNames(otherParticipants(thread, viewerId).map(nameOf));
}

/** Every other participant, by name, for the open conversation's header ("Ana, Ben and Cal"). */
export function threadParticipants(thread: Pick<ThreadLike, "participantIds">, viewerId: string, nameOf: (userId: string) => PersonCardLike | undefined): string {
  return joinNames(otherParticipants(thread, viewerId).map(nameOf), { all: true });
}

/** The sender's subject line, trimmed; null when there is none. Secondary text only. */
export function threadSubject(thread: Pick<ThreadLike, "subject">): string | null {
  return thread.subject?.trim() || null;
}

/**
 * The one-to-one thread between the viewer and another person, if there is one. A group that shrank to the two of them
 * (the others left) is not it: the server keeps the pair's direct thread apart, and a Send to the person goes there.
 */
export function findDirectThread<T extends ThreadLike>(threads: readonly T[], viewerId: string, otherId: string): T | undefined {
  return threads.find((t) => {
    if (t.kind === "group") return false;
    const others = new Set(otherParticipants(t, viewerId));
    return others.size === 1 && others.has(otherId);
  });
}

/** Where the viewer stands with another person, for "Ask to connect" (audit #66). */
export type ConnectState = "self" | "connected" | "requested" | "incoming" | "blocked" | "none";

/**
 * The viewer's state with `otherId` from their own connection rows (`live.connections.list`): connected, a request they
 * sent ("requested"), one waiting for them ("incoming"), a block they set, or nothing yet. A block the other person set
 * is never in the viewer's rows, so it reads as "none" (and the request is refused without saying why).
 */
export function connectStateOf(rows: readonly ConnectionLike[], viewerId: string, otherId: string): ConnectState {
  if (otherId === viewerId) return "self";
  const row = rows.find((c) => counterpartId(c, viewerId) === otherId);
  if (!row) return "none";
  if (row.status === "accepted") return "connected";
  if (row.status === "blocked") return "blocked";
  return row.fromUser === viewerId ? "requested" : "incoming";
}

/**
 * What a sent request came to (`live.connections.request` returns the pair's one row): the viewer's own request, new or
 * already waiting ("sent"); a connection that already stood ("connected"); or the other person's request, already
 * waiting for the viewer's answer ("incoming"). A leaderboard row cannot know the owner beforehand, so this tells.
 */
export function requestOutcome(row: Pick<ConnectionLike, "fromUser" | "status">, viewerId: string): "sent" | "connected" | "incoming" {
  if (row.status === "accepted") return "connected";
  return row.fromUser === viewerId ? "sent" : "incoming";
}

/** The group a thread is with: "Ana, Ben and Cal left" style notes for people who left. */
export function leftNote(leftIds: readonly string[], nameOf: (userId: string) => PersonCardLike | undefined): string | null {
  if (!leftIds.length) return null;
  const who = joinNames(leftIds.map(nameOf));
  return `${who} left this conversation`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Speaking as a business
// ---------------------------------------------------------------------------------------------------------------------

/**
 * May the viewer speak as this business on the network ("post as Ledgerly")? The same rule the API enforces
 * (`live.ts` speakingAs): the business is LIVE, committed and not archived, and the member holds a writing role with write
 * access to the `live` section (an owner always does; an explicit permission wins; otherwise the role's default). The UI
 * only offers the choice when this is true, and posts as the person by default; the API refuses anyone it does not hold for.
 */
export function canSpeakAsBusiness(input: {
  business: { gameMode: string; committedAt: Date | string | null; archivedAt: Date | string | null };
  membership: { role: string; sectionPermissions?: Record<string, string> | null };
}): boolean {
  const { business, membership } = input;
  if (business.gameMode !== "live" || !business.committedAt || business.archivedAt) return false;
  if (!(WRITE_ROLES as readonly string[]).includes(membership.role)) return false;
  if (membership.role === "owner") return true;
  const explicit = membership.sectionPermissions?.live;
  return explicit ? explicit === "write" : true;
}

/**
 * Why "Ask to connect" cannot be pressed from the current business, or null when it can: a request is asked from a LIVE
 * business the founder may speak for (the API's `live.connections.request` rule).
 */
export function askToConnectBlocker(input: Parameters<typeof canSpeakAsBusiness>[0]): string | null {
  if (input.business.gameMode !== "live") return "Connection requests are sent from a LIVE business. Open one, or make this business LIVE in Settings › Business.";
  if (!canSpeakAsBusiness(input)) return "Your role in this business cannot send connection requests for it.";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Communities and moderation
// ---------------------------------------------------------------------------------------------------------------------

/** Report reasons, in the order the report dialog lists them (the API's POST_REPORT_REASONS). */
export const REPORT_REASONS = [
  { value: "spam", label: "Spam or self-promotion" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "personal_data", label: "Someone's personal data" },
  { value: "scam", label: "A scam or fraud" },
  { value: "off_topic", label: "Off topic" },
  { value: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export function reportReasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

/**
 * Why the viewer cannot leave a community, or null when they can: the owner of a community joined by invitation stays,
 * since nobody could let them back in (the API refuses it too).
 */
export function leaveBlocker(community: { role: string | null; visibility: string }): string | null {
  return community.role === "owner" && community.visibility !== "public" ? "You own this community and it is joined by invitation only, so you stay its member." : null;
}

/** Community kinds (BUILD §11.14) for the create dialog. Private is a visibility, chosen beside the kind. */
export const COMMUNITY_KIND_OPTIONS = [
  { value: "category", label: "Category", description: "Founders in the same kind of business." },
  { value: "cohort", label: "Cohort", description: "A group that started together." },
  { value: "geography", label: "Geography", description: "Founders in one place." },
] as const;

/**
 * How a post's status reads to the people who can see it: its author (their own held post) and the moderators. Null
 * for a visible post.
 */
export function postStatusLabel(status: string): string | null {
  if (status === "pending_review") return "Held for review";
  if (status === "hidden") return "Hidden by a moderator";
  if (status === "removed") return "Removed";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------------------------------------------------

// The words a board reads in live in @foundmill/widgets so the Leaderboard widget on Home says the same as these pages.
export { boardKindLabel, boardScope, boardTitle, describeMetric, humanise, periodLabel, type BoardLike, type MetricFormat } from "@foundmill/widgets/shared/leaderboards";

export function formatMetricValue(value: string | number, format: MetricFormat): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (format === "percent") return `${formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return formatNumber(n, { maximumFractionDigits: format === "integer" ? 0 : 2 });
}

/** The form string of an entry ("WWDLW": win, draw, loss) as cells for FormCells. Other characters are ignored. */
export function formResults(form: string): FormResult[] {
  const out: FormResult[] = [];
  for (const ch of form.toUpperCase()) {
    if (ch === "W") out.push("success");
    else if (ch === "D") out.push("partial");
    else if (ch === "L") out.push("failure");
  }
  return out;
}

/** "#3". */
export function positionLabel(position: number): string {
  return `#${position}`;
}
