-- 0030 — approvals the founder can decide in the Inbox, and that a later call can use (audit FR-01 / O-02 / O-26).
-- An approval is opened for one gated tool call. It now records the task the call was for (so the task can wait for the
-- decision instead of being dispatched again, and run again once approved), the amount the call would commit, and when
-- a call ran under it: an approval granted after its session had ended is used once, by the same call of the next
-- session on the task, instead of asking the founder a second time. Rows opened before 0030 keep task_id null: they
-- have no Inbox item to answer them by, so they never hold a task back (Team › approvals still resolves them).
alter table approvals add column task_id uuid references tasks(id) on delete set null;
--> statement-breakpoint
alter table approvals add column amount_minor bigint check (amount_minor is null or amount_minor >= 0);
--> statement-breakpoint
alter table approvals add column currency char(3);
--> statement-breakpoint
alter table approvals add column used_at timestamptz;
--> statement-breakpoint
alter table approvals add column used_by_session_id uuid references agent_sessions(id) on delete set null;
--> statement-breakpoint
create index approvals_task_id_idx on approvals (task_id);
--> statement-breakpoint
create index approvals_used_by_session_id_idx on approvals (used_by_session_id);
