/**
 * Pure helpers behind the LIVE pages (BUILD §11.14): /network, /communities, /leaderboards. No React, no Next.js, so
 * the rules are unit-tested on their own: who is on the other end of a connection, how a thread is titled, how a
 * board and its metric read, how the form string becomes cells, and what a community post may carry.
 */
import { APP_NAME } from "@foundmill/config";
import { ARCHETYPE_LABELS, ENTITY_MARKUP_RE, type Archetype, type Visibility } from "@foundmill/shared";
import type { FormResult } from "@foundmill/dugout";

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
// Community posts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A post is written by someone else, so an `[[ent:<uuid>|Name]]` in it names an entity in *their* business, not one the
 * reader can open. It is shown as the plain name and never as an entity link.
 */
export function stripEntityMarkup(text: string): string {
  return text.replace(new RegExp(ENTITY_MARKUP_RE.source, "g"), "$2");
}

// ---------------------------------------------------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------------------------------------------------

const WORDS: Record<string, string> = { b2b: "B2B", b2c: "B2C", saas: "SaaS", mrr: "MRR", arr: "ARR", eu: "EU", us: "US", ai: "AI", pct: "%", dtc: "DTC" };

/** "customers_won" → "Customers won", "b2b_saas" → "B2B SaaS". */
export function humanise(key: string): string {
  const words = key.split(/[_\s-]+/).filter(Boolean);
  return words
    .map((w, i) => WORDS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

export interface BoardLike {
  id: string;
  boardKind: string;
  division: string;
  period: string;
  metric: string;
  archetype: string | null;
  region: string | null;
  computedAt: Date | string | null;
}

export function boardKindLabel(kind: string): string {
  return humanise(kind);
}

/** "Q4 2026", "Oct 2026", "All time". Anything else is shown as written. */
export function periodLabel(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
  if (period === "all-time") return "All time";
  return period;
}

/** Who a board compares: its division, archetype and region, e.g. "B2B SaaS · EU". "open" divisions read "Open". */
export function boardScope(board: Pick<BoardLike, "division" | "archetype" | "region">): string {
  const archetype = board.archetype ? (ARCHETYPE_LABELS[board.archetype as Archetype] ?? humanise(board.archetype)) : null;
  const division = board.division === board.archetype ? null : humanise(board.division);
  return [archetype ?? division ?? "Open", archetype ? division : null, board.region ? board.region.toUpperCase() : null].filter(Boolean).join(" · ");
}

export type MetricFormat = "percent" | "integer" | "number";

/** How a board's ranked metric reads: its name, and whether the value is a percentage, a count or a plain figure. */
export function describeMetric(metric: string): { label: string; format: MetricFormat } {
  if (/_pct$/.test(metric)) return { label: humanise(metric.replace(/_pct$/, "")), format: "percent" };
  if (/^customers?(_won)?$/.test(metric)) return { label: "Customers won", format: "integer" };
  return { label: humanise(metric), format: "number" };
}

export function formatMetricValue(value: string | number, format: MetricFormat): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (format === "percent") return `${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: format === "integer" ? 0 : 2 }).format(n);
}

/** A board's title: its kind and who it compares ("Growth · B2B SaaS · EU"). */
export function boardTitle(board: BoardLike): string {
  return `${boardKindLabel(board.boardKind)} · ${boardScope(board)}`;
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
