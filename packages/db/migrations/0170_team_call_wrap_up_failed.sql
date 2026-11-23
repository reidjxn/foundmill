-- 0170 — a team call always ends (founder, Nov 23, 2026: four calls stayed "In progress" for good). A wrap-up that fails
-- twice no longer puts the call back to `live`: the call is over and shows "Ended, couldn't write up" with Try again,
-- every turn kept. `wrap_up_failed` may be claimed again (`repos.teamCalls.claimWrapUp`), like `live`.
-- The index serves the api's sweep, which ends a call that is live with no turn for 15 minutes (`repos.teamCalls.idle`).
alter table team_calls drop constraint team_calls_status_known;
--> statement-breakpoint
alter table team_calls add constraint team_calls_status_known check (status in ('live','wrapping_up','wrap_up_failed','ended'));
--> statement-breakpoint
create index team_calls_open_idx on team_calls (updated_at) where status in ('live','wrapping_up');
