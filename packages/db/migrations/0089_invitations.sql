-- 0089 — invitations to a project, and the admissions the api records (docs/NETWORK.md F5, §11; docs/THESIS_REVIEW.md
-- package 3.1, and the admission half of 2.2). It follows 0088 (page dates recorded by the database);
-- the journal orders by `when`, which is later than 0088's. Nothing here stores a person who is waiting or an address
-- that has no account: the waitlist is the retention team's own change.
--
-- `invitations` — business-scoped: a link a project's people make for someone to join as a cofounder or a
-- collaborator. The link's token is stored as its SHA-256 only, and the address it was emailed to (when one was typed)
-- is the service's to read. Who may do what, for the client roles (the service connection, which accepts and declines
-- for a person who is not a member yet, is not limited):
--   select   any member reads the rows, but not `token_hash` and not `email` (column grants): nobody reads a token back
--   insert   an owner or an admin, as the inviter, a pending invitation made now that works at most 30 days, on a real
--            (not sample), open business; a cofounder invitation only by an owner (equal standing is an owner's to give)
--   update   an owner or an admin revokes a pending invitation, and changes nothing else (guard trigger)
--   delete   nobody (a revoked or used invitation stays as the record)
-- 0090 (the cofounder and collaborator roles) makes a cofounder an owner in every `has_role` check, these included.
--
-- `account_admissions` — account-scoped: one row per account the api admitted other than through SIGNUP_ALLOWLIST
-- (`how`: through an invitation it accepted, under open sign-up's daily ceiling, or an account that was a person here
-- before open sign-up). It records who is in, never who waits. apps/api reads it on a signed-in request the list does
-- not answer (services/access.ts `admitOrWait`); apps/stream and apps/collab read it for the live channels
-- (@foundmill/shared `liveChannelAdmit`). The open mode's daily count is a query on it at sign-in (`how = 'open'` since
-- the start of the UTC day, under an advisory lock), never a timer. No policy and no client grant: no client role reads
-- or writes it, not even a person's own row (a client that could insert one would admit itself).
--
-- RLS is on for both. One existing table changes: `founder_notifications.kind` (0083) also takes
-- `invitation_accepted`, the person's own email that someone they invited joined. Nothing else of 0083 or 0085 is touched.

create table invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  token_hash text not null
    constraint invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null
    constraint invitations_role_value check (role in ('cofounder', 'collaborator')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  email text
    constraint invitations_email_format check (email is null or (char_length(email) between 3 and 254 and email = lower(btrim(email)) and position('@' in email) > 1)),
  state text not null default 'pending'
    constraint invitations_state_value check (state in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_token_hash_key unique (token_hash),
  constraint invitations_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint invitations_accepted_when check ((state = 'accepted') = (accepted_at is not null)),
  constraint invitations_declined_when check ((state = 'declined') = (declined_at is not null)),
  constraint invitations_revoked_when check ((state = 'revoked') = (revoked_at is not null))
);
--> statement-breakpoint
create index invitations_business_id_idx on invitations (business_id, created_at desc);
--> statement-breakpoint
create index invitations_invited_by_user_id_idx on invitations (invited_by_user_id);
--> statement-breakpoint
create index invitations_accepted_by_user_id_idx on invitations (accepted_by_user_id);
--> statement-breakpoint
create index invitations_revoked_by_user_id_idx on invitations (revoked_by_user_id);
--> statement-breakpoint
alter table invitations enable row level security;
--> statement-breakpoint
create policy invitations_select on invitations for select using (is_member(business_id));
--> statement-breakpoint
create policy invitations_insert on invitations for insert with check (
  has_role(invitations.business_id, array['owner','admin'])
  and (invitations.role = 'collaborator' or has_role(invitations.business_id, array['owner']))
  and invitations.invited_by_user_id = auth.uid()
  and not exists (select 1 from businesses b where b.id = invitations.business_id and (b.is_demo or b.archived_at is not null))
);
--> statement-breakpoint
create policy invitations_update on invitations for update
  using (has_role(business_id, array['owner','admin']))
  with check (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
-- What a client role may write, beyond the policies: a new invitation is pending, made now (its own clock, never the
-- client's) and works for at most 30 days; a pending invitation becomes revoked, by the person revoking it, and nothing
-- else moves. Not security definer: `current_user` must be the caller's role (as 0087's milestones guard).
create function fm_invitations_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if new.state <> 'pending' or new.accepted_by_user_id is not null or new.accepted_at is not null or new.declined_at is not null
       or new.revoked_at is not null or new.revoked_by_user_id is not null
       or new.expires_at <= now() or new.expires_at > now() + interval '30 days' then
      raise exception 'permission denied for invitations: a new invitation is pending and works for at most 30 days' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.state <> 'pending' or new.state <> 'revoked'
     or new.revoked_by_user_id is distinct from auth.uid() or new.revoked_at is null
     or new.business_id is distinct from old.business_id or new.token_hash is distinct from old.token_hash
     or new.role is distinct from old.role or new.invited_by_user_id is distinct from old.invited_by_user_id
     or new.email is distinct from old.email or new.expires_at is distinct from old.expires_at
     or new.accepted_by_user_id is distinct from old.accepted_by_user_id or new.accepted_at is distinct from old.accepted_at
     or new.declined_at is distinct from old.declined_at or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'permission denied for invitations: a pending invitation can only be revoked' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger invitations_guard before insert or update on invitations for each row execute function fm_invitations_guard();
--> statement-breakpoint
revoke all on invitations from public, anon, authenticated;
--> statement-breakpoint
-- A member reads every column but the token's hash and the address (`token_hash`, `email`): nobody reads a token back.
grant select (id, business_id, role, invited_by_user_id, state, expires_at, accepted_by_user_id, accepted_at, declined_at, revoked_at, revoked_by_user_id, created_at, updated_at) on invitations to authenticated;
--> statement-breakpoint
grant insert on invitations to authenticated;
--> statement-breakpoint
grant update (state, revoked_at, revoked_by_user_id) on invitations to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on invitations to service_role;
--> statement-breakpoint
select fm_track_updated_at('invitations');
--> statement-breakpoint
create table account_admissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  how text not null
    constraint account_admissions_how_value check (how in ('invitation', 'open', 'existing')),
  invitation_id uuid references invitations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_admissions_user_id_key unique (user_id),
  constraint account_admissions_invitation_only check (how = 'invitation' or invitation_id is null)
);
--> statement-breakpoint
create index account_admissions_invitation_id_idx on account_admissions (invitation_id);
--> statement-breakpoint
-- The open mode's count at sign-in: today's admissions under the ceiling.
create index account_admissions_how_created_at_idx on account_admissions (how, created_at);
--> statement-breakpoint
alter table account_admissions enable row level security;
--> statement-breakpoint
revoke all on account_admissions from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on account_admissions to service_role;
--> statement-breakpoint
select fm_track_updated_at('account_admissions');
--> statement-breakpoint
-- The person's own kinds of email gain `invitation_accepted` (`EMAIL_NOTIFICATION_KINDS`, @foundmill/shared): the note
-- to the person who invited someone that they joined, kept on its `founder_notifications` row like every other kind.
alter table founder_notifications drop constraint founder_notifications_kind_check;
--> statement-breakpoint
alter table founder_notifications add constraint founder_notifications_kind_check check (kind in ('decision_waiting','win','milestone','run_finished','credits','daily_brief','weekly_review','invitation_accepted'));
