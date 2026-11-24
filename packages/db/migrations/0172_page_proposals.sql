-- 0172 — an agent's proposed edit to a project's page (WP-08 T8; audit s3 §6.1). The SEO and GEO agents, the content
-- agent and the Product lead can read the hosted page and propose changes to its words; a proposal never touches
-- `draft` or `published`. It waits here, one per page (a new one replaces it), until a member who can write in Product
-- uses it (it is copied into the draft) or dismisses it. No new table: the page row's existing tenant policy covers it,
-- and the public view `public_project_pages` lists its columns by name, so none of these ever leaves the console.
alter table project_pages
  add column if not exists proposed jsonb,
  add column if not exists proposed_note text,
  add column if not exists proposed_by_agent_id uuid references agents(id) on delete set null,
  add column if not exists proposed_at timestamptz;
--> statement-breakpoint

alter table project_pages
  add constraint project_pages_proposed_ok check (proposed is null or (jsonb_typeof(proposed) = 'object' and proposed_at is not null)),
  add constraint project_pages_proposed_note_len check (proposed_note is null or char_length(proposed_note) <= 1000);
--> statement-breakpoint

create index if not exists project_pages_proposed_by_agent_idx on project_pages (proposed_by_agent_id) where proposed_by_agent_id is not null;
