-- 0009 — finance: bank accounts, transactions, ledger, forecasts, cap table, usage, credits.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null,
  external_id text not null,
  name text not null,
  currency char(3) not null default 'EUR',
  balance_minor bigint not null default 0,
  balance_at timestamptz,
  consent_expires_at timestamptz,
  integration_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, provider, external_id)
);
--> statement-breakpoint
create index accounts_business_id_idx on accounts (business_id);
--> statement-breakpoint
create index accounts_integration_id_idx on accounts (integration_id);
--> statement-breakpoint
select fm_tenant_table('accounts', array['owner','admin']);
--> statement-breakpoint
create table transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  external_id text,
  booked_at timestamptz not null,
  amount_minor bigint not null,
  currency char(3) not null default 'EUR',
  counterparty text,
  counterparty_entity_id uuid references entities(id) on delete set null,
  description text not null default '',
  category text,
  category_source text check (category_source in ('rule','model','ledger','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, external_id)
);
--> statement-breakpoint
create index transactions_business_id_idx on transactions (business_id, booked_at desc);
--> statement-breakpoint
create index transactions_account_id_idx on transactions (account_id, booked_at desc);
--> statement-breakpoint
create index transactions_category_idx on transactions (business_id, category);
--> statement-breakpoint
create index transactions_counterparty_entity_id_idx on transactions (counterparty_entity_id);
--> statement-breakpoint
select fm_tenant_table('transactions');
--> statement-breakpoint
create table ledger_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  period text not null,
  basis text not null default 'cash' check (basis in ('accrual','cash')),
  currency char(3) not null default 'EUR',
  pnl jsonb not null default '{}',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period, basis)
);
--> statement-breakpoint
create index ledger_snapshots_business_id_idx on ledger_snapshots (business_id, period);
--> statement-breakpoint
select fm_tenant_table('ledger_snapshots');
--> statement-breakpoint
create table forecasts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scenario text not null check (scenario in ('base','upside','downside')),
  currency char(3) not null default 'EUR',
  drivers jsonb not null default '{}',
  series jsonb not null default '[]',
  generated_by_agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index forecasts_business_id_idx on forecasts (business_id, scenario, created_at desc);
--> statement-breakpoint
create index forecasts_generated_by_agent_id_idx on forecasts (generated_by_agent_id);
--> statement-breakpoint
select fm_tenant_table('forecasts');
--> statement-breakpoint
create table securities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  class text not null,
  kind text not null check (kind in ('common','preferred','option','warrant','safe','note')),
  terms jsonb not null default '{}',
  authorised_quantity bigint,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, class)
);
--> statement-breakpoint
create index securities_business_id_idx on securities (business_id);
--> statement-breakpoint
select fm_tenant_table('securities', array['owner','admin']);
--> statement-breakpoint
create table cap_table_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  holder_entity_id uuid not null references entities(id) on delete restrict,
  security_id uuid not null references securities(id) on delete cascade,
  quantity numeric(20,4) not null,
  price_minor bigint,
  currency char(3) not null default 'EUR',
  vesting jsonb,
  issued_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index cap_table_entries_business_id_idx on cap_table_entries (business_id);
--> statement-breakpoint
create index cap_table_entries_holder_entity_id_idx on cap_table_entries (holder_entity_id);
--> statement-breakpoint
create index cap_table_entries_security_id_idx on cap_table_entries (security_id);
--> statement-breakpoint
select fm_tenant_table('cap_table_entries', array['owner','admin']);
--> statement-breakpoint
create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  session_id uuid references agent_sessions(id) on delete set null,
  kind text not null check (kind in ('tokens','sandbox','tool','training')),
  model_key text check (model_key in ('opus','sonnet','haiku')),
  quantity bigint not null default 0,
  unit text not null default 'tokens',
  cost_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  billed_to text not null default 'credits' check (billed_to in ('byok','credits')),
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index usage_ledger_business_id_idx on usage_ledger (business_id, occurred_at desc);
--> statement-breakpoint
create index usage_ledger_agent_id_idx on usage_ledger (agent_id, occurred_at desc);
--> statement-breakpoint
create index usage_ledger_session_id_idx on usage_ledger (session_id);
--> statement-breakpoint
create index usage_ledger_kind_idx on usage_ledger (business_id, kind, occurred_at);
--> statement-breakpoint
select fm_tenant_table('usage_ledger', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create table credit_balances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  period text not null,
  balance_minor bigint not null default 0,
  granted_minor bigint not null default 0,
  spent_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period)
);
--> statement-breakpoint
create index credit_balances_business_id_idx on credit_balances (business_id, period desc);
--> statement-breakpoint
select fm_tenant_table('credit_balances', array['owner','admin','member'], 'read_only');
