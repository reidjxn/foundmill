-- 0023 — business controls (audit fixes, 2026-10-12). Stop all agents, a revoked Anthropic key and used-up credits
-- leave a business-level stop flag that only an owner or admin clears (`business.resumeAgents`); a new key or a top-up
-- clears the stop it caused. Every path that starts work refuses while the flag is set, so a task start, a channel
-- toggle or a restarted orchestrator can no longer undo the kill switch. Agents remember why they were paused, so a
-- resume lifts only the team-wide pause and a wage-cap pause lifts itself when the period turns. The flag is a column
-- of `businesses`, so its existing policies apply: members read it, only owners and admins (or services) change it.
alter table businesses add column agents_stopped_at timestamptz;
--> statement-breakpoint
alter table businesses add column agents_stopped_reason text;
--> statement-breakpoint
alter table businesses add constraint businesses_agents_stopped_check check ((agents_stopped_at is null) = (agents_stopped_reason is null));
--> statement-breakpoint
alter table agents add column paused_reason text;
--> statement-breakpoint
-- The reason belongs to the pause: whatever moves an agent out of `paused` drops it, so no writer can leave a stale one.
create or replace function fm_agents_clear_paused_reason() returns trigger language plpgsql as $$
begin
  if new.status <> 'paused' then
    new.paused_reason := null;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger agents_clear_paused_reason before insert or update on agents for each row execute function fm_agents_clear_paused_reason();
--> statement-breakpoint
-- Sessions a cycle, a plan or a vacation opened stored a placeholder; their workflow has always been `session:<id>`.
update agent_sessions set workflow_id = 'session:' || id::text where workflow_id = 'session:pending';
--> statement-breakpoint
-- A business stopped before 0023 (Stop all agents, archiving, a revoked key, used-up credits) was never resumed, since
-- nothing could resume a team: every live agent is still paused, or some are and its audit trail holds one of those
-- stops (a task start or a task stop used to set single agents back to work). The latest of those entries names the
-- reason and the time (no entry: the kill switch, the strictest, which only an owner or admin lifts). Archived
-- businesses are marked too, so a restored one shows Resume agents.
update businesses b set
  agents_stopped_at = coalesce((
    select a.created_at from audit_log a
    where a.business_id = b.id and a.action in ('business.stop_all_agents', 'keys.revoke', 'billing.credits_exhausted')
    order by a.seq desc
    limit 1
  ), now()),
  agents_stopped_reason = coalesce((
    select case a.action when 'keys.revoke' then 'key_revoked' when 'billing.credits_exhausted' then 'credits_exhausted' else 'kill_switch' end
    from audit_log a
    where a.business_id = b.id and a.action in ('business.stop_all_agents', 'keys.revoke', 'billing.credits_exhausted')
    order by a.seq desc
    limit 1
  ), 'kill_switch')
where exists (select 1 from agents g where g.business_id = b.id and g.archived_at is null and g.status = 'paused')
  and (
    not exists (select 1 from agents g where g.business_id = b.id and g.archived_at is null and g.status <> 'paused')
    or exists (select 1 from audit_log a where a.business_id = b.id and a.action in ('business.stop_all_agents', 'keys.revoke', 'billing.credits_exhausted'))
  );
--> statement-breakpoint
update agents g set paused_reason = b.agents_stopped_reason
from businesses b
where b.id = g.business_id and b.agents_stopped_reason is not null and g.status = 'paused' and g.archived_at is null and g.paused_reason is null;
