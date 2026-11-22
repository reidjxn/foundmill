-- 0150 — paying for a domain registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md,
-- Path A; founder, Nov 17, 2026: "Paid through Foundmill's Stripe"). A domain is a one-off Stripe Checkout payment on
-- the platform account, a `domain` checkout: the price shown before paying (OpenSRS's cost plus about $3, an Estimate)
-- is its amount, and `domain_name` is what it pays for. Paying grants no credits; it lets the registration run, once:
-- `fulfilled_at` is claimed atomically by the one registration that may follow (a second press, a retry or a replayed
-- webhook finds it taken), and given back if the registry refused, so the founder can try again or be refunded.
alter table billing_checkouts drop constraint billing_checkouts_kind_check;
--> statement-breakpoint
alter table billing_checkouts add constraint billing_checkouts_kind_check check (kind in ('credits', 'subscription', 'domain'));
--> statement-breakpoint
alter table billing_checkouts add column domain_name text
  constraint billing_checkouts_domain_name_format check (domain_name is null or domain_name ~ '^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');
--> statement-breakpoint
alter table billing_checkouts add constraint billing_checkouts_domain_named check ((kind = 'domain') = (domain_name is not null));
--> statement-breakpoint
alter table billing_checkouts add column fulfilled_at timestamptz;
--> statement-breakpoint
-- The founder's registrant details for a domain checkout, between paying and registering: their name, address, email
-- and phone (the domain's owner contact). Kept apart from billing_checkouts, which every founder of the project reads, so
-- no one but the services ever reads another founder's address: RLS on with no policy and no grant to an app role.
-- Deleted once the registration went through (and with the checkout or the business).
create table domain_registrants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  checkout_id uuid not null references billing_checkouts(id) on delete cascade,
  registrant jsonb not null
    constraint domain_registrants_registrant_object check (jsonb_typeof(registrant) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domain_registrants_checkout_id_key unique (checkout_id)
);
--> statement-breakpoint
create index domain_registrants_business_id_idx on domain_registrants (business_id);
--> statement-breakpoint
select fm_track_updated_at('domain_registrants');
--> statement-breakpoint
alter table domain_registrants enable row level security;
--> statement-breakpoint
revoke all on domain_registrants from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on domain_registrants to service_role;
