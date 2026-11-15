/**
 * The cost report (WP-02 T11): what the platform's model, sandbox and training work costs, from the ledger. Queries 1,
 * 2, 3, 4, 4b, 5, 6, 8 and 9 of docs/holistic-plan/audits/a7-models-gateway-economics.md Appendix B, as written, plus
 * one count of projects per source (so the CLI can mark small samples). Query 7 waits for WP-09 (A7-07).
 *
 * Each query is plain SQL text in COST_QUERIES; `{range:<column>}` is the only placeholder and becomes the from/to
 * bounds (from inclusive, to exclusive) or `true`. `renderCostQuery` produces exactly what runs, so the CLI's
 * `--print-sql` output can be pasted into a read-only session. Dollars: coalesce(cost_micro_minor, cost_minor *
 * 1000000) / 1e8. Every query leaves out demo projects (`businesses.is_demo = false`). Read with the service role.
 */
import { sql } from "drizzle-orm";
import { rowsOf, type Executor } from "./_shared";

export interface CostRange {
  from?: Date;
  to?: Date;
}

export interface CostQuery {
  name: string;
  text: string;
}

const USD = "coalesce(u.cost_micro_minor, u.cost_minor * 1000000)";

export const COST_QUERIES: CostQuery[] = [
  {
    name: "projects",
    text: `select
  (select count(distinct u.business_id) from usage_ledger u join businesses b on b.id = u.business_id
     where b.is_demo = false and u.currency = 'USD' and {range:u.occurred_at}) as ledger,
  (select count(distinct s.business_id) from agent_sessions s join businesses b on b.id = s.business_id
     where b.is_demo = false and s.ended_at is not null and {range:s.ended_at}) as sessions,
  (select count(distinct t.business_id) from training_runs t join businesses b on b.id = t.business_id
     where b.is_demo = false and {range:t.created_at}) as training_runs;`,
  },
  {
    name: "byRoute",
    text: `select u.details->>'route' as route, u.details->>'model' as model, u.billed_to,
       count(*) as calls, sum(u.quantity) as tokens,
       round(sum(${USD}) / 1e8, 4) as usd,
       round(avg(${USD}) / 1e6, 3) as cents_per_call
from usage_ledger u join businesses b on b.id = u.business_id
where u.kind = 'tokens' and u.currency = 'USD' and b.is_demo = false and u.details ? 'route' and {range:u.occurred_at}
group by 1, 2, 3 order by usd desc;`,
  },
  {
    name: "sessionsByModelAndOutcome",
    text: `select s.model_key, s.outcome, count(*) as sessions,
       round(avg(s.tokens_in)) as avg_tokens_in, round(avg(s.tokens_out)) as avg_tokens_out,
       round(avg(s.cost_minor) / 100.0, 3) as avg_usd, round(sum(s.cost_minor) / 100.0, 2) as usd
from agent_sessions s join businesses b on b.id = s.business_id
where b.is_demo = false and s.ended_at is not null and {range:s.ended_at}
group by 1, 2 order by 1, 2;`,
  },
  {
    name: "firstDayPerProject",
    text: `select b.id, b.created_at,
       round(sum(${USD}) / 1e8, 3) as usd_first_24h,
       round(sum(${USD}) filter (where u.details->>'route' in ('foundations','foundationsSkeleton')) / 1e8, 3) as usd_foundations,
       round(sum(${USD}) filter (where u.details->>'source' = 'claude-agent-sdk') / 1e8, 3) as usd_sessions,
       round(sum(${USD}) filter (where u.details->>'route' in ('inboxComposer','conversation')) / 1e8, 3) as usd_notes_and_replies
from businesses b join usage_ledger u on u.business_id = b.id
where b.is_demo = false and u.currency = 'USD' and u.kind in ('tokens','sandbox')
  and u.occurred_at < b.created_at + interval '24 hours' and {range:b.created_at}
group by 1, 2 order by 2 desc;`,
  },
  {
    name: "projectWeeks",
    text: `select u.business_id, date_trunc('week', u.occurred_at) as week, u.billed_to,
       round(sum(${USD}) / 1e8, 3) as usd,
       count(*) filter (where u.kind = 'tokens') as model_rows
from usage_ledger u join businesses b on b.id = u.business_id
where b.is_demo = false and u.currency = 'USD' and u.kind <> 'tool' and {range:u.occurred_at}
group by 1, 2, 3 order by 2 desc, usd desc;`,
  },
  {
    name: "projectWeekDistribution",
    text: `with w as (
  select u.business_id, date_trunc('week', u.occurred_at) as week,
         sum(${USD}) / 1e8 as usd
  from usage_ledger u join businesses b on b.id = u.business_id
  where b.is_demo = false and u.currency = 'USD' and u.kind <> 'tool' and {range:u.occurred_at} group by 1, 2)
select count(*) as project_weeks, count(distinct business_id) as projects, round(avg(usd)::numeric, 3) as mean,
       round(percentile_cont(0.5) within group (order by usd)::numeric, 3) as p50,
       round(percentile_cont(0.9) within group (order by usd)::numeric, 3) as p90,
       round(max(usd)::numeric, 3) as max from w;`,
  },
  {
    name: "byAgentFamily",
    text: `select a.layer, a.agent_type, a.model_key, count(distinct u.session_id) as sessions,
       round(sum(${USD}) / 1e8, 3) as usd
from usage_ledger u join agents a on a.id = u.agent_id join businesses b on b.id = u.business_id
where b.is_demo = false and u.kind = 'tokens' and u.currency = 'USD' and {range:u.occurred_at}
group by 1, 2, 3 order by usd desc;`,
  },
  {
    name: "blockedSessions",
    text: `select s.model_key, e.payload->>'reason' as reason, count(*) as sessions,
       round(sum(s.cost_minor) / 100.0, 2) as usd
from agent_sessions s
left join events e on e.business_id = s.business_id and e.idempotency_key = 'task.blocked:' || s.id::text
join businesses b on b.id = s.business_id
where b.is_demo = false and s.outcome = 'blocked' and {range:s.ended_at}
group by 1, 2 order by usd desc;`,
  },
  {
    name: "trainingRuns",
    text: `select t.status, count(*) as runs, round(avg(t.cost_minor) / 100.0, 2) as avg_usd, round(max(t.cost_minor) / 100.0, 2) as max_usd
from training_runs t join businesses b on b.id = t.business_id where b.is_demo = false and {range:t.created_at} group by 1;`,
  },
  {
    name: "creditsThisMonth",
    text: `select c.business_id, c.period, c.granted_minor, c.spent_minor, c.balance_minor, b.plan_tier, b.model_billing, b.agents_stopped_reason
from credit_balances c join businesses b on b.id = c.business_id
where c.period = to_char(now() at time zone 'utc', 'YYYY-MM') and b.is_demo = false order by c.balance_minor asc;`,
  },
];

