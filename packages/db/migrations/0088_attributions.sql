-- 0088 — who or what brought a new person (docs/NETWORK.md §5 "Attribution is part of every loop", §11). Every public
-- address accepts `?via=<reference>`; the web keeps the first one a visitor arrives with in a cookie, and when that
-- visitor becomes a person (their founder profile is first created) the api records it here, once. It is how the growth
-- loops are measured and how credit for bringing someone is later paid; nothing is paid from this table yet.
--
-- One row per account, ever (`user_id` is unique): a later reference never replaces the first. Account-scoped, no
-- `business_id`: the row is about the new person, who has no business yet. `source_business_id` is the project whose
-- page brought them (not a tenancy key), and `referrer_user_id` the person credited: the page's longest-standing owner,
-- or the profile's own person.
--
-- Who may do what: the api alone, on the service connection (`founder.profile.update`, services/attribution.ts). No
-- client role reads or writes it, not even the person's own row: who is credited and which project it was, by id, are
-- not theirs to read (a page need not name its founders, and an account id never leaves through a public address), and
-- a client that could insert here could credit anyone for itself. RLS is on with no policy, and the grants say the same.
--
-- The events. One sign-up that a public address brought is a fact about two people, so the api writes two account
-- events (0085) in the transaction that inserts the row here, one per person, each in that person's own
-- `account_events`: `signup.attributed` for the new person ("you arrived through this public page or profile") and,
-- when someone is credited, `referral.arrived` for them ("someone signed up through your page or profile"). Both carry
-- `sourceKind` and `sourceRef` (the slug or handle as it arrived: public, it was in an address) and nothing else: no
-- account id, no business id, and nothing in the credited person's row about who signed up. This table is where the
-- two accounts and the project are held together by id. Nothing goes to a business's `events` or `outbox`. The last
-- statements of this file add the two types to the database's list of account-scoped types.
create table attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- What the reference named (`VIA_KINDS` in @foundmill/shared/via; a test compares the two lists).
  source_kind text not null
    constraint attributions_source_kind_value check (source_kind in ('project_page', 'person_profile')),
  -- The slug or handle as it arrived: the shape both share (0077, 0080).
  source_ref text not null
    constraint attributions_source_ref_format check (source_ref ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  -- Set for a project page; kept null for a person's profile. A deleted business leaves the row (the person was still brought).
  source_business_id uuid references businesses(id) on delete set null,
  -- The person credited; null once their account is gone.
  referrer_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attributions_user_id_key unique (user_id),
  -- Nobody brings themselves.
  constraint attributions_not_self check (referrer_user_id is null or referrer_user_id <> user_id),
  constraint attributions_business_for_page_only check (source_kind = 'project_page' or source_business_id is null)
);
--> statement-breakpoint
create index attributions_source_business_id_idx on attributions (source_business_id);
--> statement-breakpoint
create index attributions_referrer_user_id_idx on attributions (referrer_user_id);
--> statement-breakpoint
alter table attributions enable row level security;
--> statement-breakpoint
revoke all on attributions from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on attributions to service_role;
--> statement-breakpoint
select fm_track_updated_at('attributions');
--> statement-breakpoint
-- The account-scoped event types, redefined with the two this migration brings (0085 defined the function and asks
-- for exactly this: a later migration with `create or replace`). The list is `ACCOUNT_EVENT_TYPES` in
-- @foundmill/shared, in its order; packages/db `rls/account-events.test.ts` compares the two, and reads the latest
-- definition among the migrations. Both checks call the function by name each time a row is written, so
-- `account_events_type_account_scoped` takes the two new types from here on and `events_not_account_scoped` refuses
-- them, whoever writes. Language, volatility, parallel safety and `search_path` are restated as 0085 has them, because
-- `create or replace` resets every attribute that is left out; the owner and the grants are kept by it, and the two
-- statements after it say them again so this file can be read on its own.
create or replace function fm_account_event_types() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['profile.published', 'profile.unpublished', 'signup.attributed', 'referral.arrived']::text[]
$$;
--> statement-breakpoint
revoke all on function fm_account_event_types() from public, anon;
--> statement-breakpoint
grant execute on function fm_account_event_types() to authenticated, service_role;
--> statement-breakpoint
-- A check is not run again over the rows already there when the function it calls changes. No writer ever produced
-- either type in `events` (`signup.attributed` was declared and never written; `referral.arrived` is new), but until
-- now a member could plant a row under either name straight through RLS. Such a row goes, as 0085 did for its own two
-- types, so every row of `events` satisfies the check as it now reads (its outbox row cascades).
delete from events where type in ('signup.attributed', 'referral.arrived');
