/**
 * The nightly numbers (WP-02 T10; A8-08, A8-06, FR-10): funnel, north star, retention, agent work and honesty, as
 * counts across projects, never ids or names. Every count is over projects with `is_demo = false`; "outside" figures
 * (and the north star, as A8-08 wrote it) also leave out Foundmill's own house project. Read with the service role.
 *
 * Each statement is raw SQL in `METRIC_QUERIES`, so `report:metrics --print-sql` prints exactly what runs and a
 * Desktop session can run it read-only through the Supabase connector. The one parameter is the end of the window,
 * written `:as_of_end` and bound as a literal timestamp (`boundMetricSql`): the start of the UTC day after `asOf`.
 * Windows are that UTC day, and 7 and 14 days back from it. The retention report's totals come from
 * `presenceRepo.retentionReport`, the existing definition, rather than a second copy in SQL.
 *
 * WP-14 T12 adds four measures (`first_session`, `resting`, `customer_updates`). Two of them read events nothing
 * writes yet (`PENDING_SOURCES`): they count zero, with a null share, until WP-14 T1 and T9 write them.
 */
import { HOUSE_BUSINESS_ID } from "@foundmill/config";
import { sql } from "drizzle-orm";
import { platformMetricDays } from "../schema";
import { rowsOf, type Executor } from "./_shared";
import { presenceRepo } from "./presence";
import { reportsRepo } from "./reports";

const DAY_MS = 86_400_000;
const HOUSE = `'${HOUSE_BUSINESS_ID}'`;

/** A real project's event row (`e`) in a real business (`b`): no demo, no house. */
const REAL_OUTSIDE = `not b.is_demo and b.id <> ${HOUSE}`;

/**
 * The per-event rule of `isRealOutcome` (@foundmill/shared morning-brief.ts), over an `events e` row: A8-08's
 * north-star predicate as written. `metrics.test.ts` checks the two agree on every fixture event.
 */
export const REAL_OUTCOME_PREDICATE = `(
     not (e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate')
     and not (e.payload ? 'simulated' and e.payload->>'simulated' is distinct from 'false')
     and (   (e.type = 'page.published'   and e.actor->>'kind' = 'user')
          or (e.type = 'mail.sent'        and e.payload->>'simulated' = 'false')
          or (e.type = 'page.followed'    and e.actor->>'kind' = 'system' and e.actor->>'id' = 'public-page')
          or (e.type = 'payment.received' and e.actor->>'kind' = 'webhook')
          or (e.type = 'lead.replied'     and e.actor->>'kind' = 'webhook' and e.payload->>'sentiment' in ('positive','neutral'))))`;

/** The first page a person published, per project (the funnel's step and the north star's one-time page). */
const FIRST_PAGES = `select e.business_id, min(e.occurred_at) as at
      from events e join businesses b on b.id = e.business_id
     where not b.is_demo and e.type = 'page.published' and e.occurred_at < :as_of_end and ${REAL_OUTCOME_PREDICATE}
     group by e.business_id`;

/**
 * Sources two of WP-14 T12's measures wait for. Until the task named writes the event, its counts are zero and its
 * shares null. If a task lands the fact under another name, change the name here and nowhere else.
 */
export const PENDING_SOURCES = {
  /** WP-14 T1: the team used the month's budget and rests. One event each time a project starts resting. */
  resting: "team.resting",
  /** WP-14 T1 (or the billing code it builds on): credits were added to the project after it rested. */
  toppedUp: "credits.topped_up",
  /** WP-14 T14: the owner's plan changed. */
  planChanged: "plan.changed",
  /** WP-14 T9: the founder shared one Customer Update as a card; `payload.conversionId` names the update. */
  customerUpdateShared: "customer_update.shared",
} as const;

/** The actions a press of Continue leaves in the audit log (apps/api services/cycle.ts); the last one is a refusal. */
const PRESS_ACTIONS = ["business.continue", "cycle.run_start", "business.resume_cycle", "business.continue_refused"] as const;
export const CONTINUE_REFUSED_ACTION = "business.continue_refused";

/** Minutes after which the median time from commit to the first plan is the operator's to hear about (WP-14 T12). */
export const FIRST_PLAN_SLOW_MINUTES = 10;

export interface MetricQuery {
  name: string;
  text: string;
}

