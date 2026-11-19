/**
 * The cost report (WP-02 T11): what the platform's model, sandbox and training work costs, from the ledger. Queries 1,
 * 2, 3, 4, 4b, 5, 6, 8 and 9 of docs/holistic-plan/audits/a7-models-gateway-economics.md Appendix B, as written, plus
 * one count of projects per source (so the CLI can mark small samples). WP-09 T1 and T2 add query 7 (the cache-read
 * share per route, from the ledger's `details.tokens`), the first week per project, the cost of one round of work and
 * how many rounds the free allowance pays for, the route, effort and turns of sessions, the drafting a person did before
 * each project (`account_usage`) and the signed-out idea box per day (`idea_drafts.cost_micro`). The last one has no
 * project, so it is the one query without the demo filter.
 *
 * Each query is plain SQL text in COST_QUERIES; `{range:<column>}` is the only placeholder and becomes the from/to
 * bounds (from inclusive, to exclusive) or `true`. `renderCostQuery` produces exactly what runs, so the CLI's
 * `--print-sql` output can be pasted into a read-only session. Dollars: coalesce(cost_micro_minor, cost_minor *
 * 1000000) / 1e8. Every query leaves out demo projects (`businesses.is_demo = false`). Read with the service role,
 * inside one `set transaction read only` transaction, so Postgres refuses a write even on that role.
 */
import { CREDIT_MARKUP, includedCreditsMinor } from "@foundmill/config";
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
/** When a project's own spend starts: its commit, or its creation for one made before commits were recorded. */
const START = "coalesce(b.committed_at, b.created_at)";
const firstWindow = (name: string, window: string): CostQuery => ({
  name,
  text: `select b.id, ${START} as started_at,
       round(sum(${USD}) / 1e8, 3) as usd_total,
       round(sum(${USD}) filter (where u.details->>'route' in ('foundations','foundationsSkeleton')) / 1e8, 3) as usd_foundations,
       round(sum(${USD}) filter (where u.details->>'source' = 'claude-agent-sdk') / 1e8, 3) as usd_sessions,
       round(sum(${USD}) filter (where u.details->>'route' in ('inboxComposer','conversation')) / 1e8, 3) as usd_notes_and_replies
from businesses b join usage_ledger u on u.business_id = b.id
where b.is_demo = false and u.currency = 'USD' and u.kind in ('tokens','sandbox')
  and u.occurred_at < ${START} + interval '${window}' and {range:b.created_at}
group by 1, 2 order by 2 desc;`,
});

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
       round(sum(${USD}) filter (where u.billed_to = 'credits') * ${1 + CREDIT_MARKUP} / 1e8, 4) as usd_charged,
       round(avg(${USD}) / 1e6, 3) as cents_per_call
from usage_ledger u join businesses b on b.id = u.business_id
where u.kind = 'tokens' and u.currency = 'USD' and b.is_demo = false and u.details ? 'route' and {range:u.occurred_at}
group by 1, 2, 3 order by usd desc;`,
  },
  {
    name: "sessionsByModelAndOutcome",
    text: `select s.model_key, s.route, s.effort, s.outcome, count(*) as sessions,
       round(avg(s.tokens_in)) as avg_tokens_in, round(avg(s.tokens_out)) as avg_tokens_out,
       round(avg(s.cost_minor) / 100.0, 3) as avg_usd, round(sum(s.cost_minor) / 100.0, 2) as usd,
       percentile_cont(0.5) within group (order by s.num_turns) as p50_turns,
       percentile_cont(0.9) within group (order by s.num_turns) as p90_turns
