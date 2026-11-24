-- 0174 — the terms check of a website the team may work in (founder, Nov 24, 2026: "Add any website").
-- Before a founder first connects a site Foundmill does not list, the gateway reads the site's terms of use and a model
-- says whether they forbid automated use of a person's own account. The answer is about the site, not about a project,
-- so it is one row per host for the whole platform and is reused for 30 days (the reader decides when a row is stale).
--
-- A platform table like `site_address_holds` (0130): no business_id, RLS on with no policy and no app-role grant, read
-- and written by the service connection only (the gateway writes it, the api reads it after its own membership check).
-- `line` is a quote that was found in the fetched terms text; `simulated` marks an answer the mock gave, which a live
-- reader never accepts, so a host has one row per mode. `never_category` is set when the model put the site in a
-- category the team never works in (a bank, a payment account, a social network and the like): such a row is a refusal.
create table site_terms_checks (
  id uuid primary key default gen_random_uuid(),
  host text not null check (host = lower(host) and char_length(host) between 3 and 253),
  verdict text not null check (verdict in ('forbids', 'unclear', 'allows')),
  line text check (line is null or char_length(line) <= 300),
  terms_url text check (terms_url is null or char_length(terms_url) <= 500),
  sign_in_hosts text[] not null default '{}',
  simulated boolean not null default false,
  never_category text check (never_category is null or never_category in ('bank', 'brokerage', 'payment', 'government_identity', 'health_records', 'password_manager', 'social_network')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_terms_checks_host_simulated_key unique (host, simulated)
);
--> statement-breakpoint
select fm_track_updated_at('site_terms_checks');
--> statement-breakpoint
alter table site_terms_checks enable row level security;
--> statement-breakpoint
revoke all on site_terms_checks from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on site_terms_checks to service_role;
