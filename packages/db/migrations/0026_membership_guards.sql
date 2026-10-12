-- 0026 — membership guards (audit DB-02 / SECX-4 / ARB-03: an invited admin could demote the owner or mint owners).
-- 0001 let any owner or admin insert, update or delete any membership row, and nothing kept a business from losing its
-- last owner. From here, for the app roles:
--   * only an owner inserts, changes or removes an owner row, or grants the role 'owner' (admins manage everyone else);
--   * nobody changes their own row (role or section permissions): someone else with the right does it;
--   * a business always keeps at least one owner. That one is a trigger, so the service connection is held to it too;
--     it stands aside only when the business itself or the owner's account is being deleted.
-- apps/api checks the same rules first and answers with a readable error; these are the backstop.
drop policy memberships_insert on memberships;
--> statement-breakpoint
create policy memberships_insert on memberships for insert with check (
  has_role(business_id, array['owner'])
  or (has_role(business_id, array['admin']) and role <> 'owner')
  or (user_id = auth.uid() and role = 'owner' and not business_has_members(business_id))
);
--> statement-breakpoint
drop policy memberships_update on memberships;
--> statement-breakpoint
-- USING checks the row as it was (an admin cannot touch an owner's row), WITH CHECK the row as it becomes (an admin
-- cannot make anyone an owner); both refuse the caller's own row.
create policy memberships_update on memberships for update
  using (user_id <> auth.uid() and (has_role(business_id, array['owner']) or (has_role(business_id, array['admin']) and role <> 'owner')))
  with check (user_id <> auth.uid() and (has_role(business_id, array['owner']) or (has_role(business_id, array['admin']) and role <> 'owner')));
--> statement-breakpoint
drop policy memberships_delete on memberships;
--> statement-breakpoint
-- Anyone may leave; owners remove anyone else, admins anyone but an owner.
create policy memberships_delete on memberships for delete using (
  user_id = auth.uid()
  or has_role(business_id, array['owner'])
  or (has_role(business_id, array['admin']) and role <> 'owner')
);
--> statement-breakpoint
-- After the statement's rows are written (so a statement touching several owners is judged on its end state).
-- Security definer: the caller may no longer see the business's rows once they have left it. Two owners stepping each
-- other down at the same moment would each still see the other as owner, so the check takes a per-business lock
-- first: the second waits for the first to commit, then sees its result (each query here reads the latest commit).
create function fm_memberships_keep_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role <> 'owner' then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('fm_memberships_keep_owner'), hashtext(old.business_id::text));
  if exists (select 1 from businesses b where b.id = old.business_id)
    and exists (select 1 from auth.users u where u.id = old.user_id)
    and not exists (select 1 from memberships m where m.business_id = old.business_id and m.role = 'owner') then
    raise exception 'A business must keep at least one owner' using errcode = '23514';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create trigger memberships_keep_owner after update of role or delete on memberships
  for each row execute function fm_memberships_keep_owner();
