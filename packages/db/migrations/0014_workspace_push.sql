-- A saved session's code pushed to the agent's branch on GitHub (the GitHub connector's commit_files, called through
-- the gateway by the orchestrator), or why it was not. Written by the orchestrator with the service role, like the
-- rest of the row; members read it on Development › Code.
alter table workspace_snapshots
  add column pushed_repo text,
  add column pushed_branch text,
  add column pushed_commit_sha text,
  add column pushed_url text,
  add column pushed_at timestamptz,
  add column push_error text;
--> statement-breakpoint
-- The last save of a task that reached a repository: the base the next push is diffed against.
create index workspace_snapshots_pushed_idx on workspace_snapshots (task_id, pushed_repo, created_at desc) where pushed_commit_sha is not null;
