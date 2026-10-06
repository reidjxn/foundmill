-- 0004 — agents, versions, skills, training, departments, screens, dashboards, tasks, playbooks, holidays.
create table agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  role text not null default '',
  agent_type text not null,
  layer text not null default 'worker' check (layer in ('assistant','lead','worker','utility')),
  description_md text not null default '',
  department_ids uuid[] not null default '{}',
  line_manager_id uuid references agents(id) on delete set null,
  model_key text not null default 'sonnet' check (model_key in ('opus','sonnet','haiku')),
  status text not null default 'idle' check (status in ('healthy','degraded','failing','injured','paused','idle')),
  current_version_id uuid,
  autonomy jsonb not null default '{}',
  negotiation jsonb not null default '{}',
  schedule jsonb not null default '{}',
  wage_cap_minor bigint,
  currency char(3) not null default 'EUR',
  avatar_seed text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index agents_business_id_idx on agents (business_id);
--> statement-breakpoint
create index agents_status_idx on agents (business_id, status);
--> statement-breakpoint
create index agents_line_manager_id_idx on agents (line_manager_id);
--> statement-breakpoint
create index agents_name_trgm_idx on agents using gin (name gin_trgm_ops);
--> statement-breakpoint
select fm_tenant_table('agents');
--> statement-breakpoint
create table agent_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  version int not null default 1,
  instructions jsonb not null default '{}',
  tools jsonb not null default '[]',
  model_key text not null default 'sonnet' check (model_key in ('opus','sonnet','haiku')),
  state text not null default 'draft' check (state in ('draft','live','retired')),
  created_by_kind text not null default 'user' check (created_by_kind in ('user','agent','system')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, version)
);
--> statement-breakpoint
create index agent_versions_business_id_idx on agent_versions (business_id);
--> statement-breakpoint
create index agent_versions_agent_id_idx on agent_versions (agent_id, state);
--> statement-breakpoint
select fm_tenant_table('agent_versions');
--> statement-breakpoint
alter table agents add constraint agents_current_version_id_fkey foreign key (current_version_id) references agent_versions(id) on delete set null;
--> statement-breakpoint
create index agents_current_version_id_idx on agents (current_version_id);
--> statement-breakpoint
create table departments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  icon text not null default 'folder',
  colour_token text not null default 'dept-1',
  position int not null default 0,
  lead_agent_id uuid references agents(id) on delete set null,
  module_keys text[] not null default '{}',
  budget_minor bigint,
  currency char(3) not null default 'EUR',
  approvers jsonb not null default '[]',
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, slug)
);
--> statement-breakpoint
create index departments_business_id_idx on departments (business_id, position);
--> statement-breakpoint
create index departments_lead_agent_id_idx on departments (lead_agent_id);
--> statement-breakpoint
select fm_tenant_table('departments', array['owner','admin']);
--> statement-breakpoint
create table department_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  member_kind text not null check (member_kind in ('agent','human')),
  member_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, member_kind, member_id)
);
--> statement-breakpoint
create index department_members_business_id_idx on department_members (business_id);
--> statement-breakpoint
create index department_members_department_id_idx on department_members (department_id);
--> statement-breakpoint
create index department_members_member_id_idx on department_members (member_id);
--> statement-breakpoint
select fm_tenant_table('department_members', array['owner','admin']);
--> statement-breakpoint
create table screen_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  tab_slug text not null,
  title text not null,
  position int not null default 0,
  layout jsonb not null default '{"widgets":[]}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (department_id, tab_slug)
);
--> statement-breakpoint
create index screen_definitions_business_id_idx on screen_definitions (business_id);
--> statement-breakpoint
create index screen_definitions_department_id_idx on screen_definitions (department_id, position);
--> statement-breakpoint
select fm_tenant_table('screen_definitions');
--> statement-breakpoint
-- Home layouts are per user per business.
create table dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Home',
  preset text,
  layout jsonb not null default '{"widgets":[]}',
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index dashboard_layouts_business_id_idx on dashboard_layouts (business_id);
--> statement-breakpoint
create index dashboard_layouts_user_id_idx on dashboard_layouts (user_id, business_id);
--> statement-breakpoint
alter table dashboard_layouts enable row level security;
--> statement-breakpoint
create policy dashboard_layouts_own on dashboard_layouts for all
  using (user_id = auth.uid() and is_member(business_id))
  with check (user_id = auth.uid() and is_member(business_id));
