-- 0059 — A monthly model budget per business (audit #15, BUILD §10.4: "Monthly model budget per business; wage cap per
-- agent"). The platform key already stops at the month's credits (SEC2) and each agent at its wage cap, but a business on
-- its own Anthropic key spent without any Foundmill limit. `model_budget_minor` is the founder's limit on what the team's
-- metered work may cost in a calendar month, in US cents like every wage and credit (the usage ledger's currency), whoever
-- pays the model: credits or the business's own key. Null: no budget. Dispatch refuses new sessions once the month's
-- metered cost reaches it, and a running session is handed only what is left (the SDK's `maxBudgetUsd`). It is a column of
-- `businesses`, so the existing policies apply: members read it, only owners and admins change it.
alter table businesses add column model_budget_minor bigint;
--> statement-breakpoint
alter table businesses add constraint businesses_model_budget_check check (model_budget_minor is null or model_budget_minor >= 0);
