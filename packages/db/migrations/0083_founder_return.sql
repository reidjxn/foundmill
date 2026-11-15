-- 0083 — the return loop (retention plan, founder 2026-11-11: "start with measurement and the return loop").
--
-- founder_presence / founder_visit_days: when each person was last in each business and the days they came. The api's
-- presence ping writes them as that person; a person reads and writes only their own rows, and only while they belong
-- to the business. No delete grant: leaving the business or deleting the account cascades.
--
-- founder_notifications: every founder email the platform's sender (the gateway's `/v1/notify/email`) sent, with a dedupe
-- key so a pass that runs twice sends once. Written by the gateway with the service role; a person reads
-- only their own. A one-click answer stores the sha-256 of its token, never the token.
--
-- account_preferences gains the morning brief's hour, the time zone it is read in, opt-in browser notifications and the
-- "pause every email" stamp. The email switches themselves are the platform's one map, `notifications.email` (0075,
-- founder 2026-11-12: one sender, one preference). The row's existing policy (`user_id = auth.uid()`) covers them.
create table founder_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  last_seen_at timestamptz not null,
  session_started_at timestamptz not null,
  previous_seen_at timestamptz,
  sessions integer not null default 1 check (sessions >= 1),
  last_via text not null default 'direct' check (last_via in ('direct','email','browser_notification')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index founder_presence_user_business_key on founder_presence (user_id, business_id);
--> statement-breakpoint
create index founder_presence_business_idx on founder_presence (business_id);
--> statement-breakpoint
alter table founder_presence enable row level security;
--> statement-breakpoint
create policy founder_presence_own on founder_presence for all
  using (user_id = auth.uid() and is_member(business_id))
  with check (user_id = auth.uid() and is_member(business_id));
--> statement-breakpoint
revoke all on founder_presence from anon;
--> statement-breakpoint
grant select, insert, update on founder_presence to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_presence to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_presence');
--> statement-breakpoint
create table founder_visit_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  day date not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  pings integer not null default 1 check (pings >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index founder_visit_days_user_business_day_key on founder_visit_days (user_id, business_id, day);
--> statement-breakpoint
create index founder_visit_days_business_day_idx on founder_visit_days (business_id, day);
--> statement-breakpoint
alter table founder_visit_days enable row level security;
--> statement-breakpoint
create policy founder_visit_days_own on founder_visit_days for all
  using (user_id = auth.uid() and is_member(business_id))
  with check (user_id = auth.uid() and is_member(business_id));
--> statement-breakpoint
revoke all on founder_visit_days from anon;
--> statement-breakpoint
grant select, insert, update on founder_visit_days to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_visit_days to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_visit_days');
--> statement-breakpoint
create table founder_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('decision_waiting','win','milestone','run_finished','credits','daily_brief','weekly_review')),
  channel text not null default 'email' check (channel in ('email','browser')),
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued','sent','skipped','failed')),
  skip_reason text,
  mode text check (mode in ('mock','live')),
  subject text not null default '',
  body_text text not null default '',
  body_html text not null default '',
  inbox_item_ids uuid[] not null default '{}',
  provider_message_id text,
  action_item_id uuid,
  action_option_id text,
  action_token_hash text,
  action_expires_at timestamptz,
  action_used_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((action_token_hash is null) = (action_item_id is null and action_option_id is null and action_expires_at is null))
);
--> statement-breakpoint
create unique index founder_notifications_dedupe_key on founder_notifications (user_id, dedupe_key);
--> statement-breakpoint
create unique index founder_notifications_action_token_key on founder_notifications (action_token_hash);
--> statement-breakpoint
create index founder_notifications_user_created_idx on founder_notifications (user_id, created_at);
--> statement-breakpoint
create index founder_notifications_business_idx on founder_notifications (business_id, created_at);
--> statement-breakpoint
alter table founder_notifications enable row level security;
--> statement-breakpoint
create policy founder_notifications_own_select on founder_notifications for select using (user_id = auth.uid() and is_member(business_id));
--> statement-breakpoint
revoke all on founder_notifications from anon, authenticated;
--> statement-breakpoint
grant select (id, user_id, business_id, kind, channel, status, skip_reason, mode, subject, body_text, inbox_item_ids, action_item_id, action_option_id, action_expires_at, action_used_at, sent_at, opened_at, created_at, updated_at) on founder_notifications to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on founder_notifications to service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_notifications');
--> statement-breakpoint
alter table account_preferences
  add column brief_hour integer not null default 8 check (brief_hour between 0 and 23),
  add column time_zone text,
  add column browser_notifications boolean not null default false,
  add column emails_paused_at timestamptz;
