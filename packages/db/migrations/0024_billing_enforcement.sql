-- 0024 — billing enforcement (audit 2026-10-12, issues 16, 18, 19, 21).
--
-- 1. Credits are US dollars. Platform costs are metered in the model price list's currency (USD) and credits are
--    charged with them, but both tables defaulted to EUR: live session rows, sandbox minutes and training summaries were
--    stored as "EUR" while holding US cents, and balances were granted in whatever currency a top-up named, then debited
--    1:1 with US cents. Every platform-cost row (tokens, sandbox, training) is relabeled USD (its amount was always US
--    cents; the demo seeds' rows are synthetic); tool rows keep their vendor's currency. Existing balances were only ever
--    granted by the mock top-up or the demo seed (no payment path has granted credits), so they are relabeled USD at
--    face value. From here a balance can only hold USD.
update usage_ledger set currency = 'USD', updated_at = now() where currency <> 'USD' and kind in ('tokens','sandbox','training');
--> statement-breakpoint
alter table usage_ledger alter column currency set default 'USD';
--> statement-breakpoint
update credit_balances set currency = 'USD', updated_at = now() where currency <> 'USD';
--> statement-breakpoint
alter table credit_balances alter column currency set default 'USD';
--> statement-breakpoint
alter table credit_balances add constraint credit_balances_currency_usd check (currency = 'USD');
--> statement-breakpoint
-- The other places a model cost is kept had the same EUR default for US cents: an agent session's cost (Live sessions,
-- an agent's Logs and History), a training run's cost and the daily agent metrics rolled up from sessions. Their amounts
-- were always US cents (a plan's training action and the demo seeds only named another currency), so they are relabeled
-- USD.
update agent_sessions set currency = 'USD', updated_at = now() where currency <> 'USD';
--> statement-breakpoint
alter table agent_sessions alter column currency set default 'USD';
--> statement-breakpoint
update training_runs set currency = 'USD', updated_at = now() where currency <> 'USD';
--> statement-breakpoint
alter table training_runs alter column currency set default 'USD';
--> statement-breakpoint
update agent_metrics set currency = 'USD', updated_at = now() where currency <> 'USD';
--> statement-breakpoint
alter table agent_metrics alter column currency set default 'USD';
--> statement-breakpoint
-- 2. The Commit screen's "Spend cap per action", kept on the business (it was only written to the audit log) and
--    editable in Settings › Mode. Minor units of the business currency; null means no business cap. The gateway lowers
--    every agent's approval threshold to it, so above it every spend asks first, whatever the mode.
alter table businesses add column spend_cap_minor bigint check (spend_cap_minor is null or spend_cap_minor >= 0);
