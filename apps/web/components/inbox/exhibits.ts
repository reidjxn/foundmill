/**
 * Exhibits (BUILD §11.3 "exhibit (chart from a named query, SVG diagram, entity card, mini table, diff preview,
 * agent progress tile)", AC-11.3.6). An inbox item carries `exhibit: { kind, spec_ref }` where `spec_ref` is a named
 * query id; the API has no procedure that runs a named query for the web yet (see docs/PROGRESS.md), so each named
 * query maps here to the tRPC query that already holds the same rows and a pure transform into the composer's
 * `ExhibitData` shape (columns/rows/series + label + source). Renderers in Exhibit.tsx only look at that shape.
 */
import type { ExhibitKind } from "@foundmill/shared";

export const NAMED_QUERY_IDS = ["tasks_by_status", "conversions_30d", "channel_cpa", "cash_position", "runway_forecast", "roadmap_status"] as const;
export type NamedQueryId = (typeof NAMED_QUERY_IDS)[number];

export type ExhibitLabel = "Estimate" | "Forecast";
export type ColumnUnit = "minor" | "count" | "months" | "day" | "text" | "percent";

export interface ExhibitColumn {
  key: string;
  label: string;
  unit?: ColumnUnit;
}

export interface ExhibitSeries {
  key: string;
  label: string;
  points: { x: string; y: number | null }[];
}

export interface ExhibitData {
  id: string;
  title: string;
  label: ExhibitLabel | null;
  source: string;
  currency?: string;
  columns?: readonly ExhibitColumn[];
  rows?: Record<string, string | number | null>[];
  series?: ExhibitSeries[];
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isNamedQueryId = (v: unknown): v is NamedQueryId => typeof v === "string" && (NAMED_QUERY_IDS as readonly string[]).includes(v);

export interface ExhibitRef {
  kind: ExhibitKind;
  specRef: string | null;
}

/** Normalise whatever the row holds (`{ kind, spec_ref }`, legacy `{ kind, specRef }`, garbage) into a reference. */
export function readExhibit(raw: unknown): ExhibitRef {
  if (!raw || typeof raw !== "object") return { kind: "none", specRef: null };
  const o = raw as { kind?: unknown; spec_ref?: unknown; specRef?: unknown };
  const kind = typeof o.kind === "string" ? (o.kind as ExhibitKind) : "none";
  const ref = typeof o.spec_ref === "string" ? o.spec_ref : typeof o.specRef === "string" ? o.specRef : null;
  return { kind, specRef: ref };
}

/** Which tRPC query (dotted path + input) feeds a named query. The page merges `businessId` itself. */
export type ExhibitSource = { path: "dev.tasks.list"; input: { limit: number } } | { path: "journey.ribbon"; input: { from: string; to: string } } | { path: "distribution.channels.list"; input: Record<string, never> } | { path: "finance.overview"; input: Record<string, never> } | { path: "product.roadmap.list"; input: Record<string, never> };

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export function sourceFor(id: NamedQueryId, now = new Date()): ExhibitSource {
  switch (id) {
    case "tasks_by_status":
      return { path: "dev.tasks.list", input: { limit: 500 } };
    case "conversions_30d":
      return { path: "journey.ribbon", input: { from: dayKey(new Date(now.getTime() - 30 * DAY_MS)), to: dayKey(now) } };
    case "channel_cpa":
      return { path: "distribution.channels.list", input: {} };
    case "cash_position":
    case "runway_forecast":
      return { path: "finance.overview", input: {} };
    case "roadmap_status":
      return { path: "product.roadmap.list", input: {} };
  }
}

export const EXHIBIT_TITLES: Record<NamedQueryId, string> = {
  tasks_by_status: "Tasks by status",
  conversions_30d: "Conversions, last 30 days",
  channel_cpa: "Cost per customer by channel",
  cash_position: "Cash position",
  runway_forecast: "Runway forecast",
  roadmap_status: "Roadmap status",
};

// --- transforms -------------------------------------------------------------------------------------------------------

const TASK_STATUS_ORDER = ["planned", "queued", "running", "blocked", "waiting_approval", "review", "done", "failed", "stopped", "paused"] as const;

export function tasksByStatus(input: { items: readonly { status: string }[] } | undefined): ExhibitData {
  const counts = new Map<string, number>();
  for (const t of input?.items ?? []) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  const order = [...TASK_STATUS_ORDER.filter((s) => counts.has(s)), ...[...counts.keys()].filter((s) => !(TASK_STATUS_ORDER as readonly string[]).includes(s))];
  return {
    id: "tasks_by_status",
    title: EXHIBIT_TITLES.tasks_by_status,
    label: null,
    source: "dev.tasks.list, counted by status",
    columns: [
      { key: "status", label: "Status", unit: "text" },
      { key: "count", label: "Tasks", unit: "count" },
    ],
    rows: order.map((s) => ({ status: s.replace(/_/g, " "), count: counts.get(s) ?? 0 })),
  };
}

export interface RibbonLike {
  rows: readonly { day: string; departmentId: string | null; signups: number; activations: number; payments: number }[];
  conversions: readonly { kind: string; occurredAt: Date | string }[];
}

/** One point per day for signups, activations and payments: business-wide rows when present, else per-day sums. */
export function conversions30d(input: RibbonLike | undefined, from: string, to: string): ExhibitData {
  const perDay = new Map<string, { signups: number; activations: number; payments: number }>();
  const wide = (input?.rows ?? []).filter((r) => r.departmentId === null);
  const rows = wide.length ? wide : (input?.rows ?? []);
  for (const r of rows) {
    const cur = perDay.get(r.day) ?? { signups: 0, activations: 0, payments: 0 };
    perDay.set(r.day, { signups: cur.signups + r.signups, activations: cur.activations + r.activations, payments: cur.payments + r.payments });
  }
  if (perDay.size === 0 && input?.conversions?.length) {
    for (const c of input.conversions) {
      const day = String(c.occurredAt).slice(0, 10);
      const cur = perDay.get(day) ?? { signups: 0, activations: 0, payments: 0 };
      if (c.kind === "signup") cur.signups += 1;
      else if (c.kind === "activation") cur.activations += 1;
      else if (c.kind === "payment") cur.payments += 1;
      perDay.set(day, cur);
    }
  }
  const days: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) days.push(dayKey(new Date(t)));
  const series = (key: "signups" | "activations" | "payments", label: string): ExhibitSeries => ({ key, label, points: days.map((d) => ({ x: d, y: perDay.get(d)?.[key] ?? 0 })) });
  return {
    id: "conversions_30d",
    title: EXHIBIT_TITLES.conversions_30d,
    label: null,
    source: "journey_daily (business-wide rows), one point per day",
    columns: [
      { key: "stage", label: "Stage", unit: "text" },
      { key: "count", label: "Count", unit: "count" },
    ],
    rows: (["signups", "activations", "payments"] as const).map((k) => ({ stage: k, count: [...perDay.values()].reduce((s, v) => s + v[k], 0) })),
    series: [series("signups", "Signups"), series("activations", "Activations"), series("payments", "Payments")],
  };
}