export const METRIC_QUERIES: readonly MetricQuery[] = [
  {
    name: "accounts",
    text: `select (select count(*) from auth.users u where u.created_at < :as_of_end)::int as total,
       (select count(*) from auth.users u where u.created_at >= :as_of_end - interval '14 days' and u.created_at < :as_of_end)::int as new_14d,
       (select count(*) from auth.users u where u.last_sign_in_at >= :as_of_end - interval '14 days' and u.last_sign_in_at < :as_of_end)::int as signed_in_14d,
       (select count(*) from founder_profiles p where p.created_at < :as_of_end)::int as profiles`,
  },
  {
    name: "gate",
    text: `select (select count(*) from waitlist_entries w where w.created_at < :as_of_end)::int as waitlist,
       (select count(*) from invitations i join businesses b on b.id = i.business_id where not b.is_demo and i.created_at < :as_of_end)::int as invitations,
       coalesce((select jsonb_object_agg(how, n) from (select how, count(*)::int as n from account_admissions where created_at < :as_of_end group by how) a), '{}'::jsonb) as admissions`,
  },
  {
    name: "funnel_days",
    text: `with facts as (
  select 'idea_cards' as metric, d.created_at as at, null::text as k from idea_drafts d
  union all select 'cards_kept', d.claimed_at, null from idea_drafts d where d.claimed_at is not null
  union all select 'accounts_new', u.created_at, null from auth.users u
  union all select 'admitted', a.occurred_at, a.payload->>'how' from account_events a where a.type = 'account.admitted'
  union all select 'profiles_created', a.occurred_at, a.payload->>'client' from account_events a where a.type = 'profile.created'
  union all select 'idea_drafted', a.occurred_at, a.payload->>'source' from account_events a where a.type = 'idea.drafted'
  union all select 'committed', b.committed_at, null from businesses b where not b.is_demo and b.committed_at is not null
  union all select 'page_published', p.at, null from (${FIRST_PAGES}) p
  union all select 'first_other_outcome', min(e.occurred_at), null
              from events e join businesses b on b.id = e.business_id
             where not b.is_demo and e.type <> 'page.published' and ${REAL_OUTCOME_PREDICATE}
             group by e.business_id
)
select metric, to_char((at at time zone 'utc')::date, 'YYYY-MM-DD') as day, k, count(*)::int as n
  from facts
 where at >= :as_of_end - interval '14 days' and at < :as_of_end
 group by 1, 2, 3 order by 1, 2, 3`,
  },
  {
    name: "funnel_medians",
    text: `with committed as (
  select b.id, b.created_by, b.committed_at from businesses b
   where not b.is_demo and b.committed_at is not null and b.committed_at < :as_of_end
), first_commit as (
  select created_by as user_id, min(committed_at) as at from committed where created_by is not null group by 1
)
select (select percentile_cont(0.5) within group (order by extract(epoch from c.at - p.created_at) / 60)
          from first_commit c join founder_profiles p on p.user_id = c.user_id where c.at >= p.created_at) as profile_to_commit_min,
       (select percentile_cont(0.5) within group (order by extract(epoch from f.at - c.committed_at) / 60)
          from committed c join (${FIRST_PAGES}) f on f.business_id = c.id where f.at >= c.committed_at) as commit_to_page_min`,
  },
  {
    name: "projects",
    text: `select count(*)::int as total,
       count(*) filter (where b.is_demo)::int as demo,
       count(*) filter (where not b.is_demo)::int as real,
       count(*) filter (where not b.is_demo and b.id <> ${HOUSE})::int as real_outside,
       count(*) filter (where not b.is_demo and b.committed_at < :as_of_end)::int as committed,
       count(*) filter (where not b.is_demo and exists (select 1 from project_pages p where p.business_id = b.id))::int as with_page_draft,
       count(*) filter (where not b.is_demo and exists (select 1 from project_pages p where p.business_id = b.id
                          and p.published is not null and p.published_at < :as_of_end))::int as with_page_live
  from businesses b where b.created_at < :as_of_end`,
  },
  {
    // A8-08's north star, with three changes (docs/log 2026-11-15 T10): a page.published counts only in the week of
    // the project's first one (WP-02, decisions for the founder 1); now() is the snapshot's end, so a past day can be
    // recomputed; and the window is the last 12 whole UTC weeks, so every week it returns is a full one.
    name: "north_star",
    text: `with outcomes as (
  select e.business_id, date_trunc('week', e.occurred_at at time zone 'utc')::date as week, e.type
    from events e join businesses b on b.id = e.business_id
   where not b.is_demo and b.id <> ${HOUSE}
     and e.occurred_at >= date_trunc('week', (:as_of_end - interval '1 day') at time zone 'utc') at time zone 'utc' - interval '11 weeks'
     and e.occurred_at < :as_of_end
     and not (e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate')
     and not (e.payload ? 'simulated' and e.payload->>'simulated' is distinct from 'false')
     and (   (e.type = 'page.published'   and e.actor->>'kind' = 'user'
              and e.occurred_at = (select f.at from (${FIRST_PAGES}) f where f.business_id = e.business_id))
          or (e.type = 'mail.sent'        and e.payload->>'simulated' = 'false')
          or (e.type = 'page.followed'    and e.actor->>'kind' = 'system' and e.actor->>'id' = 'public-page')
          or (e.type = 'payment.received' and e.actor->>'kind' = 'webhook')
          or (e.type = 'lead.replied'     and e.actor->>'kind' = 'webhook' and e.payload->>'sentiment' in ('positive','neutral')))
), people as (
  select business_id, count(*) as n from memberships
   where source <> 'example' and (expires_at is null or expires_at > :as_of_end) group by 1
)
select to_char(o.week, 'YYYY-MM-DD') as week,
       count(distinct o.business_id)::int                                   as projects_with_real_outcome,
       count(distinct o.business_id) filter (where p.n = 1)::int            as solo,
       count(distinct o.business_id) filter (where p.n >= 2)::int           as together,
       count(distinct o.business_id) filter (where exists (
         select 1 from founder_visit_days v where v.business_id = o.business_id and v.day >= o.week and v.day < o.week + 7))::int as also_visited_that_week
  from outcomes o left join people p on p.business_id = o.business_id
 group by o.week order by o.week desc`,
  },
  {
    name: "retention_visits",
    text: `select count(distinct v.user_id)::int as visit_users_14d, count(distinct (v.user_id, v.day))::int as visit_days_14d
  from founder_visit_days v join businesses b on b.id = v.business_id
 where not b.is_demo and v.day >= ((:as_of_end at time zone 'utc')::date - 14) and v.day < (:as_of_end at time zone 'utc')::date`,
  },
  {
    name: "retention_cycles",
    text: `with per as (
  select e.business_id, count(*) as cycles, extract(epoch from max(e.occurred_at) - min(e.occurred_at)) / 86400 as span_days
    from events e join businesses b on b.id = e.business_id
   where not b.is_demo and e.type = 'cycle.started' and e.occurred_at < :as_of_end
   group by e.business_id
)
select count(*)::int as projects_with_cycles,
       coalesce(sum(cycles), 0)::int as cycles,
       percentile_cont(0.5) within group (order by cycles) as cycles_median,
       percentile_cont(0.5) within group (order by floor(span_days)) as span_days_median,
       count(*) filter (where span_days < 1)::int as ran_only_first_day
  from per`,
  },
  {
    name: "agent_sessions",
    text: `select coalesce(s.outcome, 'none') as outcome, count(*)::int as n
  from agent_sessions s join businesses b on b.id = s.business_id
 where not b.is_demo and s.ended_at is not null and s.ended_at < :as_of_end
 group by 1 order by 1`,
  },
  {
    name: "agent_events",
    text: `select e.type, coalesce(case e.type when 'approval.requested' then e.payload->>'tool' when 'approval.resolved' then e.payload->>'outcome' end, '') as k, count(*)::int as n
  from events e join businesses b on b.id = e.business_id
 where not b.is_demo and e.type in ('task.blocked', 'task.completed', 'approval.requested', 'approval.resolved') and e.occurred_at < :as_of_end
 group by 1, 2 order by 1, 2`,
  },
  {
    name: "agent_approvals",
    text: `select count(*) filter (where a.requested_at < :as_of_end and (a.resolved_at is null or a.resolved_at >= :as_of_end))::int as approvals_open,
       count(*) filter (where a.requested_at < :as_of_end - interval '9 days' and (a.resolved_at is null or a.resolved_at >= :as_of_end))::int as approvals_open_over_9d,
       (select count(*) from audit_log l join businesses lb on lb.id = l.business_id
         where not lb.is_demo and l.action = 'cycle.tool_missing_stopped' and l.created_at < :as_of_end)::int as tool_missing_stopped
  from approvals a join businesses b on b.id = a.business_id where not b.is_demo`,
  },
  {
    name: "agent_notes_day_one",
    text: `with per as (
  select b.id, (select count(*) from inbox_items i where i.business_id = b.id
                 and i.created_at >= b.committed_at and i.created_at < b.committed_at + interval '24 hours') as notes
    from businesses b where not b.is_demo and b.committed_at is not null and b.committed_at < :as_of_end
)
select coalesce(max(notes), 0)::int as max, percentile_cont(0.5) within group (order by notes) as median from per`,
  },
  {
    // WP-14 T12: projects committed in the 14 days, and how long each took to its first plan (the first sign-off the
    // team asked for) and to the first thing a founder approved (a sign-off or an approval, by a person).
    name: "first_session_times",
    text: `with fresh as (
  select b.id, b.committed_at,
         (select min(s.requested_at) from product_signoffs s where s.business_id = b.id and s.requested_at < :as_of_end) as plan_at,
         least((select min(s.decided_at) from product_signoffs s
                 where s.business_id = b.id and s.status = 'approved' and s.decided_by_kind = 'user' and s.decided_at < :as_of_end),
               (select min(a.resolved_at) from approvals a
                 where a.business_id = b.id and a.outcome = 'approved' and a.by_kind = 'user' and a.resolved_at < :as_of_end)) as approved_at
    from businesses b
   where not b.is_demo and b.committed_at >= :as_of_end - interval '14 days' and b.committed_at < :as_of_end
)
select count(*)::int as projects,
       count(*) filter (where plan_at >= committed_at)::int as with_plan,
       count(*) filter (where approved_at >= committed_at)::int as with_approval,
       percentile_cont(0.5) within group (order by extract(epoch from plan_at - committed_at) / 60) filter (where plan_at >= committed_at) as plan_median_min,
       percentile_cont(0.9) within group (order by extract(epoch from plan_at - committed_at) / 60) filter (where plan_at >= committed_at) as plan_p90_min,
       percentile_cont(0.5) within group (order by extract(epoch from approved_at - committed_at) / 60) filter (where approved_at >= committed_at) as approval_median_min,
       percentile_cont(0.9) within group (order by extract(epoch from approved_at - committed_at) / 60) filter (where approved_at >= committed_at) as approval_p90_min
  from fresh`,
  },
  {
    // WP-14 T12: each founder's first press of Continue on a project they started, when it fell in the 14 days, and
    // whether it was refused (`business.continue_refused`, written since this task; a press before it left no row
    // when it was refused, so older founders count from their first press that worked).
    name: "first_session_continue",
    text: `with presses as (
  select l.action, l.created_at, row_number() over (partition by b.created_by order by l.created_at, l.id) as n
    from audit_log l join businesses b on b.id = l.business_id
   where not b.is_demo and b.created_by is not null and l.actor_kind = 'user' and l.actor_id = b.created_by
     and l.action in (${PRESS_ACTIONS.map((a) => `'${a}'`).join(", ")}) and l.created_at < :as_of_end
)
select count(*)::int as founders, count(*) filter (where action <> '${CONTINUE_REFUSED_ACTION}')::int as succeeded
  from presses where n = 1 and created_at >= :as_of_end - interval '14 days'`,
  },
  {
    // WP-14 T12, waiting for T1 (PENDING_SOURCES): projects that started resting 7 to 21 days before the window's end
    // (so each has had a week to act), by the first thing that followed in that week: credits added, a plan change,
    // a visit with neither (waiting for the reset), or no visit at all.
    name: "resting",
    text: `with rested as (
  select e.business_id, min(e.occurred_at) as at
    from events e join businesses b on b.id = e.business_id
   where ${REAL_OUTSIDE} and e.type = '${PENDING_SOURCES.resting}'
     and e.occurred_at >= :as_of_end - interval '21 days' and e.occurred_at < :as_of_end - interval '7 days'
   group by e.business_id
), nxt as (
  select r.business_id,
         (select n.type from events n where n.business_id = r.business_id and n.type in ('${PENDING_SOURCES.toppedUp}', '${PENDING_SOURCES.planChanged}')
            and n.occurred_at > r.at and n.occurred_at < r.at + interval '7 days' order by n.occurred_at limit 1) as did,
         exists (select 1 from founder_visit_days v where v.business_id = r.business_id
                  and v.day > (r.at at time zone 'utc')::date and v.day <= (r.at at time zone 'utc')::date + 7) as visited
    from rested r
)
select (select count(*) from businesses b where ${REAL_OUTSIDE} and b.committed_at < :as_of_end - interval '7 days')::int as projects,
       count(*)::int as rested,
       count(*) filter (where did = '${PENDING_SOURCES.toppedUp}')::int as top_up,
       count(*) filter (where did = '${PENDING_SOURCES.planChanged}')::int as change_plan,
       count(*) filter (where did is null and visited)::int as wait,
       count(*) filter (where did is null and not visited)::int as leave
  from nxt`,
  },
  {
    // WP-14 T12, waiting for T9 (PENDING_SOURCES): real Customer Updates of the 14 days (a customer won, never one
    // from the Simulate panel) and the shares of them.
    name: "customer_updates",
    text: `with updates as (
  select e.payload->>'conversionId' as conversion_id
    from events e join businesses b on b.id = e.business_id
   where ${REAL_OUTSIDE} and e.type = 'customer.converted'
     and not (e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate')
     and not (e.payload ? 'simulated' and e.payload->>'simulated' is distinct from 'false')
     and e.occurred_at >= :as_of_end - interval '14 days' and e.occurred_at < :as_of_end
), shares as (
  select e.payload->>'conversionId' as conversion_id
    from events e join businesses b on b.id = e.business_id
   where ${REAL_OUTSIDE} and e.type = '${PENDING_SOURCES.customerUpdateShared}'
     and e.occurred_at >= :as_of_end - interval '14 days' and e.occurred_at < :as_of_end
)
select (select count(*) from updates)::int as updates,
       (select count(*) from shares)::int as shares,
       (select count(distinct u.conversion_id) from updates u join shares s on s.conversion_id = u.conversion_id)::int as updates_shared`,
  },
  {
    // WP-02 T4's read-only check, as written there (house included, demo out); now() is the snapshot's end.
    name: "honesty_fabricated_left",
    text: `select (select count(*) from entities e join businesses b on b.id = e.business_id join entity_roles r on r.entity_id = e.id
         where not b.is_demo and r.role = 'lead' and r.ended_at is null and e.identifiers->>'email' like '%.example')::int as mock_leads,
       (select count(*) from channel_metrics m join businesses b on b.id = m.business_id where not b.is_demo and m.source = 'estimate')::int as estimate_rows,
       (select count(*) from integrations i join businesses b on b.id = i.business_id where not b.is_demo and i.status = 'mock')::int as mock_integrations,
       (select count(*) from campaigns c join businesses b on b.id = c.business_id join channels ch on ch.id = c.channel_id where not b.is_demo and c.status = 'live' and not ch.kit_mode)::int as live_campaigns,
       (select count(*) from approvals a join businesses b on b.id = a.business_id where not b.is_demo and a.tool = 'launch_campaign' and a.resolved_at is null and a.requested_at < :as_of_end - interval '9 days')::int as stale_launch_approvals`,
  },
  {
    // Outcome-type events the north star leaves out because they were simulated, in its window and over its projects.
    name: "honesty_simulated",
    text: `select count(*)::int as simulated_outcomes_excluded
  from events e join businesses b on b.id = e.business_id
 where ${REAL_OUTSIDE}
   and e.type in ('page.published', 'mail.sent', 'page.followed', 'payment.received', 'lead.replied')
   and e.occurred_at >= date_trunc('week', (:as_of_end - interval '1 day') at time zone 'utc') at time zone 'utc' - interval '11 weeks'
   and e.occurred_at < :as_of_end
   and ((e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate') or (e.payload ? 'simulated' and e.payload->>'simulated' is distinct from 'false'))`,
  },
];

