-- 0003 — product module: spec blocks, versions, change proposals, roadmap, sources.
create table spec_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  section text not null,
  position int not null default 0,
  content jsonb not null default '{"type":"doc","content":[]}',
  sources uuid[] not null default '{}',
  authored_by_kind text not null default 'user' check (authored_by_kind in ('user','agent','system')),
  authored_by uuid,
  pinned boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index spec_blocks_business_id_idx on spec_blocks (business_id);
--> statement-breakpoint
create index spec_blocks_section_idx on spec_blocks (business_id, section, position);
--> statement-breakpoint
select fm_tenant_table('spec_blocks');
--> statement-breakpoint
create table spec_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  version int not null,
  snapshot jsonb not null default '{}',
  changelog_md text not null default '',
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, version)
);
--> statement-breakpoint
create index spec_versions_business_id_idx on spec_versions (business_id);
--> statement-breakpoint
create index spec_versions_published_by_idx on spec_versions (published_by);
--> statement-breakpoint
select fm_tenant_table('spec_versions');
--> statement-breakpoint
create table change_proposals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null default '',
  status text not null default 'open' check (status in ('open','accepted','partially_accepted','rejected')),
  rationale_md text not null default '',
  evidence uuid[] not null default '{}',
  impact jsonb not null default '{}',
  severity text not null default 'normal' check (severity in ('low','normal','critical')),
  proposed_by_agent_id uuid,
  inbox_item_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index change_proposals_business_id_idx on change_proposals (business_id);
--> statement-breakpoint
create index change_proposals_status_idx on change_proposals (business_id, status);
--> statement-breakpoint
create index change_proposals_inbox_item_id_idx on change_proposals (inbox_item_id);
--> statement-breakpoint
select fm_tenant_table('change_proposals');
--> statement-breakpoint
create table roadmap_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null,
  description_md text not null default '',
  horizon text not null default 'next' check (horizon in ('now','next','later')),
  target_start date,
  target_end date,
  confidence int not null default 3 check (confidence between 1 and 5),
  owner_ref jsonb,
  spec_block_ids uuid[] not null default '{}',
  status text not null default 'planned',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index roadmap_items_business_id_idx on roadmap_items (business_id);
--> statement-breakpoint
create index roadmap_items_horizon_idx on roadmap_items (business_id, horizon, position);
--> statement-breakpoint
select fm_tenant_table('roadmap_items');
--> statement-breakpoint
create table roadmap_dependencies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  from_item uuid not null references roadmap_items(id) on delete cascade,
  to_item uuid not null references roadmap_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_item, to_item),
  check (from_item <> to_item)
);
--> statement-breakpoint
create index roadmap_dependencies_business_id_idx on roadmap_dependencies (business_id);
--> statement-breakpoint
create index roadmap_dependencies_to_item_idx on roadmap_dependencies (to_item);
--> statement-breakpoint
select fm_tenant_table('roadmap_dependencies');
--> statement-breakpoint
create table proposal_hunks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  proposal_id uuid not null references change_proposals(id) on delete cascade,
  spec_block_id uuid references spec_blocks(id) on delete cascade,
  roadmap_item_id uuid references roadmap_items(id) on delete cascade,
  base jsonb,
  ours jsonb,
  theirs jsonb,
  decision text not null default 'pending' check (decision in ('pending','accepted','rejected','edited')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (spec_block_id is not null or roadmap_item_id is not null)
);
--> statement-breakpoint
create index proposal_hunks_business_id_idx on proposal_hunks (business_id);
--> statement-breakpoint
create index proposal_hunks_proposal_id_idx on proposal_hunks (proposal_id);
--> statement-breakpoint
create index proposal_hunks_spec_block_id_idx on proposal_hunks (spec_block_id);
--> statement-breakpoint
create index proposal_hunks_roadmap_item_id_idx on proposal_hunks (roadmap_item_id);
--> statement-breakpoint
select fm_tenant_table('proposal_hunks');
--> statement-breakpoint
create table sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('doc','issue','feedback','transcript','competitor','legal','finance')),
  uri text,
  title text not null default '',
  content_ref text,
  embedding vector(1024),
  relevance jsonb not null default '{}',
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index sources_business_id_idx on sources (business_id);
--> statement-breakpoint
create index sources_kind_idx on sources (business_id, kind);
--> statement-breakpoint
create index sources_title_trgm_idx on sources using gin (title gin_trgm_ops);
--> statement-breakpoint
select fm_tenant_table('sources');
