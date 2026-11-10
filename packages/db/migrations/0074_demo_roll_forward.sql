-- 0074 — The sample businesses roll forward with the calendar (first-time founder report, Phase 3 group K, Nov 10, 2026).
-- The demo seed dates its activity up to the day it ran, so "this week" on Northwind and Ledgerly read 0 once the
-- calendar moved on. `rollDemoForward` (packages/db/src/seed/roll-forward.ts) shifts the timestamps of the two demo
-- businesses' own sample rows (found by their fixed ids) forward by whole days, one transaction per business.
--
-- Which rows are the sample's: `demo_sample_rows` lists, per demo business and table, the ids of the rows the seed
-- wrote (recorded by the seed just before its `seed.demo` audit entry). Only those rows ever move, however many rolls
-- run, so a row a person or a service writes later (an owner's approval, a nightly agent rollup, a viewer's seat) keeps
-- its real times for good. A listed row someone changes after a roll leaves the list (its updated_at, stamped by the
-- trigger below, is newer than the roll). Standard tenancy, read-only for app roles: members of the business may read
-- the list; only the seed and the roll (the service connection) write it.
create table demo_sample_rows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- A business-scoped table in the public schema.
  table_name text not null check (char_length(table_name) between 1 and 63),
  row_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, table_name)
);
--> statement-breakpoint
select fm_tenant_table('demo_sample_rows', array['owner'], 'read_only');
--> statement-breakpoint
-- updated_at is shifted with the rest of a sample row: while the roll's transaction sets `fm.demo_roll_forward` to the
-- id of the business it is rolling, the updated_at trigger keeps the value the statement wrote for that business's rows
-- instead of stamping now() (a churned customer's role is "churned since its last change", and the paying-customer
-- count reads that time). The exemption is scoped: a row of any other business, and any statement run as an app role
-- (authenticated, anon), still gets now(), whatever the setting says; so a signed-in session that sets the setting
-- itself cannot pin updated_at. Every other write gets now(), as before.
create or replace function fm_set_updated_at() returns trigger language plpgsql as $$
declare
  rolling text := coalesce(current_setting('fm.demo_roll_forward', true), '');
begin
  if rolling <> '' and current_user not in ('authenticated', 'anon') then
    if rolling = coalesce(to_jsonb(new) ->> 'business_id', case when tg_table_name = 'businesses' then to_jsonb(new) ->> 'id' end) then
      return new;
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint
comment on function fm_set_updated_at() is 'Stamps updated_at with now(), except for the rows of the business the demo roll-forward is rolling (fm.demo_roll_forward = its id, never for authenticated or anon), which keep the shifted value.';
