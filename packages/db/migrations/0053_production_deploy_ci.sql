-- 0053 — production, deploy and CI (audit fixes, 2026-10-12).
--
-- Rebuilding the demo (#232) no longer disables the audit trigger. `alter table audit_log disable trigger` held an
-- ACCESS EXCLUSIVE lock on audit_log for the whole cascade delete, so every audited write on the platform waited for
-- it. The trigger now lets one transaction delete the audit chain of the one business it names in the
-- transaction-local setting `fm.purge_business` (`set_config(..., true)`); every other update or delete is refused as
-- before. App roles hold no DELETE on audit_log, so the setting only matters to the table owner's cascades (the demo
-- seed, a business purge). A business purge (workstream H) may use the same setting.
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('fm.purge_business', true) = old.business_id::text then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = 'P0001';
end;
$$;
--> statement-breakpoint
-- Session recordings (#233). The `as:{sessionId}` Redis stream is a session's live feed; when the session finishes
-- the orchestrator copies its events here and lets the stream expire, so Redis memory no longer grows with every
-- session and a replay outlives the stream. `events` is the stream's entries in order (`[{ "id", "event" }]`, the
-- stream ids kept so a replay cursor works on either source); a session whose output passed the size cap keeps every
-- event but with long terminal output and diffs cut (`truncated`). Written by the orchestrator with the service role;
-- members read their business's rows.
create table session_recordings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  session_id uuid not null references agent_sessions(id) on delete cascade,
  events jsonb not null default '[]'::jsonb,
  event_count integer not null default 0 check (event_count >= 0),
  bytes integer not null default 0 check (bytes >= 0),
  truncated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index session_recordings_session_id_key on session_recordings (session_id);
--> statement-breakpoint
create index session_recordings_business_id_idx on session_recordings (business_id, created_at);
--> statement-breakpoint
select fm_tenant_table('session_recordings', array['owner','admin'], 'read_only');
