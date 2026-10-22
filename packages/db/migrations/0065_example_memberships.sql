-- 0065 — example memberships (docs/UX_AUDIT_AND_PLAN.md §10 Phase 3, §12 item 5; founder, 2026-10-20). A signed-in
-- founder may walk around a seeded demo business before starting their own: "Explore an example" on New business
-- gives them a viewer membership of the example business, which this column tells apart from the staff an owner
-- invited and from the founder's own seat. `source` says how the row came to be: 'invite' (team.humans.invite, the
-- seeds' owners, every row that existed before this migration), 'founder' (the owner seat Commit writes), 'example'
-- (business.example.open). An example membership is always a viewer (the check), so the role's walls apply unchanged:
-- the viewer reads, and every write policy and `writeProcedure` already refuse viewers. RLS is not changed here; the
-- repos leave example rows out of the staff list and the seat count, and `founder.businesses.list` marks them so Your
-- businesses lists them under their own heading. Leaving is a plain delete of the caller's own row (memberships_delete
-- already lets anyone leave), and opening again writes a fresh row: nothing an example viewer does is kept.
alter table memberships add column source text not null default 'invite' check (source in ('invite','founder','example'));
--> statement-breakpoint
alter table memberships add constraint memberships_example_is_viewer check (source <> 'example' or role = 'viewer');
--> statement-breakpoint
create index memberships_example_idx on memberships (business_id) where source = 'example';
