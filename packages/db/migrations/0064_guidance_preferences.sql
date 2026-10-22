-- 0064 — guidance preferences (docs/UX_AUDIT_AND_PLAN.md §6.3; founder, 2026-10-20). The guided layer's one switch and
-- its memory live on the account's preferences row, beside the date format: "on" shows explainers, the first-week
-- checklist, coach marks, term underlines and kbd caps; "off" hides that tutoring and never hides information
-- (consequences, provenance, Estimate). `text_size` is the comfortable type mode (body 14/20, small 12.5/16); the two
-- jsonb maps remember which screens' explainers were dismissed and which tours were done (`{ "home": true }`), and
-- `checklist_dismissed_at` when the checklist was put away. Nothing is stored per business: a second business of the
-- same account inherits the choice and never replays the tours. Account-scoped like the rest of the row, so the
-- existing policy (`user_id = auth.uid()`) and grants cover the new columns; a person with no row reads the defaults.
alter table account_preferences add column guidance text not null default 'on' check (guidance in ('on','off'));
--> statement-breakpoint
alter table account_preferences add column text_size text not null default 'standard' check (text_size in ('standard','comfortable'));
--> statement-breakpoint
alter table account_preferences add column explainers_seen jsonb not null default '{}';
--> statement-breakpoint
alter table account_preferences add column tours_done jsonb not null default '{}';
--> statement-breakpoint
alter table account_preferences add column checklist_dismissed_at timestamptz;
