-- 0085 — who or what brought a new person (docs/NETWORK.md §5 "Attribution is part of every loop", §11). Every public
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
-- client role reads or writes it, not even the person's own row: who referred them and which project it was are not
-- theirs to read (a profile or a page can be taken down, and an account id never leaves through a public address), and
-- a client that could insert here could credit anyone for itself. RLS is on with no policy, and the grants say the same.
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
