-- 0132 — the lifecycle emails (WP-04 T11, T12, T16). Two kinds join Foundmill's own email to its users:
-- `getting_started` (help in a project's first week, and the email about a kept card to a person with no project yet)
-- and `checkin` (after 14, 30 and 60 days away, and the held win-back letters). Both are the person's own switches in
-- `account_preferences.notifications.email`, on until turned off; no column changes there.
--
-- The card email belongs to no project, so its record has no business: `business_id` becomes nullable, and only a
-- card's `getting_started` row (its key starts `getting_started:card_`) may leave it empty. The person's own read keeps its rule (their own rows, in a project they are
-- a member of) and adds their own rows with no project. Nobody else reads a row with no business: the policy still
-- needs `user_id = auth.uid()`, and the column grants are unchanged.
alter table founder_notifications drop constraint founder_notifications_kind_check;
--> statement-breakpoint
alter table founder_notifications add constraint founder_notifications_kind_check check (kind in ('decision_waiting','win','milestone','run_finished','credits','daily_brief','weekly_review','invitation_accepted','founder_notice','getting_started','checkin'));
--> statement-breakpoint
alter table founder_notifications alter column business_id drop not null;
--> statement-breakpoint
alter table founder_notifications add constraint founder_notifications_business_or_card check (business_id is not null or (kind = 'getting_started' and dedupe_key like 'getting_started:card_%'));
--> statement-breakpoint
drop policy founder_notifications_own_select on founder_notifications;
--> statement-breakpoint
create policy founder_notifications_own_select on founder_notifications for select using (user_id = auth.uid() and (business_id is null or is_member(business_id)));
--> statement-breakpoint
-- The sweep's read of a person's lifecycle emails, newest first.
create index founder_notifications_user_kind_idx on founder_notifications (user_id, kind, created_at);
