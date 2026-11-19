-- 0165 — the scoped per-agent check (WP-06 T10). A training run is a 'training' run of a draft (as before), a
-- 'model_retest' of a model change, or a 'skill_check' of one skill on the live version (two arms, with and without the
-- skill; no draft). `skill_keys` limits a run to those rated skills; `measured_skill_key` is the skill a skill_check
-- puts in and takes out. RLS unchanged: training_runs keeps its business policy.
alter table training_runs add column kind text not null default 'training' check (kind in ('training','model_retest','skill_check'));
--> statement-breakpoint
alter table training_runs add column skill_keys text[];
--> statement-breakpoint
alter table training_runs add column measured_skill_key text;
