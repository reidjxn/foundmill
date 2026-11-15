-- 0070 — a task's title in the founder's words (founder, 2026-11-01: "founder titles for tasks, Composer-generated,
-- at most ten words"). The planner and the agents name tasks in engineering terms ("Rebase agent/… onto main", "Fix
-- hydration mismatch"), and the founder meets every task somewhere: the Plan, a department card, the Inbox decision
-- about putting its change live. `founder_title` is written by the Composer (`POST /v1/founder-titles`, checked
-- against the vocabulary rules in @foundmill/shared) or by the api's deterministic rewrite when the Composer is away;
-- null means "not yet", and every founder-facing surface falls back to `title`. The technical title stays for the
-- agents and for "Details for a developer". The existing tenant policy and grants on `tasks` cover the column.
alter table tasks add column founder_title text;
--> statement-breakpoint
comment on column tasks.founder_title is 'The title in the founder''s words, at most ten, written by the Composer (POST /v1/founder-titles) or the api''s deterministic rewrite; null until then. Founder-facing screens fall back to title.';
