/**
 * Pure Inbox logic (BUILD §11.3, DESIGN §9 Inbox): tabs, row models, J/K navigation, the Refresh debounce gate,
 * decision options → DecisionBar, status-strip metric resolution with provenance, the "Here is what will happen"
 * summary, follow-up links from plan actions, and the replay lookup for won customers.
 */
import type { DecisionAnswer, DecisionOption, MetricTileProps, TabItem } from "@foundmill/dugout";
import type { InboxItemType, InboxState, Money } from "@foundmill/shared";
import { monthRevenueMinor } from "@foundmill/widgets/shared/cash";
import { routes } from "@foundmill/widgets/shared/routes";
import { runwayWords } from "@foundmill/widgets/shared/runway";
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

/** Messages is LIVE-only (BUILD §11.3). Badges: Respond carries the count of items waiting for an answer. */
export function inboxTabs(businessId: string, live: boolean, counts: Partial<Record<string, number>> | undefined): TabItem[] {
  return INBOX_TABS.filter((t) => live || t !== "messages").map((t) => ({
    id: t,
    label: INBOX_TAB_LABELS[t],
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

/** First sentence of the note as the preview line (entity markup and markdown stripped). */
export function previewLine(bodyMd: string, max = 120): string {
  const plain = bodyMd
    .replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = plain.search(/[.!?](\s|$)/);
  const line = end > 0 ? plain.slice(0, end + 1) : plain;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The tag a row and the reading pane carry (DIRECTION #8): one vocabulary with Home's preview (widgets/shared/note-tags). */
export type TagTone = NoteTagTone;
export type TagIcon = NoteTagIcon;
export type NoteTag = SharedNoteTag;

/**
 * One tag per row: a won customer reads "Customer" (gold), anything waiting on the founder says "Respond", the rest
 * name their kind ("Milestone", "Update", "Report", "Decided" once a decision is answered).
 */
export function rowTag(item: Pick<InboxRowInput, "type" | "state" | "blocksContinue">): NoteTag {
  return noteRowTag(item);
}

/** The reading pane's type tag: the same vocabulary, a little fuller ("Needs your call", "Customer won"). */
export function headerTag(type: InboxItemType, answered: boolean, blocksContinue: boolean): NoteTag {
  if (type === "customer_won") return { word: "Customer won", tone: "gold", icon: "win" };
  if (!answered && (type === "decision" || blocksContinue)) return { word: "Needs your call", tone: "bad", icon: "respond" };
  return NOTE_TYPE_TAGS[type];
}

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
    needsAnswer: !answered && (item.blocksContinue || item.type === "decision" || item.type === "customer_won"),
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
      return { id: o.id as string, label: o.label as string, recommended: o.recommended === true, consequence: typeof o.consequence === "string" ? o.consequence : undefined, cost, reversible: typeof o.reversible === "boolean" ? o.reversible : undefined };
    });
}

export function freeTextAllowed(decision: unknown): boolean {
  const v = (decision as { free_text?: unknown } | null | undefined)?.free_text;
  return v !== false;
}

/** "Expires in 5 days", "Expires today", "Expires tomorrow": the deadline under "Your call"; null without one or once expired. */
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

export function decisionExpired(decision: unknown, now = new Date()): boolean {
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
  /** Conversions in the ribbon window (last 30 days). */
  conversions?: readonly { kind: string; occurredAt: Date | string }[] | null;
  tasks?: readonly { status: string }[] | null;
  channelsEnabled?: number | null;
  now?: Date;
}

const DAY_MS = 86_400_000;

function countKind(conversions: MetricSources["conversions"], kind: string, days: number, now: Date): number | null {
  if (!conversions) return null;
  const since = now.getTime() - days * DAY_MS;
  return conversions.filter((c) => c.kind === kind && Date.parse(String(c.occurredAt)) >= since).length;
}

function latestMonthly(f: NonNullable<MetricSources["finance"]>): NonNullable<MetricSources["finance"]>["revenue"]["monthly"][number] | undefined {
  return [...f.revenue.monthly].sort((a, b) => (a.month < b.month ? 1 : -1))[0];
}

/** Plain words for where a figure comes from: never a table or query name (seed and composer sources are keys). */
const SOURCE_WORDS: Record<string, string> = {
  accounts: "Bank accounts",
  bank: "Bank accounts",
  forecasts: "The cash forecast",
  forecast: "The cash forecast",
  conversions: "Customer conversions",
  conversions_30d: "Customer conversions, last 30 days",
  filings: "The filing calendar",
  usage_ledger: "Model and tool usage",
  tasks_by_status: "Team tasks",
  channel_cpa: "Channel spend and customers",
  cash_position: "Bank balances and burn",
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
 * the source as provenance so the strip stays honest. Provenance is in plain words, never a table name.
 */
export function statusStripTiles(strip: unknown, sources: MetricSources): MetricTileProps[] {
  if (!Array.isArray(strip)) return [];
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
          // No figure: the shared runway words (Home, Finance and the note say the same), never a bare "—".
          const words = runwayWords(f);
          if (words) return { label: "Runway", value: words.value, caption: words.caption, provenance: provenance(m, "Cash ÷ net burn") };
          return { label: "Runway", value: f?.runway.months ?? null, format: "decimal", unit: "months", estimate: "estimate", provenance: provenance(m, "Cash ÷ net burn") };
        }
        case "burn":
        case "net_burn":
          return { label: "Net burn", value: f ? { amountMinor: f.burn.netBurnMinor, currency: f.cash.currency } : null, estimate: "estimate", provenance: provenance(m, "Trailing 3-month average") };
        case "mrr":
        case "revenue": {
          const latest = f ? latestMonthly(f) : undefined;
          return { label: key === "mrr" ? "MRR" : "Revenue", value: latest ? { amountMinor: monthRevenueMinor(latest), currency: f!.cash.currency } : null, estimate: key === "mrr" ? "estimate" : undefined, caption: latest ? latest.month : undefined, provenance: provenance(m, "Cash basis, latest month") };
        }
        case "customers_week":
          return { label: "Customers this week", value: countKind(sources.conversions, "payment", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days") };
        case "customers_30d":
          return { label: "Customers, 30 days", value: f?.customers30d ?? countKind(sources.conversions, "payment", 30, now), format: "integer", provenance: provenance(m, "Conversions, last 30 days") };
        case "signups_week":
          return { label: "Signups this week", value: countKind(sources.conversions, "signup", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days") };
        case "signups_30d":
          return { label: "Signups, 30 days", value: countKind(sources.conversions, "signup", 30, now), format: "integer", provenance: provenance(m, "Conversions, last 30 days") };
        case "activations_week":
          return { label: "Activations this week", value: countKind(sources.conversions, "activation", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days") };
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
}

// The "Here is what will happen" lines live in ./confirmation, so the agent desk (mounted in every business page) can
// use them without shipping the rest of the Inbox's logic.
export { actionCost, confirmationLines, describeAction, totalCost, type ConfirmationLine, type EvaluationLike } from "./confirmation";

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
}

/**
 * Where an agent's request stands, in words: waiting (and what Approve does from here), or how it was answered. The
 * session may still wait for the answer, or it ended while waiting, in which case Approve runs the task again on the
 * next cycle.
 */
export function approvalStatus(a: ApprovalLike): { word: string; tone: "good" | "warn" | "bad" | "neutral"; detail: string } {
  switch (a.outcome) {
    case "approved":
      return { word: "Approved", tone: "good", detail: "The call runs once, exactly as asked." };
    case "rejected":
      return { word: "Rejected", tone: "bad", detail: a.task ? "Nothing ran. The task stays blocked until you start it again." : "Nothing ran." };
    case "expired":
      return { word: "Expired", tone: "neutral", detail: "Nobody answered in time, so nothing ran." };
    default:
      if (a.sessionWaiting) return { word: "Waiting for you", tone: "warn", detail: "The agent's session is waiting for your answer. Approve and it carries on." };
      return { word: "Waiting for you", tone: "warn", detail: a.task ? "The session stopped waiting and freed its place. Approve and the task runs again on the next cycle." : "Approve and it runs once, exactly as asked." };
  }
}

/** Why Approve and Reject are not this reader's to press, or null when they are. */
export function approvalLockedReason(a: Pick<ApprovalLike, "canAnswer" | "section">): string | null {
  if (a.canAnswer) return null;
  const section = a.section ? a.section[0]!.toUpperCase() + a.section.slice(1) : "the Inbox";
  return `Answering this needs write access to ${section}. Someone who has it can approve or reject it.`;
}

/** Where the artefacts of a decided plan live (BUILD §11.3 "follow-up Update with links to artefacts"). */
export function followUpLinks(actions: readonly PlanActionLike[], businessId: string, departments: readonly DepartmentForLinks[]): FollowUpLink[] {
  const out: FollowUpLink[] = [];
  const seen = new Set<string>();
  const push = (id: string, label: string, href: string | null) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ id, label, href });
  };
  for (const a of actions) {
    const id = a.id ?? `${a.type}-${out.length}`;
    switch (a.type) {
      case "create_task": {
        const t = moduleTab(departments, "development", "plan");
        push(id, "Open the plan", t ? routes.department(businessId, t.slug, t.tab) : null);
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
  squad: readonly { id: string; name: string; role: string; avatarSeed: string; status?: string; modelKey?: string }[];
}

export interface AgentIndexEntry {
  id: string;
  name: string;
  role: string;
  seed: string;
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
      out.set(a.id, { id: a.id, name: a.name, role: a.role, seed: a.avatarSeed || a.id, dept: d.colourToken, departmentId: d.id, departmentName: d.name, status: a.status, modelKey: a.modelKey });
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
  actions: readonly PlanActionLike[];
}

/** One line for the answered strip: "Done · 3 of 3 actions" / "Awaiting your confirmation" / "Running · 1 of 3". */
export function planStatusLine(plan: PlanLike | null | undefined): { word: string; tone: "good" | "warn" | "bad" | "info" | "neutral"; detail: string } | null {
  if (!plan) return null;
  const total = plan.actions.length;
  const done = plan.actions.filter((a) => a.status === "done").length;
  const failed = plan.actions.filter((a) => a.status === "failed" || a.status === "denied").length;
  const of = total ? `${done} of ${total} action${total === 1 ? "" : "s"} done` : "no actions";
  switch (plan.status) {
    case "pending_confirmation":
      return { word: "Awaiting your confirmation", tone: "warn", detail: `${total} action${total === 1 ? "" : "s"} planned` };
    case "executing":
      return { word: "Running", tone: "info", detail: of };
    case "done":
      return { word: failed ? "Done with issues" : "Done", tone: failed ? "warn" : "good", detail: failed ? `${of}, ${failed} failed or denied` : of };
    case "failed":
      return { word: "Failed", tone: "bad", detail: of };
    default:
      return { word: plan.status.replace(/_/g, " "), tone: "neutral", detail: of };
  }
}

/**
 * The chip beside an action the policy left to the founder (`ask`): "Needs your go-ahead" while the plan awaits
 * confirmation or the action still waits on an approval, "Confirmed by you" only after that; none for other actions
 * and for one that never ran (turned down or skipped: its status says so).
 */
export function askedActionChip(plan: Pick<PlanLike, "status">, action: Pick<PlanActionLike, "status" | "policyOutcome">): string | null {
  if (action.policyOutcome !== "ask" || action.status === "denied" || action.status === "skipped") return null;
  return plan.status === "pending_confirmation" || action.status === "awaiting_approval" ? "Needs your go-ahead" : "Confirmed by you";
}

/** The id of the item from the pathname (`/b/<bid>/inbox/<itemId>`), or null on the list route. */
export function itemIdFromPath(pathname: string | null | undefined): string | null {
  const m = /\/inbox\/([^/?#]+)/.exec(pathname ?? "");
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}
