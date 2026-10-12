-- 0033 — paying for credits (audit 2026-10-12 #22). A top-up is a Stripe Checkout session on the platform's own Stripe
-- account: the api asks the gateway for it and sends the founder there, and the credits are granted only when the
-- platform Stripe webhook (apps/ingest `POST /billing/stripe`, signed with STRIPE_BILLING_WEBHOOK_SECRET) reports the
-- session paid, or, in mock mode, when the founder completes the simulated checkout (labeled, no money moves). One row
-- per checkout, and the row is the idempotency key: it moves from open to paid once, in the same transaction as the
-- grant, so a session Stripe announces twice (a retry, `async_payment_succeeded` after `completed`) is granted once.
-- Amounts are USD minor units (credits are USD, contract 5). Rows are written by services only (api and ingest through
-- the service role); members read their business's rows, and the api asks for the billing section.
create table billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null default 'credits' check (kind in ('credits')),
  status text not null default 'open' check (status in ('open', 'paid', 'expired', 'failed')),
  mode text not null check (mode in ('mock', 'live')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  created_by uuid,
  -- The Stripe Checkout session (`cs_…`); null until the gateway answered.
  external_id text,
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  -- What settled it: the Stripe event id, or `mock:<checkout id>` for a simulated payment.
  paid_event_id text,
  -- The credit_balances period the credits went to (YYYY-MM).
  granted_period text check (granted_period is null or granted_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  credit_balance_id uuid references credit_balances(id) on delete set null,
  failure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);
--> statement-breakpoint
create index billing_checkouts_business_id_idx on billing_checkouts (business_id, created_at desc);
--> statement-breakpoint
create unique index billing_checkouts_external_id_key on billing_checkouts (external_id) where external_id is not null;
--> statement-breakpoint
create index billing_checkouts_credit_balance_id_idx on billing_checkouts (credit_balance_id);
--> statement-breakpoint
select fm_tenant_table('billing_checkouts', array['owner','admin'], 'read_only');
