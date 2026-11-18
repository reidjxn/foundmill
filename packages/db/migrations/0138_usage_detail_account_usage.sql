-- 0138 — what a session did, and model calls made before a project exists (WP-09 T1 and T2).
--
-- agent_sessions gains the figures the cost report needs to say what a session cost and why: the route it ran on, the
-- effort the SDK reported, its turn count and its cache-read and cache-write token totals (tokens_in stays the input
-- figure). All are null or 0 on sessions that ended before this migration.
--
-- account_usage: one row per live model call a signed-in person makes before they have a project (Ideation, Import,
-- Ask on a concept, compare, a logo before commit, the screen of a post made without a project), at its exact cost.
-- The api's pre-commit ceilings sum it per account; the cost report joins it to a project through businesses.created_by.
-- No business_id, so it is in neither the tenant nor the export tables. The services' alone: RLS on, no policy, no
-- client grant; the service role may read and add rows, never change or delete them.
alter table agent_sessions
  add column route text,
  add column effort text,
  add column num_turns integer check (num_turns >= 0),
  add column cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  add column cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0);
--> statement-breakpoint
create table account_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  route text not null,
  model_key text check (model_key in ('opus', 'sonnet', 'haiku', 'glm')),
  quantity bigint not null default 0 check (quantity >= 0),
  cost_micro_minor bigint not null default 0 check (cost_micro_minor >= 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index account_usage_user_id_occurred_at_idx on account_usage (user_id, occurred_at);
--> statement-breakpoint
alter table account_usage enable row level security;
--> statement-breakpoint
revoke all on account_usage from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert on account_usage to service_role;
--> statement-breakpoint
select fm_track_updated_at('account_usage');
