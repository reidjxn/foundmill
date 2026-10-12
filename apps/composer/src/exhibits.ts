/**
 * Named queries — the only exhibits an inbox note may reference (BUILD §11.3 "exhibit (chart from a named query …)",
 * AC-11.3.6 "Charts in notes only reference named queries; the model never writes chart numbers").
 *
 * A named query is `named_query_id → repository call returning chart-ready data`. The Composer hands the model only
 * the catalogue (id, title, kind, what it shows); the model picks a `spec_ref`; the Inbox renders the exhibit by running
 * the query again at view time, so every number on screen comes from the database and none from the model.
 *
 * Every derived number is labelled: cash, CPA and runway are "Estimate" (cash basis, list prices, no FX); forecast
 * series are "Forecast" (BUILD §2.1 rule 6, CLAUDE.md "Label every non-real number").
 */
import { repos, type Executor } from "@foundmill/db";
import { CHANNEL_META, type ExhibitKind } from "@foundmill/shared";
import { estimateRunwayMonths } from "./metrics";

export const EXHIBIT_LABELS = ["Estimate", "Forecast"] as const;
export type ExhibitLabel = (typeof EXHIBIT_LABELS)[number];

/** Chart-ready payload every named query returns. `series` for charts, `columns` + `rows` for tables. */
export const NAMED_QUERY_IDS = ["tasks_by_status", "conversions_30d", "channel_cpa", "cash_position", "runway_forecast", "roadmap_status"] as const;
export type NamedQueryId = (typeof NAMED_QUERY_IDS)[number];

export interface ExhibitData {
  id: NamedQueryId;
  kind: Exclude<ExhibitKind, "none">;
  title: string;
  /** "Estimate" / "Forecast" when any value is derived rather than a ledger fact; null when every value is a count of real rows. */
  label: ExhibitLabel | null;
  /** Provenance shown on hover (BUILD §11.3 status strip / exhibit provenance). */
  source: string;
  computedAt: string;
  currency?: string;
  columns?: readonly { key: string; label: string; unit?: "minor" | "count" | "months" | "day" | "text" | "percent" }[];
  rows?: Record<string, string | number | null>[];
  series?: { key: string; label: string; points: { x: string; y: number | null }[] }[];
}

export interface NamedQuery {
  id: NamedQueryId;
  title: string;
  kind: Exclude<ExhibitKind, "none">;
  /** One line for the model: what the exhibit shows (no numbers). */
  description: string;
  run(db: Executor, businessId: string, now?: Date): Promise<ExhibitData>;
}

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (now: Date, n: number): Date => new Date(now.getTime() - n * DAY_MS);

