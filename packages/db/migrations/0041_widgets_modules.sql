-- 0041 — widgets and module screens: saved table views that persist, and the business time zone.
--
-- saved_table_views (audit #204): the views a person saves on a data table (Team › Agents, CRM, every Distribution,
-- Finance, Legal and Product table, the LIVE leaderboards) were component state and vanished on reload. One row per
-- person × business × table holds the views they made (built-in views stay in code) and the view they last had open.
-- business_id is null for the account-wide LIVE pages (/leaderboards, /communities), which belong to no business.
-- Each person reads and writes only their own rows, and only for businesses they are a member of (the
-- dashboard_layouts rule).
create table saved_table_views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  table_key text not null check (table_key ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
  views jsonb not null default '[]' check (jsonb_typeof(views) = 'array'),
  active_view_id text check (active_view_id is null or length(active_view_id) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index saved_table_views_key_idx on saved_table_views (user_id, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), table_key);
--> statement-breakpoint
create index saved_table_views_business_id_idx on saved_table_views (business_id);
--> statement-breakpoint
alter table saved_table_views enable row level security;
--> statement-breakpoint
create policy saved_table_views_own on saved_table_views for all
  using (user_id = auth.uid() and (business_id is null or is_member(business_id)))
  with check (user_id = auth.uid() and (business_id is null or is_member(business_id)));
--> statement-breakpoint
revoke all on saved_table_views from anon;
--> statement-breakpoint
grant select, insert, update, delete on saved_table_views to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('saved_table_views');
--> statement-breakpoint
-- The business time zone (audit #196): "today", this week and this month on Home, the Journey's days and the top
-- bar's date all follow it, so they agree with each other at any hour. Null until an owner or admin first opens the
-- business (the app sets it from their browser) or picks one in Settings › Business; null reads as UTC. Names are
-- IANA zones; repos.businesses.setTimeZone accepts only names Postgres knows (pg_timezone_names).
alter table businesses add column time_zone text check (time_zone is null or time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$');
--> statement-breakpoint
drop view journey_daily;
--> statement-breakpoint
drop materialized view journey_daily_mv;
--> statement-breakpoint
-- As 0034, with each timestamp bucketed into the business's own day (a zone Postgres does not know reads as UTC, so a
-- bad value can never break the refresh). channel_metrics.day is already a calendar day.
create materialized view journey_daily_mv as
with zones as (
  select b.id as business_id, coalesce(z.name, 'UTC') as zone
    from businesses b left join pg_timezone_names z on z.name = b.time_zone
),
rows as (
  select s.business_id, (s.started_at at time zone zn.zone)::date as day, a.department_ids[1] as department_id,
         extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at) / 3600.0 as agent_hours,
         0 as tasks_done, s.cost_minor as spend_minor, 0::bigint as revenue_minor, 0 as signups, 0 as activations, 0 as payments, 0 as decisions
    from agent_sessions s join agents a on a.id = s.agent_id join zones zn on zn.business_id = s.business_id
  union all
  select t.business_id, (t.ended_at at time zone zn.zone)::date, t.department_id, 0, 1, 0, 0, 0, 0, 0, 0
    from tasks t join zones zn on zn.business_id = t.business_id where t.status = 'done' and t.ended_at is not null
  union all
  select m.business_id, m.day, null, 0, 0, m.spend_minor, 0, 0, 0, 0, 0
    from channel_metrics m
  union all
  select c.business_id, (c.occurred_at at time zone zn.zone)::date, null, 0, 0, 0,
         case when c.kind = 'payment' then c.amount_minor else 0 end,
         case when c.kind = 'signup' then 1 else 0 end,
         case when c.kind = 'activation' then 1 else 0 end,
         case when c.kind = 'payment' and c.first_payment then 1 else 0 end, 0
    from conversions c join zones zn on zn.business_id = c.business_id
  union all
  select d.business_id, (d.decided_at at time zone zn.zone)::date, null, 0, 0, 0, 0, 0, 0, 0, 1
    from decisions d join zones zn on zn.business_id = d.business_id
)
select business_id, day,
       -- nil uuid = "no department" so the key is non-null and the matview can refresh concurrently
       coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) as department_id,
       sum(agent_hours)::numeric(12,3) as agent_hours,
       sum(tasks_done)::int as tasks_done,
       sum(spend_minor)::bigint as spend_minor,
       sum(revenue_minor)::bigint as revenue_minor,
       sum(signups)::int as signups,
       sum(activations)::int as activations,
       sum(payments)::int as payments,
       sum(decisions)::int as decisions
  from rows
 group by business_id, day, department_id
with data;
--> statement-breakpoint
create unique index journey_daily_mv_key_idx on journey_daily_mv (business_id, day, department_id);
--> statement-breakpoint
revoke all on journey_daily_mv from anon, authenticated;
--> statement-breakpoint
grant select on journey_daily_mv to service_role;
--> statement-breakpoint
create view journey_daily with (security_barrier) as
  select * from journey_daily_mv where is_member(business_id);
--> statement-breakpoint
revoke all on journey_daily from anon;
--> statement-breakpoint
grant select on journey_daily to authenticated, service_role;
