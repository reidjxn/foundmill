-- 0115 — reports of a person, a profile or a message, and the platform's review queue (docs/NETWORK.md F21, §3.2
-- layer 7; WP-12 T4). The people layer is open (LIVE_MODE=1 since Nov 15, 2026), so anyone who meets a stranger can
-- report them, and an operator reviews every report within REPORT_RESPONSE_TARGET_HOURS (@foundmill/shared/reports).
--
-- Person-level, not business-scoped: a report is about two people and is no fact of any project. It follows 0088
-- (`attributions`): RLS on, no policy, every client role revoked, service role only. The api files a report for the
-- signed-in person (`report.create`) and shows the queue to the accounts in `OPERATOR_USER_IDS` (`operator.reports.*`);
-- the person reported never learns who reported them, and the reporter never reads the row back.
--
-- What is kept: who reported, what kind of thing, the person it is about (every kind names one, so a queue can show a
-- pattern), the message when it is one, the reason, an optional note in the reporter's words (untrusted content: shown
-- to an operator as plain text, never sent to a model), and how an operator resolved it. A deleted account takes the
-- reports it filed with it; a report about an account that is later deleted keeps its row with the person set null.
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  -- `REPORT_TARGET_KINDS` in @foundmill/shared/reports (a test compares the two lists).
  target_kind text not null
    constraint reports_target_kind_value check (target_kind in ('person', 'profile', 'message')),
  target_user_id uuid references auth.users(id) on delete set null,
  target_message_id uuid references messages(id) on delete set null,
  -- `REPORT_REASONS`.
  reason text not null
    constraint reports_reason_value check (reason in ('spam', 'harassment', 'scam', 'asks_for_money', 'impersonation', 'personal_data', 'underage', 'other')),
  note text
    constraint reports_note_length check (note is null or char_length(note) <= 1000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  -- `REPORT_RESOLUTIONS`; set exactly when the report is resolved.
  resolution text
    constraint reports_resolution_value check (resolution is null or resolution in ('no_action', 'warned', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_resolution_with_time check ((resolved_at is null) = (resolution is null)),
  constraint reports_message_for_message_only check ((target_kind = 'message') = (target_message_id is not null) or target_message_id is null),
  constraint reports_not_self check (target_user_id is null or target_user_id <> reporter_user_id)
);
--> statement-breakpoint
-- One open report per reporter and target: a second press while the first waits files nothing new.
create unique index reports_open_once_key on reports (reporter_user_id, target_kind, coalesce(target_message_id, target_user_id)) where resolved_at is null;
--> statement-breakpoint
-- The queue: open reports, oldest first.
create index reports_open_idx on reports (created_at) where resolved_at is null;
--> statement-breakpoint
create index reports_target_user_id_idx on reports (target_user_id);
--> statement-breakpoint
create index reports_target_message_id_idx on reports (target_message_id);
--> statement-breakpoint
create index reports_resolved_by_idx on reports (resolved_by);
--> statement-breakpoint
alter table reports enable row level security;
--> statement-breakpoint
revoke all on reports from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on reports to service_role;
--> statement-breakpoint
select fm_track_updated_at('reports');
