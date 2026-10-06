-- 0008 — CRM: entities, roles, relationships, interactions, mentions, provenance, merge log.
create table entities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('person','organisation','agent','team_member','platform_member','community','venue')),
  display_name text not null,
  aliases text[] not null default '{}',
  avatar_url text,
  identifiers jsonb not null default '{}',
  lawful_basis text,
  source text,
  embedding vector(1024),
  search tsvector,
  visibility text not null default 'private' check (visibility in ('public','connections','community','private')),
  agent_id uuid references agents(id) on delete set null,
  merged_into_id uuid references entities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index entities_business_id_idx on entities (business_id);
--> statement-breakpoint
create index entities_kind_idx on entities (business_id, kind) where archived_at is null;
--> statement-breakpoint
create index entities_display_name_trgm_idx on entities using gin (display_name gin_trgm_ops);
--> statement-breakpoint
create index entities_search_idx on entities using gin (search);
--> statement-breakpoint
create index entities_identifiers_idx on entities using gin (identifiers jsonb_path_ops);
--> statement-breakpoint
create index entities_agent_id_idx on entities (agent_id);
--> statement-breakpoint
create index entities_merged_into_id_idx on entities (merged_into_id);
--> statement-breakpoint
-- Maintained by trigger (array_to_string is STABLE, so a generated column is not allowed).
create function entities_search_update() returns trigger language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.display_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(new.aliases, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.identifiers ->> 'email', '') || ' ' || coalesce(new.identifiers ->> 'domain', '')), 'C');
  return new;
end;
$$;
--> statement-breakpoint
create trigger entities_search before insert or update of display_name, aliases, identifiers on entities
  for each row execute function entities_search_update();
--> statement-breakpoint
select fm_tenant_table('entities');
--> statement-breakpoint
alter table visitors add constraint visitors_entity_id_fkey foreign key (entity_id) references entities(id) on delete set null;
--> statement-breakpoint
alter table touches add constraint touches_entity_id_fkey foreign key (entity_id) references entities(id) on delete set null;
--> statement-breakpoint
alter table conversions add constraint conversions_entity_id_fkey foreign key (entity_id) references entities(id) on delete set null;
--> statement-breakpoint
create table entity_roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  role text not null,
  stage text,
  owner_ref jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index entity_roles_business_id_idx on entity_roles (business_id);
--> statement-breakpoint
create index entity_roles_entity_id_idx on entity_roles (entity_id);
--> statement-breakpoint
create index entity_roles_role_stage_idx on entity_roles (business_id, role, stage) where ended_at is null;
--> statement-breakpoint
select fm_tenant_table('entity_roles');
--> statement-breakpoint
create table relationships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  from_entity uuid not null references entities(id) on delete cascade,
  to_entity uuid not null references entities(id) on delete cascade,
  type text not null,
  strength numeric(4,3) not null default 0.5 check (strength between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_entity, to_entity, type),
  check (from_entity <> to_entity)
);
--> statement-breakpoint
create index relationships_business_id_idx on relationships (business_id);
--> statement-breakpoint
create index relationships_to_entity_idx on relationships (to_entity);
--> statement-breakpoint
select fm_tenant_table('relationships');
--> statement-breakpoint
create table interactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('email','meeting','call','message','note')),
  occurred_at timestamptz not null default now(),
  entity_ids uuid[] not null default '{}',
  agent_id uuid references agents(id) on delete set null,
  content_ref text,
  summary text not null default '',
  direction text check (direction in ('inbound','outbound','internal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index interactions_business_id_idx on interactions (business_id, occurred_at desc);
--> statement-breakpoint
create index interactions_entity_ids_idx on interactions using gin (entity_ids);
--> statement-breakpoint
create index interactions_agent_id_idx on interactions (agent_id);
--> statement-breakpoint
select fm_tenant_table('interactions');
--> statement-breakpoint
create table mentions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  container_kind text not null,
  container_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, container_kind, container_id)
);
--> statement-breakpoint
create index mentions_business_id_idx on mentions (business_id);
--> statement-breakpoint
create index mentions_container_idx on mentions (container_kind, container_id);
--> statement-breakpoint
select fm_tenant_table('mentions');
--> statement-breakpoint
create table field_provenance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  field text not null,
  source text not null,
  source_ref text,
  confidence numeric(4,3),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index field_provenance_business_id_idx on field_provenance (business_id);
--> statement-breakpoint
create index field_provenance_entity_id_idx on field_provenance (entity_id, field);
--> statement-breakpoint
select fm_tenant_table('field_provenance');
--> statement-breakpoint
create table merge_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kept_id uuid not null references entities(id) on delete cascade,
  merged_id uuid not null,
  by_kind text not null default 'user' check (by_kind in ('user','agent','system')),
  by_id uuid,
  reversible_snapshot jsonb not null default '{}',
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index merge_log_business_id_idx on merge_log (business_id, created_at desc);
--> statement-breakpoint
create index merge_log_kept_id_idx on merge_log (kept_id);
--> statement-breakpoint
create index merge_log_merged_id_idx on merge_log (merged_id);
--> statement-breakpoint
select fm_tenant_table('merge_log');
