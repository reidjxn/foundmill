-- 0144 — plans and prices (WP-14 T14; founder, Nov 17, 2026). Two tables, and nothing is charged by either.
--
-- `owner_plans` — account-scoped, one row per person, what a plan needs to know about its owner:
--   `invited_at`   the person joined while sign-up was invite-only (the day they joined). When charging opens these
--                  people are on Founder and are never billed its monthly fee, for as long as they keep their account
--                  (answer A12). Every account that exists when this migration runs joined that way, so each gets a row
--                  here. A person who joins later while sign-up is still invite-only is marked when they take charge of a
--                  project (apps/api commit) and, for the rest, in the opening step (`repos.ownerPlans.markInvitedBefore`,
--                  docs/DEPLOY.md §4).
--   `price_tier`, `price_minor`, `price_set_at`
--                  the first Founder or Studio price the person paid, in US cents a month, kept for as long as they stay
--                  subscribed: a later price change in config never reaches them. Null until a subscription is charged,
--                  which nothing does before sign-up opens.
--   No policy and no client grant: a client that could write its own row could give itself the invited marker.
--
-- `partner_waitlist` — business-scoped: an owner asked to hear when the Partner plan opens, for this project, and
--   agreed to be contacted about it (`consented_at`). No price is charged and no date is promised. Services write it
--   (the api checks the owner first), one row per person and project; the project's members read its rows, a
--   collaborator none.

create table owner_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_at timestamptz,
  price_tier text
    constraint owner_plans_price_tier_value check (price_tier is null or price_tier in ('pro', 'scale')),
  price_minor bigint
    constraint owner_plans_price_minor_check check (price_minor is null or price_minor >= 0),
  -- Plans are priced in US dollars, as credits are.
  currency char(3) not null default 'USD' constraint owner_plans_currency_usd check (currency = 'USD'),
  price_set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_plans_user_id_key unique (user_id),
  constraint owner_plans_price_together check ((price_tier is null) = (price_minor is null) and (price_tier is null) = (price_set_at is null))
);
--> statement-breakpoint
alter table owner_plans enable row level security;
--> statement-breakpoint
revoke all on owner_plans from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on owner_plans to service_role;
--> statement-breakpoint
select fm_track_updated_at('owner_plans');
--> statement-breakpoint
-- Everyone here today joined while sign-up was invite-only.
insert into owner_plans (user_id, invited_at) select id, created_at from auth.users on conflict (user_id) do nothing;
--> statement-breakpoint
create table partner_waitlist (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index partner_waitlist_business_id_user_id_key on partner_waitlist (business_id, user_id);
--> statement-breakpoint
create index partner_waitlist_user_id_idx on partner_waitlist (user_id);
--> statement-breakpoint
select fm_tenant_table('partner_waitlist', array['owner','admin'], 'read_only');
--> statement-breakpoint
-- A collaborator reads nothing of it (0094's rule for the admin-written billing tables).
drop policy partner_waitlist_select on partner_waitlist;
--> statement-breakpoint
create policy partner_waitlist_select on partner_waitlist for select using (is_member_not_collaborator(business_id));