export interface ChannelsLike {
  channels: readonly { channelKey: string; enabled: boolean; currency?: string; meta?: { label: string } | null; form: { spendMinor: number; customers: number } | null }[];
}

export function channelCpa(input: ChannelsLike | undefined, currency: string): ExhibitData {
  const rows = (input?.channels ?? [])
    .filter((c) => c.enabled || (c.form && c.form.spendMinor > 0))
    .map((c) => {
      const spend = c.form?.spendMinor ?? 0;
      const customers = c.form?.customers ?? 0;
      return { channel: c.meta?.label ?? c.channelKey.replace(/_/g, " "), spend_minor: spend, customers, cpa_minor: customers > 0 ? Math.round(spend / customers) : null };
    })
    .sort((a, b) => (a.cpa_minor ?? Number.POSITIVE_INFINITY) - (b.cpa_minor ?? Number.POSITIVE_INFINITY));
  return {
    id: "channel_cpa",
    title: EXHIBIT_TITLES.channel_cpa,
    label: "Estimate",
    source: "channel_metrics, last 35 days: spend ÷ customers",
    currency: input?.channels[0]?.currency ?? currency,
    columns: [
      { key: "channel", label: "Channel", unit: "text" },
      { key: "spend_minor", label: "Spend", unit: "minor" },
      { key: "customers", label: "Customers", unit: "count" },
      { key: "cpa_minor", label: "Cost per customer", unit: "minor" },
    ],
    rows,
  };
}

export interface FinanceLike {
  cash: { amountMinor: number; currency: string; accounts?: number };
  burn: { netBurnMinor: number; grossBurnMinor: number };
  runway: { months: number | null };
  forecasts?: Partial<Record<string, { scenario: string; currency: string; series: unknown[] } | null>>;
}

export function cashPosition(input: FinanceLike | undefined): ExhibitData {
  const currency = input?.cash.currency ?? "EUR";
  return {
    id: "cash_position",
    title: EXHIBIT_TITLES.cash_position,
    label: "Estimate",
    source: "Bank balances and the trailing 3-month burn (financing excluded)",
    currency,
    columns: [
      { key: "metric", label: "Metric", unit: "text" },
      { key: "value", label: "Value", unit: "text" },
    ],
    rows: input
      ? [
          { metric: "Cash in bank", value: input.cash.amountMinor, unit: "minor" },
          { metric: "Gross burn / month", value: input.burn.grossBurnMinor, unit: "minor" },
          { metric: "Net burn / month", value: input.burn.netBurnMinor, unit: "minor" },
          { metric: "Runway (months)", value: input.runway.months, unit: "months" },
        ]
      : [],
  };
}

