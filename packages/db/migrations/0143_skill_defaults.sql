-- 0143 — default skills per role (WP-06 T6; founder, Nov 16, 2026: D3 and D6 call 3). Every role comes with the library
-- skills whose `default_for` names it, marked "Came with the role" and removable.
--   agent_skills.added_by: who put an added skill on the agent ('template' at hire or by the backfill, 'founder',
--   'chief_of_staff'); null for a rated template skill and for skills added before this migration.
--   agents.default_skills_version: the release of defaults the agent was given (`DEFAULT_SKILLS_VERSION`,
--   packages/agents). The boot backfill offers an agent only defaults newer than it, so a default a founder removed is
--   never added again.
--
-- RLS unchanged: both tables keep their business policies (0004); agent_skills stays read-only for app roles. An app
-- role never sets or changes default_skills_version (resetting it would make the backfill re-add defaults a founder
-- removed): only service code does, as 0082 guards speech_accent. Not security definer, so `current_user` is the caller.
alter table agent_skills add column added_by text check (added_by in ('template','founder','chief_of_staff'));
--> statement-breakpoint
alter table agents add column default_skills_version integer not null default 0;
--> statement-breakpoint
create function fm_agents_default_skills_version_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.default_skills_version <> 0) or (tg_op = 'UPDATE' and new.default_skills_version is distinct from old.default_skills_version)) then
    raise exception 'permission denied: the release of default skills is set by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger agents_default_skills_version_guard before insert or update of default_skills_version on agents for each row execute function fm_agents_default_skills_version_guard();
