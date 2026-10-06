-- 0005 — inbox items, decisions, plans, plan actions, composer buffer.
create table inbox_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('decision','customer_won','warning','update','milestone','report','human_message')),
  from_agent_id uuid references agents(id) on delete set null,
  from_user_id uuid references auth.users(id) on delete set null,
  subject text not null,
  body_md text not null default '',
  status_strip jsonb not null default '[]',
  exhibit jsonb not null default '{"kind":"none"}',
  decision jsonb,
  blocks_continue boolean not null default false,
  source_event_ids uuid[] not null default '{}',
  entity_ids uuid[] not null default '{}',
  state text not null default 'unread' check (state in ('unread','read','answered','archived')),
  cost_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index inbox_items_business_id_idx on inbox_items (business_id, created_at desc);
--> statement-breakpoint
create index inbox_items_state_idx on inbox_items (business_id, state) where state <> 'archived';
--> statement-breakpoint
create index inbox_items_type_idx on inbox_items (business_id, type);
--> statement-breakpoint
create index inbox_items_from_agent_id_idx on inbox_items (from_agent_id);
--> statement-breakpoint
create index inbox_items_from_user_id_idx on inbox_items (from_user_id);
--> statement-breakpoint
create index inbox_items_blocks_continue_idx on inbox_items (business_id) where blocks_continue and state in ('unread','read');
--> statement-breakpoint
select fm_tenant_table('inbox_items');
--> statement-breakpoint
alter table change_proposals add constraint change_proposals_inbox_item_id_fkey foreign key (inbox_item_id) references inbox_items(id) on delete set null;
--> statement-breakpoint
alter table holiday_periods add constraint holiday_periods_report_inbox_item_id_fkey foreign key (report_inbox_item_id) references inbox_items(id) on delete set null;
--> statement-breakpoint
create table plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  origin text not null check (origin in ('option','free_text','playbook','holiday')),
  status text not null default 'pending_confirmation' check (status in ('pending_confirmation','executing','done','failed')),
  summary_md text not null default '',
  inbox_item_id uuid references inbox_items(id) on delete set null,
  playbook_id uuid references playbooks(id) on delete set null,
  workflow_id text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index plans_business_id_idx on plans (business_id, created_at desc);
--> statement-breakpoint
create index plans_status_idx on plans (business_id, status);
--> statement-breakpoint
create index plans_inbox_item_id_idx on plans (inbox_item_id);
--> statement-breakpoint
create index plans_playbook_id_idx on plans (playbook_id);
--> statement-breakpoint
select fm_tenant_table('plans');
--> statement-breakpoint
create table decisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  inbox_item_id uuid not null references inbox_items(id) on delete cascade,
  chosen_option text,
  free_text text,
  decided_by_kind text not null default 'user' check (decided_by_kind in ('user','chief_of_staff')),
  decided_by uuid,
  decided_at timestamptz not null default now(),
  plan_id uuid references plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index decisions_business_id_idx on decisions (business_id, decided_at desc);
--> statement-breakpoint
create index decisions_inbox_item_id_idx on decisions (inbox_item_id);
--> statement-breakpoint
create index decisions_plan_id_idx on decisions (plan_id);
--> statement-breakpoint
select fm_tenant_table('decisions');
--> statement-breakpoint
create table plan_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  position int not null default 0,
  type text not null check (type in (
    'create_task','enable_channel','disable_channel','set_budget','approve_spend','update_spec','update_roadmap',
    'send_message','schedule_meeting','hire_agent','train_agent','set_agent_model','create_playbook','request_human_action','reply_only'
  )),
  params jsonb not null default '{}',
  agent_id uuid references agents(id) on delete set null,
  policy_outcome text check (policy_outcome in ('allow','ask','deny')),
  status text not null default 'pending' check (status in ('pending','awaiting_approval','running','done','failed','skipped','denied')),
  result jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index plan_actions_business_id_idx on plan_actions (business_id);
--> statement-breakpoint
create index plan_actions_plan_id_idx on plan_actions (plan_id, position);
--> statement-breakpoint
create index plan_actions_agent_id_idx on plan_actions (agent_id);
--> statement-breakpoint
create index plan_actions_status_idx on plan_actions (business_id, status);
--> statement-breakpoint
select fm_tenant_table('plan_actions');
--> statement-breakpoint
alter table tasks add constraint tasks_plan_action_id_fkey foreign key (plan_action_id) references plan_actions(id) on delete set null;
--> statement-breakpoint
-- Pre-narrated candidates for Inbox Refresh (3 per business). Written by the composer service only.
create table composer_buffer (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  candidate jsonb not null,
  source_hash text not null,
  priority int not null default 0,
  valid boolean not null default true,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, source_hash)
);
--> statement-breakpoint
create index composer_buffer_business_id_idx on composer_buffer (business_id, priority desc) where valid and consumed_at is null;
--> statement-breakpoint
select fm_tenant_table('composer_buffer', array['owner','admin','member'], 'read_only');