function forecastPoints(series: unknown[] | undefined): { x: string; y: number | null }[] {
  if (!Array.isArray(series)) return [];
  return series
    .map((p) => {
      const o = (p ?? {}) as { month?: unknown; day?: unknown; cashMinor?: unknown; baseMinor?: unknown; revenueMinor?: unknown };
      const x = typeof o.month === "string" ? o.month : typeof o.day === "string" ? o.day : null;
      const y = typeof o.cashMinor === "number" ? o.cashMinor : typeof o.baseMinor === "number" ? o.baseMinor : typeof o.revenueMinor === "number" ? o.revenueMinor : null;
      return x ? { x, y } : null;
    })
    .filter((p): p is { x: string; y: number | null } => p !== null);
}

export function runwayForecast(input: FinanceLike | undefined): ExhibitData {
  const currency = input?.cash.currency ?? "EUR";
  const scenarios = ["base", "upside", "downside"] as const;
  const series = scenarios
    .map((s) => {
      const f = input?.forecasts?.[s];
      return f ? { key: s, label: s.charAt(0).toUpperCase() + s.slice(1), points: forecastPoints(f.series) } : null;
    })
    .filter((s): s is ExhibitSeries => s !== null && s.points.length > 0);
  return { id: "runway_forecast", title: EXHIBIT_TITLES.runway_forecast, label: "Forecast", source: "Driver-based forecast (base / upside / downside)", currency, series };
}

export interface RoadmapLike {
  items: readonly { horizon: string; status: string; tasks: readonly { status: string }[] }[];
}

export function roadmapStatus(input: RoadmapLike | undefined): ExhibitData {
  const horizons = ["now", "next", "later"] as const;
  const rows = horizons.map((h) => {
    const items = (input?.items ?? []).filter((i) => i.horizon === h);
    const done = items.filter((i) => i.status === "done").length;
    const tasks = items.reduce((s, i) => s + i.tasks.length, 0);
    const tasksDone = items.reduce((s, i) => s + i.tasks.filter((t) => t.status === "done" || t.status === "merged").length, 0);
    return { horizon: h, items: items.length, done, tasks, tasks_done: tasksDone };
  });
  return {
    id: "roadmap_status",
    title: EXHIBIT_TITLES.roadmap_status,
    label: null,
    source: "roadmap_items and their linked tasks",
    columns: [
      { key: "horizon", label: "Horizon", unit: "text" },
      { key: "items", label: "Items", unit: "count" },
      { key: "done", label: "Done", unit: "count" },
      { key: "tasks", label: "Tasks", unit: "count" },
      { key: "tasks_done", label: "Tasks done", unit: "count" },
    ],
    rows,
  };
}

/** Run the transform for a named query over the raw query result. */
export function transform(id: NamedQueryId, raw: unknown, ctx: { currency: string; from?: string; to?: string }): ExhibitData {
  switch (id) {
    case "tasks_by_status":
      return tasksByStatus(raw as Parameters<typeof tasksByStatus>[0]);
    case "conversions_30d":
      return conversions30d(raw as RibbonLike | undefined, ctx.from ?? dayKey(new Date(Date.now() - 30 * DAY_MS)), ctx.to ?? dayKey(new Date()));
    case "channel_cpa":
      return channelCpa(raw as ChannelsLike | undefined, ctx.currency);
    case "cash_position":
      return cashPosition(raw as FinanceLike | undefined);
    case "runway_forecast":
      return runwayForecast(raw as FinanceLike | undefined);
    case "roadmap_status":
      return roadmapStatus(raw as RoadmapLike | undefined);
  }
}

// --- rendering decisions ----------------------------------------------------------------------------------------------

export type ChartShape = "line" | "bar" | "funnel" | "table" | "empty";

/** Pick how a chart/diagram exhibit draws from the data it has (the model never chooses chart numbers). */
export function chartShape(kind: ExhibitKind, data: ExhibitData): ChartShape {
  const hasSeries = !!data.series?.some((s) => s.points.length > 1);
  const numericCols = (data.columns ?? []).filter((c) => c.unit === "minor" || c.unit === "count" || c.unit === "months" || c.unit === "percent");
  const hasRows = !!data.rows?.length;
  if (kind === "table") return hasRows ? "table" : "empty";
  if (kind === "diagram") {
    if (hasRows && numericCols.length >= 1 && (data.rows?.length ?? 0) >= 2 && (data.rows?.length ?? 0) <= 6) return "funnel";
    return hasSeries ? "line" : hasRows ? "table" : "empty";
  }
  if (hasSeries) return "line";
  if (hasRows && numericCols.length >= 1) return "bar";
  return hasRows ? "table" : "empty";
}

/** The numeric column a bar/funnel uses: the last numeric column (cost per customer, count…). */
export function barColumn(data: ExhibitData): ExhibitColumn | null {
  const numeric = (data.columns ?? []).filter((c) => c.unit === "minor" || c.unit === "count" || c.unit === "months" || c.unit === "percent");
  return numeric[numeric.length - 1] ?? null;
}

export function labelColumn(data: ExhibitData): ExhibitColumn | null {
  return (data.columns ?? []).find((c) => c.unit === "text" || c.unit === "day" || c.unit === undefined) ?? null;
}
