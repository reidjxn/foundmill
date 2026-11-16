-- 0119 — an index under each foreign key that had none led by its own columns (Supabase advisor lint 0001,
-- unindexed_foreign_keys; docs/holistic-plan/WP-11 T7). Each table already had an index led by the key's first
-- column, so no query gets faster: this clears the lint so the next real finding is visible. The six new indexes will
-- show as "unused index" until the tables grow. No `concurrently`: the migrator runs in one transaction and the tables
-- are small.
create index account_outbox_event_user_idx on account_outbox (event_id, user_id);
--> statement-breakpoint
create index agent_messages_thread_business_idx on agent_messages (thread_id, business_id);
--> statement-breakpoint
create index inbox_item_reads_item_business_idx on inbox_item_reads (inbox_item_id, business_id);
--> statement-breakpoint
-- Replaces the one-column index: the new one leads with the same column.
create index showcase_consents_item_business_idx on showcase_consents (inbox_item_id, business_id);
--> statement-breakpoint
drop index showcase_consents_inbox_item_id_idx;
--> statement-breakpoint
create index team_call_actions_call_business_idx on team_call_actions (call_id, business_id);
--> statement-breakpoint
create index team_call_turns_call_business_idx on team_call_turns (call_id, business_id);
