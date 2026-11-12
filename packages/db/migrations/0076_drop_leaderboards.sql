-- 0076 — leaderboards leave the product (founder, 2026-11-11). They ranked businesses by a verified metric (0012) and
-- nothing ever computed them: the only rows were the sample business's, written by the demo seed. The routes, the
-- widget, the Home tile and the api procedures are removed in the same change; this drops what was stored.
-- Entries first (they reference the boards). Dropping a table takes its indexes, grants and updated_at trigger with
-- it; the policies are dropped by name so the removal reads in full here.
drop policy if exists leaderboard_entries_select on leaderboard_entries;
--> statement-breakpoint
drop table if exists leaderboard_entries;
--> statement-breakpoint
drop policy if exists leaderboards_select on leaderboards;
--> statement-breakpoint
drop table if exists leaderboards;
--> statement-breakpoint
-- The views people saved on the two leaderboard tables (0041) have no table to apply to anymore.
delete from saved_table_views where table_key in ('live.leaderboards', 'live.leaderboard');