export const NAMED_QUERIES: Readonly<Record<NamedQueryId, NamedQuery>> = {
  tasks_by_status: {
    id: "tasks_by_status",
    title: "Tasks by status",
    kind: "table",
    description: "Count of team tasks in each status (planned, running, blocked, review, done…).",
    async run(db, businessId, now = new Date()) {
      const counts = await repos.tasks.countByStatus(db, businessId);
      return {
        id: "tasks_by_status",
        kind: "table",
        title: "Tasks by status",
        label: null,
        source: "tasks",
        computedAt: now.toISOString(),
        columns: [
          { key: "status", label: "Status", unit: "text" },
          { key: "count", label: "Tasks", unit: "count" },
        ],
        rows: Object.entries(counts).map(([status, count]) => ({ status, count })),
      };
    },
  },
  conversions_30d: {
    id: "conversions_30d",
    title: "Conversions, last 30 days",
    kind: "chart",
    description: "Daily signups, activations and payments over the last thirty days.",
    async run(db, businessId, now = new Date()) {
      const from = daysAgo(now, 30);
      // Conversions that won a customer: a renewal or a repeat order is revenue, not a conversion (same as the Ribbon).
      const page = await repos.journeys.listConversions(db, businessId, { from, to: now, firstPayment: true, limit: 500 });
      const days = Array.from({ length: 30 }, (_, i) => dayKey(daysAgo(now, 29 - i)));
      const buckets: Record<"signup" | "activation" | "payment", Map<string, number>> = {
        signup: new Map(days.map((d) => [d, 0])),
        activation: new Map(days.map((d) => [d, 0])),
        payment: new Map(days.map((d) => [d, 0])),
      };
      for (const c of page.items) {
        const key = dayKey(c.occurredAt);
        const bucket = buckets[c.kind];
        if (bucket.has(key)) bucket.set(key, (bucket.get(key) ?? 0) + 1);
      }
      return {
        id: "conversions_30d",
        kind: "chart",
        title: "Conversions, last 30 days",
        label: null,
        source: "conversions",
        computedAt: now.toISOString(),
        series: (["signup", "activation", "payment"] as const).map((kind) => ({
          key: kind,
          label: kind === "signup" ? "Signups" : kind === "activation" ? "Activations" : "Payments",
          points: days.map((d) => ({ x: d, y: buckets[kind].get(d) ?? 0 })),
        })),
      };
    },
  },
  channel_cpa: {
    id: "channel_cpa",
    title: "Cost per customer by channel",
    kind: "chart",
    description: "Spend divided by customers per channel for the last seven days against the seven days before.",
    async run(db, businessId, now = new Date()) {
      const [recent, previous] = await Promise.all([
        repos.channels.metricsSummary(db, businessId, { from: dayKey(daysAgo(now, 6)), to: dayKey(now) }),
        repos.channels.metricsSummary(db, businessId, { from: dayKey(daysAgo(now, 13)), to: dayKey(daysAgo(now, 7)) }),
      ]);
      const prevByKey = new Map(previous.channels.map((c) => [c.channelKey, c]));
      const keys = [...new Set([...recent.channels.map((c) => c.channelKey), ...previous.channels.map((c) => c.channelKey)])];
      return {
        id: "channel_cpa",
        kind: "chart",
        title: "Cost per customer by channel",
        label: "Estimate",
        source: "channel_metrics",
        computedAt: now.toISOString(),
        series: [
          { key: "last_7d", label: "Last 7 days", points: keys.map((k) => ({ x: CHANNEL_META[k].label, y: recent.channels.find((c) => c.channelKey === k)?.cpaMinor ?? null })) },
          { key: "previous_7d", label: "Previous 7 days", points: keys.map((k) => ({ x: CHANNEL_META[k].label, y: prevByKey.get(k)?.cpaMinor ?? null })) },
        ],
      };
    },
  },
  cash_position: {
    id: "cash_position",
    title: "Cash position",
    kind: "table",
    description: "Cash in bank per currency with trailing net burn and the runway estimate.",
    async run(db, businessId, now = new Date()) {
      const [cash, burn] = await Promise.all([repos.finance.cashPosition(db, businessId), repos.finance.netBurn(db, businessId, { asOf: now })]);
      const rows: Record<string, string | number | null>[] = cash.byCurrency.map((c) => ({
        currency: c.currency,
        balance_minor: c.balanceMinor,
        accounts: c.accounts,
        net_burn_monthly_minor: burn.netBurnMinor,
        runway_months: estimateRunwayMonths(c.balanceMinor, burn.netBurnMinor),
      }));
      return {
        id: "cash_position",
        kind: "table",
        title: "Cash position",
        label: "Estimate",
        source: "accounts, transactions",
        computedAt: now.toISOString(),
        columns: [
          { key: "currency", label: "Currency", unit: "text" },
          { key: "balance_minor", label: "Cash in bank", unit: "minor" },
          { key: "accounts", label: "Accounts", unit: "count" },
          { key: "net_burn_monthly_minor", label: "Net burn / month", unit: "minor" },
          { key: "runway_months", label: "Runway (months)", unit: "months" },
        ],
        rows,
      };
    },
  },
  runway_forecast: {
    id: "runway_forecast",
    title: "Runway forecast",
    kind: "chart",
    description: "Base, upside and downside cash forecast series from the latest Finance forecast, when one exists.",
    async run(db, businessId, now = new Date()) {
      const latest = await repos.finance.latestForecasts(db, businessId);
      const series = (["base", "upside", "downside"] as const)
        .filter((s) => latest[s])
        .map((s) => ({
          key: s,
          label: s.charAt(0).toUpperCase() + s.slice(1),
          points: (latest[s]!.series as unknown[])
            .map((p, i) => {
              const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
              const x = typeof r.day === "string" ? r.day : typeof r.month === "string" ? r.month : typeof r.x === "string" ? r.x : String(i);
              const yRaw = r.cashMinor ?? r.cash_minor ?? r.y ?? r.value;
              return { x, y: typeof yRaw === "number" && Number.isFinite(yRaw) ? yRaw : null };
            }),
        }));
      return { id: "runway_forecast", kind: "chart", title: "Runway forecast", label: "Forecast", source: "forecasts", computedAt: now.toISOString(), series };
    },
  },
  roadmap_status: {
    id: "roadmap_status",
    title: "Roadmap by horizon",
    kind: "table",
    description: "Roadmap items grouped by horizon with status, target end date and whether the date has slipped.",
    async run(db, businessId, now = new Date()) {
      const items = await repos.product.listRoadmap(db, businessId);
      const today = dayKey(now);
      return {
        id: "roadmap_status",
        kind: "table",
        title: "Roadmap by horizon",
        label: null,
        source: "roadmap_items",
        computedAt: now.toISOString(),
        columns: [
          { key: "title", label: "Item", unit: "text" },
          { key: "horizon", label: "Horizon", unit: "text" },
          { key: "status", label: "Status", unit: "text" },
          { key: "target_end", label: "Target end", unit: "day" },
          { key: "slipped", label: "Slipped", unit: "text" },
        ],
        rows: items.map((i) => ({ title: i.title, horizon: i.horizon, status: i.status, target_end: i.targetEnd, slipped: i.targetEnd && i.targetEnd < today && i.status !== "done" ? "yes" : "no" })),
      };
    },
  },
};

