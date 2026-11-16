-- 0143 — default skills per role (WP-06 T6; founder, Nov 16, 2026: D3 and D6 call 3). Every role comes with the library
-- skills whose `default_for` names it, marked "Came with the role" and removable.
--   agent_skills.added_by: who put an added skill on the agent ('template' at hire or by the backfill, 'founder',
--   'chief_of_staff'); null for a rated template skill and for skills added before this migration.
--   agents.default_skills_version: the release of defaults the agent was given (`DEFAULT_SKILLS_VERSION`,
--   packages/agents). The boot backfill offers an agent only defaults newer than it, so a default a founder removed is
--   never added again.
--
-- RLS unchanged: both tables keep their business policies (0004); agent_skills stays read-only for app roles.
alter table agent_skills add column added_by text check (added_by in ('template','founder','chief_of_staff'));
--> statement-breakpoint
alter table agents add column default_skills_version integer not null default 0;
