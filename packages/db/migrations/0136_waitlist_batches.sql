-- 0136 — the waitlist opens in batches (WP-14 T15; founder answer A7, Nov 17, 2026, which replaces "no admission in
-- weekly cohorts" and "no public counts" for the waitlist). The operator sets each batch's day and size; on that day the
-- orchestrator's `waitlist-admissions` sweep lets in the next `places` people in the waitlist's own order (WP-03 T10)
-- and closes the batch. The public waitlist page shows the next batch that has not opened: its number, day and places.
-- Until the operator screen exists (it needs `operatorProcedure`), a batch is set by the SQL in docs/DEPLOY.md §4.
--
-- `waitlist_entries.batch_number` records which batch let a person in (null: the daily number, the operator by hand, or
-- not yet); `personal_note_at` records that the founder sent that person a personal note (the note itself is the
-- founder's own action; only that it was sent is stored). Both feed the measures of T15 step 6.
--
-- Both tables are the services' alone: RLS on, no policy, no grant to a client role. The page reads the next batch
-- through the api, which answers with the number, day and places only.
create table waitlist_batches (
  id uuid primary key default gen_random_uuid(),
  number integer not null check (number > 0),
  opens_at timestamptz not null,
  places integer not null check (places between 1 and 10000),
  admitted_at timestamptz,
  admitted_count integer check (admitted_count is null or admitted_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_batches_number_key unique (number)
);
--> statement-breakpoint
alter table waitlist_batches enable row level security;
--> statement-breakpoint
revoke all on waitlist_batches from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on waitlist_batches to service_role;
--> statement-breakpoint
create trigger waitlist_batches_updated_at before update on waitlist_batches for each row execute function fm_set_updated_at();
--> statement-breakpoint
-- The sweep's and the page's read: the batches not yet opened, by day.
create index waitlist_batches_due_idx on waitlist_batches (opens_at) where admitted_at is null;
--> statement-breakpoint
alter table waitlist_entries add column batch_number integer;
--> statement-breakpoint
alter table waitlist_entries add column personal_note_at timestamptz;
