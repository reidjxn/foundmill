-- 0151 — one included budget per owner (WP-14; founder, Nov 19, 2026): the month's included team budget (Try $5.00,
-- Founder $10.00, Studio $50.00) is the owner's, shared across every project they took charge of, instead of a budget
-- per project. `owner_credits` is account-scoped, one row per person and month, written lazily on the owner's first
-- charge of the month by `repos.usage.chargeCreditsMicro`; a project's own `credit_balances` row now holds only what
-- the project itself bought (credit packs, as lots). A charge draws on the owner's row first, then the project's.
--   granted_minor  what the month's budget was when the row opened (the owner's plan then).
--   balance_minor  what is left of it, shared by all their projects. Never below zero.
--   spent_minor    what the owner's projects have drawn from it.
-- Reads: a person who is a member (not a collaborator) of a project the owner took charge of sees the owner's row, as they
-- see that project's own credits; nobody but the service role writes it.
create table owner_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null constraint owner_credits_period_format check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  granted_minor bigint not null default 0 constraint owner_credits_granted_nonneg check (granted_minor >= 0),
  balance_minor bigint not null default 0 constraint owner_credits_balance_nonneg check (balance_minor >= 0),
  spent_minor bigint not null default 0 constraint owner_credits_spent_nonneg check (spent_minor >= 0),
  -- Always US dollars, as credits are.
  currency char(3) not null default 'USD' constraint owner_credits_currency_usd check (currency = 'USD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_credits_user_id_period_key unique (user_id, period)
);
--> statement-breakpoint
alter table owner_credits enable row level security;
--> statement-breakpoint
revoke all on owner_credits from public, anon, authenticated;
--> statement-breakpoint
create function fm_shares_owner_budget(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join businesses b on b.id = m.business_id
     where b.created_by = owner and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
       and m.role <> 'collaborator'
  );
$$;
--> statement-breakpoint
revoke all on function fm_shares_owner_budget(uuid) from public, anon;
--> statement-breakpoint
grant execute on function fm_shares_owner_budget(uuid) to authenticated, service_role;
--> statement-breakpoint
create policy owner_credits_select on owner_credits for select using (fm_shares_owner_budget(user_id));
--> statement-breakpoint
grant select on owner_credits to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on owner_credits to service_role;
--> statement-breakpoint
select fm_track_updated_at('owner_credits');
--> statement-breakpoint
-- This month's projects already hold their own included credits, so an owner who has any keeps them and is granted no
-- second budget for the month (a row with nothing in it); the shared budget starts with the next month.
insert into owner_credits (user_id, period)
select distinct b.created_by, cb.period
  from credit_balances cb join businesses b on b.id = cb.business_id
 where b.created_by is not null and cb.period = to_char(now() at time zone 'UTC', 'YYYY-MM')
on conflict (user_id, period) do nothing;
