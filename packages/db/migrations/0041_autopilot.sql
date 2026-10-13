-- 0041 — Autopilot (2026-10-13). A business can start its own cycles: off by default, owners and admins turn it on in
-- Settings › Mode (or on Commit). The setting and its state live on `businesses` (one workflow per business,
-- `autopilot:<businessId>`, drives it), so the existing business policies apply: members read it, only owners and
-- admins (or services) change it. `autopilot_paused_reason` is set when a guard rail paused it (Stop all agents, a
-- revoked key, used-up credits, failed or empty cycles in a row) and cleared only by turning Autopilot on again, so
-- Resume never restarts it by itself. `autopilot_changed_at` is when it was last turned on; `autopilot_next_at` is the
-- next planned cycle (an Estimate).
alter table businesses add column autopilot_enabled boolean not null default false;
--> statement-breakpoint
alter table businesses add column autopilot_cadence text not null default 'every_4h';
--> statement-breakpoint
alter table businesses add column autopilot_daily_hour integer not null default 9;
--> statement-breakpoint
alter table businesses add column autopilot_max_cycles_per_day integer not null default 6;
--> statement-breakpoint
alter table businesses add column autopilot_spend_ceiling_minor bigint;
--> statement-breakpoint
alter table businesses add column autopilot_max_idle_cycles integer not null default 3;
--> statement-breakpoint
alter table businesses add column autopilot_paused_reason text;
--> statement-breakpoint
alter table businesses add column autopilot_changed_at timestamptz;
--> statement-breakpoint
alter table businesses add column autopilot_next_at timestamptz;
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_cadence_check check (autopilot_cadence in ('after_cycle', 'every_1h', 'every_4h', 'every_12h', 'daily'));
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_daily_hour_check check (autopilot_daily_hour between 0 and 23);
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_max_cycles_check check (autopilot_max_cycles_per_day between 1 and 24);
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_max_idle_check check (autopilot_max_idle_cycles between 1 and 10);
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_spend_ceiling_check check (autopilot_spend_ceiling_minor is null or autopilot_spend_ceiling_minor >= 0);
--> statement-breakpoint
alter table businesses add constraint businesses_autopilot_paused_reason_check check (autopilot_paused_reason is null or autopilot_paused_reason in ('kill_switch', 'key_revoked', 'credits_exhausted', 'idle_cycles'));
--> statement-breakpoint
-- A pause only means something while Autopilot is on.
alter table businesses add constraint businesses_autopilot_paused_requires_on_check check (autopilot_paused_reason is null or autopilot_enabled);
