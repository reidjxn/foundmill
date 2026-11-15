-- 0110 — task reports (WP-05 T3, audit AR-02). The result of a task an agent finished: its findings, sources and what it
-- recommends, saved with the platform's `save_report` (or, when the session saved none, the summary `complete_task`
-- carried). The next agent reads it with `read_report`; the founder's note on the finished task quotes it.
--
-- Who may do what:
--   read    members of the business, as for `tasks` (a collaborator reads the task board, so its reports too)
--   write   the services only (the gateway's platform tools)
--
-- `simulated` is set by the gateway, never by the agent: true when a call of the session that saved the report ran on a
-- mock connector, so a report built on simulated reads never counts as a real result. A report may quote the web: the
-- tools hand it back to agents as untrusted content.
create table task_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  -- The session that saved it; null outside one.
  session_id uuid,
  agent_id uuid not null,
  title text not null constraint task_reports_title_length check (char_length(title) between 1 and 200),
  body_md text not null constraint task_reports_body_length check (char_length(body_md) between 1 and 60000),
  -- `[{ url, title }]`, at most 50.
  sources jsonb not null default '[]'::jsonb constraint task_reports_sources_shape check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 50),
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index task_reports_task_idx on task_reports (business_id, task_id, created_at desc);
--> statement-breakpoint
create index task_reports_task_id_idx on task_reports (task_id);
--> statement-breakpoint
-- No report of one business points at another business's task, whoever writes (the service connection included).
create function fm_task_report_same_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tasks t where t.id = new.task_id and t.business_id = new.business_id) then
    raise exception 'a task report belongs to a task of its own business' using errcode = '23514', constraint = 'task_reports_same_business';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_task_report_same_business() from public, anon, authenticated;
--> statement-breakpoint
create trigger task_reports_same_business before insert or update of task_id, business_id on task_reports for each row execute function fm_task_report_same_business();
--> statement-breakpoint
select fm_tenant_table('task_reports', array['owner'], 'read_only');
--> statement-breakpoint
-- Read only for app roles in the grants too, not only in the policies.
revoke insert, update, delete on task_reports from anon, authenticated;
