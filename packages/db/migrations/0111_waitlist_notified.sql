-- 0111 — the waitlist admits and emails (WP-03 T2). `admitted_at` (0086) is now written: by the orchestrator's
-- `waitlist-admissions` sweep (oldest sign-up first, at most WAITLIST_ADMIT_PER_DAY a UTC day; unset means none), or by
-- the operator's SQL (docs/DEPLOY.md §4 "Admit people from the waitlist"). `notified_at` is when the gateway sent the
-- one email that says the place is open (`waitlist_admitted`); null until then, and the sweep asks again.
--
-- RLS unchanged: the table stays the services' alone (RLS on, no policy, no grant to a client role).
alter table waitlist_entries add column notified_at timestamptz;
--> statement-breakpoint
-- The sweep's two reads: who waits, oldest first; who was admitted and not yet told.
create index waitlist_entries_waiting_idx on waitlist_entries (created_at) where admitted_at is null and user_id is not null;
--> statement-breakpoint
create index waitlist_entries_to_notify_idx on waitlist_entries (admitted_at) where notified_at is null;
