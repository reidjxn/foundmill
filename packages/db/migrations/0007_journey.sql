-- 0007 — customer journey: visitors, touches, conversions, journeys, journey_daily, milestones.
-- entity_id FKs to entities are added in 0008 (CRM) once that table exists.
create table visitors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  anon_id text not null,
  entity_id uuid,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  consent_state text not null default 'unknown' check (consent_state in ('unknown','granted','denied','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, anon_id)
);
--> statement-breakpoint
create index visitors_business_id_idx on visitors (business_id);
--> statement-breakpoint
create index visitors_entity_id_idx on visitors (entity_id);
--> statement-breakpoint
select fm_tenant_table('visitors', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table touches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  visitor_id uuid references visitors(id) on delete set null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  channel_key text check (channel_key in (
    'lead_generation','email_automation','seo','geo','content','social','paid_ads','influencer','affiliate',
    'direct_mail','print','broadcast','outdoor','pr','events'
  )),
  campaign_id uuid references campaigns(id) on delete set null,
  source jsonb not null default '{}',
  kind text not null default 'visit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visitor_id is not null or entity_id is not null)
);
--> statement-breakpoint
create index touches_business_id_idx on touches (business_id, occurred_at desc);
--> statement-breakpoint
create index touches_visitor_id_idx on touches (visitor_id, occurred_at);
--> statement-breakpoint
create index touches_entity_id_idx on touches (entity_id, occurred_at);
--> statement-breakpoint
create index touches_campaign_id_idx on touches (campaign_id);
--> statement-breakpoint
create index touches_channel_key_idx on touches (business_id, channel_key);
--> statement-breakpoint
select fm_tenant_table('touches', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table conversions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entity_id uuid,
  kind text not null check (kind in ('signup','activation','payment')),
  amount_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  occurred_at timestamptz not null default now(),
  source_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index conversions_business_id_idx on conversions (business_id, occurred_at desc);
--> statement-breakpoint
create index conversions_entity_id_idx on conversions (entity_id);
--> statement-breakpoint
create index conversions_kind_idx on conversions (business_id, kind, occurred_at);
--> statement-breakpoint
create index conversions_source_event_id_idx on conversions (source_event_id);
--> statement-breakpoint
select fm_tenant_table('conversions', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table journeys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  conversion_id uuid not null unique references conversions(id) on delete cascade,
  touch_ids uuid[] not null default '{}',
  weights jsonb not null default '{}',
  xc_series jsonb not null default '[]',
  commentary jsonb not null default '[]',
  agents jsonb not null default '[]',
  matchday_level text not null check (matchday_level in ('friendly','league','cup')),
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index journeys_business_id_idx on journeys (business_id, created_at desc);
--> statement-breakpoint
create index journeys_matchday_level_idx on journeys (business_id, matchday_level);
--> statement-breakpoint
select fm_tenant_table('journeys', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
-- Write-role members may mark a journey as viewed; nothing else is user-writable (viewers never write).
create policy journeys_mark_viewed on journeys for update
  using (has_role(business_id, array['owner','admin','member'])) with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create table milestones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('customer','revenue','release','decision','incorporation','funding','launch','trophy')),
  label text not null,
  achieved_at timestamptz not null default now(),
  ref jsonb,
  visibility text not null default 'private' check (visibility in ('public','connections','community','private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index milestones_business_id_idx on milestones (business_id, achieved_at desc);
--> statement-breakpoint
select fm_tenant_table('milestones');
--> statement-breakpoint
-- journey_daily: one row per business × day × department. Materialised for the Ribbon
-- (2 years of data must render < 2 s). The matview itself cannot carry RLS, so app roles
-- only see it through the security-barrier view `journey_daily` below.
create materialized view journey_daily_mv as
with rows as (
  select s.business_id, (s.started_at at time zone 'UTC')::date as day, a.department_ids[1] as department_id,
         extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at) / 3600.0 as agent_hours,
         0 as tasks_done, s.cost_minor as spend_minor, 0::bigint as revenue_minor, 0 as signups, 0 as activations, 0 as payments, 0 as decisions
    from agent_sessions s join agents a on a.id = s.agent_id
  union all
  select t.business_id, (t.ended_at at time zone 'UTC')::date, t.department_id, 0, 1, 0, 0, 0, 0, 0, 0
    from tasks t where t.status = 'done' and t.ended_at is not null
  union all
  select m.business_id, m.day, null, 0, 0, m.spend_minor, 0, 0, 0, 0, 0
    from channel_metrics m
  union all
  select c.business_id, (c.occurred_at at time zone 'UTC')::date, null, 0, 0, 0,
         case when c.kind = 'payment' then c.amount_minor else 0 end,
         case when c.kind = 'signup' then 1 else 0 end,
         case when c.kind = 'activation' then 1 else 0 end,
         case when c.kind = 'payment' then 1 else 0 end, 0
    from conversions c
  union all
  select d.business_id, (d.decided_at at time zone 'UTC')::date, null, 0, 0, 0, 0, 0, 0, 0, 1
    from decisions d
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
--> statement-breakpoint
-- Called by the metrics consumer (after journey/conversion writes, debounced) and nightly.
create function refresh_journey_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently journey_daily_mv;
end;
$$;
--> statement-breakpoint
revoke all on function refresh_journey_daily() from public;
--> statement-breakpoint
grant execute on function refresh_journey_daily() to service_role;
