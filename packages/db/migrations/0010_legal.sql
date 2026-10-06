-- 0010 — legal: entities, incorporations, filings, contracts, compliance events.
create table legal_entities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  jurisdiction text not null,
  entity_type text not null,
  legal_name text not null,
  reg_no text,
  registered_address jsonb,
  officers jsonb not null default '[]',
  share_capital_minor bigint,
  currency char(3) not null default 'EUR',
  formed_at date,
  source text,
  status text not null default 'planned' check (status in ('planned','forming','active','dissolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index legal_entities_business_id_idx on legal_entities (business_id);
--> statement-breakpoint
create index legal_entities_legal_name_trgm_idx on legal_entities using gin (legal_name gin_trgm_ops);
--> statement-breakpoint
select fm_tenant_table('legal_entities', array['owner','admin']);
--> statement-breakpoint
create table incorporations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  legal_entity_id uuid references legal_entities(id) on delete set null,
  route text not null check (route in ('stripe_atlas','companies_house_web','kit')),
  status text not null default 'draft' check (status in ('draft','in_progress','awaiting_founder','submitted','complete','abandoned')),
  steps jsonb not null default '[]',
  browser_session_id text,
  workflow_id text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index incorporations_business_id_idx on incorporations (business_id);
--> statement-breakpoint
create index incorporations_legal_entity_id_idx on incorporations (legal_entity_id);
--> statement-breakpoint
select fm_tenant_table('incorporations', array['owner','admin']);
--> statement-breakpoint
create table filings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  legal_entity_id uuid references legal_entities(id) on delete set null,
  kind text not null,
  title text not null default '',
  due_at timestamptz,
  filed_at timestamptz,
  status text not null default 'upcoming' check (status in ('upcoming','due','overdue','filed','waived')),
  ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index filings_business_id_idx on filings (business_id, due_at);
--> statement-breakpoint
create index filings_legal_entity_id_idx on filings (legal_entity_id);
--> statement-breakpoint
create index filings_status_idx on filings (business_id, status);
--> statement-breakpoint
select fm_tenant_table('filings');
--> statement-breakpoint
create table contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  counterparty_entity_id uuid references entities(id) on delete set null,
  kind text not null,
  title text not null default '',
  status text not null default 'draft' check (status in ('draft','review','awaiting_signature','signed','active','expired','terminated')),
  doc_ref text,
  signed_at timestamptz,
  starts_at date,
  ends_at date,
  value_minor bigint,
  currency char(3) not null default 'EUR',
  obligations jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index contracts_business_id_idx on contracts (business_id);
--> statement-breakpoint
create index contracts_counterparty_entity_id_idx on contracts (counterparty_entity_id);
--> statement-breakpoint
create index contracts_status_idx on contracts (business_id, status);
--> statement-breakpoint
select fm_tenant_table('contracts');
--> statement-breakpoint
create table compliance_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  legal_entity_id uuid references legal_entities(id) on delete set null,
  kind text not null,
  title text not null default '',
  due_at timestamptz not null,
  recurrence text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index compliance_events_business_id_idx on compliance_events (business_id, due_at);
--> statement-breakpoint
create index compliance_events_legal_entity_id_idx on compliance_events (legal_entity_id);
--> statement-breakpoint
select fm_tenant_table('compliance_events');
