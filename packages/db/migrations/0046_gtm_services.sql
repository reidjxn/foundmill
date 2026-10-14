-- 0046 — Distribution truth (audit 2026-10-12, W11 #158 #162).
-- channels.scored_at: when the Distribution Strategist last scored the channel (fit, potential, why); null until it has.
-- Commit seeds all 15 channels unscored, so the screens say "Not scored" and offer the recommendation instead of showing
-- the column defaults (fit 1, potential 0) as scores. Rows `distribution.recommend` wrote before carry a why (it is
-- never empty there); they count as scored from their last update.
alter table channels add column scored_at timestamptz;
--> statement-breakpoint
update channels set scored_at = updated_at where why_md <> '';
--> statement-breakpoint
-- channel_metrics.source: 'measured' (reported by a connector or the conversion API) or 'estimate' (the mock channel
-- engine's simulated week, in staging and local runs). The screens label 'estimate' numbers Estimate.
alter table channel_metrics add column source text not null default 'measured' check (source in ('measured', 'estimate'));
--> statement-breakpoint
-- Only the mock engine's measure step wrote rows for engine campaigns (config.weekIndex). The ones it wrote for a
-- campaign that never went live (an approval that was rejected or expired) describe nothing that happened: drop them.
delete from channel_metrics m using campaigns c where c.id = m.campaign_id and c.config ? 'weekIndex' and c.starts_at is null;
--> statement-breakpoint
update channel_metrics m set source = 'estimate' from campaigns c where c.id = m.campaign_id and c.config ? 'weekIndex';
