-- 0139 — Autopilot's "every third day" cadence (WP-09 T12; founder, Nov 16, 2026, D7 option B): the overnight shift
-- runs one round of work every third night at its $0.15 cap. New projects get it at commit; a project's existing
-- cadence is left as its founder or commit set it.
alter table businesses drop constraint businesses_autopilot_cadence_check;
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_cadence_check check (autopilot_cadence in ('after_cycle', 'every_1h', 'every_4h', 'every_12h', 'daily', 'every_3_days'));
