-- 0027 — LIVE social: delivery, group rules, blocks by person, community moderation and invitations, the 18+
-- confirmation (audit #28, #34, #65, #66). Writes stay with the api on the service connection (0016); the client roles
-- keep read access only.
--
-- Threads. A thread is `direct` (two people) or a `group`; a group is never mistaken for the pair it shrinks to. A
-- participant who leaves is taken out of `participant_ids` (they no longer read it or get its messages) and listed in
-- `left_ids`, so the others can see who left; a thread may be down to one person once everyone else has left.
-- `muted_ids` are the participants who muted it: it no longer counts toward their unread badge or reaches their Inbox.
alter table message_threads add column kind text not null default 'direct' check (kind in ('direct','group'));
--> statement-breakpoint
update message_threads set kind = 'group' where cardinality(participant_ids) > 2;
--> statement-breakpoint
alter table message_threads add column left_ids uuid[] not null default '{}';
--> statement-breakpoint
alter table message_threads add column muted_ids uuid[] not null default '{}';
--> statement-breakpoint
alter table message_threads drop constraint message_threads_participant_ids_check;
--> statement-breakpoint
alter table message_threads add constraint message_threads_participant_ids_check check (cardinality(participant_ids) >= 1);
--> statement-breakpoint
-- Communities have a kind (BUILD §11.14: Cohort, Category, Geography; Private is a visibility, not a kind).
alter table communities add column kind text not null default 'category' check (kind in ('cohort','category','geography'));
--> statement-breakpoint
-- An owner or moderator invites a person: an `invited` membership that person may accept (join) or decline. That is
-- the only way into a community that is not public.
alter table community_members drop constraint community_members_status_check;
--> statement-breakpoint
alter table community_members add constraint community_members_status_check check (status in ('active','muted','banned','left','invited'));
--> statement-breakpoint
alter table community_members add column invited_by uuid references auth.users(id) on delete set null;
--> statement-breakpoint
create index community_members_invited_by_idx on community_members (invited_by);
--> statement-breakpoint
-- A mute outlives leaving: someone muted who leaves and joins again comes back muted, until a moderator restores them.
alter table community_members add column muted_at timestamptz;
--> statement-breakpoint
update community_members set muted_at = updated_at where status = 'muted';
--> statement-breakpoint
-- A muted member still reads the community; they only cannot post until a moderator restores them.
create or replace function is_community_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members cm where cm.community_id = cid and cm.user_id = auth.uid() and cm.status in ('active','muted'));
$$;
--> statement-breakpoint
create function is_community_invitee(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members cm where cm.community_id = cid and cm.user_id = auth.uid() and cm.status = 'invited');
$$;
--> statement-breakpoint
revoke execute on function is_community_invitee(uuid) from public, anon;
--> statement-breakpoint
grant execute on function is_community_invitee(uuid) to authenticated, service_role;
--> statement-breakpoint
drop policy communities_select on communities;
--> statement-breakpoint
create policy communities_select on communities for select using (
  archived_at is null and (visibility = 'public' or is_community_member(id) or is_community_invitee(id))
);
--> statement-breakpoint
-- Posts. Every new post passes a moderation screen first (Haiku; deterministic in mock mode): `screening` keeps its
-- verdict, and a post it holds stays `pending_review` until a moderator decides. Authors edit (`edited_at`) and delete
-- their own posts; owners and moderators hide, restore and remove them (`moderated_by`, `moderated_at`,
-- `moderation_note`). An author always reads their own posts, whatever their status.
alter table posts add column edited_at timestamptz;
--> statement-breakpoint
alter table posts add column screening jsonb not null default '{}';
--> statement-breakpoint
alter table posts add column moderated_by uuid references auth.users(id) on delete set null;
--> statement-breakpoint
create index posts_moderated_by_idx on posts (moderated_by);
--> statement-breakpoint
alter table posts add column moderated_at timestamptz;
--> statement-breakpoint
alter table posts add column moderation_note text check (char_length(moderation_note) <= 500);
--> statement-breakpoint
create index posts_review_idx on posts (community_id, status) where status in ('pending_review','hidden');
--> statement-breakpoint
create policy posts_select_own on posts for select using (author_user_id = auth.uid());
--> statement-breakpoint
-- Reports: a member flags a post for the community's owner and moderators, once per post. Enough reports from
-- different people hold the post for review. The reporter and the moderators read a report; nobody else does.
create table post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  community_id uuid not null references communities(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','personal_data','scam','off_topic','other')),
  note text check (char_length(note) <= 1000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text check (resolution in ('approved','hidden','removed','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, reporter_user_id),
  check ((resolved_at is null) = (resolution is null))
);
--> statement-breakpoint
create index post_reports_open_idx on post_reports (community_id, post_id) where resolved_at is null;
--> statement-breakpoint
create index post_reports_reporter_idx on post_reports (reporter_user_id);
--> statement-breakpoint
create index post_reports_resolved_by_idx on post_reports (resolved_by);
--> statement-breakpoint
alter table post_reports enable row level security;
--> statement-breakpoint
create policy post_reports_select on post_reports for select using (reporter_user_id = auth.uid() or is_community_moderator(community_id));
--> statement-breakpoint
revoke all on post_reports from anon, authenticated;
--> statement-breakpoint
grant select on post_reports to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on post_reports to service_role;
--> statement-breakpoint
select fm_track_updated_at('post_reports');
--> statement-breakpoint
-- The network is for adults (BUILD §11.14 "18+ only"). A person confirms once that they are 18 or older: before their
-- first network action (asking to connect, accepting, writing, joining, starting or posting in a community) or when a
-- business they run goes LIVE. It is the person's own statement, not identity verification. Only they read their row;
-- the api writes it.
create table network_attestations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  adult_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
alter table network_attestations enable row level security;
--> statement-breakpoint
create policy network_attestations_select on network_attestations for select using (user_id = auth.uid());
--> statement-breakpoint
revoke all on network_attestations from anon, authenticated;
--> statement-breakpoint
grant select on network_attestations to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on network_attestations to service_role;
--> statement-breakpoint
select fm_track_updated_at('network_attestations');
--> statement-breakpoint
-- Before this change `connection.requested` was written into the REQUESTER's business on every call, and the composer
-- narrated it to the requester as an incoming "Message from a contact". Those events are about the sender's own
-- request: never narrate them, and take the notes already written from them out of the Inbox.
update events set narrated = true where type = 'connection.requested' and narrated = false;
--> statement-breakpoint
update inbox_items i set state = 'archived'
 where i.type = 'human_message' and i.state <> 'archived'
   and exists (select 1 from events e where e.id = any(i.source_event_ids) and e.type = 'connection.requested' and e.business_id = i.business_id);