--> statement-breakpoint
revoke all on dashboard_layouts from anon;
--> statement-breakpoint
grant select, insert, update, delete on dashboard_layouts to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('dashboard_layouts');
--> statement-breakpoint
-- skill_definitions: business_id null = platform-wide definition (service_role writes those).
create table skill_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  agent_type text not null,
  skill_key text not null,
  name text not null,
  description text not null default '',
  "group" text not null check ("group" in ('craft','judgement','execution')),
  custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create unique index skill_definitions_platform_key_idx on skill_definitions (agent_type, skill_key) where business_id is null;
--> statement-breakpoint
create unique index skill_definitions_business_key_idx on skill_definitions (business_id, agent_type, skill_key) where business_id is not null;
--> statement-breakpoint
create index skill_definitions_business_id_idx on skill_definitions (business_id);
--> statement-breakpoint
alter table skill_definitions enable row level security;
--> statement-breakpoint
create policy skill_definitions_select on skill_definitions for select using (business_id is null or is_member(business_id));
--> statement-breakpoint
create policy skill_definitions_write on skill_definitions for all
  using (business_id is not null and has_role(business_id, array['owner','admin','member']))
  with check (business_id is not null and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke all on skill_definitions from anon;
--> statement-breakpoint
grant select, insert, update, delete on skill_definitions to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('skill_definitions');
--> statement-breakpoint
create table skill_tests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  skill_definition_id uuid not null references skill_definitions(id) on delete cascade,
  task jsonb not null default '{}',
  rubric jsonb not null default '{}',
  held_out boolean not null default false,
  fixtures_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index skill_tests_skill_definition_id_idx on skill_tests (skill_definition_id);
--> statement-breakpoint
create index skill_tests_business_id_idx on skill_tests (business_id);
--> statement-breakpoint
alter table skill_tests enable row level security;
--> statement-breakpoint
-- Held-out tests are never readable by app roles (they would leak into training); platform tests readable.
create policy skill_tests_select on skill_tests for select using (
  held_out = false and (business_id is null or is_member(business_id))
);
--> statement-breakpoint
-- Split per command (a `for all` policy's USING clause would make held-out rows visible to writers).
-- Held-out tests are managed by services only.
create policy skill_tests_insert on skill_tests for insert
  with check (business_id is not null and held_out = false and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy skill_tests_update on skill_tests for update
  using (business_id is not null and held_out = false and has_role(business_id, array['owner','admin','member']))
  with check (business_id is not null and held_out = false and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy skill_tests_delete on skill_tests for delete
  using (business_id is not null and held_out = false and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke all on skill_tests from anon;
--> statement-breakpoint
grant select, insert, update, delete on skill_tests to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('skill_tests');
--> statement-breakpoint
create table agent_skills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  skill_key text not null,
  "group" text not null check ("group" in ('craft','judgement','execution')),
  tested numeric(6,3),
  proven numeric(6,3),
  n_live int not null default 0,
  displayed int not null default 1 check (displayed between 1 and 20),
  potential int not null default 1 check (potential between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, skill_key)
);
--> statement-breakpoint
create index agent_skills_business_id_idx on agent_skills (business_id);
--> statement-breakpoint
create index agent_skills_agent_id_idx on agent_skills (agent_id);
--> statement-breakpoint
select fm_tenant_table('agent_skills', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table training_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  from_version_id uuid references agent_versions(id) on delete set null,
  to_version_id uuid references agent_versions(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','grading','awaiting_decision','done','failed','cancelled')),
  cost_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  results jsonb not null default '{}',
  coach_summary_md text not null default '',
  decision text check (decision in ('promoted','discarded')),
  watch_until timestamptz,
  requested_by uuid,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index training_runs_business_id_idx on training_runs (business_id);
--> statement-breakpoint
create index training_runs_agent_id_idx on training_runs (agent_id, status);
--> statement-breakpoint
create index training_runs_from_version_id_idx on training_runs (from_version_id);
--> statement-breakpoint
create index training_runs_to_version_id_idx on training_runs (to_version_id);
--> statement-breakpoint
select fm_tenant_table('training_runs');
--> statement-breakpoint
create table tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('code','research','channel','specialist','legal','finance','ops')),
  title text not null,
  goal_md text not null default '',
  acceptance jsonb not null default '[]',
  file_scope text[] not null default '{}',
  roadmap_item_id uuid references roadmap_items(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  assignee_agent_id uuid references agents(id) on delete set null,
  plan_action_id uuid,
  status text not null default 'planned' check (status in ('planned','ready','running','paused','blocked','review','merging','done','failed','stopped')),
  progress numeric(5,4) not null default 0 check (progress between 0 and 1),
  phase text check (phase in ('planning','implementing','testing','review','merge','done')),
  eta timestamptz,
  priority int not null default 0,
  budget_minor bigint,
  currency char(3) not null default 'EUR',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index tasks_business_id_idx on tasks (business_id);
--> statement-breakpoint
create index tasks_status_idx on tasks (business_id, status);
--> statement-breakpoint
create index tasks_assignee_agent_id_idx on tasks (assignee_agent_id);
--> statement-breakpoint
create index tasks_roadmap_item_id_idx on tasks (roadmap_item_id);
--> statement-breakpoint
create index tasks_department_id_idx on tasks (department_id);
--> statement-breakpoint
create index tasks_plan_action_id_idx on tasks (plan_action_id);
--> statement-breakpoint
select fm_tenant_table('tasks');
--> statement-breakpoint
create table task_edges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  from_task uuid not null references tasks(id) on delete cascade,
  to_task uuid not null references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_task, to_task),
  check (from_task <> to_task)
);
--> statement-breakpoint
create index task_edges_business_id_idx on task_edges (business_id);
--> statement-breakpoint
create index task_edges_to_task_idx on task_edges (to_task);
--> statement-breakpoint
select fm_tenant_table('task_edges');
--> statement-breakpoint
create table agent_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  version_id uuid references agent_versions(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  workflow_id text,
  model_key text not null default 'sonnet' check (model_key in ('opus','sonnet','haiku')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  outcome text,
  recording_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index agent_sessions_business_id_idx on agent_sessions (business_id, started_at desc);
--> statement-breakpoint
create index agent_sessions_agent_id_idx on agent_sessions (agent_id, started_at desc);
--> statement-breakpoint
create index agent_sessions_task_id_idx on agent_sessions (task_id);
--> statement-breakpoint
create index agent_sessions_version_id_idx on agent_sessions (version_id);
--> statement-breakpoint
create index agent_sessions_workflow_id_idx on agent_sessions (workflow_id);
--> statement-breakpoint
select fm_tenant_table('agent_sessions', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table agent_metrics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  day date not null,
  tasks_done int not null default 0,
  success_rate numeric(5,4),
  review_findings int not null default 0,
  approvals_rejected int not null default 0,
  rating_avg numeric(4,2),
  cost_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, day)
);
--> statement-breakpoint
create index agent_metrics_business_id_idx on agent_metrics (business_id, day);
--> statement-breakpoint
select fm_tenant_table('agent_metrics', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table playbooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name text not null default '',
  source_text text not null,
  compiled jsonb not null default '{}',
  enabled boolean not null default false,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index playbooks_business_id_idx on playbooks (business_id);
--> statement-breakpoint
create index playbooks_department_id_idx on playbooks (department_id);
--> statement-breakpoint
select fm_tenant_table('playbooks');
--> statement-breakpoint
create table holiday_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  until_at timestamptz,
  until_condition jsonb,
  authority jsonb not null default '{}',
  budget_ceiling_minor bigint,
  currency char(3) not null default 'EUR',
  wake_events text[] not null default '{}',
  started_at timestamptz,
  ended_at timestamptz,
  report_inbox_item_id uuid,
  started_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index holiday_periods_business_id_idx on holiday_periods (business_id, started_at desc);
--> statement-breakpoint
create index holiday_periods_report_inbox_item_id_idx on holiday_periods (report_inbox_item_id);
--> statement-breakpoint
select fm_tenant_table('holiday_periods', array['owner','admin']);
