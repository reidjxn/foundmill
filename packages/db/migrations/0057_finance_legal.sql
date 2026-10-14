-- 0057 — finance and legal fixes (audit W03).
-- A cap-table entry's price is in its share class's currency. Entries written without one took the column default
-- (EUR) even under a GBP class, so the Cap table and both share-register exports printed euros for pounds.
update cap_table_entries e
   set currency = s.currency
  from securities s
 where s.id = e.security_id
   and s.business_id = e.business_id
   and e.currency <> s.currency;
--> statement-breakpoint
-- Forecasts seeded before the drivers contract (docs/DECISIONS.md "Forecast drivers contract") stored their cost line
-- as monthlyOutflowMinor; the contract key is monthlyCostsMinor, so the Runway tab fell back to today's gross burn.
update forecasts
   set drivers = (drivers - 'monthlyOutflowMinor') || jsonb_build_object('monthlyCostsMinor', drivers -> 'monthlyOutflowMinor')
 where drivers ? 'monthlyOutflowMinor'
   and not drivers ? 'monthlyCostsMinor';
--> statement-breakpoint
-- The founder's regulated-sector choices (Legal › Regulatory): whether a sector applies and which checklist items are
-- done. One row per sector the founder has decided on; a sector without a row falls back to the suggestion. Open gates
-- go into the team's brief every cycle.
create table regulatory_gates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sector text not null,
  applies boolean not null default true,
  done text[] not null default '{}',
  decided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index regulatory_gates_business_id_sector_key on regulatory_gates (business_id, sector);
--> statement-breakpoint
select fm_tenant_table('regulatory_gates');
