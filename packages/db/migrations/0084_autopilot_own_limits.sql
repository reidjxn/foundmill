-- 0084 — Autopilot's own limits (founder, 2026-11-12: "split the limits"). The daily cycle cap and spend ceiling of 0055
-- stay the shared ones: they bound Continue's runs and Autopilot alike. These two count only the cycles Autopilot starts
-- on its own schedule (never a press of Continue or the rounds of its run): how many a UTC day, and what they may spend
-- (USD cents, an Estimate). The spend ceiling is also the budget such a cycle is given, so it holds while the cycle runs.
-- Null: no limit of its own. The overnight shift (Commit's default) sets one cycle and 15 cents. The existing business
-- policies cover the columns; no new table.
alter table businesses
  add column autopilot_own_max_cycles_per_day integer check (autopilot_own_max_cycles_per_day between 1 and 24),
  add column autopilot_own_spend_ceiling_minor bigint check (autopilot_own_spend_ceiling_minor >= 0);
--> statement-breakpoint
comment on column businesses.autopilot_own_max_cycles_per_day is 'Cycles Autopilot itself may start per UTC day (not Continue''s); null: only the shared daily cap.';
--> statement-breakpoint
comment on column businesses.autopilot_own_spend_ceiling_minor is 'USD cents Autopilot''s own cycles may spend per UTC day, also each such cycle''s budget (an Estimate); null: none of its own.';