from agent_sessions s join businesses b on b.id = s.business_id
where b.is_demo = false and s.ended_at is not null and {range:s.ended_at}
group by 1, 2, 3, 4 order by 1, 2, 3, 4;`,
  },
  firstWindow("firstDayPerProject", "24 hours"),
  firstWindow("firstWeekPerProject", "7 days"),
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
    // Appendix B query 7, from the ledger's details.tokens (WP-09 T1); rows booked before it carry none and are left out.
    name: "cacheShareByRoute",
    text: `select u.details->>'route' as route,
       sum((u.details->'tokens'->>'cacheRead')::bigint) as cache_read,
       sum((u.details->'tokens'->>'cacheWrite')::bigint) as cache_write,
       sum((u.details->'tokens'->>'input')::bigint) as uncached_input,
       round(100.0 * sum((u.details->'tokens'->>'cacheRead')::bigint)
             / nullif(sum((u.details->'tokens'->>'cacheRead')::bigint + (u.details->'tokens'->>'cacheWrite')::bigint + (u.details->'tokens'->>'input')::bigint), 0), 1) as cache_read_pct
from usage_ledger u join businesses b on b.id = u.business_id
where b.is_demo = false and u.kind = 'tokens' and u.details ? 'tokens' and u.details ? 'route' and {range:u.occurred_at}
group by 1 order by 2 desc nulls last;`,
  },
  {
    // One round of work: the cost cycle.completed already carries (US cents of credits), per round that ended.
    name: "rounds",
    text: `select (e.payload->'cost'->>'amountMinor')::bigint as cost_minor
from events e join businesses b on b.id = e.business_id
where b.is_demo = false and e.type = 'cycle.completed' and e.payload->'cost'->>'currency' = 'USD' and {range:e.occurred_at};`,
  },
  {
    // What a person drafted before each project (WP-09 T2): their account_usage between their previous commit and this one.
    name: "preCommitPerProject",
    text: `with c as (
  select b.id, b.created_by, b.created_at, ${START} as started_at,
         lag(${START}) over (partition by b.created_by order by ${START}) as previous_at
  from businesses b where b.is_demo = false and b.created_by is not null)
select c.id, round(coalesce(sum(a.cost_micro_minor), 0) / 1e8, 4) as usd
from c left join account_usage a on a.user_id = c.created_by and a.occurred_at < c.started_at
  and (c.previous_at is null or a.occurred_at >= c.previous_at)
where {range:c.created_at}
group by 1 order by 1;`,
  },
  {
    // The signed-out idea box (no person, no project): its daily total from idea_drafts.cost_micro (millionths of a cent).
    name: "ideaBox",
    text: `select date_trunc('day', d.created_at) as day, count(*) as cards, round(sum(d.cost_micro) / 1e8, 4) as usd
