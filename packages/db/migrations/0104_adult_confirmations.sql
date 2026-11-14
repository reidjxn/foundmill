-- 0104 — "I am 18 or older", confirmed once at sign-up, for the whole product (CLAUDE.md, founder 2026-11-11;
-- docs/THESIS_REVIEW.md package 2.2). Until now the confirmation was the network's (`network_attestations`, 0027),
-- asked before a first network action or when a business went LIVE. This table is the account's record and the source
-- of truth: the api asks for it when a new account creates its profile (`founder.profile.update`, the
-- `adult_confirmation` step of services/person-created.ts), when an invitee accepts (`invitation.accept`), and once
-- from anyone who was here before (`founder.adult.confirm`). It is the person's own statement, not identity
-- verification.
--
-- One row per account, ever (`user_id` is unique), account-scoped like `account_preferences`: no `business_id`.
--
-- Who may do what. A person reads their own row and inserts their own row (`user_id = auth.uid()`), and nothing else:
-- no client UPDATE or DELETE grant, so a confirmation is never taken back or redated by a client. The time is the
-- database's: a trigger sets `confirmed_at` to now() on every insert, whatever the insert says, and keeps it on every
-- update, so a client cannot backdate it. The service role keeps every privilege (the account's deletion cascades).
-- Grants are revoked from `public, anon, authenticated` by name first (0087: Supabase grants every new table to the
-- client roles directly).
--
-- `network_attestations` keeps working. Every row there is copied here first, with its own time (before the time
-- trigger exists). From then on the two stay together: a confirmation recorded here is mirrored into
-- `network_attestations` (so anything that reads the network's table reads the person as confirmed), and a row a
-- writer still puts straight into `network_attestations` is mirrored here. Nobody who confirmed once is asked again.
create table adult_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adult_confirmations_user_id_key unique (user_id)
);
--> statement-breakpoint
alter table adult_confirmations enable row level security;
--> statement-breakpoint
create policy adult_confirmations_select on adult_confirmations for select using (user_id = auth.uid());
--> statement-breakpoint
create policy adult_confirmations_insert on adult_confirmations for insert with check (user_id = auth.uid());
--> statement-breakpoint
revoke all on adult_confirmations from public, anon, authenticated;
--> statement-breakpoint
grant select, insert on adult_confirmations to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on adult_confirmations to service_role;
--> statement-breakpoint
select fm_track_updated_at('adult_confirmations');
--> statement-breakpoint
-- Everyone the network already asked, with the time they confirmed.
insert into adult_confirmations (user_id, confirmed_at)
  select user_id, adult_confirmed_at from network_attestations
  on conflict (user_id) do nothing;
--> statement-breakpoint
-- The database sets the time: now() on insert, the first time kept on update.
create function fm_adult_confirmations_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.confirmed_at := now();
  else
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function fm_adult_confirmations_time() from public, anon, authenticated;
--> statement-breakpoint
create trigger adult_confirmations_time before insert or update on adult_confirmations for each row execute function fm_adult_confirmations_time();
--> statement-breakpoint
-- A confirmation here reads as one on the network. Security definer: a client inserts its own row here and holds no
-- write on `network_attestations`; the function writes only the row of the confirmation that fired it.
create function fm_adult_confirmations_to_network() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.network_attestations (user_id, adult_confirmed_at) values (new.user_id, new.confirmed_at)
    on conflict (user_id) do nothing;
  return null;
end
$$;
--> statement-breakpoint
revoke all on function fm_adult_confirmations_to_network() from public, anon, authenticated;
--> statement-breakpoint
create trigger adult_confirmations_to_network after insert on adult_confirmations for each row execute function fm_adult_confirmations_to_network();
--> statement-breakpoint
-- A row still written straight into `network_attestations` (only the service role writes there) lands here too.
create function fm_network_attestations_to_adult() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.adult_confirmations (user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  return null;
end
$$;
--> statement-breakpoint
revoke all on function fm_network_attestations_to_adult() from public, anon, authenticated;
--> statement-breakpoint
create trigger network_attestations_to_adult after insert on network_attestations for each row execute function fm_network_attestations_to_adult();
