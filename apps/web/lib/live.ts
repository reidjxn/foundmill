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
  { value: "connections", label: "Connections", description: "Only people you have connected with." },
  { value: "community", label: "Community", description: "Your connections and people in the same communities." },
  { value: "private", label: "Private", description: "Nobody, until you write to them or they write to you." },
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

/** "Ana", "Ana and Ben", "Ana, Ben and 2 others". Unnamed people collapse into "A founder" / "3 founders". */
export function joinNames(cards: readonly (PersonCardLike | undefined | null)[]): string {
  const named = cards.flatMap((c) => (c?.displayName?.trim() ? [c.displayName.trim()] : []));
  const unnamed = cards.length - named.length;
  const parts = [...named, ...(unnamed === 1 ? [UNNAMED_PERSON] : unnamed > 1 ? [`${unnamed} founders`] : [])];
  if (parts.length === 0) return UNNAMED_PERSON;
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
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
}

export function otherParticipants(thread: Pick<ThreadLike, "participantIds">, viewerId: string): string[] {
  return thread.participantIds.filter((id) => id !== viewerId);
}

/** The subject, or who the thread is with. */
export function threadTitle(thread: ThreadLike, viewerId: string, nameOf: (userId: string) => PersonCardLike | undefined): string {
  const subject = thread.subject?.trim();
  if (subject) return subject;
  return joinNames(otherParticipants(thread, viewerId).map(nameOf));
}

/** The one-to-one thread between the viewer and another person, if there is one. */
export function findDirectThread<T extends ThreadLike>(threads: readonly T[], viewerId: string, otherId: string): T | undefined {
  return threads.find((t) => {
    const others = new Set(otherParticipants(t, viewerId));
    return others.size === 1 && others.has(otherId);
  });
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
