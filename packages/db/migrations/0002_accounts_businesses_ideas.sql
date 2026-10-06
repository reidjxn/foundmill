-- 0002 — founder profiles, businesses, ideas.
create table founder_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  experience text,
  skills jsonb not null default '{}',
  time_commitment text,
  budget_minor bigint,
  currency char(3) not null default 'EUR',
  citizenship text,
  residence text,
  target_markets text[] not null default '{}',
  constraints text[] not null default '{}',
  risk_appetite text,
  visibility text not null default 'private' check (visibility in ('public','connections','community','private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
alter table founder_profiles enable row level security;
--> statement-breakpoint
create policy founder_profiles_own on founder_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
--> statement-breakpoint
revoke all on founder_profiles from anon;
--> statement-breakpoint
grant select, insert, update, delete on founder_profiles to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_profiles');
--> statement-breakpoint
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  game_mode text not null default 'personal' check (game_mode in ('live','personal')),
  business_mode text not null default 'assisted' check (business_mode in ('augmented','assisted','automated')),
  archetype text check (archetype in ('b2b_saas','consumer_app','marketplace','dtc_physical','hardware','services','content_media')),
  kit_primary text not null default '#1b4fd8',
  kit_secondary text not null default '#f5c400',
  crest_url text,
  region text not null default 'eu' check (region in ('eu','us')),
  committed_at timestamptz,
  plan_tier text not null default 'free' check (plan_tier in ('free','pro','scale')),
  model_billing text not null default 'credits' check (model_billing in ('byok','credits')),
  glossary jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index businesses_game_mode_idx on businesses (game_mode) where archived_at is null;
--> statement-breakpoint
create index businesses_created_by_idx on businesses (created_by);
--> statement-breakpoint
create index businesses_name_trgm_idx on businesses using gin (name gin_trgm_ops);
--> statement-breakpoint
alter table businesses enable row level security;
--> statement-breakpoint
create policy businesses_select on businesses for select using (is_member(id));
--> statement-breakpoint
-- Creators generate the id client-side and insert without RETURNING (the select policy needs a membership),
-- then insert their own owner membership (see memberships_insert in 0001) in the same transaction.
create policy businesses_insert on businesses for insert with check (auth.uid() is not null and (created_by is null or created_by = auth.uid()));
--> statement-breakpoint
create policy businesses_update on businesses for update
  using (has_role(id, array['owner','admin'])) with check (has_role(id, array['owner','admin']));
--> statement-breakpoint
-- No delete policy: permanent deletion is a hard gate (archive instead; service_role only).
revoke all on businesses from anon;
--> statement-breakpoint
grant select, insert, update, delete on businesses to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('businesses');
--> statement-breakpoint
alter table memberships add constraint memberships_business_id_fkey foreign key (business_id) references businesses(id) on delete cascade;
--> statement-breakpoint
-- Ideas live with their owner until commit, then belong to the business.
create table ideas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  pitch text not null default '',
  archetype text check (archetype in ('b2b_saas','consumer_app','marketplace','dtc_physical','hardware','services','content_media')),
  current_version_id uuid,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index ideas_owner_user_id_idx on ideas (owner_user_id);
--> statement-breakpoint
create index ideas_business_id_idx on ideas (business_id);
--> statement-breakpoint
create table idea_versions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references ideas(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  title text not null,
  pitch text not null default '',
  attributes jsonb not null default '{}',
  stars_current numeric(3,1) not null default 0,
  stars_potential numeric(3,1) not null default 0,
  research jsonb not null default '{"citations":[]}',
  parent_version_id uuid references idea_versions(id) on delete set null,
  action text not null default 'generated' check (action in ('generated','merged','forked','edited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idea_id, version)
);
--> statement-breakpoint
create index idea_versions_idea_id_idx on idea_versions (idea_id);
--> statement-breakpoint
create index idea_versions_owner_user_id_idx on idea_versions (owner_user_id);
--> statement-breakpoint
create index idea_versions_business_id_idx on idea_versions (business_id);
--> statement-breakpoint
create index idea_versions_parent_version_id_idx on idea_versions (parent_version_id);
--> statement-breakpoint
alter table ideas add constraint ideas_current_version_id_fkey foreign key (current_version_id) references idea_versions(id) on delete set null;
--> statement-breakpoint
create index ideas_current_version_id_idx on ideas (current_version_id);
--> statement-breakpoint
create table idea_comparisons (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  idea_version_ids uuid[] not null default '{}',
  verdict_md text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index idea_comparisons_owner_user_id_idx on idea_comparisons (owner_user_id);
--> statement-breakpoint
create index idea_comparisons_business_id_idx on idea_comparisons (business_id);
--> statement-breakpoint
-- Owner-or-member policies for the three idea tables (business_id nullable until commit).
create function fm_idea_table(tbl text) returns void language plpgsql as $$
begin
  execute format('alter table %I enable row level security', tbl);
  execute format(
    'create policy %I on %I for select using (owner_user_id = auth.uid() or (business_id is not null and is_member(business_id)))',
    tbl || '_select', tbl);
  execute format(
    'create policy %I on %I for all using (owner_user_id = auth.uid() or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))'
    || ' with check ((business_id is null and owner_user_id = auth.uid()) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_write', tbl);
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end;
$$;
--> statement-breakpoint
select fm_idea_table('ideas');
--> statement-breakpoint
select fm_idea_table('idea_versions');
--> statement-breakpoint
select fm_idea_table('idea_comparisons');
