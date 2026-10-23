-- 0068 — real checkouts (founder decision 2, 2026-10-23). A code session starts from the business's Code-tab repository
-- (the gateway's archive of agent/<task id>, else the default branch) and saves only what the agent changed against
-- that checkout: the snapshot's `files` are the files it added or changed, `removed_paths` the files of the checkout it
-- deleted, and `base_*` name the checkout (repository, ref and commit). A snapshot with no base is a whole workspace,
-- as before. Written by the orchestrator with the service role like the rest of the row; members read it on
-- Development › Code. Business-scoped like the row: the workspace_snapshots policies (0013) cover the new columns.
alter table workspace_snapshots
  add column base_repo text check (base_repo is null or base_repo ~ '^[A-Za-z0-9-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  add column base_ref text check (base_ref is null or length(base_ref) between 1 and 250),
  add column base_commit_sha text check (base_commit_sha is null or base_commit_sha ~ '^[0-9a-f]{7,64}$'),
  add column removed_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(removed_paths) = 'array');
--> statement-breakpoint
-- A diff names its base whole or not at all.
alter table workspace_snapshots add constraint workspace_snapshots_base_check check ((base_commit_sha is null) = (base_repo is null) and (base_commit_sha is null) = (base_ref is null));
