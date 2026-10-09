-- 0016 — LIVE hardening (security review of the LIVE pages).
-- Connections: record who blocked, make a block belong to its blocker, keep a connection between the two people it was
-- made for, allow one row per pair, and hide a block from the person who was blocked.
-- The other LIVE tables (threads, messages, communities, members, posts): writes belong to the api, which runs on the
-- service connection and applies the rules a policy cannot (connections and blocks gate messages, a business may only be
-- spoken for by a writer of its `live` section, a moderator's decisions stand). The Supabase client roles keep read access
-- only, so none of those rules can be walked around with a direct write.
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
-- One row per pair of people, whichever of them asked: the unique key on (from_user, to_user) lets A→B and B→A coexist.
-- Where both exist already keep one: a block first, then an accepted connection, then the newest request.
delete from connections c using (
  select id, row_number() over (
           partition by least(from_user, to_user), greatest(from_user, to_user)
           order by case status when 'blocked' then 0 when 'accepted' then 1 else 2 end, created_at desc, id
         ) as rn
    from connections
) d where c.id = d.id and d.rn > 1;
--> statement-breakpoint
create unique index connections_pair_key on connections (least(from_user, to_user), greatest(from_user, to_user));
--> statement-breakpoint
-- True when either of the two has blocked the other. security definer so it can read both directions whatever the
-- caller's own policies show, so it answers only for a party to the pair (a third party learns nothing, and anon may not
-- call it at all); the service role, and a connection that carries no user at all, are answered. Boolean only.
create function connection_is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select (auth.role() = 'service_role' or auth.uid() is null or auth.uid() in (a, b))
     and exists (
       select 1 from public.connections c
        where c.status = 'blocked'
          and ((c.from_user = a and c.to_user = b) or (c.from_user = b and c.to_user = a))
     );
$$;
--> statement-breakpoint
revoke execute on function connection_is_blocked(uuid, uuid) from public, anon;
--> statement-breakpoint
grant execute on function connection_is_blocked(uuid, uuid) to authenticated, service_role;
--> statement-breakpoint
-- A connection stays between the two people it was made for, and a block is lifted by deleting the row (never by
-- turning it into something else). Applies to every role.
create function connections_guard_update() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.from_user is distinct from old.from_user or new.to_user is distinct from old.to_user then
    raise exception 'a connection cannot change who it is between' using errcode = '42501';
  end if;
  if old.status = 'blocked' and new.status <> 'blocked' then
    raise exception 'a block is lifted by deleting the connection' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger connections_guard_update before update on connections
  for each row execute function connections_guard_update();
--> statement-breakpoint
-- The client roles may only answer a request (status, responded_at) or record a block (blocked_by): never move a row
-- between people or rewrite what it says.
revoke update on connections from authenticated;
--> statement-breakpoint
grant update (status, responded_at, blocked_by) on connections to authenticated;
--> statement-breakpoint
-- A block is never announced: the person who was blocked does not see the row.
drop policy connections_select on connections;
--> statement-breakpoint
create policy connections_select on connections for select
  using ((from_user = auth.uid() or to_user = auth.uid()) and (status <> 'blocked' or blocked_by = auth.uid()));
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
--> statement-breakpoint
-- Threads, messages, communities, members and posts: read-only for the client roles. (Participants are an array on
-- message_threads, not a table of their own.) The 0012 write policies stay in place but no longer have a grant to act on.
revoke insert, update, delete on message_threads from authenticated, anon;
--> statement-breakpoint
revoke insert, update, delete on messages from authenticated, anon;
--> statement-breakpoint
revoke insert, update, delete on communities from authenticated, anon;
--> statement-breakpoint
revoke insert, update, delete on community_members from authenticated, anon;
--> statement-breakpoint
revoke insert, update, delete on posts from authenticated, anon;
