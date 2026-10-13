/**
 * Custom metrics for the dashboard (BUILD §11.2; AC-11.2.5 "RLS + SELECT-only").
 *
 * A metric is a catalogue entry: a named, read-only query the API runs through repositories under the caller's RLS
 * transaction. `compileMetric` turns a founder's sentence into the catalogue entry it means (deterministic keyword
 * match; no model call is needed for a closed catalogue) and previews it. `runMetric` accepts a `queryId` or the
 * entry's canonical SQL text: the text is matched against the catalogue, never executed, so nothing a widget sends can
 * read outside the business (docs/DECISIONS.md "custom metric SQL is a catalogue key").
 *
 * Section walls (BUILD §11.9; audit RA-02): every entry names the section whose data it reads, and a reader without
 * read access to that section never gets its value, its preview or its catalogue line, exactly as the section's own
 * procedures (finance.overview, dev.tasks.list, distribution.channels.list, …) refuse them. RLS scopes the rows to the
 * business, not to a section, so the check lives here.
 */
import { repos, type Executor } from "@foundmill/db";
import { ForbiddenError, ValidationError, type Section } from "@foundmill/shared";

export type MetricFormat = "compact" | "integer" | "decimal" | "percent" | "money";

export interface MetricResult {
  value: number | null;
  currency?: string;
  format: MetricFormat;
  label: string;
  asOf: string | null;
  provenance: string;
  estimate: "forecast" | "estimate" | null;
  series?: number[];
}

export interface CompiledMetric {
  queryId: string;
  sql: string;
  label: string;
  format: MetricFormat;
  provenance: string;
  estimate: "forecast" | "estimate" | null;
}

/** What the caller may read (apps/api passes the membership's effective section permissions). */
export interface MetricReader {
  canRead(section: Section): boolean;
}

interface MetricDefinition extends CompiledMetric {
  /** The section whose data the metric reads: a reader without read access to it never gets the metric. */
  section: Section;
  description: string;
  keywords: readonly string[];
  run(db: Executor, businessId: string, now: Date): Promise<Pick<MetricResult, "value" | "currency" | "series" | "asOf">>;
}

const DAY_MS = 86_400_000;
const last30 = (now: Date) => ({ from: new Date(now.getTime() - 30 * DAY_MS), to: now });

