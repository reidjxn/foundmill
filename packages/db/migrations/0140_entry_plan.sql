-- 0140 — the $5 entry plan and credit packs on Foundmill's own Stripe (WP-09 T16; founder, Nov 17, 2026). Built
-- behind PAID_ENTRY, which stays off until sign-up opens: until then nothing here is offered to anyone.
--
-- billing_checkouts gains the `subscription` kind (the entry plan's Checkout, opened from a business's Billing tab or
-- its Continue gate) and `credits_minor`: what a credit pack grants when that differs from what it costs (null: the
-- amount paid, as every top-up so far). A subscription checkout grants nothing itself: the month's included credits
-- come as they do today; paying it records the account's plan.
--
-- `resume`: what the checkout was opened to unblock (the pay-and-resume loop, founder Nov 17, 2026): 'continue' means the
-- founder asked for the team's next round of work, so its confirmed payment starts it with no second press. Null: a
-- purchase on its own (the Billing tab), which resumes nothing beyond what a top-up already lifts.
--
-- account_plans: one row per account that has subscribed, account-scoped (no business_id): the subscription's status
-- as Stripe last reported it, its customer and subscription ids, and the end of the paid period. The person reads their
-- own row; only the services write (the api's mock settlement, ingest's webhook).
alter table billing_checkouts drop constraint billing_checkouts_kind_check;
--> statement-breakpoint
alter table billing_checkouts add constraint billing_checkouts_kind_check check (kind in ('credits', 'subscription'));
--> statement-breakpoint
alter table billing_checkouts add column credits_minor bigint check (credits_minor is null or credits_minor > 0);
--> statement-breakpoint
alter table billing_checkouts add column resume text check (resume is null or resume in ('continue'));
--> statement-breakpoint
create table account_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'entry' check (plan in ('entry')),
  status text not null check (status in ('active', 'past_due', 'canceled')),
  mode text not null check (mode in ('mock', 'live')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  -- When Stripe created the event that last set the status: an older event that arrives later never overrides it.
  status_at timestamptz,
  checkout_id uuid references billing_checkouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_plans_user_id_key unique (user_id)
);
--> statement-breakpoint
create unique index account_plans_stripe_subscription_id_key on account_plans (stripe_subscription_id) where stripe_subscription_id is not null;
--> statement-breakpoint
create index account_plans_checkout_id_idx on account_plans (checkout_id);
--> statement-breakpoint
alter table account_plans enable row level security;
--> statement-breakpoint
create policy account_plans_select on account_plans for select using (user_id = auth.uid());
--> statement-breakpoint
revoke all on account_plans from public, anon, authenticated;
--> statement-breakpoint
-- The person sees their plan's state, never the Stripe ids (the services read those).
grant select (id, user_id, plan, status, mode, current_period_end, status_at, created_at, updated_at) on account_plans to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on account_plans to service_role;
--> statement-breakpoint
select fm_track_updated_at('account_plans');