/** Always part of the report: spend the ledger does not see yet. */
export const COST_NOT_MEASURED = [
  "Model calls before a project exists (ideas, compare, logo) are not in the ledger (A7-02)",
  "The gateway's reader and web search are not booked (A7-03)",
] as const;

/** The query's SQL with its range filled in: exactly the text `run` executes. Dates come from Date objects only. */
export function renderCostQuery(query: CostQuery, range: CostRange = {}): string {
  const at = (d: Date) => `'${d.toISOString()}'::timestamptz`;
  return query.text.replace(/\{range:([a-z_.]+)\}/g, (_m, col: string) => {
    const parts = [range.from ? `${col} >= ${at(range.from)}` : null, range.to ? `${col} < ${at(range.to)}` : null].filter(Boolean);
    return parts.length ? `(${parts.join(" and ")})` : "true";
  });
}

export interface CostSpread {
  total: number;
  foundations: number;
  sessions: number;
  notesAndReplies: number;
}

export interface CostReport {
  from: string | null;
  to: string | null;
  /** Real projects seen by each source in the range (the CLI marks figures from fewer than 5 as a small sample). */
  projects: { ledger: number; sessions: number; trainingRuns: number };
  byRoute: { route: string; model: string | null; billedTo: string; calls: number; tokens: number; usd: number; centsPerCall: number }[];
  sessionsByModelAndOutcome: { modelKey: string; outcome: string | null; sessions: number; avgTokensIn: number; avgTokensOut: number; avgUsd: number; usd: number }[];
  firstDayPerProject: {
    rows: { businessId: string; createdAt: string; usd: number; foundations: number; sessions: number; notesAndReplies: number }[];
    projects: number;
    median: CostSpread;
    p90: CostSpread;
  };
  projectWeeks: {
    rows: { businessId: string; week: string; billedTo: string; usd: number; modelRows: number }[];
    distribution: { projectWeeks: number; projects: number; mean: number; p50: number; p90: number; max: number };
  };
  byAgentFamily: { layer: string; agentType: string; modelKey: string; sessions: number; usd: number }[];
  /** Reason from the session's `task.blocked` event (`payload.reason`, key `task.blocked:<sessionId>`); null when none. */
  blockedSessions: { modelKey: string; reason: string | null; sessions: number; usd: number }[];
  trainingRuns: { status: string; runs: number; avgUsd: number; maxUsd: number }[];
  creditsThisMonth: { businessId: string; period: string; grantedMinor: number; spentMinor: number; balanceMinor: number; planTier: string; modelBilling: string; agentsStoppedReason: string | null }[];
  notMeasured: string[];
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Linear-interpolated percentile (what Postgres's percentile_cont does), rounded to a tenth of a cent. */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  return Math.round(v * 1000) / 1000;
}

export const costReportRepo = {
  async run(db: Executor, range: CostRange = {}): Promise<CostReport> {
    const results: Record<string, Row[]> = {};
    for (const q of COST_QUERIES) results[q.name] = rowsOf<Row>(await db.execute(sql.raw(renderCostQuery(q, range))));
    const get = (name: string) => results[name] ?? [];

    const counts = get("projects")[0] ?? {};
    const firstDay = get("firstDayPerProject").map((r) => ({
      businessId: str(r.id),
      createdAt: str(r.created_at),
      usd: num(r.usd_first_24h),
      foundations: num(r.usd_foundations),
      sessions: num(r.usd_sessions),
      notesAndReplies: num(r.usd_notes_and_replies),
    }));
    const spread = (p: number): CostSpread => ({
      total: percentile(firstDay.map((r) => r.usd), p),
      foundations: percentile(firstDay.map((r) => r.foundations), p),
      sessions: percentile(firstDay.map((r) => r.sessions), p),
      notesAndReplies: percentile(firstDay.map((r) => r.notesAndReplies), p),
    });
    const dist = get("projectWeekDistribution")[0] ?? {};

    return {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      projects: { ledger: num(counts.ledger), sessions: num(counts.sessions), trainingRuns: num(counts.training_runs) },
      byRoute: get("byRoute").map((r) => ({ route: str(r.route), model: strOrNull(r.model), billedTo: str(r.billed_to), calls: num(r.calls), tokens: num(r.tokens), usd: num(r.usd), centsPerCall: num(r.cents_per_call) })),
      sessionsByModelAndOutcome: get("sessionsByModelAndOutcome").map((r) => ({
        modelKey: str(r.model_key),
        outcome: strOrNull(r.outcome),
        sessions: num(r.sessions),
        avgTokensIn: num(r.avg_tokens_in),
        avgTokensOut: num(r.avg_tokens_out),
        avgUsd: num(r.avg_usd),
        usd: num(r.usd),
      })),
      firstDayPerProject: { rows: firstDay, projects: firstDay.length, median: spread(0.5), p90: spread(0.9) },
      projectWeeks: {
        rows: get("projectWeeks").map((r) => ({ businessId: str(r.business_id), week: str(r.week), billedTo: str(r.billed_to), usd: num(r.usd), modelRows: num(r.model_rows) })),
        distribution: { projectWeeks: num(dist.project_weeks), projects: num(dist.projects), mean: num(dist.mean), p50: num(dist.p50), p90: num(dist.p90), max: num(dist.max) },
      },
      byAgentFamily: get("byAgentFamily").map((r) => ({ layer: str(r.layer), agentType: str(r.agent_type), modelKey: str(r.model_key), sessions: num(r.sessions), usd: num(r.usd) })),
      blockedSessions: get("blockedSessions").map((r) => ({ modelKey: str(r.model_key), reason: strOrNull(r.reason), sessions: num(r.sessions), usd: num(r.usd) })),
      trainingRuns: get("trainingRuns").map((r) => ({ status: str(r.status), runs: num(r.runs), avgUsd: num(r.avg_usd), maxUsd: num(r.max_usd) })),
      creditsThisMonth: get("creditsThisMonth").map((r) => ({
        businessId: str(r.business_id),
        period: str(r.period),
        grantedMinor: num(r.granted_minor),
        spentMinor: num(r.spent_minor),
        balanceMinor: num(r.balance_minor),
        planTier: str(r.plan_tier),
        modelBilling: str(r.model_billing),
        agentsStoppedReason: strOrNull(r.agents_stopped_reason),
      })),
      notMeasured: [...COST_NOT_MEASURED],
    };
  },
};
