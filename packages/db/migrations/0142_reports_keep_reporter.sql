-- Reports outlive the reporter's account (founder, Nov 18, 2026): when a reporter closes their account, the report stays
-- for the operator with the reporter removed, instead of going with the account (0136 cascaded it). The two open-report
-- unique indexes and `reports_not_self` still hold: a null reporter is distinct in a unique index, and the self check
-- passes when either side is null.
alter table reports alter column reporter_user_id drop not null;
--> statement-breakpoint
alter table reports drop constraint reports_reporter_user_id_fkey;
--> statement-breakpoint
alter table reports add constraint reports_reporter_user_id_fkey foreign key (reporter_user_id) references auth.users(id) on delete set null;
