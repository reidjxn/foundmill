/**
 * Pure Inbox logic (BUILD §11.3, DESIGN §9 Inbox): tabs, row models, J/K navigation, the Refresh debounce gate,
 * decision options → DecisionBar, status-strip metric resolution with provenance, the "Here is what will happen"
 * summary, follow-up links from plan actions, and the replay lookup for won customers.
 */
import type { DecisionAnswer, DecisionOption, MetricTileProps, TabItem } from "@foundmill/dugout";
import type { InboxItemType, InboxState, Money } from "@foundmill/shared";
import { routes } from "@foundmill/widgets";

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
  customer_won: { word: "Customer won", tone: "bad" },
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

export interface InboxRowModel {
  id: string;
  subject: string;
  preview: string;
  createdAt: Date | string;
  /** Red 6 px dot: the item waits for an answer. */
  needsAnswer: boolean;
  /** Gold left edge: a won customer. */
  won: boolean;
  unread: boolean;
  tone: RowTone;
  typeWord: string;
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
    revenue: { monthly: readonly { month: string; inflowMinor: number; netMinor: number }[] };
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

function latestMonthly(f: NonNullable<MetricSources["finance"]>): { month: string; inflowMinor: number; netMinor: number } | undefined {
  return [...f.revenue.monthly].sort((a, b) => (a.month < b.month ? 1 : -1))[0];
}

/**
 * Resolve the Composer's `status_strip` entries (`{ metric, source }`) to MetricTiles. The note never carries the
 * numbers (AC-11.3.6); they come from the live queries the page already holds. Unknown metrics render "—" with the
 * source as provenance so the strip stays honest.
 */
export function statusStripTiles(strip: unknown, sources: MetricSources): MetricTileProps[] {
  if (!Array.isArray(strip)) return [];
  const now = sources.now ?? new Date();
  const f = sources.finance ?? null;
  const currency = f?.cash.currency ?? "EUR";
  const provenance = (m: StripMetricInput, fallback: string, query?: string) => ({ source: m.source || fallback, query, asOf: f?.cash.asOf ?? undefined });
  return strip
    .filter((m): m is StripMetricInput => !!m && typeof m === "object" && typeof (m as StripMetricInput).metric === "string")
    .slice(0, 4)
    .map((m): MetricTileProps => {
      switch (m.metric) {
        case "cash":
          return { label: "Cash", value: f ? { amountMinor: f.cash.amountMinor, currency } : null, provenance: provenance(m, "Bank balances", "cash_position") };
        case "runway":
          return { label: "Runway", value: f?.runway.months ?? null, format: "decimal", unit: "months", estimate: "estimate", provenance: provenance(m, "Cash ÷ net burn", "runway_forecast") };
        case "burn":
        case "net_burn":
          return { label: "Net burn", value: f ? { amountMinor: f.burn.netBurnMinor, currency } : null, estimate: "estimate", provenance: provenance(m, "Trailing 3-month average", "cash_position") };
        case "mrr":
        case "revenue": {
          const latest = f ? latestMonthly(f) : undefined;
          return { label: m.metric === "mrr" ? "MRR" : "Revenue", value: latest ? { amountMinor: latest.inflowMinor, currency } : null, estimate: m.metric === "mrr" ? "estimate" : undefined, caption: latest ? latest.month : undefined, provenance: provenance(m, "Cash basis, latest month", "cash_position") };
        }
        case "customers_week":
          return { label: "Customers this week", value: countKind(sources.conversions, "payment", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days", "conversions_30d") };
        case "customers_30d":
          return { label: "Customers, 30 days", value: f?.customers30d ?? countKind(sources.conversions, "payment", 30, now), format: "integer", provenance: provenance(m, "Conversions, last 30 days", "conversions_30d") };
        case "signups_week":
          return { label: "Signups this week", value: countKind(sources.conversions, "signup", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days", "conversions_30d") };
        case "signups_30d":
          return { label: "Signups, 30 days", value: countKind(sources.conversions, "signup", 30, now), format: "integer", provenance: provenance(m, "Conversions, last 30 days", "conversions_30d") };
        case "activations_week":
          return { label: "Activations this week", value: countKind(sources.conversions, "activation", 7, now), format: "integer", provenance: provenance(m, "Conversions, last 7 days", "conversions_30d") };
        case "tasks_running":
          return { label: "Tasks running", value: sources.tasks ? sources.tasks.filter((t) => t.status === "running").length : null, format: "integer", provenance: provenance(m, "Squad tasks", "tasks_by_status") };
        case "channels_enabled":
          return { label: "Channels on", value: sources.channelsEnabled ?? null, format: "integer", provenance: provenance(m, "Enabled channels", "channel_cpa") };
        default:
          return { label: m.metric.replace(/_/g, " "), value: null, provenance: provenance(m, "Not available in this build") };
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

export interface EvaluationLike {
  action: { type: string; params?: Record<string, unknown> | null };
  outcome: string;
  hardGate?: boolean;
  reasons?: string[];
}

export function describeAction(type: string, p: Record<string, unknown> | null | undefined): string {
  const s = (k: string) => (p && typeof p[k] === "string" ? (p[k] as string) : "");
  switch (type) {
    case "create_task":
      return `Create task: ${s("title") || s("goal") || "new task"}`;
    case "enable_channel":
      return `Enable channel ${s("channel").replace(/_/g, " ")}`;
    case "disable_channel":
      return `Disable channel ${s("channel").replace(/_/g, " ")}`;
    case "set_budget":
      return `Set budget for ${s("channel").replace(/_/g, " ") || s("department") || "the business"}`;
    case "approve_spend":
      return `Approve spend${s("purpose") ? `: ${s("purpose")}` : ""}`;
    case "send_message":
      return `Send a message${s("to") ? ` to ${s("to")}` : ""}`;
    case "schedule_meeting":
      return "Schedule a meeting";
    case "hire_agent":
      return `Hire an agent${s("template") || s("templateKey") ? ` (${s("template") || s("templateKey")})` : ""}`;
    case "train_agent":
      return "Train an agent";
    case "set_agent_model":
      return `Change an agent's model${s("model") || s("modelKey") ? ` to ${s("model") || s("modelKey")}` : ""}`;
    case "update_spec":
      return "Update the specification";
    case "update_roadmap":
      return "Update the roadmap";
    case "create_playbook":
      return "Create a playbook";
    case "request_human_action":
      return `Founder action: ${s("request") || s("original_text") || "needs you"}`;
    case "reply_only":
      return `Reply: ${s("question") || s("text") || "a question back to you"}`;
    default:
      return type.replace(/_/g, " ");
  }
}

export function actionCost(p: Record<string, unknown> | null | undefined, currency: string): Money | null {
  const v = p?.amount_minor ?? p?.amountMinor ?? p?.cost_minor;
  if (typeof v !== "number" || v <= 0) return null;
  const c = typeof p?.currency === "string" ? (p.currency as string) : currency;
  return { amountMinor: v, currency: c };
}

export interface ConfirmationLine {
  label: string;
  outcome: "allow" | "ask" | "deny" | string;
  hardGate: boolean;
  cost: Money | null;
  reasons: string[];
}

/** The lines of "Here is what will happen" (BUILD §11.3): every action with its policy outcome and cost. */
export function confirmationLines(evaluations: readonly EvaluationLike[], currency: string): ConfirmationLine[] {
  return evaluations.map((e) => ({ label: describeAction(e.action.type, e.action.params ?? null), outcome: e.outcome, hardGate: e.hardGate === true || e.action.type === "request_human_action", cost: actionCost(e.action.params ?? null, currency), reasons: e.reasons ?? [] }));
}

export function totalCost(lines: readonly ConfirmationLine[], currency: string): Money | null {
  const sum = lines.reduce((acc, l) => acc + (l.cost?.amountMinor ?? 0), 0);
  return sum > 0 ? { amountMinor: sum, currency } : null;
}

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
          push(id, "Open the squad", t ? routes.department(businessId, t.slug, t.tab) : null);
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
    const src = typeof metric === "string" ? SOURCE_FOR_METRIC[metric] : undefined;
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

/** The id of the item from the pathname (`/b/<bid>/inbox/<itemId>`), or null on the list route. */
export function itemIdFromPath(pathname: string | null | undefined): string | null {
  const m = /\/inbox\/([^/?#]+)/.exec(pathname ?? "");
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}
