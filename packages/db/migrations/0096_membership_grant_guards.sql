-- 0096 — what a membership's section permissions may name, and a lock on one's own membership (review of the grant rule,
-- PR #113's follow-ups, 2026-11-13). It follows 0095.
--
--   * `memberships.section_permissions` names only the sections the walls know (@foundmill/shared `SECTIONS`), each with
--     "read", "write" or "none". Until now any key was stored (apps/api's input was a record of any string), and a key
--     for a section added later would have taken effect that day without anyone having given it. @foundmill/db's
--     `SectionPermissions` refuses an unknown key with a validation error; this CHECK is the same rule in the database.
--     The list below is a copy of `SECTIONS`: migration-0096.test.ts fails when the two differ.
--     Rows stored before 0096 with an unknown key keep their known keys and lose the others: an unknown key opens
--     nothing today (the walls read `SECTIONS` only), so dropping it changes no one's access. A row with a level other
--     than read, write or none stops the migration instead: dropping such a level would change what the row opens.
--   * `lock_my_membership(bid)`: holds the caller's own membership row of the business `for share` until the transaction
--     ends, and says whether there was one. Under RLS a `select … for share` must also pass the update policy, which
--     never lets anyone change their own row (0026, 0092), so the caller cannot lock it themselves. `team.humans.role`
--     locks the editor's own row this way before it re-reads it and judges the change against it, so an owner who lowers
--     that editor at the same moment is either seen or waits. Security definer, about the caller only (`auth.uid()`);
--     executable by authenticated and the service, never anon.

do $$
declare
  bad bigint;
begin
  select count(*) into bad
    from memberships
   where jsonb_typeof(section_permissions) <> 'object'
      or jsonb_path_exists(section_permissions, '$.* ? (@.type() != "string" || (@ != "read" && @ != "write" && @ != "none"))');
  if bad > 0 then
    raise exception '0096: % memberships hold section permissions that are not an object of read, write or none; correct them first', bad;
  end if;
end;
$$;
--> statement-breakpoint
update memberships m
   set section_permissions = (
     select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
       from jsonb_each(m.section_permissions) e
      where e.key = any(array['product','development','distribution','finance','team','legal','inbox','crm','settings','billing','live']::text[])
   )
 where (m.section_permissions - array['product','development','distribution','finance','team','legal','inbox','crm','settings','billing','live']::text[]) <> '{}'::jsonb;
--> statement-breakpoint
alter table memberships add constraint memberships_section_permissions_known check (
  case
    when jsonb_typeof(section_permissions) = 'object' then
      (section_permissions - array['product','development','distribution','finance','team','legal','inbox','crm','settings','billing','live']::text[]) = '{}'::jsonb
      and not jsonb_path_exists(section_permissions, '$.* ? (@.type() != "string" || (@ != "read" && @ != "write" && @ != "none"))')
    else false
  end
);
--> statement-breakpoint
create function lock_my_membership(bid uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from memberships m where m.business_id = bid and m.user_id = auth.uid() for share;
  return found;
end;
$$;
--> statement-breakpoint
comment on function lock_my_membership(uuid) is 'Holds the caller''s own membership row of the business for share until the transaction ends; true when there is one (0096). Under RLS the caller cannot lock their own row: the update policy excludes it.';
--> statement-breakpoint
revoke execute on function lock_my_membership(uuid) from public, anon;
--> statement-breakpoint
grant execute on function lock_my_membership(uuid) to authenticated, service_role;
