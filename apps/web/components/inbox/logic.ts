/**
 * Pure Inbox logic (BUILD §11.3, DESIGN §9 Inbox): tabs, row models, J/K navigation, the Refresh debounce gate,
 * decision options → DecisionBar, status-strip metric resolution with provenance, the "Here is what will happen"
 * summary, follow-up links from plan actions, and the replay lookup for won customers.
 */
import type { DecisionAnswer, DecisionOption, MetricTileProps, TabItem } from "@foundmill/dugout";
import { notePreview, type InboxItemType, type InboxState, type Money } from "@foundmill/shared";
import { monthRevenueMinor } from "@foundmill/widgets/shared/cash";
import { applyGlossary } from "@foundmill/shared/glossary";
import { routes } from "@foundmill/widgets/shared/routes";
import { runwayFigure, runwayWords } from "@foundmill/widgets/shared/runway";
import { NOTE_TYPE_TAGS, noteRowTag, type NoteTag as SharedNoteTag, type NoteTagIcon, type NoteTagTone } from "@foundmill/widgets/shared/note-tags";
import { formatNumber } from "@/lib/format";

// --- tabs --------------------------------------------------------------------------------------------------------------

export const INBOX_TABS = ["all", "respond", "customers", "updates", "messages", "archive"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const INBOX_TAB_LABELS: Record<InboxTab, string> = { all: "All", respond: "Respond", customers: "Customers", updates: "Updates", messages: "Messages", archive: "Archive" };

export function parseInboxTab(raw: string | null | undefined, live: boolean): InboxTab {
  const tab = (INBOX_TABS as readonly string[]).includes(raw ?? "") ? (raw as InboxTab) : "all";
  return tab === "messages" && !live ? "all" : tab;
}

/**
 * Messages is LIVE-only (BUILD §11.3). Badges: Respond carries the count of items waiting for an answer. Labels are in
 * the business's words (Settings › Glossary: "Customers" reads "Clients").
 */
export function inboxTabs(businessId: string, live: boolean, counts: Partial<Record<string, number>> | undefined, glossary?: Record<string, string>): TabItem[] {
  return INBOX_TABS.filter((t) => live || t !== "messages").map((t) => ({
    id: t,
    label: applyGlossary(INBOX_TAB_LABELS[t], glossary),
    href: t === "all" ? routes.inbox(businessId) : `${routes.inbox(businessId)}?tab=${t}`,
    badge: t === "respond" && counts?.respond ? counts.respond : undefined,
  }));
}

// --- rows --------------------------------------------------------------------------------------------------------------

export interface InboxRowInput {
  id: string;
  type: InboxItemType;
  state: InboxState;
  subject: string;
  bodyMd: string;
  blocksContinue: boolean;
  fromAgentId: string | null;
  fromUserId?: string | null;
  createdAt: Date | string;
  /** Answered, but its plan still waits for the founder's go-ahead (inbox.list; audit OL-01): it says "Respond". */
  awaitingConfirmation?: boolean;
}

export type RowTone = "bad" | "warn" | "info" | "good" | "neutral";

export const TYPE_META: Record<InboxItemType, { word: string; tone: RowTone }> = {
  decision: { word: "Decision", tone: "bad" },
  customer_won: { word: "Customer won", tone: "good" },
  warning: { word: "Warning", tone: "warn" },
  update: { word: "Update", tone: "info" },
  milestone: { word: "Milestone", tone: "good" },
  report: { word: "Report", tone: "neutral" },
  human_message: { word: "Message", tone: "neutral" },
};

/**
 * First sentence of the note as the preview line (entity markup and markdown stripped, a leading "**Vision.**" heading
 * skipped). One rule with Home's Inbox widget: both read @foundmill/shared's notePreview.
 */
export function previewLine(bodyMd: string, max = 120): string {
  return notePreview(bodyMd, max);
}

/** The tag a row and the reading pane carry (DIRECTION #8): one vocabulary with Home's preview (widgets/shared/note-tags). */
export type TagTone = NoteTagTone;
export type TagIcon = NoteTagIcon;
export type NoteTag = SharedNoteTag;

/**
 * One tag per row: a won customer reads "Customer" (gold), anything waiting on the founder says "Respond", the rest
 * name their kind ("Milestone", "Update", "Report", "Decided" once a decision is answered).
 */
export function rowTag(item: Pick<InboxRowInput, "type" | "state" | "blocksContinue" | "awaitingConfirmation">): NoteTag {
  return noteRowTag(item);
}

/**
 * The reading pane's type tag: the same vocabulary, a little fuller. Two families only (UX plan B7): "Needs your
 * answer" for an open note, "Needs your go-ahead" for an answered note whose plan waits for "Here is what will happen";
 * "Customer won" for a win.
 */
export function headerTag(type: InboxItemType, answered: boolean, blocksContinue: boolean, awaitingConfirmation = false): NoteTag {
  if (type === "customer_won") return { word: "Customer won", tone: "gold", icon: "win" };
  if (awaitingConfirmation) return { word: "Needs your go-ahead", tone: "warn", icon: "respond" };
  if (!answered && (type === "decision" || blocksContinue)) return { word: "Needs your answer", tone: "bad", icon: "respond" };
  return NOTE_TYPE_TAGS[type];
}

/** The tooltip of the "Holds Continue" chip: what the chip means for the team (UX plan B7). */
export const HOLDS_CONTINUE_HINT = "The team waits for this answer before its next round of work";

export interface InboxRowModel {
  id: string;
  subject: string;
  preview: string;
  createdAt: Date | string;
  /** The item waits for an answer ("Respond" tag). */
  needsAnswer: boolean;
  /** Gold left edge and the "Customer" tag: a won customer. */
  won: boolean;
  unread: boolean;
  tone: RowTone;
  typeWord: string;
  tag: NoteTag;
}

export function rowModel(item: InboxRowInput): InboxRowModel {
  const answered = item.state === "answered" || item.state === "archived";
  return {
    id: item.id,
    subject: item.subject,
    preview: previewLine(item.bodyMd),
    createdAt: item.createdAt,
    needsAnswer: item.awaitingConfirmation === true || (!answered && (item.blocksContinue || item.type === "decision" || item.type === "customer_won")),
    won: item.type === "customer_won",
    unread: item.state === "unread",
    tone: TYPE_META[item.type].tone,
    typeWord: TYPE_META[item.type].word,
    tag: rowTag(item),
  };
}

/** J (next) / K (previous) over the visible rows; nothing selected → the first row; ends clamp. */
export function neighbourId(ids: readonly string[], currentId: string | null | undefined, dir: "next" | "prev"): string | null {
  if (ids.length === 0) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  if (i < 0) return ids[0] ?? null;
  const j = dir === "next" ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
  return ids[j] ?? null;
}

// --- paging --------------------------------------------------------------------------------------------------------------

export interface PagedInbox<I extends { id: string; createdAt: Date | string }> {
  items: readonly I[];
  nextCursor: string | null;
}

/** How long a page older than the first is reused when the list is refreshed; the first page is always fetched. */
export const OLDER_PAGE_REUSE_MS = 60_000;

/** The list's order: newest first, ties by id (the server's keyset, `timeKeyset`). Negative when `a` comes before `b`. */
const listOrder = (a: { id: string; createdAt: Date | string }, b: { id: string; createdAt: Date | string }): number => {
  const t = Math.trunc(new Date(b.createdAt).getTime()) - Math.trunc(new Date(a.createdAt).getTime());
  return t !== 0 ? t : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * The first page after a refresh, folded into the first page the reader already holds. A new note costs one request
 * however deep the reader has scrolled: the fresh page replaces the items it covers, the items older than it stay as
 * they were, and the cursor keeps pointing past the old page, so every older page stays valid and is not fetched
 * again. When more notes arrived than a page holds, the fresh page does not reach back to the old one; it is then
 * taken alone and the older pages are fetched afresh (nothing between them is lost). Audit SOAK-09.
 */
export function mergeFirstPage<I extends { id: string; createdAt: Date | string }, P extends PagedInbox<I>>(held: P | undefined, fresh: P): P {
  if (!held || fresh.nextCursor === null) return fresh;
  const oldest = fresh.items[fresh.items.length - 1];
  const newestHeld = held.items[0];
  if (!oldest || !newestHeld) return fresh;
  // Fresh reaches the held page when its oldest note is not newer than the held page's newest one.
  if (listOrder(oldest, newestHeld) < 0) return fresh;
  const older = held.items.filter((i) => listOrder(oldest, i) < 0);
  return { ...fresh, items: [...fresh.items, ...older], nextCursor: held.nextCursor };
}

// --- refresh -----------------------------------------------------------------------------------------------------------

/** The composer debounces per business (BUILD §11.3 "debounce 3 s"); the page says so instead of firing a no-op. */
export const REFRESH_DEBOUNCE_MS = 3_000;

export function refreshGate(lastAt: number | null, now: number): { allowed: boolean; waitMs: number } {
  if (lastAt === null) return { allowed: true, waitMs: 0 };
  const waitMs = Math.max(0, REFRESH_DEBOUNCE_MS - (now - lastAt));
  return { allowed: waitMs === 0, waitMs };
}

// --- decisions ---------------------------------------------------------------------------------------------------------

interface RawOption {
  id?: unknown;
  label?: unknown;
  recommended?: unknown;
  consequence?: unknown;
  /** Why it is recommended, or why it is on the list (the Composer schema's `because`, UX plan §7.19). */
  because?: unknown;
  cost_minor?: unknown;
  reversible?: unknown;
}

/** The item's `decision.options` (Composer schema) → DecisionBar options, costs in the business currency. */
export function toDecisionOptions(decision: unknown, currency: string): DecisionOption[] {
  const raw = (decision as { options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is RawOption => !!o && typeof o === "object" && typeof (o as RawOption).id === "string" && typeof (o as RawOption).label === "string")
    .slice(0, 4)
    .map((o) => {
      const cost: Money | null = typeof o.cost_minor === "number" ? (o.cost_minor > 0 ? { amountMinor: o.cost_minor, currency } : null) : null;
      const because = typeof o.because === "string" && o.because.trim() ? o.because.trim() : undefined;
      return { id: o.id as string, label: o.label as string, recommended: o.recommended === true, consequence: typeof o.consequence === "string" ? o.consequence : undefined, ...(because ? { because } : {}), cost, reversible: typeof o.reversible === "boolean" ? o.reversible : undefined };
    });
}

export function freeTextAllowed(decision: unknown): boolean {
  const v = (decision as { free_text?: unknown } | null | undefined)?.free_text;
  return v !== false;
}

/**
 * A sign-off's Request changes needs the founder's words (they become the Product lead's revision task; founder
 * 2026-10-18): true when that option is pressed with empty notes, so the pane asks for them instead of sending.
 */
export function signoffNeedsNotes(optionId: string, notes: string): boolean {
  return optionId === "request_changes" && notes.trim().length === 0;
}

/** "Expires in 5 days", "Expires today", "Expires tomorrow": the deadline beside "Your decision"; null without one or once expired. */
export function decisionDeadline(decision: unknown, now = new Date()): string | null {
  const v = (decision as { expires_at?: unknown } | null | undefined)?.expires_at;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < now.getTime()) return null;
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = day(t - startOfToday);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

/**
 * Notes the founder can talk through with the agent who wrote them (DIRECTION #6): decisions, updates, warnings,
 * reports, milestones and Customer Updates. Messages from other founders on LIVE are people, not agents: no desk.
 */
export function hasAgentDesk(type: InboxItemType): boolean {
  return type !== "human_message";
}

/**
 * The agent's first line under a note (DESIGN §8 Conversation: short, first person, specific): it picks up the note the
 * founder is reading instead of a generic greeting, and names its recommendation when a decision is still open.
 */
export function noteOpener(type: InboxItemType, options: readonly Pick<DecisionOption, "label" | "recommended">[], answered: boolean): string | null {
  const rec = options.find((o) => o.recommended);
  if (type === "decision" && rec && !answered) return `I'd go with “${rec.label}”. Ask me anything before you decide.`;
  switch (type) {
    case "decision":
      return answered ? "That one is decided. Ask me how it is going, or what comes next." : "Ask me anything before you decide.";
    case "customer_won":
      return "A new customer. Ask me how they found us, or what I'd do next.";
    case "update":
      return "That is where the work stands. Ask me what's blocking it, or what's next.";
    case "warning":
      return "Ask me what this needs from you, and by when.";
    case "milestone":
      return "Ask me what got us here, or what the next milestone is.";
    case "report":
      return "Ask me about any figure in this report.";
    default:
      return null;
  }
}

/**
 * True once a decision's `expires_at` has passed. Nothing on the server applies an option at that moment (agents never
 * decide a founder's call for them outside a vacation's authority), so the decision stays open and keeps blocking
 * Continue: the deadline is a nudge, never a lock (audit VCML-X2).
 */
export function decisionPastDeadline(decision: unknown, now = new Date()): boolean {
  const v = (decision as { expires_at?: unknown } | null | undefined)?.expires_at;
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && t < now.getTime();
}

/** The answered state from the item's decisions (newest wins). */
export function answeredFrom(decisions: readonly { chosenOption: string | null; freeText: string | null; decidedAt: Date | string }[] | undefined): DecisionAnswer | undefined {
  if (!decisions?.length) return undefined;
  const latest = [...decisions].sort((a, b) => Date.parse(String(b.decidedAt)) - Date.parse(String(a.decidedAt)))[0]!;
  if (latest.chosenOption) return { optionId: latest.chosenOption };
  if (latest.freeText) return { text: latest.freeText };
  return undefined;
}

/** Who answered a decision, as the Decided panel words it for the person reading it. */
export interface DecisionAttribution {
  /** "Your answer" for the viewer's own decision, "Answer" for anyone else's. */
  label: string;
  /** "You", the decider's name, "the Chief of Staff", or their role ("an admin") when no name is known. */
  by: string;
  mine: boolean;
  decidedAt: Date | string | null;
}

/**
 * The newest decision's author relative to the viewer: "your" wording only for the viewer's own answer (a co-founder
 * reading an answer someone else gave sees who gave it). `nameOf` names another member (their name, or their role).
 */
export function decisionAttribution(decisions: readonly { decidedBy?: string | null; decidedByKind?: string | null; decidedAt: Date | string }[] | undefined, viewerId: string | null | undefined, nameOf: (userId: string) => string | null = () => null): DecisionAttribution | null {
  if (!decisions?.length) return null;
  const latest = [...decisions].sort((a, b) => Date.parse(String(b.decidedAt)) - Date.parse(String(a.decidedAt)))[0]!;
  // plain-allow: "Chief of Staff" is a Term where the answer shows (ReadingPane's Decided panel).
  if (latest.decidedByKind === "chief_of_staff") return { label: "Chief of Staff's answer", by: "the Chief of Staff", mine: false, decidedAt: latest.decidedAt };
  const mine = !!viewerId && latest.decidedBy === viewerId;
  if (mine || !latest.decidedBy) return { label: "Your answer", by: "You", mine: true, decidedAt: latest.decidedAt };
  return { label: "Answer", by: nameOf(latest.decidedBy) ?? "another member", mine: false, decidedAt: latest.decidedAt };
}

// --- status strip ------------------------------------------------------------------------------------------------------

export interface StripMetricInput {
  metric: string;
  source?: string;
}

export interface MetricSources {
  finance?: {
    cash: { amountMinor: number; currency: string; asOf?: Date | string | null };
    burn: { netBurnMinor: number; grossBurnMinor: number };
    runway: { months: number | null };
    revenue: { monthly: readonly { month: string; inflowMinor: number; netMinor: number; operatingInflowMinor?: number }[] };
    customers30d: number;
  } | null;
  /**
   * Revenue over the trailing three full months from the management P&L (`finance.pnl`), the figure Finance divides
   * by three for MRR. Without it the cash inflow of the same three months stands in.
   */
  trailingRevenueMinor?: number | null;
  /** Conversions in the ribbon window (last 30 days). */
  conversions?: readonly { kind: string; occurredAt: Date | string }[] | null;
  tasks?: readonly { status: string }[] | null;
  channelsEnabled?: number | null;
  /** The business glossary (Settings › Glossary): tile captions read in the business's words, like the note's text. */
  glossary?: Record<string, string> | null;
  now?: Date;
}

const DAY_MS = 86_400_000;

function countKind(conversions: MetricSources["conversions"], kind: string, days: number, now: Date): number | null {
  if (!conversions) return null;
  const since = now.getTime() - days * DAY_MS;
  return conversions.filter((c) => c.kind === kind && Date.parse(String(c.occurredAt)) >= since).length;
}

/** Months the trailing revenue and MRR cover (BUILD §11.8: "average monthly revenue over the trailing 3 months"). */
export const TRAILING_MONTHS = 3;

/** The `n` full calendar months before `now`'s month ("2026-09" for the one before "2026-10"), UTC like the ledger's month keys. */
export function trailingMonthKeys(now: Date, n = TRAILING_MONTHS): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - i), 1)).toISOString().slice(0, 7));
}

