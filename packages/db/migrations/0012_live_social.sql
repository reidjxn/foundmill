-- 0012 — LIVE social layer: public profiles view, connections, messages, communities, leaderboards, negotiations.
-- Public fields only: name, crest, archetype, kit colours and founder display names of committed LIVE businesses.
create view public_profiles with (security_barrier) as
  select b.id as business_id, 'business'::text as kind, b.name as display_name, b.slug, b.crest_url, b.archetype,
         b.kit_primary, b.kit_secondary, b.region, b.committed_at, null::uuid as user_id
    from businesses b
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null
  union all
  select m.business_id, 'founder'::text, fp.display_name, null, null, null, null, null, null, null, fp.user_id
    from founder_profiles fp
    join memberships m on m.user_id = fp.user_id and m.role in ('owner','admin')
    join businesses b on b.id = m.business_id
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null
     and fp.visibility = 'public' and fp.archived_at is null;
--> statement-breakpoint
grant select on public_profiles to anon, authenticated, service_role;
--> statement-breakpoint
create table connections (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','accepted','blocked')),
  message text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
--> statement-breakpoint
create index connections_to_user_idx on connections (to_user, status);
--> statement-breakpoint
create index connections_from_user_idx on connections (from_user, status);
--> statement-breakpoint
alter table connections enable row level security;
--> statement-breakpoint
create policy connections_select on connections for select using (from_user = auth.uid() or to_user = auth.uid());
--> statement-breakpoint
create policy connections_insert on connections for insert with check (from_user = auth.uid() and status = 'requested');
--> statement-breakpoint
create policy connections_update on connections for update
  using (from_user = auth.uid() or to_user = auth.uid()) with check (from_user = auth.uid() or to_user = auth.uid());
--> statement-breakpoint
create policy connections_delete on connections for delete using (from_user = auth.uid() or to_user = auth.uid());
--> statement-breakpoint
revoke all on connections from anon;
--> statement-breakpoint
grant select, insert, update, delete on connections to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('connections');
--> statement-breakpoint
create table message_threads (
  id uuid primary key default gen_random_uuid(),
  participant_ids uuid[] not null,
  subject text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (cardinality(participant_ids) >= 2)
);
--> statement-breakpoint
create index message_threads_participant_ids_idx on message_threads using gin (participant_ids);
--> statement-breakpoint
alter table message_threads enable row level security;
--> statement-breakpoint
create policy message_threads_participants on message_threads for all
  using (auth.uid() = any(participant_ids)) with check (auth.uid() = any(participant_ids));
--> statement-breakpoint
revoke all on message_threads from anon;
--> statement-breakpoint
grant select, insert, update, delete on message_threads to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('message_threads');
--> statement-breakpoint
create function is_thread_participant(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from message_threads t where t.id = tid and auth.uid() = any(t.participant_ids));
$$;
--> statement-breakpoint
grant execute on function is_thread_participant(uuid) to authenticated, service_role;
--> statement-breakpoint
create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references message_threads(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  body text not null,
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index messages_thread_id_idx on messages (thread_id, created_at);
--> statement-breakpoint
create index messages_from_user_idx on messages (from_user);
--> statement-breakpoint
alter table messages enable row level security;
--> statement-breakpoint
create policy messages_select on messages for select using (is_thread_participant(thread_id));
--> statement-breakpoint
create policy messages_insert on messages for insert with check (from_user = auth.uid() and is_thread_participant(thread_id));
--> statement-breakpoint
create policy messages_update on messages for update using (is_thread_participant(thread_id)) with check (is_thread_participant(thread_id));
--> statement-breakpoint
revoke all on messages from anon;
--> statement-breakpoint
grant select, insert, update, delete on messages to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('messages');
--> statement-breakpoint
create table communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description_md text not null default '',
  visibility text not null default 'public' check (visibility in ('public','connections','community','private')),
  owner_business_id uuid references businesses(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  member_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index communities_owner_business_id_idx on communities (owner_business_id);
--> statement-breakpoint
create index communities_created_by_idx on communities (created_by);
--> statement-breakpoint
create index communities_name_trgm_idx on communities using gin (name gin_trgm_ops);
--> statement-breakpoint
create table community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  status text not null default 'active' check (status in ('active','muted','banned','left')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);
--> statement-breakpoint
create index community_members_user_id_idx on community_members (user_id);
--> statement-breakpoint
create index community_members_business_id_idx on community_members (business_id);
--> statement-breakpoint
create function is_community_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members cm where cm.community_id = cid and cm.user_id = auth.uid() and cm.status = 'active');
$$;
--> statement-breakpoint
create function is_community_moderator(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members cm where cm.community_id = cid and cm.user_id = auth.uid() and cm.status = 'active' and cm.role in ('owner','moderator'));
$$;
--> statement-breakpoint
grant execute on function is_community_member(uuid), is_community_moderator(uuid) to anon, authenticated, service_role;
--> statement-breakpoint
alter table communities enable row level security;
--> statement-breakpoint
create policy communities_select on communities for select using (
  archived_at is null and (visibility = 'public' or is_community_member(id))
);
--> statement-breakpoint
create policy communities_insert on communities for insert with check (auth.uid() is not null and created_by = auth.uid());
--> statement-breakpoint
create policy communities_update on communities for update using (is_community_moderator(id)) with check (is_community_moderator(id));
--> statement-breakpoint
revoke all on communities from anon;
--> statement-breakpoint
grant select on communities to anon;
--> statement-breakpoint
grant select, insert, update, delete on communities to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('communities');
--> statement-breakpoint
alter table community_members enable row level security;
--> statement-breakpoint
create policy community_members_select on community_members for select using (user_id = auth.uid() or is_community_member(community_id));
--> statement-breakpoint
create policy community_members_join on community_members for insert with check (
  user_id = auth.uid() and role = 'member'
  and exists (select 1 from communities c where c.id = community_id and c.visibility = 'public' and c.archived_at is null)
);
--> statement-breakpoint
create policy community_members_moderate on community_members for all
  using (is_community_moderator(community_id)) with check (is_community_moderator(community_id));
--> statement-breakpoint
create policy community_members_leave on community_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
--> statement-breakpoint
revoke all on community_members from anon;
--> statement-breakpoint
grant select, insert, update, delete on community_members to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('community_members');
--> statement-breakpoint
create table posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  parent_post_id uuid references posts(id) on delete cascade,
  body_md text not null,
  entity_ids uuid[] not null default '{}',
  status text not null default 'visible' check (status in ('visible','hidden','removed','pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index posts_community_id_idx on posts (community_id, created_at desc);
--> statement-breakpoint
create index posts_author_user_id_idx on posts (author_user_id);
--> statement-breakpoint
create index posts_business_id_idx on posts (business_id);
--> statement-breakpoint
create index posts_parent_post_id_idx on posts (parent_post_id);
--> statement-breakpoint
alter table posts enable row level security;
--> statement-breakpoint
create policy posts_select on posts for select using (status = 'visible' and is_community_member(community_id));
--> statement-breakpoint
create policy posts_insert on posts for insert with check (author_user_id = auth.uid() and is_community_member(community_id));
--> statement-breakpoint
create policy posts_update_own on posts for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());
--> statement-breakpoint
create policy posts_moderate on posts for all using (is_community_moderator(community_id)) with check (is_community_moderator(community_id));
--> statement-breakpoint
revoke all on posts from anon;
--> statement-breakpoint
grant select, insert, update, delete on posts to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('posts');
--> statement-breakpoint
create table leaderboards (
  id uuid primary key default gen_random_uuid(),
  board_kind text not null,
  division text not null default 'open',
  period text not null,
  metric text not null,
  archetype text,
  region text check (region in ('eu','us')),
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_kind, division, period, archetype, region)
);
--> statement-breakpoint
create index leaderboards_period_idx on leaderboards (period, board_kind);
--> statement-breakpoint
alter table leaderboards enable row level security;
--> statement-breakpoint
create policy leaderboards_select on leaderboards for select using (true);
--> statement-breakpoint
revoke all on leaderboards from anon;
--> statement-breakpoint
grant select on leaderboards to anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on leaderboards to service_role;
--> statement-breakpoint
select fm_track_updated_at('leaderboards');
--> statement-breakpoint
-- Only verified metrics of committed LIVE businesses. Written by apps/social (service_role).
create table leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  leaderboard_id uuid not null references leaderboards(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  position int not null,
  movement int not null default 0,
  form text not null default '',
  metric_value numeric(20,4) not null,
  verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leaderboard_id, business_id),
  check (verified)
);
--> statement-breakpoint
create index leaderboard_entries_leaderboard_id_idx on leaderboard_entries (leaderboard_id, position);
--> statement-breakpoint
create index leaderboard_entries_business_id_idx on leaderboard_entries (business_id);
--> statement-breakpoint
alter table leaderboard_entries enable row level security;
--> statement-breakpoint
create policy leaderboard_entries_select on leaderboard_entries for select using (is_public(business_id));
--> statement-breakpoint
revoke all on leaderboard_entries from anon;
--> statement-breakpoint
grant select on leaderboard_entries to anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on leaderboard_entries to service_role;
--> statement-breakpoint
select fm_track_updated_at('leaderboard_entries');
--> statement-breakpoint
create table negotiation_threads (
  id uuid primary key default gen_random_uuid(),
  business_a uuid not null references businesses(id) on delete cascade,
  business_b uuid not null references businesses(id) on delete cascade,
  agent_a uuid references agents(id) on delete set null,
  agent_b uuid references agents(id) on delete set null,
  subject text not null default '',
  limits_snapshot jsonb not null default '{}',
  transcript_ref text,
  status text not null default 'open' check (status in ('open','agreed','declined','expired','stopped')),
  workflow_id text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (business_a <> business_b)
);
--> statement-breakpoint
create index negotiation_threads_business_a_idx on negotiation_threads (business_a, status);
--> statement-breakpoint
create index negotiation_threads_business_b_idx on negotiation_threads (business_b, status);
--> statement-breakpoint
create index negotiation_threads_agent_a_idx on negotiation_threads (agent_a);
--> statement-breakpoint
create index negotiation_threads_agent_b_idx on negotiation_threads (agent_b);
--> statement-breakpoint
alter table negotiation_threads enable row level security;
--> statement-breakpoint
create policy negotiation_threads_select on negotiation_threads for select using (is_member(business_a) or is_member(business_b));
--> statement-breakpoint
-- Either side's owner/admin may stop a negotiation; everything else is written by the orchestrator.
create policy negotiation_threads_stop on negotiation_threads for update
  using (has_role(business_a, array['owner','admin']) or has_role(business_b, array['owner','admin']))
  with check (has_role(business_a, array['owner','admin']) or has_role(business_b, array['owner','admin']));
--> statement-breakpoint
revoke all on negotiation_threads from anon;
--> statement-breakpoint
grant select, insert, update, delete on negotiation_threads to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('negotiation_threads');
