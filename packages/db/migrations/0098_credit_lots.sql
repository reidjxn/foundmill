-- 0098 — bought credits last 12 months (founder, 2026-11-13). Until now a top-up was added to the month's balance row
-- and went with it at the end of the month. Now every paid top-up is also a lot: what was bought, what is left of it,
-- and when it expires (12 months after payment). The month's balance row keeps being the one balance everything
-- reads; the lots say how much of it is bought credit:
--   - a charge spends the month's included credits first, then the lots, the one that expires first first;
--   - a new month's row starts with the included credits plus every lot still live (bought credit carries over);
--   - a lot past its expiry leaves the balance with what is left of it.
-- Rows are written by services only (api and ingest through the service role, as for credit_balances); members read
-- their business's rows.
create table credit_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  checkout_id uuid references billing_checkouts(id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0),
  remaining_minor bigint not null check (remaining_minor >= 0 and remaining_minor <= amount_minor),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  purchased_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > purchased_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index credit_lots_business_id_idx on credit_lots (business_id, expires_at) where remaining_minor > 0;
--> statement-breakpoint
create unique index credit_lots_checkout_id_key on credit_lots (checkout_id) where checkout_id is not null;
--> statement-breakpoint
select fm_tenant_table('credit_lots', array['owner','admin','member'], 'read_only');
