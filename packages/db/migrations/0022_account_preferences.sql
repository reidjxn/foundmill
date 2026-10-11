-- 0022 — account preferences (founder, 2026-10-11: "a preferences option for every signed-in user to choose date
-- formats"). One row per signed-in account, not per business: the choice applies in every business they open. The row
-- sits beside founder_profiles rather than on it, because a missing profile is the onboarding gate (AC-11.1.1) and a
-- preference must never create one; a person with no row reads the defaults (US dates, 12-hour times). Each person
-- reads and writes only their own row (`user_id = auth.uid()`); there is no delete grant (the account's own deletion
-- cascades).
create table account_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  date_format text not null default 'us' check (date_format in ('us','day_first','iso')),
  time_format text not null default '12h' check (time_format in ('12h','24h')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
alter table account_preferences enable row level security;
--> statement-breakpoint
create policy account_preferences_own on account_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
--> statement-breakpoint
revoke all on account_preferences from anon;
--> statement-breakpoint
grant select, insert, update on account_preferences to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('account_preferences');
