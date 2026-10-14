-- 0025 — the business's own currency (CLAUDE.md: money keeps the business's own currency). Until now a business had
-- none: commit wrote the founder's choice onto departments, agents, channels and tasks only, so every business-level
-- figure (cash before a bank is connected, plan totals, milestones, hires, vacations, dashboard metrics) fell back to
-- EUR in a dollar or pound business. `currency` is the ISO 4217 code of the business's money: set at commit from the
-- founder's choice, changed by owners and admins in Settings › Business (the 0002 update policy). Model and credit costs
-- are not business money and stay in USD.
alter table businesses add column currency char(3);
--> statement-breakpoint
-- Backfill: the currency commit gave the business's departments (the most common one), else its channels', else the
-- creator's profile currency, else USD.
update businesses b set currency = coalesce(
  (select d.currency from departments d where d.business_id = b.id group by d.currency order by count(*) desc, d.currency limit 1),
  (select c.currency from channels c where c.business_id = b.id group by c.currency order by count(*) desc, c.currency limit 1),
  (select f.currency from founder_profiles f where f.user_id = b.created_by),
  'USD'
);
--> statement-breakpoint
alter table businesses alter column currency set default 'USD';
--> statement-breakpoint
alter table businesses alter column currency set not null;
--> statement-breakpoint
alter table businesses add constraint businesses_currency_code check (currency ~ '^[A-Z]{3}$');
--> statement-breakpoint
-- A business amount written without a currency takes the business's. These tables kept `default 'EUR'` from 0004–0010,
-- so an agent hired from Recruitment, a vacation without a budget ceiling or a department added in Settings was stored
-- in euros whatever the business used. The default goes; a trigger fills a missing currency from the business row.
-- Security definer so the lookup does not depend on what the inserting role may read; the row's own policies still
-- decide whether it may be written. Model-cost tables are not business money and are not listed (below).
create function fm_business_currency_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency is null then
    select b.currency into new.currency from businesses b where b.id = new.business_id;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create function fm_business_currency(tbl text) returns void language plpgsql as $$
begin
  execute format('alter table %I alter column currency drop default', tbl);
  execute format('create trigger %I before insert on %I for each row execute function fm_business_currency_fill()', tbl || '_business_currency', tbl);
end;
$$;
--> statement-breakpoint
select fm_business_currency(t) from unnest(array[
  'departments', 'tasks', 'holiday_periods',
  'channels', 'campaigns', 'channel_metrics', 'conversions',
  'accounts', 'transactions', 'ledger_snapshots', 'forecasts', 'securities', 'cap_table_entries',
  'legal_entities', 'contracts'
]) as t;
--> statement-breakpoint
-- What a session, a training run, an agent's day or an Inbox note cost is a model cost, metered in the pricing currency
-- (USD), whatever the business uses: a row written without a currency says USD, not EUR. (usage_ledger and
-- credit_balances belong to billing.) An agent's wage cap caps that metered cost, so it is in US dollars too (0024).
alter table agents alter column currency set default 'USD';
--> statement-breakpoint
alter table agent_sessions alter column currency set default 'USD';
--> statement-breakpoint
alter table agent_metrics alter column currency set default 'USD';
--> statement-breakpoint
alter table training_runs alter column currency set default 'USD';
--> statement-breakpoint
alter table inbox_items alter column currency set default 'USD';