export const METRICS: readonly MetricDefinition[] = [
  {
    queryId: "cash",
    section: "finance",
    label: "Cash in bank",
    description: "Sum of the latest balances of the connected bank accounts.",
    format: "money",
    provenance: "Bank balances from the connected accounts",
    estimate: null,
    sql: "select sum(balance_minor) from accounts where business_id = current_business() and archived_at is null",
    keywords: ["cash", "bank", "balance"],
    async run(db, businessId) {
      const cash = await repos.finance.cashPosition(db, businessId);
      const base = cash.byCurrency[0];
      return { value: base?.balanceMinor ?? 0, currency: base?.currency ?? "EUR", asOf: base?.oldestBalanceAt?.toISOString() ?? null };
    },
  },
  {
    queryId: "net_burn",
    section: "finance",
    label: "Net burn (monthly)",
    description: "Operating outflows minus operating inflows, trailing 3-month average.",
    format: "money",
    provenance: "Bank transactions, financing excluded, trailing 3-month average",
    estimate: "estimate",
    sql: "select avg(outflow_minor - inflow_minor) from monthly_totals where business_id = current_business() and month >= now() - interval '3 months'",
    keywords: ["burn", "net burn", "spend per month", "monthly spend"],
    async run(db, businessId, now) {
      const burn = await repos.finance.netBurn(db, businessId, { months: 3, asOf: now });
      const cash = await repos.finance.cashPosition(db, businessId);
      return { value: burn.netBurnMinor, currency: cash.byCurrency[0]?.currency ?? "EUR", asOf: now.toISOString() };
    },
  },
  {
    queryId: "runway_months",
    section: "finance",
    label: "Runway (months)",
    description: "Cash divided by net burn.",
    format: "decimal",
    provenance: "Cash ÷ net burn",
    estimate: "estimate",
    sql: "select cash_minor / nullif(net_burn_minor, 0) from runway_view where business_id = current_business()",
    keywords: ["runway", "months left", "how long"],
    async run(db, businessId, now) {
      const [cash, burn] = await Promise.all([repos.finance.cashPosition(db, businessId), repos.finance.netBurn(db, businessId, { months: 3, asOf: now })]);
      const cashMinor = cash.byCurrency[0]?.balanceMinor ?? 0;
      return { value: burn.netBurnMinor > 0 ? Math.round((cashMinor / burn.netBurnMinor) * 10) / 10 : null, asOf: now.toISOString() };
    },
  },
  {
    queryId: "revenue_30d",
    section: "finance",
    label: "Revenue, last 30 days",
    description: "Payments received in the last 30 days (cash basis).",
    format: "money",
    provenance: "Payment conversions, last 30 days, cash basis",
    estimate: null,
    sql: "select sum(amount_minor) from conversions where business_id = current_business() and kind = 'payment' and occurred_at >= now() - interval '30 days'",
    keywords: ["revenue", "sales", "income", "mrr", "payments"],
    async run(db, businessId, now) {
      // Summed in SQL (every payment, no page cap), per currency: the business's main currency, never a mix of two.
      const [main] = await repos.journeys.sumConversions(db, businessId, { ...last30(now), kind: "payment" });
      return { value: main?.amountMinor ?? 0, currency: main?.currency ?? "EUR", asOf: now.toISOString() };
    },
  },
  {
    queryId: "customers_30d",
    section: "distribution",
    label: "Customers won, last 30 days",
    description: "Paying customers won in the last 30 days.",
    format: "integer",
    provenance: "First payments, last 30 days",
    estimate: null,
    sql: "select count(*) from conversions where business_id = current_business() and kind = 'payment' and first_payment and occurred_at >= now() - interval '30 days'",
    keywords: ["customers", "paying", "won", "wins"],
    async run(db, businessId, now) {
      const counts = await repos.journeys.countConversions(db, businessId, last30(now));
      return { value: counts.payment ?? 0, asOf: now.toISOString() };
    },
  },
  {
    queryId: "signups_30d",
    section: "distribution",
    label: "Sign-ups, last 30 days",
    description: "Sign-ups in the last 30 days.",
    format: "integer",
    provenance: "Signup conversions, last 30 days",
    estimate: null,
    sql: "select count(*) from conversions where business_id = current_business() and kind = 'signup' and occurred_at >= now() - interval '30 days'",
    keywords: ["signups", "sign-ups", "sign ups", "registrations", "leads"],
    async run(db, businessId, now) {
      const counts = await repos.journeys.countConversions(db, businessId, last30(now));
      return { value: counts.signup ?? 0, asOf: now.toISOString() };
    },
  },
  {
    queryId: "activation_rate_30d",
    section: "distribution",
    label: "Activation rate, last 30 days",
    description: "Activations as a share of sign-ups in the last 30 days.",
    format: "percent",
    provenance: "Activation ÷ signup conversions, last 30 days",
    estimate: "estimate",
    sql: "select activations::float / nullif(signups, 0) from conversion_counts_30d where business_id = current_business()",
    keywords: ["activation", "activated", "conversion rate"],
    async run(db, businessId, now) {
      const counts = await repos.journeys.countConversions(db, businessId, last30(now));
      return { value: counts.signup ? counts.activation / counts.signup : null, asOf: now.toISOString() };
    },
  },
  {
    queryId: "tasks_running",
    section: "development",
    label: "Tasks running",
    description: "Team tasks currently running.",
    format: "integer",
    provenance: "tasks.status = running",
    estimate: null,
    sql: "select count(*) from tasks where business_id = current_business() and status = 'running' and archived_at is null",
    keywords: ["tasks running", "running tasks", "in progress", "working on"],
    async run(db, businessId, now) {
      const counts = await repos.tasks.countByStatus(db, businessId);
      return { value: counts.running ?? 0, asOf: now.toISOString() };
    },
  },
  {
    queryId: "tasks_done",
    section: "development",
    label: "Tasks done",
    description: "Team tasks completed.",
    format: "integer",
    provenance: "tasks.status = done",
    estimate: null,
    sql: "select count(*) from tasks where business_id = current_business() and status = 'done'",
    keywords: ["tasks done", "done", "completed tasks", "shipped", "merged"],
    async run(db, businessId, now) {
      const counts = await repos.tasks.countByStatus(db, businessId);
      return { value: counts.done ?? 0, asOf: now.toISOString() };
    },
  },
  {
    queryId: "agents_active",
    section: "team",
    label: "Agents working",
    description: "Agents with a healthy or degraded status (not paused, down or idle).",
    format: "integer",
    provenance: "agents.status",
    estimate: null,
    sql: "select count(*) from agents where business_id = current_business() and status in ('healthy', 'degraded') and archived_at is null",
    keywords: ["agents", "squad", "working agents", "active agents"],
    async run(db, businessId, now) {
      const counts = await repos.agents.countByStatus(db, businessId);
      return { value: (counts.healthy ?? 0) + (counts.degraded ?? 0), asOf: now.toISOString() };
    },
  },
  {
    queryId: "spend_30d",
    section: "finance",
    label: "Agent spend, last 30 days",
    description: "Model and sandbox cost metered in the last 30 days.",
    format: "money",
    provenance: "usage_ledger, last 30 days",
    estimate: "estimate",
    sql: "select sum(cost_minor) from usage_ledger where business_id = current_business() and occurred_at >= now() - interval '30 days'",
    keywords: ["spend", "cost", "wages", "usage", "credits"],
    async run(db, businessId, now) {
      const totals = await repos.usage.totals(db, businessId, last30(now));
      return { value: totals.costMinor, currency: "EUR", asOf: now.toISOString() };
    },
  },
  {
    queryId: "cpa_blended",
    section: "distribution",
    label: "Cost per customer (blended)",
    description: "Channel spend divided by customers won, last 30 days.",
    format: "money",
    provenance: "channel_metrics spend ÷ customers, last 30 days",
    estimate: "estimate",
    sql: "select sum(spend_minor) / nullif(sum(customers), 0) from channel_metrics where business_id = current_business() and day >= current_date - 30",
    keywords: ["cpa", "cost per customer", "acquisition cost", "cac"],
    async run(db, businessId, now) {
      const summary = await repos.channels.metricsSummary(db, businessId, { from: new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
      return { value: summary.blended.cpaMinor, currency: "EUR", asOf: now.toISOString() };
    },
  },
  {
    queryId: "channels_enabled",
    section: "distribution",
    label: "Channels enabled",
    description: "Channels switched on in the Board.",
    format: "integer",
    provenance: "channels.enabled",
    estimate: null,
    sql: "select count(*) from channels where business_id = current_business() and enabled and archived_at is null",
    keywords: ["channels", "enabled channels", "board"],
    async run(db, businessId, now) {
      const list = await repos.channels.list(db, businessId, { enabled: true });
      return { value: list.length, asOf: now.toISOString() };
    },
  },
];

export const METRIC_IDS = METRICS.map((m) => m.queryId);
const byId = new Map(METRICS.map((m) => [m.queryId, m]));

const normaliseSql = (s: string) => s.trim().replace(/\s+/g, " ").replace(/;+$/, "").toLowerCase();
const bySql = new Map(METRICS.map((m) => [normaliseSql(m.sql), m]));

/** The catalogue lines the reader may use (a metric from a section they cannot read is not offered). */
export function listMetrics(reader: MetricReader): { id: string; label: string; description: string; format: MetricFormat; estimate: "forecast" | "estimate" | null }[] {
  return METRICS.filter((m) => reader.canRead(m.section)).map((m) => ({ id: m.queryId, label: m.label, description: m.description, format: m.format, estimate: m.estimate }));
}

function assertReadable(m: MetricDefinition, reader: MetricReader): void {
  if (!reader.canRead(m.section)) throw new ForbiddenError(`You do not have read access to ${m.section}`);
}

/** Resolve `{ queryId }` or `{ sql }` to a catalogue entry. SQL is matched, never executed (AC-11.2.5). */
export function resolveMetric(input: { queryId?: string | null; sql?: string | null }): MetricDefinition {
  if (input.queryId) {
    const m = byId.get(input.queryId);
    if (!m) throw new ValidationError(`Unknown metric "${input.queryId}". Known metrics: ${METRIC_IDS.join(", ")}`);
    return m;
  }
  if (input.sql) {
    const text = normaliseSql(input.sql);
    if (!text.startsWith("select ")) throw new ValidationError("Only read-only SELECT queries are allowed");
    const m = bySql.get(text);
    if (!m) throw new ValidationError("Only catalog queries can run; compile a sentence first or pick a named metric", { known: METRIC_IDS });
    return m;
  }
  throw new ValidationError("Give a queryId or the compiled sql");
}

export async function runMetric(db: Executor, businessId: string, input: { queryId?: string | null; sql?: string | null }, reader: MetricReader, now = new Date()): Promise<MetricResult> {
  const m = resolveMetric(input);
  assertReadable(m, reader);
  const r = await m.run(db, businessId, now);
  return { value: r.value, currency: r.currency, series: r.series, asOf: r.asOf, format: m.format, label: m.label, provenance: m.provenance, estimate: m.estimate };
}

const tokenise = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);

/** The catalogue entry a sentence means, by keyword overlap (ties → catalogue order). Null when nothing matches. */
export function matchMetric(sentence: string, among: readonly MetricDefinition[] = METRICS): MetricDefinition | null {
  const text = ` ${tokenise(sentence).join(" ")} `;
  let best: { m: MetricDefinition; score: number } | null = null;
  for (const m of among) {
    let score = 0;
    for (const k of m.keywords) if (text.includes(` ${k.toLowerCase()} `)) score += k.includes(" ") ? 2 : 1;
    if (/last 30 days|30 days|this month|monthly/.test(text) && m.queryId.endsWith("_30d")) score += 0.5;
    if (score > (best?.score ?? 0)) best = { m, score };
  }
  return best?.m ?? null;
}

/**
 * A sentence → the readable catalogue entry it means, with a preview. Only metrics from sections the reader may read are
 * matched, previewed or offered as alternatives; a sentence that only matches a walled metric is refused (403).
 */
export async function compileMetric(db: Executor, businessId: string, sentence: string, reader: MetricReader, now = new Date()): Promise<CompiledMetric & { preview: MetricResult; alternatives: string[] }> {
  const readable = METRICS.filter((x) => reader.canRead(x.section));
  const m = matchMetric(sentence, readable);
  if (!m) {
    const walled = matchMetric(sentence);
    if (walled) throw new ForbiddenError(`You do not have read access to ${walled.section}`);
    throw new ValidationError(`No known metric matches "${sentence.slice(0, 80)}". Try one of: ${readable.map((x) => x.label).join(", ")}`, { known: readable.map((x) => x.queryId) });
  }
  const preview = await runMetric(db, businessId, { queryId: m.queryId }, reader, now);
  const alternatives = readable.filter((x) => x !== m && x.keywords.some((k) => sentence.toLowerCase().includes(k))).map((x) => x.queryId);
  return { queryId: m.queryId, sql: m.sql, label: m.label, format: m.format, provenance: m.provenance, estimate: m.estimate, preview, alternatives };
}