export function isNamedQueryId(id: unknown): id is NamedQueryId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(NAMED_QUERIES, id);
}

export function getNamedQuery(id: string): NamedQuery | null {
  return isNamedQueryId(id) ? NAMED_QUERIES[id] : null;
}

/** The catalogue as handed to the model (id, title, kind, description — never data). */
export function namedQueryCatalogue(): { id: NamedQueryId; title: string; kind: Exclude<ExhibitKind, "none">; description: string }[] {
  return NAMED_QUERY_IDS.map((id) => {
    const q = NAMED_QUERIES[id];
    return { id, title: q.title, kind: q.kind, description: q.description };
  });
}

/** Runs a named query for a business; unknown ids return null (the caller answers 404). */
export async function runNamedQuery(db: Executor, businessId: string, id: string, now = new Date()): Promise<ExhibitData | null> {
  const q = getNamedQuery(id);
  return q ? q.run(db, businessId, now) : null;
}

/**
 * Coerces a model-chosen exhibit to the registry: an unknown `spec_ref` or a kind that does not match the query's kind
 * becomes `none`, so nothing outside the registry ever reaches the Inbox (AC-11.3.6).
 */
export function sanitizeExhibit(exhibit: { kind: ExhibitKind; spec_ref: string | null } | null | undefined): { kind: ExhibitKind; spec_ref: string | null } {
  if (!exhibit || exhibit.kind === "none" || !exhibit.spec_ref) return { kind: "none", spec_ref: null };
  const q = getNamedQuery(exhibit.spec_ref);
  if (!q) return { kind: "none", spec_ref: null };
  return { kind: q.kind, spec_ref: q.id };
}
