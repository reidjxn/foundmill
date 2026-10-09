-- A business's foundations: the vision, the first specification and the first roadmap, drafted from what the founder
-- gave at sign-up (the idea and the founder profile through the Ideation Studio, or the Import report and the
-- imported sources through Import) when the business is first opened. One row per business, created at commit with
-- status 'pending'; the first open claims it ('drafting', attempt + 1) exactly once, and the drafting run marks it
-- 'ready' (the vision is stored here; the specification and the roadmap are written to spec_blocks and
-- roadmap_items) or 'failed' (retry claims it again). Written by services only (the api after its membership check,
-- the orchestrator's businessFoundations workflow); members read it on Home and Product.
create table business_foundations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','drafting','ready','failed')),
  door text not null check (door in ('ideation','import')),
  -- The committed idea (Door A's card, or the card Import drafted for Door B).
  idea_id uuid references ideas(id) on delete set null,
  -- Door B: the Import job the business came from (the api's job token) and the Import report as it read at commit.
  import_job_id text,
  import_report jsonb,
  -- How many times drafting was claimed; a run only writes while its attempt is the current one.
  attempt int not null default 0 check (attempt >= 0),
  runner text check (runner in ('temporal','local')),
  workflow_id text,
  -- The vision (statement, for whom, problem, why now, principles, north-star metric) once ready.
  vision jsonb,
  -- What the run wrote: sections drafted, blocks left alone (pinned or already written), roadmap items, the model.
  summary jsonb not null default '{}',
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index business_foundations_business_idx on business_foundations (business_id);
--> statement-breakpoint
create index business_foundations_idea_id_idx on business_foundations (idea_id);
--> statement-breakpoint
select fm_tenant_table('business_foundations', array['owner','admin'], 'read_only');
