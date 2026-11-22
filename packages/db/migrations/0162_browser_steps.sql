-- 0162 — browser_steps: the record of each write step the team takes in a website through the hosted browser (founder,
-- Nov 22, 2026). One row per step: the site, the tool, the element in words, how the step was classed, why it was
-- taken, the page's URL, any amount, and a PNG of the page before the step. `simulated` marks a mock browser's step,
-- which was not done.
--
-- Who may do what:
--   read    members of the business
--   write   the services only (the gateway's browser tools); no member updates or deletes a step
--
-- Retention and export: the screenshot can hold other people's personal data, so the rows follow the same rule as the
-- project's other records (tool_needs, audit_log): they live as long as the project, deleting the project deletes them
-- (business_id cascades from `businesses`, `fm_purge_business`), and "Export everything" carries their metadata
-- (`EXPORT_TABLES` in src/repos/portability.ts). The PNG bytes stay out of the archive, like `post_media.content`.
create table browser_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- Like tool_needs.raised_by_agent_id: no FK, the step outlives the agent and the session rows.
  agent_id uuid,
  session_id uuid,
  site_key text not null,
  tool text not null,
  -- The element's label, in words.
  target text not null,
  class text not null constraint browser_steps_class_value check (class in ('read','reversible','outward','hard_gate','unknown')),
  why text not null,
  url text not null,
  amount text,
  -- PNG of the page before the step; may hold other people's personal data.
  screenshot bytea,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index browser_steps_session_idx on browser_steps (business_id, session_id, created_at);
--> statement-breakpoint
create index browser_steps_recent_idx on browser_steps (business_id, created_at desc);
--> statement-breakpoint
select fm_tenant_table('browser_steps', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on browser_steps from anon, authenticated;
