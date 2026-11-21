-- 0150 — the waitlist opens in batches (founder, 2026-11-17; docs/holistic-plan/WP-14-behavior-brief.md A7 and T15).
-- This replaces "no admission in weekly cohorts" and "no public counts" (2026-11-12, answers 4 and 7) for the waitlist
-- only. (0135 to 0140 are assigned to open pull requests: #285, #208, Stripe Connect, #251.)
--
-- `waitlist_batches` — platform-scoped, one row per batch: its number, the UTC day it opens and how many places it has.
-- The operator writes the rows (docs/DEPLOY.md §4 "Open the waitlist in batches"); the orchestrator's
-- `waitlist-admissions` sweep admits from the waitlist, in the waitlist's own order, on and after that day until the
-- places are taken, and the public page (/waitlist) shows the next batch that still has places. The api's and the
-- orchestrator's alone: RLS on, no policy, no client grant (as `waitlist_entries`, 0086).
--
-- `taken` counts the new accounts the batch admitted and only ever goes up (the sweep adds to it in the admission's
-- transaction): a batch's places left are `places - taken`, so an account closed later gives no place back and a batch
-- never admits more than it published. `places` cannot be set below `taken`.
--
-- `waitlist_entries.batch_id` — the batch an entry was admitted in; null for one admitted by the daily number, by hand
-- or not yet. It is the record of who came in which batch (the measures read it). RLS unchanged: the table has
-- no policy for a client role, and a column needs none.
--
-- `waitlist_entries.personal_note_at` — when the founder's own personal note to this person was sent (T15 step 5: the
-- founder writes to each of the first hundred by hand; Foundmill sends nothing and only keeps the record). The operator
-- sets it (docs/DEPLOY.md §4). Null: no note recorded. It is what "activation by personal note against standard email"
-- is measured from (docs/holistic-plan/WP-14-T15-measures.md).
create table waitlist_batches (
  id uuid primary key default gen_random_uuid(),
  number integer not null
    constraint waitlist_batches_number_positive check (number > 0),
  opens_on date not null,
  places integer not null
    constraint waitlist_batches_places_range check (places between 1 and 1000),
  taken integer not null default 0
    constraint waitlist_batches_taken_range check (taken >= 0 and taken <= places),
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
select fm_track_updated_at('waitlist_batches');
--> statement-breakpoint
alter table waitlist_entries add column batch_id uuid references waitlist_batches(id) on delete set null;
--> statement-breakpoint
create index waitlist_entries_batch_id_idx on waitlist_entries (batch_id) where batch_id is not null;
--> statement-breakpoint
alter table waitlist_entries add column personal_note_at timestamptz;
