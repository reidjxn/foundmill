-- 0094 — founder departures, the one-click cancel and the founder notice (security review P2-3, Nov 13, 2026; reworked
-- after the second review the same day).
--
-- Someone with a founder's standing (an owner or a cofounder) could lower another founder's role, remove them, then ask
-- for the project's deletion, and the deletion's warning reached only the Inbox of the people still in it. From here on
-- every founder is emailed about each step (apps/gateway `notify-founder-notice.ts`), and a founder whose standing was
-- taken away by someone else within 30 days before a deletion request, or at any time after it, can cancel that request
-- until its scheduled day. These two tables are what let that be checked once the person is no longer a member.
--
-- `founder_departures`: one row each time a membership loses a founder's standing, written by a trigger on
-- `memberships` (so every path that lowers or deletes a row is covered, whatever wrote it):
--   * `how`: `demoted` (someone else changed the role to one below a founder's; `new_role` says which), `removed`
--     (someone else deleted the row), `left` (the person did it to their own row). A change made by a service, with no
--     signed-in person, counts as someone else's: the founder did not choose it;
--   * `prior_role`: `owner` or `cofounder`; `by_user_id`: who did it (null for a service, or once that account is gone).
-- Not written while `fm_purge_business` removes the project, nor when the business or the account is already gone (a
-- cascade), nor for an example membership. RLS: the person reads their own rows (they are no longer a member, so nothing
-- else would let them), a founder of the project reads the project's (they see the same people in Settings › People).
-- No client role writes it; the trigger is security definer.
--
-- `founder_cancel_links`: one row per email that carries a one-click cancel of a deletion request. The api mints a random
-- 256-bit token for one email, keeps only its SHA-256 here with the person, the request it cancels (`request_id`, the
-- `business.request_deletion` audit entry) and its end (`expires_at`: that request's scheduled day), and deletes the row
-- when the email is not sent. A link works once (`used_at`), and only for that request while it still waits; a newer
-- link never replaces an older one. Service role only: no client role reads or writes it.
--
-- Two existing things change:
--   * `fm_account_event_types()` lists `founder_notice.sent` (the email to each person, an account event because the
--     reader may no longer belong to the project), and `founder_notifications.kind` takes `founder_notice`;
--   * `suppression_list`'s client write policy (0006) no longer lets a member write, change or delete an entry with a
--     hard reason (`bounced`, `marked the message as spam`): those come from the mail service's delivery events through
--     the service role, and they are what stops a founder notice (`HARD_SUPPRESSION_REASONS`), so a member must not be
--     able to plant one against a founder's address.
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_departures_removed_no_role check (how <> 'removed' or new_role is null)
);
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
grant select on founder_departures to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_departures to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_departures');
--> statement-breakpoint
create table founder_cancel_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  token_hash text not null
    constraint founder_cancel_links_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_cancel_links_expiry check (expires_at > created_at)
);
--> statement-breakpoint
create unique index founder_cancel_links_token_key on founder_cancel_links (token_hash);
--> statement-breakpoint
create index founder_cancel_links_business_idx on founder_cancel_links (business_id, created_at desc);
--> statement-breakpoint
create index founder_cancel_links_user_idx on founder_cancel_links (user_id);
--> statement-breakpoint
alter table founder_cancel_links enable row level security;
--> statement-breakpoint
revoke all on founder_cancel_links from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_cancel_links to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_cancel_links');
--> statement-breakpoint
create function fm_memberships_record_founder_departure() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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
    or not exists (select 1 from public.businesses b where b.id = old.business_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;
  if actor is not null and not exists (select 1 from auth.users u where u.id = actor) then
    actor := null;
  end if;
  insert into public.founder_departures (business_id, user_id, prior_role, how, new_role, by_user_id)
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
--> statement-breakpoint
-- 0006's client policy, with the hard reasons left to the service role (which bypasses row security).
drop policy suppression_list_write on suppression_list;
--> statement-breakpoint
create policy suppression_list_write on suppression_list for all
  using (business_id is not null and has_role(business_id, array['owner','admin','member']) and reason not in ('bounced', 'marked the message as spam'))
  with check (business_id is not null and has_role(business_id, array['owner','admin','member']) and reason not in ('bounced', 'marked the message as spam'));