export const FUNNEL_METRICS = ["idea_cards", "cards_kept", "accounts_new", "admitted", "profiles_created", "idea_drafted", "committed", "page_published", "first_other_outcome"] as const;
export type FunnelMetric = (typeof FUNNEL_METRICS)[number];

export interface NorthStarWeek {
  week: string;
  projects_with_real_outcome: number;
  solo: number;
  together: number;
  also_visited: number;
}

export interface MetricFacts {
  /** The UTC day the snapshot is for, and the instant its windows end (the start of the next UTC day). */
  day: string;
  asOfEnd: string;
  accounts: { total: number; new_14d: number; signed_in_14d: number; profiles: number };
  gate: { waitlist: number; invitations: number; admissions: Record<string, number> };
  funnel: {
    per_day: ({ day: string } & Record<FunnelMetric, number>)[];
    totals_14d: Record<FunnelMetric, number>;
    /** The 14-day totals split by the account event's payload: `how`, `client`, `source`. */
    by: { admitted: Record<string, number>; profiles_created: Record<string, number>; idea_drafted: Record<string, number> };
    medians_min: { profile_to_commit: number | null; commit_to_page: number | null };
  };
  projects: { total: number; demo: number; real: number; real_outside: number; committed: number; with_page_draft: number; with_page_live: number };
  /** The last 12 UTC weeks (Monday starts), newest first; a week without an outcome is a row of zeros. */
  north_star: NorthStarWeek[];
  retention: {
    visit_users_14d: number;
    visit_days_14d: number;
    report_14d: { businesses: number; activated: number; habit: number; page_within_24h: number };
    cycles: { projects_with_cycles: number; cycles: number; cycles_median: number | null; span_days_median: number | null; ran_only_first_day: number };
  };
  agent_work: {
    sessions: Record<string, number>;
    sessions_ended: number;
    blocked_share: number | null;
    events: { task_blocked: number; task_completed: number; approval_requested: Record<string, number>; approval_requested_total: number; approval_resolved: Record<string, number>; approval_resolved_total: number };
    approvals_open: number;
    approvals_open_over_9d: number;
    tool_missing_stopped: number;
    notes_day_one: { max: number; median: number | null };
  };
  /** WP-14 T12, over the 14 days: projects committed in them, and founders whose first press of Continue fell in them. */
  first_session: {
    projects: number;
    to_first_plan: { projects: number; median_min: number | null; p90_min: number | null };
    to_first_approval: { projects: number; median_min: number | null; p90_min: number | null };
    first_continue: { founders: number; succeeded: number; share: number | null };
    /** Set when the median time to the first plan passed FIRST_PLAN_SLOW_MINUTES: the operator's note. */
    note: string | null;
  };
  /** WP-14 T12, zeros until T1 writes its events: projects that rested 7 to 21 days ago, by what they did in the week after. */
  resting: { projects: number; rested: number; share: number | null; next: { top_up: number; change_plan: number; wait: number; leave: number } };
  /** WP-14 T12, shares zero until T9 writes its event: real Customer Updates of the 14 days and how often they were shared. */
  customer_updates: { updates: number; shares: number; updates_shared: number; shares_per_update: number | null };
  honesty: {
    fabricated_left: { mock_leads: number; estimate_rows: number; mock_integrations: number; live_campaigns: number; stale_launch_approvals: number };
    simulated_outcomes_excluded: number;
  };
  /** Reports of people, profiles and messages waiting for review, and those past the response target (0136). */
  safety: { reports_open: number; reports_overdue: number };
}

