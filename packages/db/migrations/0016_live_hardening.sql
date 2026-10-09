-- 0016 — LIVE hardening (security review of the LIVE pages): record who blocked a connection, and make the connection
-- policies follow from it. Only the blocker may change or delete a blocked row, `accepted` never lands on a blocked row,
-- and nobody can start a request to or from someone who is blocked. (The api runs on the service connection, so
-- repos.social enforces the same rules; these policies are what the Supabase client roles are held to.)
alter table connections add column blocked_by uuid references auth.users(id) on delete cascade;
--> statement-breakpoint
-- Rows blocked before this column existed: the recipient is the one who could block (respond), so record them.
update connections set blocked_by = to_user where status = 'blocked';
--> statement-breakpoint
alter table connections add constraint connections_blocked_by_check
  check ((status = 'blocked') = (blocked_by is not null) and (blocked_by is null or blocked_by in (from_user, to_user)));
--> statement-breakpoint
create index connections_blocked_by_idx on connections (blocked_by);
--> statement-breakpoint
-- True when either of the two has blocked the other. security definer so the check can read both directions whatever the
-- caller's own policies show; it returns a boolean only.
create function connection_is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from connections c
     where c.status = 'blocked'
       and ((c.from_user = a and c.to_user = b) or (c.from_user = b and c.to_user = a))
  );
$$;
--> statement-breakpoint
grant execute on function connection_is_blocked(uuid, uuid) to authenticated, service_role;
--> statement-breakpoint
drop policy connections_insert on connections;
--> statement-breakpoint
create policy connections_insert on connections for insert
  with check (from_user = auth.uid() and status = 'requested' and blocked_by is null and not connection_is_blocked(from_user, to_user));
--> statement-breakpoint
drop policy connections_update on connections;
--> statement-breakpoint
-- A blocked row can only be touched by whoever blocked it; a row is blocked by the person writing it, or not blocked;
-- only the recipient can accept.
create policy connections_update on connections for update
  using ((from_user = auth.uid() or to_user = auth.uid()) and (status <> 'blocked' or blocked_by = auth.uid()))
  with check (
    (from_user = auth.uid() or to_user = auth.uid())
    and ((status = 'blocked' and blocked_by = auth.uid()) or (status <> 'blocked' and blocked_by is null))
    and (status <> 'accepted' or to_user = auth.uid())
  );
--> statement-breakpoint
drop policy connections_delete on connections;
--> statement-breakpoint
create policy connections_delete on connections for delete
  using ((from_user = auth.uid() or to_user = auth.uid()) and (status <> 'blocked' or blocked_by = auth.uid()));
