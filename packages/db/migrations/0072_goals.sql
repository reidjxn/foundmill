-- 0072 — the business's goal (founder, 2026-11-07: "Your goal"). One number the team aims every round of work at,
-- proposed by the Chief of Staff as an Inbox decision note and approved by the founder in one tap (or changed in their
-- own words, which yields a revised proposal). One row per proposal: proposed → active (approved; the previous active
-- goal becomes replaced) → achieved, or replaced (a change was asked for, or a newer goal was approved). At most one
-- proposed and one active goal per business. Standard tenancy: members read; owner, admin and member write (the api
-- proposes and decides as the user through RLS; ingest marks a goal achieved with the service role; the demo seeds write
-- active goals).
create table goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- 1 for a business's first proposal, then one more for every proposal after it.
  revision int not null default 1 check (revision >= 1),
  -- The goal as the founder reads it ("Get the first 10 paying customers by Dec 19"), written by packages/shared goals.ts.
  sentence text not null check (char_length(sentence) between 1 and 140),
  metric_kind text not null check (metric_kind in ('paying_customers', 'signups', 'revenue_month', 'custom')),
  -- A count, or minor units for revenue_month; null for custom (no number to track).
  target_value bigint check (target_value is null or target_value > 0),
  currency char(3),
  -- Where the number stood when the goal was proposed (and again when it was approved).
  start_value bigint,
  due_on date not null,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'achieved', 'replaced')),
  -- Why it was proposed: the first goal, a revision of the founder's words, the next after one was reached, a new date after a miss.
  reason text not null default 'first' check (reason in ('first', 'revised', 'next', 'missed')),
  proposed_by_agent_id uuid references agents(id) on delete set null,
  -- The goal this proposal replaces once approved (a revised proposal points at the one the founder changed).
  replaces_goal_id uuid references goals(id) on delete set null,
  -- The founder's words when they asked for a change to this proposal.
  change_request text check (change_request is null or char_length(change_request) <= 2000),
  inbox_item_id uuid references inbox_items(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  achieved_at timestamptz,
  achieved_value bigint,
  replaced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (metric_kind <> 'revenue_month' or currency is not null),
  check ((metric_kind = 'custom') = (target_value is null)),
  unique (business_id, revision)
);
--> statement-breakpoint
create unique index goals_one_proposed_idx on goals (business_id) where status = 'proposed';
--> statement-breakpoint
create unique index goals_one_active_idx on goals (business_id) where status = 'active';
--> statement-breakpoint
create index goals_business_idx on goals (business_id, revision desc);
--> statement-breakpoint
create index goals_item_idx on goals (inbox_item_id);
--> statement-breakpoint
create index goals_agent_idx on goals (proposed_by_agent_id);
--> statement-breakpoint
create index goals_replaces_idx on goals (replaces_goal_id);
--> statement-breakpoint
create index goals_approved_by_idx on goals (approved_by);
--> statement-breakpoint
select fm_tenant_table('goals');