from idea_drafts d where d.model_mode = 'live' and {range:d.created_at}
group by 1 order by 1 desc;`,
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
  "Sessions record their route, effort, turns and cache totals once WP-09 T1 step 4 ships; sessions before it show none",
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

/** A median and a 90th percentile, in US dollars. */
export interface CostMedianP90 {
  median: number;
  p90: number;
}

export interface CostReport {
  from: string | null;
  to: string | null;
  /** Postgres's own `transaction_read_only` while the queries ran: true means a write would have been refused. */
  readOnly: boolean;
  /** Real projects seen by each source in the range (the CLI marks figures from fewer than 5 as a small sample). */
  projects: { ledger: number; sessions: number; trainingRuns: number };
  /** `usd` is the true cost; `usdCharged` what the platform-key calls charged against credits (cost plus `CREDIT_MARKUP`). */
  byRoute: { route: string; model: string | null; billedTo: string; calls: number; tokens: number; usd: number; usdCharged: number; centsPerCall: number }[];
  sessionsByModelAndOutcome: {
    modelKey: string;
    route: string | null;
    effort: string | null;
    outcome: string | null;
    sessions: number;
    avgTokensIn: number;
    avgTokensOut: number;
    avgUsd: number;
    usd: number;
    /** Null when no session of the group recorded its turns. */
    p50Turns: number | null;
    p90Turns: number | null;
  }[];
  firstDayPerProject: {
    rows: { businessId: string; createdAt: string; usd: number; foundations: number; sessions: number; notesAndReplies: number }[];
    projects: number;
    median: CostSpread;
    p90: CostSpread;
  };
  /** The first seven days from commit (or creation), per project. */
  firstWeekPerProject: { rows: { businessId: string; startedAt: string; usd: number }[]; projects: number } & CostMedianP90;
  cacheShareByRoute: { route: string; cacheRead: number; cacheWrite: number; uncachedInput: number; cacheReadPct: number | null }[];
  /** One round of work (a cycle that ended): the median cost in US cents and how many the free plan's allowance pays for. */
  rounds: { rounds: number; medianMinor: number | null; perAllowance: number | null };
  /** Drafting before each project, from account_usage: what its creator spent between their previous commit and this one. */
  preCommitPerProject: { projects: number } & CostMedianP90;
  /** The signed-out idea box's live cards per day. */
  ideaBox: { day: string; cards: number; usd: number }[];
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
    const readOnly = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      for (const q of COST_QUERIES) results[q.name] = rowsOf<Row>(await tx.execute(sql.raw(renderCostQuery(q, range))));
      const [ro] = rowsOf<{ ro: string }>(await tx.execute(sql`select current_setting('transaction_read_only') as ro`));
      return ro?.ro === "on";
    });
    const get = (name: string) => results[name] ?? [];

    const counts = get("projects")[0] ?? {};
    const firstDay = get("firstDayPerProject").map((r) => ({
      businessId: str(r.id),
      createdAt: str(r.started_at),
      usd: num(r.usd_total),
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
    const firstWeek = get("firstWeekPerProject").map((r) => ({ businessId: str(r.id), startedAt: str(r.started_at), usd: num(r.usd_total) }));
    const preCommit = get("preCommitPerProject").map((r) => num(r.usd));
    const roundCosts = get("rounds").map((r) => num(r.cost_minor));
    const roundMedian = roundCosts.length ? percentile(roundCosts, 0.5) : null;

    return {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      readOnly,
      projects: { ledger: num(counts.ledger), sessions: num(counts.sessions), trainingRuns: num(counts.training_runs) },
      byRoute: get("byRoute").map((r) => ({ route: str(r.route), model: strOrNull(r.model), billedTo: str(r.billed_to), calls: num(r.calls), tokens: num(r.tokens), usd: num(r.usd), usdCharged: num(r.usd_charged), centsPerCall: num(r.cents_per_call) })),
      sessionsByModelAndOutcome: get("sessionsByModelAndOutcome").map((r) => ({
        modelKey: str(r.model_key),
        route: strOrNull(r.route),
        effort: strOrNull(r.effort),
        outcome: strOrNull(r.outcome),
        sessions: num(r.sessions),
        avgTokensIn: num(r.avg_tokens_in),
        avgTokensOut: num(r.avg_tokens_out),
        avgUsd: num(r.avg_usd),
        usd: num(r.usd),
        p50Turns: r.p50_turns === null || r.p50_turns === undefined ? null : num(r.p50_turns),
        p90Turns: r.p90_turns === null || r.p90_turns === undefined ? null : num(r.p90_turns),
      })),
      firstDayPerProject: { rows: firstDay, projects: firstDay.length, median: spread(0.5), p90: spread(0.9) },
      firstWeekPerProject: { rows: firstWeek, projects: firstWeek.length, median: percentile(firstWeek.map((r) => r.usd), 0.5), p90: percentile(firstWeek.map((r) => r.usd), 0.9) },
      cacheShareByRoute: get("cacheShareByRoute").map((r) => ({
        route: str(r.route),
        cacheRead: num(r.cache_read),
        cacheWrite: num(r.cache_write),
        uncachedInput: num(r.uncached_input),
        cacheReadPct: r.cache_read_pct === null || r.cache_read_pct === undefined ? null : num(r.cache_read_pct),
      })),
      rounds: { rounds: roundCosts.length, medianMinor: roundMedian, perAllowance: roundMedian ? Math.floor(includedCreditsMinor("free") / roundMedian) : null },
      preCommitPerProject: { projects: preCommit.length, median: percentile(preCommit, 0.5), p90: percentile(preCommit, 0.9) },
      ideaBox: get("ideaBox").map((r) => ({ day: str(r.day), cards: num(r.cards), usd: num(r.usd) })),
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