/**
 * Revenue over the trailing three full months, never the current partial month (audit OL-17): the P&L revenue when the
 * page holds it, else the cash inflow of those months. MRR is a third of it, as on Finance.
 */
export function trailingRevenueMinor(sources: Pick<MetricSources, "finance" | "trailingRevenueMinor">, now: Date): number | null {
  if (typeof sources.trailingRevenueMinor === "number") return sources.trailingRevenueMinor;
  const f = sources.finance;
  if (!f) return null;
  const months = new Set(trailingMonthKeys(now));
  return f.revenue.monthly.filter((m) => months.has(m.month)).reduce((sum, m) => sum + monthRevenueMinor(m), 0);
}

/** Plain words for where a figure comes from: never a table or query name (seed and composer sources are keys). */
const SOURCE_WORDS: Record<string, string> = {
  accounts: "Bank accounts",
  bank: "Bank accounts",
  forecasts: "The cash forecast",
  forecast: "The cash forecast",
  conversions: "Signups, activations and payments",
  conversions_30d: "Signups, activations and payments, last 30 days",
  filings: "The filing calendar",
  usage_ledger: "Model and tool usage",
  tasks_by_status: "Team tasks",
  channel_cpa: "Channel spend and customers",
  cash_position: "Bank balances and monthly spending",
  runway_forecast: "The cash forecast",
  roadmap_status: "The roadmap",
  metrics: "Business metrics",
};

