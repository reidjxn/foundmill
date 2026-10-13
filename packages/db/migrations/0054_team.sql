-- 0054 — Team: responsibilities route approvals, and custom skills are reviewed before they count.
-- (1) Every approval records the decision type it is and who handles it (BUILD §11.9 Responsibilities, AC-11.9.2):
-- the handler comes from the department's `approvers` matrix when the approval is opened; null handler = the founder
-- (owners and admins). A named staff member resolves their own approvals (owners and admins can still step in); a named
-- agent decides them itself, never a hard gate (signing stays with a human).
alter table approvals add column decision_type text check (decision_type in ('spend_above_threshold','publish_content','merge_to_main','sign_contracts','message_customers','hire_agents','change_models'));
--> statement-breakpoint
alter table approvals add column handler_kind text check (handler_kind in ('user','agent'));
--> statement-breakpoint
alter table approvals add column handler_id uuid;
--> statement-breakpoint
alter table approvals add constraint approvals_handler_pair check ((handler_kind is null) = (handler_id is null));
--> statement-breakpoint
create index approvals_handler_idx on approvals (business_id, handler_kind, handler_id) where resolved_at is null;
--> statement-breakpoint
-- An approval a named agent decided records that agent (`by_kind` 'agent', `by_id` its id).
alter table approvals drop constraint approvals_by_kind_check;
--> statement-breakpoint
alter table approvals add constraint approvals_by_kind_check check (by_kind in ('user','chief_of_staff','system','agent'));
--> statement-breakpoint
-- (2) A custom skill's tests are drafted by Opus and reviewed by the founder before they count (BUILD §11.10): null =
-- drafted, awaiting review; the training runner scores only reviewed tests. Every existing test counts as reviewed.
alter table skill_tests add column reviewed_at timestamptz;
--> statement-breakpoint
update skill_tests set reviewed_at = created_at where reviewed_at is null;