/** The start of the UTC day after `asOf`'s UTC day: every window ends there. */
export function metricWindowEnd(asOf: Date): Date {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  return new Date(d.getTime() + DAY_MS);
}

/** A query's text with the window end written in as a literal (an ISO instant from a Date, never outside input). */
export function boundMetricSql(text: string, end: Date): string {
  return text.replaceAll(":as_of_end", `'${end.toISOString()}'::timestamptz`);
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const share = (part: number, whole: number): number | null => (whole ? Math.round((100 * part) / whole) / 100 : null);

/** The operator's note when the first plan is slow (WP-14 T12): the tour promises "within minutes" (WP-14 T10). */
export function firstPlanNote(medianMin: number | null): string | null {
  if (medianMin === null || medianMin <= FIRST_PLAN_SLOW_MINUTES) return null;
  return `The median time from commit to the first plan is ${medianMin} minutes, over ${FIRST_PLAN_SLOW_MINUTES}. Change the tour's "Within minutes you'll have a product plan" line (WP-14 T10) or make the first plan faster.`;
}

const zeros = (): Record<FunnelMetric, number> => Object.fromEntries(FUNNEL_METRICS.map((m) => [m, 0])) as Record<FunnelMetric, number>;

async function run(db: Executor, name: string, end: Date): Promise<Record<string, unknown>[]> {
  const q = METRIC_QUERIES.find((x) => x.name === name);
  if (!q) throw new Error(`unknown metric query ${name}`);
  return rowsOf(await db.execute(sql.raw(boundMetricSql(q.text, end))));
}

export const metricsRepo = {
  /** Every block of the nightly numbers for the UTC day of `asOf` (windows end at the start of the next UTC day). */
  async snapshot(db: Executor, asOf: Date): Promise<MetricFacts> {
    const end = metricWindowEnd(asOf);
    const r = (name: string) => run(db, name, end);
    const one = async (name: string) => (await r(name))[0] ?? {};

    const accounts = await one("accounts");
    const gate = await one("gate");

    const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(end.getTime() - (14 - i) * DAY_MS)));
    const perDay = new Map(days.map((d) => [d, zeros()]));
    const totals = zeros();
    const by = { admitted: {} as Record<string, number>, profiles_created: {} as Record<string, number>, idea_drafted: {} as Record<string, number> };
    for (const row of await r("funnel_days")) {
      const metric = row.metric as FunnelMetric;
      const n = num(row.n);
      const slot = perDay.get(String(row.day));
      if (slot) slot[metric] += n;
      totals[metric] += n;
      if ((metric === "admitted" || metric === "profiles_created" || metric === "idea_drafted") && row.k) by[metric][String(row.k)] = (by[metric][String(row.k)] ?? 0) + n;
    }
    const medians = await one("funnel_medians");
    const projects = await one("projects");

    const weekRows = new Map((await r("north_star")).map((w) => [String(w.week), w]));
    const lastWeek = new Date(end.getTime() - 1);
    const monday = Date.UTC(lastWeek.getUTCFullYear(), lastWeek.getUTCMonth(), lastWeek.getUTCDate()) - ((lastWeek.getUTCDay() + 6) % 7) * DAY_MS;
    const north_star: NorthStarWeek[] = Array.from({ length: 12 }, (_, i) => {
      const week = dayKey(new Date(monday - i * 7 * DAY_MS));
      const w = weekRows.get(week);
      return { week, projects_with_real_outcome: num(w?.projects_with_real_outcome), solo: num(w?.solo), together: num(w?.together), also_visited: num(w?.also_visited_that_week) };
    });

    const visits = await one("retention_visits");
    const report = await presenceRepo.retentionReport(db, { from: new Date(end.getTime() - 14 * DAY_MS), to: end });
    const cycles = await one("retention_cycles");

    const sessions: Record<string, number> = {};
    for (const s of await r("agent_sessions")) sessions[String(s.outcome)] = num(s.n);
    const ended = Object.values(sessions).reduce((a, b) => a + b, 0);
    const ev = { task_blocked: 0, task_completed: 0, approval_requested: {} as Record<string, number>, approval_requested_total: 0, approval_resolved: {} as Record<string, number>, approval_resolved_total: 0 };
    for (const e of await r("agent_events")) {
      const n = num(e.n);
      const k = String(e.k || "unknown");
      if (e.type === "task.blocked") ev.task_blocked += n;
      else if (e.type === "task.completed") ev.task_completed += n;
      else if (e.type === "approval.requested") {
        ev.approval_requested[k] = (ev.approval_requested[k] ?? 0) + n;
        ev.approval_requested_total += n;
      } else if (e.type === "approval.resolved") {
        ev.approval_resolved[k] = (ev.approval_resolved[k] ?? 0) + n;
        ev.approval_resolved_total += n;
      }
    }
    const approvals = await one("agent_approvals");
    const notes = await one("agent_notes_day_one");
    const times = await one("first_session_times");
    const presses = await one("first_session_continue");
    const resting = await one("resting");
    const updates = await one("customer_updates");
    const planMedian = numOrNull(times.plan_median_min);
    const fabricated = await one("honesty_fabricated_left");
    const simulated = await one("honesty_simulated");
    const reports = await reportsRepo.counts(db, end);

    return {
      day: dayKey(new Date(end.getTime() - DAY_MS)),
      asOfEnd: end.toISOString(),
      accounts: { total: num(accounts.total), new_14d: num(accounts.new_14d), signed_in_14d: num(accounts.signed_in_14d), profiles: num(accounts.profiles) },
      gate: { waitlist: num(gate.waitlist), invitations: num(gate.invitations), admissions: (gate.admissions as Record<string, number> | null) ?? {} },
      funnel: {
        per_day: days.map((d) => ({ day: d, ...perDay.get(d)! })),
        totals_14d: totals,
        by,
        medians_min: { profile_to_commit: numOrNull(medians.profile_to_commit_min), commit_to_page: numOrNull(medians.commit_to_page_min) },
      },
      projects: { total: num(projects.total), demo: num(projects.demo), real: num(projects.real), real_outside: num(projects.real_outside), committed: num(projects.committed), with_page_draft: num(projects.with_page_draft), with_page_live: num(projects.with_page_live) },
      north_star,
      retention: {
        visit_users_14d: num(visits.visit_users_14d),
        visit_days_14d: num(visits.visit_days_14d),
        report_14d: { businesses: report.businesses, activated: report.activated, habit: report.habit, page_within_24h: report.rows.filter((x) => x.activation.pagePublishedWithin24h).length },
        cycles: { projects_with_cycles: num(cycles.projects_with_cycles), cycles: num(cycles.cycles), cycles_median: numOrNull(cycles.cycles_median), span_days_median: numOrNull(cycles.span_days_median), ran_only_first_day: num(cycles.ran_only_first_day) },
      },
      agent_work: {
        sessions,
        sessions_ended: ended,
        blocked_share: ended ? Math.round((100 * (sessions.blocked ?? 0)) / ended) / 100 : null,
        events: ev,
        approvals_open: num(approvals.approvals_open),
        approvals_open_over_9d: num(approvals.approvals_open_over_9d),
        tool_missing_stopped: num(approvals.tool_missing_stopped),
        notes_day_one: { max: num(notes.max), median: numOrNull(notes.median) },
      },
      first_session: {
        projects: num(times.projects),
        to_first_plan: { projects: num(times.with_plan), median_min: planMedian, p90_min: numOrNull(times.plan_p90_min) },
        to_first_approval: { projects: num(times.with_approval), median_min: numOrNull(times.approval_median_min), p90_min: numOrNull(times.approval_p90_min) },
        first_continue: { founders: num(presses.founders), succeeded: num(presses.succeeded), share: share(num(presses.succeeded), num(presses.founders)) },
        note: firstPlanNote(planMedian),
      },
      resting: {
        projects: num(resting.projects),
        rested: num(resting.rested),
        share: share(num(resting.rested), num(resting.projects)),
        next: { top_up: num(resting.top_up), change_plan: num(resting.change_plan), wait: num(resting.wait), leave: num(resting.leave) },
      },
      customer_updates: { updates: num(updates.updates), shares: num(updates.shares), updates_shared: num(updates.updates_shared), shares_per_update: share(num(updates.shares), num(updates.updates)) },
      honesty: {
        fabricated_left: { mock_leads: num(fabricated.mock_leads), estimate_rows: num(fabricated.estimate_rows), mock_integrations: num(fabricated.mock_integrations), live_campaigns: num(fabricated.live_campaigns), stale_launch_approvals: num(fabricated.stale_launch_approvals) },
        simulated_outcomes_excluded: num(simulated.simulated_outcomes_excluded),
      },
      safety: { reports_open: reports.open, reports_overdue: reports.overdue },
    };
  },

  /** Stores one day's facts; a second run for the same day replaces them. */
  async record(db: Executor, day: string, facts: object): Promise<void> {
    await db
      .insert(platformMetricDays)
      .values({ day, facts: facts as Record<string, unknown> })
      .onConflictDoUpdate({ target: platformMetricDays.day, set: { facts: facts as Record<string, unknown>, updatedAt: new Date() } });
  },

  /**
   * The skills preload test (WP-06 T13; founder, Nov 18, 2026): code sessions on real projects whose token rows carry
   * `skills_preload`, from `from` (inclusive) to `to` (exclusive), by half: how many, and their average input tokens,
   * output tokens and cost (USD cents, an Estimate) per code task. A session's cost is every token row booked for it.
   */
  async skillsPreloadComparison(db: Executor, from: Date, to: Date): Promise<Record<"on" | "off", { sessions: number; avgTokensIn: number; avgTokensOut: number; avgCostMinor: number }>> {
    const rows = rowsOf<{ half: "on" | "off"; sessions: number; avg_in: number | null; avg_out: number | null; avg_cost: number | null }>(
      await db.execute(sql`
        with tagged as (
          select distinct u.session_id, u.details ->> 'skills_preload' as half
            from usage_ledger u join businesses b on b.id = u.business_id
           where u.kind = 'tokens' and u.details ? 'skills_preload' and u.session_id is not null
             and u.occurred_at >= ${from} and u.occurred_at < ${to} and ${sql.raw(REAL_OUTSIDE)}
        ), cost as (
          select u.session_id, sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1000000.0 as cost_minor
            from usage_ledger u where u.kind = 'tokens' and u.session_id in (select session_id from tagged) group by u.session_id
        )
        select t.half, count(*)::int as sessions, avg(s.tokens_in)::float as avg_in, avg(s.tokens_out)::float as avg_out, avg(c.cost_minor)::float as avg_cost
          from tagged t join agent_sessions s on s.id = t.session_id join cost c on c.session_id = t.session_id
         group by t.half`),
    );
    const of = (half: "on" | "off") => {
      const r = rows.find((x) => x.half === half);
      return { sessions: r?.sessions ?? 0, avgTokensIn: Math.round(r?.avg_in ?? 0), avgTokensOut: Math.round(r?.avg_out ?? 0), avgCostMinor: Math.round((r?.avg_cost ?? 0) * 100) / 100 };
    };
    return { on: of("on"), off: of("off") };
  },

  /** The last `limit` recorded days, newest first (the CLI's `--history`). */
  async history(db: Executor, limit: number): Promise<{ day: string; facts: Record<string, unknown> }[]> {
    const rows = await db.select({ day: platformMetricDays.day, facts: platformMetricDays.facts }).from(platformMetricDays).orderBy(sql`${platformMetricDays.day} desc`).limit(limit);
    return rows;
  },
};
