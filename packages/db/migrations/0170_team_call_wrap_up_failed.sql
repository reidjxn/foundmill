-- 0170 — a team call always ends (founder, Nov 23, 2026: four calls stayed "In progress" for good). A wrap-up that fails
-- twice no longer puts the call back to `live`: the call is over and shows "Ended, couldn't write up" with Try again,
-- every turn kept. `wrap_up_failed` may be claimed again (`repos.teamCalls.claimWrapUp`), like `live`.
-- The index serves the api's sweep, which ends a call that is live with no turn for 15 minutes (`repos.teamCalls.idle`).
alter table team_calls drop constraint team_calls_status_known;
--> statement-breakpoint
alter table team_calls add constraint team_calls_status_known check (status in ('live','wrapping_up','wrap_up_failed','ended'));
--> statement-breakpoint
create index team_calls_open_idx on team_calls (updated_at) where status in ('live','wrapping_up');
--> statement-breakpoint
-- Who is on a call's page right now (founder, Nov 23, 2026: "that should also end the call, if all humans have left the
-- page"). The room sends a heartbeat (`teamCall.here`) every 20 seconds; leaving ends the call only when nobody else has
-- been seen within `TEAM_CALL_LIMITS.presenceMs`, and the sweep ends a call whose last person left without a word.
-- Service only (RLS on, no policy, no client grant): the api writes it after the person's own RLS read of the call.
create table team_call_presence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  call_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_call_presence_person_key unique (call_id, user_id),
  constraint team_call_presence_call_fkey foreign key (call_id, business_id) references team_calls (id, business_id) on delete cascade
);
--> statement-breakpoint
create index team_call_presence_business_id_idx on team_call_presence (business_id);
--> statement-breakpoint
create index team_call_presence_call_business_idx on team_call_presence (call_id, business_id);
--> statement-breakpoint
create index team_call_presence_user_id_idx on team_call_presence (user_id);
--> statement-breakpoint
select fm_track_updated_at('team_call_presence');
--> statement-breakpoint
alter table team_call_presence enable row level security;
--> statement-breakpoint
revoke all on team_call_presence from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on team_call_presence to service_role;
