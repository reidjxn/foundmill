-- WP-02 T10: the nightly numbers. One row per UTC day of counts across real projects (funnel, north star, retention,
-- agent work, honesty), written by the orchestrator's `platform-metrics` schedule through `repos.metrics.record`. It
-- holds no ids and no names, and it is not business-scoped: RLS on, no policy, no client grant (as 0088 does for
-- `attributions`), so only the service role reads or writes it. `id` and `updated_at` are there because every table
-- has them (migrations.test.ts); the day is the key, and a second run for a day replaces its facts.
create table platform_metric_days (
  day date primary key,
  id uuid not null default gen_random_uuid() constraint platform_metric_days_id_key unique,
  facts jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
select fm_track_updated_at('platform_metric_days');
--> statement-breakpoint
alter table platform_metric_days enable row level security;
--> statement-breakpoint
revoke all on platform_metric_days from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on platform_metric_days to service_role;
--> statement-breakpoint
-- A8-08 fix 3: cross-business reads of one event type over a window (the north star, the agent-work counts) without
-- scanning `events`; every other index on it starts with business_id.
create index events_type_occurred_idx on events (type, occurred_at desc);
