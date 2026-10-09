-- 0020 — founder ↔ agent conversations (the agent's "desk"; audit-conversation §4).
-- A thread is one agent talking with the founder about one subject: an Inbox item, the agent itself, or one task
-- (subject_id points at inbox_items / agents / tasks of the same business; the api checks it, there is no polymorphic
-- FK). Messages are written by the founder or by the agent: 1-3 bubbles (Markdown with [[ent:id|Name]] mentions the api
-- validated against the manifest), the agent's 2-4 quick replies, the chip the founder pressed, and an optional
-- hand-off (work the founder asked for, which only ever runs as a plan through policy and confirmation; plan_id once it
-- was staged). Same access model as the Inbox (0005, `fm_tenant_table` standard): members read, owners, admins and
-- members write; viewers and advisors read only. A message's thread must belong to the same business (composite FK).
create table agent_threads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('inbox_item','agent','task')),
  subject_id uuid not null,
  last_message_at timestamptz,
  message_count int not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_threads_id_business_id_key unique (id, business_id)
);
--> statement-breakpoint
create unique index agent_threads_subject_idx on agent_threads (business_id, agent_id, subject_kind, subject_id);
--> statement-breakpoint
create index agent_threads_agent_id_idx on agent_threads (agent_id);
--> statement-breakpoint
create index agent_threads_recent_idx on agent_threads (business_id, last_message_at desc);
--> statement-breakpoint
select fm_tenant_table('agent_threads');
--> statement-breakpoint
create table agent_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  thread_id uuid not null,
  author_kind text not null check (author_kind in ('founder','agent')),
  author_user_id uuid references auth.users(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  bubbles jsonb not null check (jsonb_typeof(bubbles) = 'array' and jsonb_array_length(bubbles) between 1 and 3),
  reaction text not null default 'none' check (reaction in ('none','noted','thinking','concerned','pleased')),
  quick_replies jsonb not null default '[]' check (jsonb_typeof(quick_replies) = 'array' and jsonb_array_length(quick_replies) <= 4),
  chosen_quick_reply_id text check (chosen_quick_reply_id is null or chosen_quick_reply_id ~ '^[a-z0-9_-]{1,24}$'),
  hand_off jsonb check (hand_off is null or jsonb_typeof(hand_off) = 'object'),
  refers_to text[] not null default '{}',
  entity_ids uuid[] not null default '{}',
  plan_id uuid references plans(id) on delete set null,
  -- Route, model, cost (Estimate) and what the server-side checks repaired; never shown as fact.
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_messages_thread_fkey foreign key (thread_id, business_id) references agent_threads(id, business_id) on delete cascade,
  -- Founders press chips and agents offer them, never the other way round.
  constraint agent_messages_founder_shape check (author_kind = 'agent' or (jsonb_array_length(quick_replies) = 0 and hand_off is null)),
  constraint agent_messages_agent_shape check (author_kind = 'founder' or chosen_quick_reply_id is null),
  -- Bounded: a few short bubbles and four chips; a runaway value is refused rather than stored.
  constraint agent_messages_size check (octet_length(bubbles::text) <= 16384 and octet_length(quick_replies::text) <= 8192 and octet_length(meta::text) <= 8192)
);
--> statement-breakpoint
create index agent_messages_thread_idx on agent_messages (thread_id, created_at);
--> statement-breakpoint
create index agent_messages_business_id_idx on agent_messages (business_id, created_at desc);
--> statement-breakpoint
create index agent_messages_author_user_id_idx on agent_messages (author_user_id);
--> statement-breakpoint
create index agent_messages_agent_id_idx on agent_messages (agent_id);
--> statement-breakpoint
create index agent_messages_plan_id_idx on agent_messages (plan_id);
--> statement-breakpoint
select fm_tenant_table('agent_messages');