/** "usage_ledger" → "Model and tool usage"; free words pass through, keys are spelled out ("journey_daily" → "Journey daily"). */
export function plainSource(source: string | undefined): string | undefined {
  const raw = source?.trim();
  if (!raw) return undefined;
  const known = SOURCE_WORDS[raw.toLowerCase()];
  if (known) return known;
  if (/^[a-z0-9]+(?:[_.][a-z0-9]+)+$/.test(raw)) {
    const words = raw.replace(/[_.]+/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return raw;
}

/** The value inside a free-form metric ("Cash £72,318.22", "Due in 9 days", "Activation 35%", "Customers 1101"). */
const FREE_VALUE = /(?:[£$€¥]\s?|\b[A-Z]{3}\s)?-?\d[\d,]*(?:\.\d+)?(?:\s?%|\s?[kKmMbB]\b)?(?:\s?(?:months?|mo|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|units?|SKUs?)\b)?/;

const FREE_MONEY = /(?:[£$€¥]\s?|\b[A-Z]{3}\s)-?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?/;

export interface FreeMetric {
  label: string;
  value: string | null;
  estimate?: "estimate" | "forecast";
}

/**
 * Splits a free-form metric written by an agent or the seed into its label and its figure, so the tile shows the
 * figure as the figure ("Cash" / "£72,318.22") rather than "—" under a caption carrying the number.
 */
export function parseFreeMetric(raw: string): FreeMetric {
  let text = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  let estimate: FreeMetric["estimate"];
  const kind = /\((estimate|forecast)\)|\b(estimate|forecast)\b$/i.exec(text);
  if (kind) {
    estimate = (kind[1] ?? kind[2])!.toLowerCase() === "forecast" ? "forecast" : "estimate";
    text = text.replace(kind[0], "").trim();
  }
  // Money first ("Revenue 30d £57,552.75" is about the £, not the 30), then any figure.
  const m = FREE_MONEY.exec(text) ?? FREE_VALUE.exec(text);
  const tidy = (s: string) => s.replace(/[\s:·,;—-]+$/g, "").replace(/^[\s:·,;—-]+/g, "").trim();
  if (!m) {
    const label = tidy(text) || raw;
    return { label: label.charAt(0).toUpperCase() + label.slice(1), value: null, estimate };
  }
  const figure = m[0].trim();
  // "1101" → "1,101": figures written without grouping read like ids.
  const value = /^\d{4,}$/.test(figure) ? formatNumber(Number(figure)) : figure;
  const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\b(\d+)d\b/g, "$1 days").replace(/\s+/g, " ");
  const label = tidy(rest) || "Figure";
  return { label: label.charAt(0).toUpperCase() + label.slice(1), value, estimate };
}

const FREE_FAMILY: Array<[RegExp, string]> = [
  [/^cash\b(?!\s*(?:after|flow|out|in)\b)/i, "cash"],
  [/^runway\b/i, "runway"],
  [/^(?:net\s+)?burn\b/i, "net_burn"],
  [/^mrr\b/i, "mrr"],
];

/**
 * The metric key a strip entry resolves to: a catalogue key as is, a free-form "Cash £72,318.22" or "Runway n/a mo
 * (Estimate)" to the live metric of the same name (AC-11.3.6: figures come from the live queries when they exist),
 * anything else to null (the figure is read from the entry itself).
 */
export function metricKey(metric: string): string | null {
  if (Object.hasOwn(SOURCE_FOR_METRIC, metric)) return metric;
  for (const [re, key] of FREE_FAMILY) if (re.test(metric.trim())) return key;
  return null;
}

/**
 * Resolve the Composer's `status_strip` entries (`{ metric, source }`) to MetricTiles. The note never carries the
 * numbers (AC-11.3.6); they come from the live queries the page already holds. A free-form entry whose live metric is
 * not in the catalogue shows the figure it carries, split from its label; one with no figure at all renders "—" with
 * the source as provenance so the strip stays honest. Provenance is in plain words, never a table name. Captions read
 * in the business's words (Settings › Glossary: "Customers this week" → "Clients this week"), as the note's text does.
 */
export function statusStripTiles(strip: unknown, sources: MetricSources): MetricTileProps[] {
  if (!Array.isArray(strip)) return [];
  return statusStripFigures(strip, sources).map((t) => (typeof t.label === "string" ? { ...t, label: applyGlossary(t.label, sources.glossary) } : t));
}

function statusStripFigures(strip: readonly unknown[], sources: MetricSources): MetricTileProps[] {
  const now = sources.now ?? new Date();
  // Money shows only beside finance's figures, in finance's currency (the business's own before a bank is connected).
  const f = sources.finance ?? null;
  const provenance = (m: StripMetricInput, fallback: string) => ({ source: plainSource(m.source) ?? fallback, asOf: f?.cash.asOf ?? undefined });
  return strip
    .filter((m): m is StripMetricInput => !!m && typeof m === "object" && typeof (m as StripMetricInput).metric === "string")
    .slice(0, 4)
    .map((m): MetricTileProps => {
      const key = metricKey(m.metric);
      switch (key) {
        case "cash":
          return { label: "Cash", value: f ? { amountMinor: f.cash.amountMinor, currency: f.cash.currency } : null, provenance: provenance(m, "Bank balances") };
        case "runway": {
          // No figure: the shared runway words (Home, Finance and the note say the same), never a bare "—"; a balance
          // below zero reads "Cash is below zero" with its Estimate tag, never "No limit" (widgets/shared/runway).
          const words = runwayWords(f);
          // plain-allow: the strip's labels are wrapped in a Term where they show (ReadingPane tilesWithTerms, STRIP_TERM_IDS).
          if (words) return { label: "Runway", value: words.value, caption: words.caption, estimate: words.estimate ? "estimate" : undefined, provenance: provenance(m, "Cash ÷ net burn") };
          // plain-allow: the strip's labels are wrapped in a Term where they show (ReadingPane tilesWithTerms, STRIP_TERM_IDS).
          return { label: "Runway", value: runwayFigure(f), format: "decimal", unit: "months", estimate: "estimate", provenance: provenance(m, "Cash ÷ net burn") };
        }
        case "burn":
        case "net_burn":
          // plain-allow: the strip's labels are wrapped in a Term where they show (ReadingPane tilesWithTerms, STRIP_TERM_IDS).
          return { label: "Net burn", value: f ? { amountMinor: f.burn.netBurnMinor, currency: f.cash.currency } : null, estimate: "estimate", provenance: provenance(m, "Trailing 3-month average") };
        case "mrr":
        case "revenue": {
          // The same definitions as Finance: revenue over the trailing 3 full months, MRR a third of it.
          const revenue = trailingRevenueMinor(sources, now);
          const amountMinor = revenue === null ? null : key === "mrr" ? Math.round(revenue / TRAILING_MONTHS) : revenue;
          // plain-allow: the strip's labels are wrapped in a Term where they show (ReadingPane tilesWithTerms, STRIP_TERM_IDS).
          return { label: key === "mrr" ? "MRR" : "Revenue", value: amountMinor === null || !f ? null : { amountMinor, currency: f.cash.currency }, estimate: key === "mrr" ? "estimate" : undefined, caption: key === "mrr" ? "per month" : `trailing ${TRAILING_MONTHS} months`, provenance: provenance(m, "Money received, last 3 full months") };
        }
        case "customers_week":
          return { label: "Customers this week", value: countKind(sources.conversions, "payment", 7, now), format: "integer", provenance: provenance(m, "Payments, last 7 days") };
        case "customers_30d":
          return { label: "Customers, 30 days", value: f?.customers30d ?? countKind(sources.conversions, "payment", 30, now), format: "integer", provenance: provenance(m, "Payments, last 30 days") };
        case "signups_week":
          return { label: "Signups this week", value: countKind(sources.conversions, "signup", 7, now), format: "integer", provenance: provenance(m, "Signups, last 7 days") };
        case "signups_30d":
          return { label: "Signups, 30 days", value: countKind(sources.conversions, "signup", 30, now), format: "integer", provenance: provenance(m, "Signups, last 30 days") };
        case "activations_week":
          return { label: "Activations this week", value: countKind(sources.conversions, "activation", 7, now), format: "integer", provenance: provenance(m, "Activations, last 7 days") };
        case "tasks_running":
          return { label: "Tasks running", value: sources.tasks ? sources.tasks.filter((t) => t.status === "running").length : null, format: "integer", provenance: provenance(m, "Team tasks") };
        case "channels_enabled":
          return { label: "Channels on", value: sources.channelsEnabled ?? null, format: "integer", provenance: provenance(m, "Enabled channels") };
        default: {
          const free = parseFreeMetric(m.metric);
          return { label: free.label, value: free.value, estimate: free.estimate, provenance: provenance(m, "Written by the agent from the note's sources") };
        }
      }
    });
}

// --- plans -----------------------------------------------------------------------------------------------------------

export interface PlanActionLike {
  id?: string;
  type: string;
  params: Record<string, unknown> | null;
  status?: string;
  policyOutcome?: string | null;
  /** What the action produced once it ran (a task's id, a channel's). */
  result?: Record<string, unknown> | null;
}

// The "Here is what will happen" lines live in ./confirmation, so the agent desk (mounted in every business page) can
// use them without shipping the rest of the Inbox's logic.
export { actionCost, confirmationLines, describeAction, planConfirmationLines, totalCost, type ConfirmationLine, type EvaluationLike } from "./confirmation";

export interface FollowUpLink {
  id: string;
  label: string;
  href: string;
}

export interface DepartmentForLinks {
  slug: string;
  moduleKeys: readonly string[];
  tabs: readonly { slug: string; position: number }[];
}

function moduleTab(departments: readonly DepartmentForLinks[], moduleKey: string, tabSlug: string): { slug: string; tab: string } | null {
  const d = departments.find((x) => x.moduleKeys.includes(moduleKey));
  if (!d) return null;
  const tab = d.tabs.find((t) => t.slug === tabSlug) ?? [...d.tabs].sort((a, b) => a.position - b.position)[0];
  return tab ? { slug: d.slug, tab: tab.slug } : null;
}

/** A task on the Plan tab of the department that runs development (`?task=` opens it), or null without one. */
export function taskHref(businessId: string, departments: readonly DepartmentForLinks[], taskId: string): string | null {
  const t = moduleTab(departments, "development", "plan");
  return t ? `${routes.department(businessId, t.slug, t.tab)}?task=${encodeURIComponent(taskId)}` : null;
}

/** The slice of `inbox.get`'s `approval` the reading pane needs (audit FR-01). */
export interface ApprovalLike {
  outcome: "approved" | "rejected" | "expired" | null;
  sessionWaiting: boolean;
  task: { id: string; title: string } | null;
  canAnswer: boolean;
  section: string | null;
  /** A release: the founder was asked to put a finished change live. */
  release?: boolean;
  /** What happened after the approval (the api's `approvalExecution`); null until approved. */
  execution?: { state: "ran" | "waiting" | "failed" | "handed_back"; detail: string | null; at: string | null } | null;
}

export type ApprovalStatusTone = "good" | "warn" | "bad" | "neutral" | "info";

/**
 * Where an agent's request stands, in words: waiting (and what Approve does from here), or how it was answered and what
 * came of it. An approval is never "done" on the answer alone (Nov 1, 2026: four releases were approved and none went
 * live, while the Inbox said done): approved reads as live, waiting for the tests, did not go through, or sent back,
 * from the outcome the api records. The session may still wait for the answer, or it ended while waiting, in which case
 * Approve runs the task again on the next cycle.
 */
export function approvalStatus(a: ApprovalLike): { word: string; tone: ApprovalStatusTone; detail: string } {
  switch (a.outcome) {
    case "approved": {
      const e = a.execution ?? null;
      if (!e) return { word: "Approved", tone: "good", detail: a.release ? "It goes live once the repository's automatic tests pass." : "The call runs once, exactly as asked." };
      switch (e.state) {
        case "ran":
          return { word: a.release ? "Live" : "Done", tone: "good", detail: e.detail ?? (a.release ? "It is live." : "It ran once, as asked.") };
        case "waiting":
          return { word: "Approved, waiting", tone: "info", detail: e.detail ?? "It runs when the agent next works on the task." };
        case "handed_back":
          return { word: "Sent back to the agent", tone: "warn", detail: e.detail ?? "The agent will ask again when it is ready." };
        case "failed":
          return { word: "Didn't go through", tone: "bad", detail: e.detail ?? "The team tries again in its next round of work." };
      }
      return { word: "Approved", tone: "good", detail: "" };
    }
    case "rejected":
      return { word: "Rejected", tone: "bad", detail: a.task ? "Nothing ran. The task waits until you start it again." : "Nothing ran." };
    case "expired":
      return { word: "Expired", tone: "neutral", detail: "Nobody answered in time, so nothing ran." };
    default:
      // A release waits in the background, never in a session: nothing else is held while the founder decides.
      if (a.release) return { word: "Needs your answer", tone: "warn", detail: "Say yes and it goes live once the automatic tests pass. Nothing else waits on this." };
      if (a.sessionWaiting) return { word: "Needs your answer", tone: "warn", detail: "The agent is waiting for your answer. Approve and it carries on." };
      return { word: "Needs your answer", tone: "warn", detail: a.task ? "The agent stopped waiting and freed its place. Approve and the task runs again in the team's next round of work." : "Approve and it runs once, exactly as asked." };
  }
}

/** Why Approve and Reject are not this reader's to press, or null when they are. */
export function approvalLockedReason(a: Pick<ApprovalLike, "canAnswer" | "section">): string | null {
  if (a.canAnswer) return null;
  const section = a.section ? a.section[0]!.toUpperCase() + a.section.slice(1) : "the Inbox";
  return `Answering this needs write access to ${section}. Someone who has it can approve or reject it.`;
}

/**
 * Where the artefacts of a decided plan live (BUILD §11.3 "follow-up Update with links to artefacts"). A task opens
 * Development › Plan (the task list) on that task when the plan made exactly one, never as "the plan" (audit FR-08: the
 * decision's own plan is the Decided panel).
 */
export function followUpLinks(actions: readonly PlanActionLike[], businessId: string, departments: readonly DepartmentForLinks[]): FollowUpLink[] {
  const out: FollowUpLink[] = [];
  const seen = new Set<string>();
  const push = (id: string, label: string, href: string | null) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ id, label, href });
  };
  const taskIds = actions.flatMap((a) => (a.type === "create_task" && typeof a.result?.taskId === "string" ? [a.result.taskId] : []));
  const tasks = actions.filter((a) => a.type === "create_task").length;
  for (const a of actions) {
    const id = a.id ?? `${a.type}-${out.length}`;
    switch (a.type) {
      case "create_task": {
        const t = moduleTab(departments, "development", "plan");
        const list = t ? routes.department(businessId, t.slug, t.tab) : null;
        if (tasks === 1 && taskIds.length === 1) push(id, "Open the task", list ? `${list}?task=${encodeURIComponent(taskIds[0]!)}` : null);
        else push(id, tasks === 1 ? "Open the task list" : "Open the tasks", list);
        break;
      }
      case "enable_channel":
      case "disable_channel":
      case "set_budget": {
        const t = moduleTab(departments, "distribution", "formation");
        push(id, "Open the Board", t ? routes.department(businessId, t.slug, t.tab) : null);
        break;
      }
      case "hire_agent":
      case "train_agent":
      case "set_agent_model": {
        const agentId = a.params && typeof a.params.agent_id === "string" ? (a.params.agent_id as string) : null;
        if (agentId) push(id, "Open the agent", routes.agent(businessId, agentId));
        else {
          const t = moduleTab(departments, "team", "squad");
          push(id, "Open the team", t ? routes.department(businessId, t.slug, t.tab) : null);
        }
        break;
      }
      case "update_spec": {
        const t = moduleTab(departments, "product", "specification");
        // plain-allow: a link to the Specification tab, which defines the word where it opens.
        push(id, "Open the specification", t ? routes.department(businessId, t.slug, t.tab) : null);
        break;
      }
      case "update_roadmap": {
        const t = moduleTab(departments, "product", "roadmap");
        push(id, "Open the roadmap", t ? routes.department(businessId, t.slug, t.tab) : null);
        break;
      }
      case "approve_spend": {
        const t = moduleTab(departments, "finance", "overview");
        push(id, "Open Finance", t ? routes.department(businessId, t.slug, t.tab) : null);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// --- replays -----------------------------------------------------------------------------------------------------------

export interface JourneyRowLike {
  id: string;
  viewedAt?: Date | string | null;
  createdAt?: Date | string;
  conversion: { entityId: string | null; kind: string; occurredAt: Date | string };
}

/** The replay a won-customer item opens: the newest payment journey of one of its entities, else the newest unviewed. */
export function journeyForItem(item: { type: InboxItemType; entityIds: readonly string[]; createdAt: Date | string }, journeys: readonly JourneyRowLike[] | undefined): string | null {
  if (item.type !== "customer_won" || !journeys?.length) return null;
  const byTime = [...journeys].sort((a, b) => Date.parse(String(b.conversion.occurredAt)) - Date.parse(String(a.conversion.occurredAt)));
  const own = byTime.find((j) => j.conversion.entityId && item.entityIds.includes(j.conversion.entityId));
  if (own) return own.id;
  const created = Date.parse(String(item.createdAt));
  const near = byTime.find((j) => j.conversion.kind === "payment" && Math.abs(Date.parse(String(j.conversion.occurredAt)) - created) < DAY_MS);
  return near?.id ?? null;
}

/** Header date: created, plus "decided" when answered. */
export function headerDates(item: { createdAt: Date | string; state: InboxState }, decidedAt: Date | string | null | undefined): { created: Date; decided: Date | null } {
  return { created: new Date(item.createdAt), decided: decidedAt && (item.state === "answered" || item.state === "archived") ? new Date(decidedAt) : null };
}

// --- agents and departments ---------------------------------------------------------------------------------------

export interface DepartmentLike {
  id: string;
  name: string;
  colourToken: string;
  squad: readonly { id: string; name: string; role: string; avatarSeed: string; personaKey?: string | null; status?: string; modelKey?: string }[];
}

export interface AgentIndexEntry {
  id: string;
  name: string;
  role: string;
  seed: string;
  /** `agents.persona_key`: the first name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
  dept: string;
  departmentId: string;
  departmentName: string;
  status?: string;
  modelKey?: string;
}

/** agentId → presentation data, from `department.list` squads (the first department that lists the agent wins). */
export function agentIndex(departments: readonly DepartmentLike[]): Map<string, AgentIndexEntry> {
  const out = new Map<string, AgentIndexEntry>();
  for (const d of departments) {
    for (const a of d.squad) {
      if (out.has(a.id)) continue;
      out.set(a.id, { id: a.id, name: a.name, role: a.role, seed: a.avatarSeed || a.id, personaKey: a.personaKey ?? null, dept: d.colourToken, departmentId: d.id, departmentName: d.name, status: a.status, modelKey: a.modelKey });
    }
  }
  return out;
}

// --- section walls -----------------------------------------------------------------------------------------------------

/**
 * The line under a note's title when the server masked part of it (inbox.get `item.redacted`): the reader has no access
 * to Finance or the CRM, so its figures or customer details read "(amount hidden)" / "a customer". Null when nothing was.
 */
export function hiddenNotice(redacted: readonly string[] | undefined): string | null {
  const finance = redacted?.includes("finance") ?? false;
  const crm = redacted?.includes("crm") ?? false;
  if (finance && crm) return "Figures from Finance and customer details from the CRM are hidden: your access does not include them.";
  if (finance) return "Figures from Finance are hidden: your access does not include Finance.";
  if (crm) return "Customer details from the CRM are hidden: your access does not include the CRM.";
  return null;
}

// --- status strip sources -----------------------------------------------------------------------------------------

export type StripSource = "finance" | "conversions" | "tasks" | "channels";

const SOURCE_FOR_METRIC: Record<string, StripSource> = {
  cash: "finance",
  runway: "finance",
  burn: "finance",
  net_burn: "finance",
  mrr: "finance",
  revenue: "finance",
  customers_30d: "finance",
  customers_week: "conversions",
  signups_week: "conversions",
  signups_30d: "conversions",
  activations_week: "conversions",
  tasks_running: "tasks",
  channels_enabled: "channels",
};

/** Which live queries a note's status strip needs, so the pane fetches only those. */
export function stripSources(strip: unknown): Set<StripSource> {
  const out = new Set<StripSource>();
  if (!Array.isArray(strip)) return out;
  for (const m of strip) {
    const metric = m && typeof m === "object" ? (m as { metric?: unknown }).metric : undefined;
    const key = typeof metric === "string" ? metricKey(metric) : null;
    const src = key ? SOURCE_FOR_METRIC[key] : undefined;
    if (src) out.add(src);
  }
  return out;
}

// --- plans on screen ------------------------------------------------------------------------------------------------

export interface PlanLike {
  status: string;
  /** When the founder confirmed the plan; null while it waits (and for plans that never needed it). */
  confirmedAt?: Date | string | null;
  actions: readonly PlanActionLike[];
}

/**
 * The chip beside an action policy said "ask" for: it waits for the go-ahead until the plan is confirmed, and only then
 * reads as confirmed (audit VOL-X1: never "Confirmed" while the plan still waits). Null for every other action and for
 * one that never ran.
 */
export function askChip(plan: { status: string; confirmedAt?: Date | string | null }, action: Pick<PlanActionLike, "policyOutcome"> & { status?: string }): { word: string; tone: "warn" | "neutral" } | null {
  // An action turned down or skipped never ran: its status says so, no chip.
  if (action.policyOutcome !== "ask" || action.status === "denied" || action.status === "skipped") return null;
  // Still waiting on an approval (a gated call inside the plan) reads as waiting too.
  if (plan.status === "pending_confirmation" || action.status === "awaiting_approval") return { word: "Needs your go-ahead", tone: "warn" };
  return plan.confirmedAt ? { word: "Confirmed", tone: "neutral" } : null;
}

/** inbox.get's `confirmation`: the server's record of a plan waiting for its go-ahead (apps/api `pendingConfirmation`). */
export interface ConfirmationLike {
  planId: string;
  canConfirm: boolean;
  blockedReason: string | null;
}

/**
 * Whether the Decided panel offers "Review what will happen" (audit OL-01, FR-08). It follows the plan's stored status,
 * so it is there after a reload, in another tab or on another device, never only on the page that decided. Before
 * inbox.get has caught up with a decision taken here there is no `confirmation` yet, and the decider may confirm (decide
 * already checked their walls); once it has, it says whether this reader may, and why not.
 */
export function goAheadState(plan: { id: string; status: string } | null | undefined, confirmation: ConfirmationLike | null | undefined): { waiting: boolean; canConfirm: boolean; blockedReason: string | null } {
  if (plan?.status !== "pending_confirmation") return { waiting: false, canConfirm: false, blockedReason: null };
  if (!confirmation || confirmation.planId !== plan.id) return { waiting: true, canConfirm: true, blockedReason: null };
  return { waiting: true, canConfirm: confirmation.canConfirm, blockedReason: confirmation.canConfirm ? null : confirmation.blockedReason };
}

/** The Decided panel's label for the answer: the founder's own, or the Chief of Staff's while they were on vacation. */
export function answerLabel(decisions: readonly { decidedByKind?: string | null; decidedAt: Date | string }[] | undefined): string {
  const latest = [...(decisions ?? [])].sort((a, b) => Date.parse(String(b.decidedAt)) - Date.parse(String(a.decidedAt)))[0];
  // plain-allow: "Chief of Staff" is a Term where the answer shows (ReadingPane's Decided panel).
  return latest?.decidedByKind === "chief_of_staff" ? "Chief of Staff's answer" : "Your answer";
}

/** True when a decide or confirm was turned down because the note was already answered (another tab, another member, a double click). */
export function isAlreadyDecidedMessage(message: string | null | undefined): boolean {
  return /\balready (answered|archived)\b/i.test(message ?? "");
}

/**
 * A plan action's status in the Decided panel's words (UX plan B18): never a raw "awaiting approval". The go-ahead
 * family for anything waiting on the founder, plain words for the rest; a status outside the list is spelled out.
 */
export function actionStatusWord(status: string): string {
  switch (status) {
    case "awaiting_approval":
      return "Waiting for your go-ahead";
    case "pending":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "denied":
      return "Not allowed";
    case "skipped":
      return "Skipped";
    default: {
      const words = status.replace(/_/g, " ").trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Queued";
    }
  }
}

/**
 * One line for the answered strip: "Done · 3 of 3 actions" / "Needs your go-ahead" / "Running · 1 of 3". A plan
 * someone else answered needs their go-ahead, not the viewer's (`decidedBy`: their name, "You" by default).
 */
export function planStatusLine(plan: PlanLike | null | undefined, decidedBy: string = "You"): { word: string; tone: "good" | "warn" | "bad" | "info" | "neutral"; detail: string } | null {
  if (!plan) return null;
  const total = plan.actions.length;
  const done = plan.actions.filter((a) => a.status === "done").length;
  const failed = plan.actions.filter((a) => a.status === "failed" || a.status === "denied").length;
  const of = total ? `${done} of ${total} action${total === 1 ? "" : "s"} done` : "no actions";
  switch (plan.status) {
    case "pending_confirmation":
      return { word: decidedBy === "You" ? "Needs your go-ahead" : `Needs ${decidedBy}'s go-ahead`, tone: "warn", detail: `${total} action${total === 1 ? "" : "s"} planned` };
    case "executing":
      return { word: "Running", tone: "info", detail: of };
    case "done":
      return { word: failed ? "Done with issues" : "Done", tone: failed ? "warn" : "good", detail: failed ? `${of}, ${failed} failed or denied` : of };
    case "failed":
      return { word: "Failed", tone: "bad", detail: of };
    default:
      return { word: actionStatusWord(plan.status), tone: "neutral", detail: of };
  }
}

/** The id of the item from the pathname (`/b/<bid>/inbox/<itemId>`), or null on the list route. */
export function itemIdFromPath(pathname: string | null | undefined): string | null {
  const m = /\/inbox\/([^/?#]+)/.exec(pathname ?? "");
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}
