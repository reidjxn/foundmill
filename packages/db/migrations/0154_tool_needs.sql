-- 0154 — the tool scout's memory (founder, Nov 22, 2026: "the most important skill the agents can have is finding the
-- right tool or connector for the founder at the right time"). One row per project per kind of tool: what the project
-- needs, when the need was raised, what the Chief of Staff recommended with the alternatives and the reasons, and what
-- the founder answered. The unique key is the dedupe: a need is raised once per project per category, and a later
-- agent reads why X was chosen instead of asking again. "Not now" is kept too, with when to ask again.
--
-- Who may do what:
--   read    members of the business
--   write   the services only (the gateway's platform tools, the api's stage triggers and the note's answer)
--
-- `status`:
--   planned      known at take charge, raised when its `stage` arrives (a regulated money product's identity checks
--                wait for the first real users)
--   open         raised; the scout's task (`task_id`) is on the board
--   recommended  the founder has the note (`inbox_item_id`) with the pick
--   accepted     the founder said yes
--   not_now      the founder said not now; nothing is raised again before `ask_again_at`
--
-- A new kind of task, `tool_need`: "the project cannot do X because it has no Y", the Chief of Staff's to answer.
alter table tasks drop constraint tasks_kind_check;
--> statement-breakpoint
alter table tasks add constraint tasks_kind_check check (kind in ('code','research','channel','specialist','legal','finance','ops','tool_need'));
--> statement-breakpoint
create table tool_needs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- `TOOL_CATEGORIES` in @foundmill/shared (a test compares the two lists).
  category text not null
    constraint tool_needs_category_value check (category in ('booking','kyc_identity','aml_screening','payments','subscriptions','e_signature','invoicing_accounting','email','sms','forms','help_desk','analytics','shipping','inventory','patents_ip')),
  -- `TOOL_NEED_STAGES`; null for a need an agent raised from a task.
  stage text
    constraint tool_needs_stage_value check (stage is null or stage in ('take_charge','page_drafted','first_customers','first_payment')),
  status text not null default 'open'
    constraint tool_needs_status_value check (status in ('planned','open','recommended','accepted','not_now')),
  -- Why the project needs it, and why now: the seed's words, or the agent's.
  reason text not null constraint tool_needs_reason_length check (char_length(reason) between 1 and 2000),
  raised_by_agent_id uuid,
  task_id uuid references tasks(id) on delete set null,
  inbox_item_id uuid references inbox_items(id) on delete set null,
  -- The recommendation as the founder read it: `{ name, catalogKey?, route, why, whyNow, cost, founderSteps }`.
  pick jsonb constraint tool_needs_pick_object check (pick is null or jsonb_typeof(pick) = 'object'),
  -- `[{ name, line }]`, the options not picked, one line each.
  alternatives jsonb not null default '[]'::jsonb constraint tool_needs_alternatives_array check (jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 5),
  -- `[{ url, title }]`, what the comparison cites.
  sources jsonb not null default '[]'::jsonb constraint tool_needs_sources_array check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  decided_at timestamptz,
  ask_again_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_needs_business_category_key unique (business_id, category),
  constraint tool_needs_not_now_has_time check ((status = 'not_now') = (ask_again_at is not null))
);
--> statement-breakpoint
create index tool_needs_task_id_idx on tool_needs (task_id);
--> statement-breakpoint
create index tool_needs_inbox_item_id_idx on tool_needs (inbox_item_id);
--> statement-breakpoint
select fm_tenant_table('tool_needs', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on tool_needs from anon, authenticated;
