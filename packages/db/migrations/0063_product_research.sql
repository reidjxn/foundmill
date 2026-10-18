-- Product research (BUILD §11.5 Research tab; the Product Researcher agent; the founder's 2026-10-18 request): as soon
-- as a new business's foundations are ready, the Product Researcher drafts a plan to test the specification and the
-- direction with the ICP, in parallel with the build. One `product_research` row per business carries the lifecycle
-- (pending until the foundations are ready → drafting, attempt + 1, claimed exactly once → ready or failed; a failed
-- draft is retried) and a summary; the plan's parts (interview plan and script, smoke test, survey, demo script, and
-- later the demo and the findings) are `research_artifacts`. The row is written by services only (the api after its
-- membership check); members read it. The artifacts are the team's: members read and write them (mark ready or shared,
-- archive), agents write them through the api with the service role.
create table product_research (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','drafting','ready','failed')),
  -- How many times drafting was claimed; a run only writes while its attempt is the current one.
  attempt int not null default 0 check (attempt >= 0),
  -- The agent the plan is attributed to (the Product Researcher, else the Researcher, else the Product lead).
  agent_id uuid references agents(id) on delete set null,
  -- The ideal customer profile the plan tests the specification with, in one line.
  icp text not null default '',
  -- The published specification version the plan read, when one existed.
  spec_version int,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  -- What the run wrote: the ICP, the assumptions, the artifact and task ids, the model (route, mode, cost as an Estimate).
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index product_research_business_idx on product_research (business_id);
--> statement-breakpoint
create index product_research_agent_id_idx on product_research (agent_id);
--> statement-breakpoint
select fm_tenant_table('product_research', array['owner','admin'], 'read_only');
--> statement-breakpoint
create table research_artifacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  research_id uuid references product_research(id) on delete set null,
  kind text not null check (kind in ('interview_plan','interview_script','smoke_test','survey','demo_script','demo','findings')),
  title text not null,
  summary text not null default '',
  -- Plain Markdown (headings, lists, paragraphs); links, images, addresses and entity markup are removed before it is stored.
  body_md text not null default '',
  status text not null default 'draft' check (status in ('draft','ready','shared')),
  -- The plan's order (the artifacts of one plan are written in one transaction and share a created_at).
  position int not null default 0,
  -- The specification blocks the artifact tests (the Customers block an interview plan is about).
  spec_block_ids uuid[] not null default '{}',
  -- The research task that produced or uses it, when one does.
  task_id uuid references tasks(id) on delete set null,
  created_by_agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index research_artifacts_business_idx on research_artifacts (business_id, kind);
--> statement-breakpoint
create index research_artifacts_research_id_idx on research_artifacts (research_id);
--> statement-breakpoint
create index research_artifacts_task_id_idx on research_artifacts (task_id);
--> statement-breakpoint
create index research_artifacts_created_by_agent_id_idx on research_artifacts (created_by_agent_id);
--> statement-breakpoint
select fm_tenant_table('research_artifacts');
