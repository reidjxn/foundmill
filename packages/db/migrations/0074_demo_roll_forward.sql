-- 0074 — The sample businesses roll forward with the calendar (first-time founder report, Phase 3 group K, Nov 10, 2026).
-- The demo seed dates its activity up to the day it ran, so "this week" on Northwind and Ledgerly read 0 once the
-- calendar moved on. `rollDemoForward` (packages/db/src/seed/roll-forward.ts) shifts every timestamp of the two demo
-- businesses (found by their fixed ids) forward by whole days in one transaction. Their `updated_at` is shifted with
-- the rest: while that transaction sets `fm.demo_roll_forward` to 'on', the updated_at trigger keeps the value the
-- statement wrote instead of stamping now() (a churned customer's role is "churned since its last change", and the
-- paying-customer count reads that time). Every other write still gets now(), as before.
create or replace function fm_set_updated_at() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('fm.demo_roll_forward', true), '') = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint
comment on function fm_set_updated_at() is 'Stamps updated_at with now(), except inside the demo roll-forward (fm.demo_roll_forward = on), which shifts it with the row.';
