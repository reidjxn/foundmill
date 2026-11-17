-- 0123 — the GLM model key (WP-13; founder, Nov 16, 2026): every call for an account not on a paid plan runs on
-- GLM-5.3 Flash, so agents, their versions, their sessions and the usage ledger may name `glm`
-- (`MODEL_KEYS`, packages/shared). The four checks were written inline in 0004 and 0009 and carry Postgres's default
-- names. RLS unchanged.
alter table agents drop constraint agents_model_key_check;
--> statement-breakpoint
alter table agents add constraint agents_model_key_check check (model_key in ('opus','sonnet','haiku','glm'));
--> statement-breakpoint
alter table agent_versions drop constraint agent_versions_model_key_check;
--> statement-breakpoint
alter table agent_versions add constraint agent_versions_model_key_check check (model_key in ('opus','sonnet','haiku','glm'));
--> statement-breakpoint
alter table agent_sessions drop constraint agent_sessions_model_key_check;
--> statement-breakpoint
alter table agent_sessions add constraint agent_sessions_model_key_check check (model_key in ('opus','sonnet','haiku','glm'));
--> statement-breakpoint
alter table usage_ledger drop constraint usage_ledger_model_key_check;
--> statement-breakpoint
alter table usage_ledger add constraint usage_ledger_model_key_check check (model_key is null or model_key in ('opus','sonnet','haiku','glm'));
