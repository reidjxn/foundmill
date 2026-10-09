-- Code an agent writes on a code task, kept after its session ends (the session workspace is deleted).
-- workspace_blobs holds each file's content once per business, addressed by its sha256; workspace_snapshots
-- holds one manifest per saved session ({ path, sha256, size } per file). The orchestrator writes both with the
-- service role; members of the business read them (Development › Code). A new session on the same task starts
-- from the latest snapshot. Owners and admins may delete them (forget a task's saved code); nothing else does,
-- apart from the orchestrator's retention (the newest snapshots per task) and its sweep of unreferenced blobs.
create table workspace_blobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sha256 char(64) not null,
  size_bytes integer not null check (size_bytes >= 0),
  content bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index workspace_blobs_business_sha_idx on workspace_blobs (business_id, sha256);
--> statement-breakpoint
select fm_tenant_table('workspace_blobs', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table workspace_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  session_id uuid references agent_sessions(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  branch text,
  files jsonb not null default '[]'::jsonb,
  file_count integer not null default 0,
  total_bytes bigint not null default 0,
  added integer not null default 0,
  changed integer not null default 0,
  removed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index workspace_snapshots_business_id_idx on workspace_snapshots (business_id, created_at desc);
--> statement-breakpoint
create index workspace_snapshots_task_id_idx on workspace_snapshots (task_id, created_at desc);
--> statement-breakpoint
create index workspace_snapshots_session_id_idx on workspace_snapshots (session_id);
--> statement-breakpoint
create index workspace_snapshots_agent_id_idx on workspace_snapshots (agent_id);
--> statement-breakpoint
-- Which snapshots still reference a blob (retention and the orphan sweep): files @> [{"sha256": …}].
create index workspace_snapshots_files_idx on workspace_snapshots using gin (files jsonb_path_ops);
--> statement-breakpoint
select fm_tenant_table('workspace_snapshots', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
-- When a task's saved code was forgotten: a session that started before then cannot save it again.
alter table tasks add column code_forgotten_at timestamptz;
--> statement-breakpoint
-- A founder action, never an agent's: owners and admins may forget a task's saved code.
create policy workspace_snapshots_forget on workspace_snapshots for delete using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
create policy workspace_blobs_forget on workspace_blobs for delete using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
-- Development departments created before this migration get the Code tab right after Pull requests, where new ones
-- get it from MODULE_TABS (or last when Pull requests is gone). Later tabs move one place to make room.
update screen_definitions s
   set position = s.position + 1, updated_at = now()
  from screen_definitions pr
  join departments d on d.id = pr.department_id
 where pr.tab_slug = 'pull-requests'
   and 'development' = any(d.module_keys)
   and s.department_id = pr.department_id
   and s.position > pr.position
   and not exists (select 1 from screen_definitions c where c.department_id = d.id and c.tab_slug = 'code');
--> statement-breakpoint
insert into screen_definitions (business_id, department_id, tab_slug, title, position, layout)
select d.business_id, d.id, 'code', 'Code',
       coalesce((select pr.position + 1 from screen_definitions pr where pr.department_id = d.id and pr.tab_slug = 'pull-requests'),
                (select max(s.position) + 1 from screen_definitions s where s.department_id = d.id),
                0),
       '{"widgets":[{"key":"module:development/code","x":0,"y":0,"w":12,"h":60,"settings":{}}]}'::jsonb
  from departments d
 where 'development' = any(d.module_keys)
on conflict (department_id, tab_slug) do nothing;
