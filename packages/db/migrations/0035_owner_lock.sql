-- 0035 — the last owner survives concurrent changes (security review S9). 0026's keep-owner trigger counted the
-- remaining owners without a lock: two owners demoting (or removing) each other at the same moment each still saw the
-- other as an owner under READ COMMITTED, both committed, and the business was left with none.
-- The trigger now takes a per-business transaction lock before it counts. The second transaction waits until the first
-- commits or rolls back, and its count (a new statement, so a fresh snapshot under READ COMMITTED) then sees the
-- first one's change. `membershipsRepo.setRole` and `remove` take the same lock before their own readable check, so the
-- repo's answer and the trigger's agree. Serializable transactions were already safe (SSI aborts one of the two).
-- 0026 itself is unchanged (it may already be applied); this replaces only the trigger's function.
create or replace function fm_memberships_keep_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' then
    perform pg_advisory_xact_lock(hashtext('memberships_owner'), hashtext(old.business_id::text));
    if exists (select 1 from businesses b where b.id = old.business_id)
      and exists (select 1 from auth.users u where u.id = old.user_id)
      and not exists (select 1 from memberships m where m.business_id = old.business_id and m.role = 'owner') then
      raise exception 'A business must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
comment on function fm_memberships_keep_owner() is 'Keeps at least one owner per business; serialized per business by pg_advisory_xact_lock(hashtext(''memberships_owner''), hashtext(business_id::text)) (0035).';
