-- 0094 — founder departures and the founder notice (security review P2-3, Nov 13, 2026).
--
-- Someone with a founder's standing (an owner or a cofounder) could lower another founder's role, remove them, then ask
-- for the project's deletion, and the deletion's warning reached only the Inbox of the people still in it. From here on
-- every founder is emailed about each step (apps/gateway `notify-founder-notice.ts`), and a founder whose standing was
-- taken away by someone else can still cancel a pending deletion of that project for 7 days. This table is what lets
-- that be checked later, once the person is no longer a member and no membership row says they ever were.
--
-- `founder_departures`: one row each time a membership loses a founder's standing, written by a trigger on
-- `memberships` (so every path that lowers or deletes a row is covered, whatever wrote it):
--   * `how`: `demoted` (someone else changed the role to one below a founder's; `new_role` says which), `removed`
--     (someone else deleted the row), `left` (the person did it to their own row). A change made by a service, with no
--     signed-in person, counts as someone else's: the founder did not choose it;
--   * `prior_role`: `owner` or `cofounder`; `by_user_id`: who did it (null for a service, or once that account is gone);
--   * the one-click cancel of a pending deletion (`cancel_*`): the api mints a random 256-bit token for a founder
--     demoted or removed in the last 7 days when a deletion waits, keeps only its SHA-256 here with the audit entry of
--     the request it cancels and the moment it stops working (at most 7 days after the departure), and spends it once
--     (`cancel_used_at`). A later request replaces it. The token travels only in that person's email.
-- Not written while `fm_purge_business` removes the project, nor when the business or the account is already gone (a
-- cascade), nor for an example membership.
--
-- RLS: the person reads their own rows (they are no longer a member, so nothing else would let them), and a founder of
-- the project reads the project's (they see the same people in Settings › People). Never the token's hash: no client
-- role reads that column. No client role writes the table; the trigger is security definer, and the api writes the
-- cancel columns with the service role.
--
-- One existing function and one existing check change: `fm_account_event_types()` lists `founder_notice.sent` (the
-- email to each person, an account event because the reader may no longer belong to the project), and
-- `founder_notifications.kind` takes `founder_notice` (the record of that email, beside every other kind).
create table founder_departures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prior_role text not null
    constraint founder_departures_prior_role check (prior_role in ('owner', 'cofounder')),
  how text not null
    constraint founder_departures_how check (how in ('demoted', 'removed', 'left')),
  new_role text
    constraint founder_departures_new_role check (new_role is null or (new_role in ('admin', 'member', 'viewer', 'advisor', 'collaborator'))),
  by_user_id uuid references auth.users(id) on delete set null,
  departed_at timestamptz not null default now(),
  cancel_token_hash text
    constraint founder_departures_cancel_token_hash check (cancel_token_hash is null or cancel_token_hash ~ '^[0-9a-f]{64}$'),
  cancel_request_id uuid,
  cancel_expires_at timestamptz,
  cancel_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_departures_removed_no_role check (how <> 'removed' or new_role is null),
  constraint founder_departures_cancel_whole check ((cancel_token_hash is null) = (cancel_request_id is null) and (cancel_token_hash is null) = (cancel_expires_at is null)),
  constraint founder_departures_cancel_window check (cancel_expires_at is null or cancel_expires_at <= departed_at + interval '7 days'),
  constraint founder_departures_cancel_by_other check (cancel_token_hash is null or how in ('demoted', 'removed'))
);
--> statement-breakpoint
create unique index founder_departures_cancel_token_key on founder_departures (cancel_token_hash) where cancel_token_hash is not null;
--> statement-breakpoint
create index founder_departures_user_idx on founder_departures (user_id, departed_at desc);
--> statement-breakpoint
create index founder_departures_business_idx on founder_departures (business_id, departed_at desc);
--> statement-breakpoint
create index founder_departures_by_user_idx on founder_departures (by_user_id);
--> statement-breakpoint
alter table founder_departures enable row level security;
--> statement-breakpoint
create policy founder_departures_select on founder_departures for select
  using (user_id = auth.uid() or has_role(business_id, array['owner']));
--> statement-breakpoint
revoke all on founder_departures from public, anon, authenticated;
--> statement-breakpoint
grant select (id, business_id, user_id, prior_role, how, new_role, by_user_id, departed_at, cancel_request_id, cancel_expires_at, cancel_used_at, created_at, updated_at) on founder_departures to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_departures to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_departures');
--> statement-breakpoint
create function fm_memberships_record_founder_departure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  if old.role not in ('owner', 'cofounder') then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.role in ('owner', 'cofounder') then
    return null;
  end if;
  if old.source = 'example' then
    return null;
  end if;
  if current_setting('fm.purge_business', true) = old.business_id::text
    or not exists (select 1 from businesses b where b.id = old.business_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;
  if actor is not null and not exists (select 1 from auth.users u where u.id = actor) then
    actor := null;
  end if;
  insert into founder_departures (business_id, user_id, prior_role, how, new_role, by_user_id)
  values (
    old.business_id,
    old.user_id,
    old.role,
    case when actor = old.user_id then 'left' when tg_op = 'DELETE' then 'removed' else 'demoted' end,
    case when tg_op = 'UPDATE' then new.role else null end,
    actor
  );
  return null;
end;
$$;
--> statement-breakpoint
revoke all on function fm_memberships_record_founder_departure() from public, anon, authenticated;
--> statement-breakpoint
create trigger memberships_founder_departure_update after update of role on memberships
  for each row when (old.role is distinct from new.role) execute function fm_memberships_record_founder_departure();
--> statement-breakpoint
create trigger memberships_founder_departure_delete after delete on memberships
  for each row execute function fm_memberships_record_founder_departure();
--> statement-breakpoint
create or replace function fm_account_event_types() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['profile.published', 'profile.unpublished', 'signup.attributed', 'referral.arrived', 'founder_notice.sent']::text[]
$$;
--> statement-breakpoint
-- As 0086 did for its types: no writer ever produced this type in `events`, but a member could have planted a row
-- under its name through RLS before now. Such a row goes, so every row of `events` satisfies the check as it now reads.
delete from events where type = 'founder_notice.sent';
--> statement-breakpoint
alter table founder_notifications drop constraint founder_notifications_kind_check;
--> statement-breakpoint
alter table founder_notifications add constraint founder_notifications_kind_check check (kind in ('decision_waiting','win','milestone','run_finished','credits','daily_brief','weekly_review','invitation_accepted','founder_notice'));
