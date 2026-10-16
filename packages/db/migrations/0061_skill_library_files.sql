-- 0061 — Skills library and skill files (founder request 2026-10-16). A founder adds skills to an agent from the
-- curated library (packages/agents SKILL_LIBRARY) or by uploading a skill file (SKILL.md, .md, .txt). Each becomes a
-- business-owned skill definition for the agent's type, carrying the instructions the agent receives in its prompt's
-- "## Skills" section (after the house rules), and joins the agent's attribute ratings at its template's baseline,
-- untested until a training run scores it.
--
-- `source` says where it came from (null for platform and custom skills); `instructions_md` is the Markdown the agent
-- receives; an upload keeps its original `file_name` and the SHA-256 `content_hash` of the normalized file, so the same
-- file is one skill. Tenancy is unchanged: skill_definitions already carries business_id and its RLS policies (0004:
-- members read the business's rows and the platform's, owners, admins and members write the business's), and the api
-- writes these rows on the service connection after the team-write check, as it writes custom skills.
alter table skill_definitions add column source text;
--> statement-breakpoint
alter table skill_definitions add column instructions_md text;
--> statement-breakpoint
alter table skill_definitions add column file_name text;
--> statement-breakpoint
alter table skill_definitions add column content_hash text;
--> statement-breakpoint
alter table skill_definitions add constraint skill_definitions_source_check check (source is null or source in ('library', 'upload'));
--> statement-breakpoint
-- An added skill belongs to a business and has instructions (bounded: they sit in every prompt of the agent).
alter table skill_definitions add constraint skill_definitions_added_body_check check (
  source is null or (business_id is not null and instructions_md is not null and char_length(instructions_md) between 1 and 20000)
);
--> statement-breakpoint
-- An uploaded skill keeps the file it came from: its name and a SHA-256 hex digest.
alter table skill_definitions add constraint skill_definitions_upload_file_check check (
  source is distinct from 'upload' or (file_name is not null and char_length(file_name) between 1 and 255 and content_hash ~ '^[0-9a-f]{64}$')
);
