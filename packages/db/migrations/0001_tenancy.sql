-- 0001 — extensions, roles contract, tenancy helpers, RLS helper functions.
-- Runs on Supabase (Postgres 17) and on PGlite. The `auth` schema and the roles
-- anon / authenticated / service_role are provided by Supabase; the PGlite test
-- harness creates stubs for them before applying migrations.
create extension if not exists pg_trgm;
--> statement-breakpoint
create extension if not exists vector;
--> statement-breakpoint
-- memberships: the FK to businesses(id) is added in 0002 once that table exists.
create table memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer','advisor')),
  section_permissions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
--> statement-breakpoint
create index memberships_user_id_idx on memberships (user_id);
--> statement-breakpoint
create index memberships_business_id_idx on memberships (business_id);
--> statement-breakpoint
create function is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.business_id = bid and m.user_id = auth.uid());
$$;
--> statement-breakpoint
create function has_role(bid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.business_id = bid and m.user_id = auth.uid() and m.role = any(roles));
$$;
--> statement-breakpoint
-- True once a business has at least one membership row. Security definer so the
-- first-owner bootstrap policy on memberships cannot be fooled by RLS hiding rows.
create function business_has_members(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.business_id = bid);
$$;
--> statement-breakpoint
-- True when the business is a committed LIVE business (its shareable rows may enter public views).
-- plpgsql so the body is not validated against `businesses` before 0002 creates it.
create function is_public(bid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from businesses b
    where b.id = bid and b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null
  );
end;
$$;
--> statement-breakpoint
create function fm_set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint
-- Attaches the updated_at trigger when the table has an updated_at column.
create function fm_track_updated_at(tbl text) returns void language plpgsql as $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = 'updated_at'
  ) then
    execute format('create trigger %I before update on %I for each row execute function fm_set_updated_at()', tbl || '_updated_at', tbl);
  end if;
end;
$$;
--> statement-breakpoint
-- Applies the BUILD §7.1 tenancy pattern to a business-scoped table:
--   enable RLS; T_select for members; T_write (for all) for write_roles;
--   grants to authenticated + service_role; nothing for anon; updated_at trigger.
-- mode = 'standard'  → members in write_roles may insert/update/delete.
-- mode = 'read_only' → app roles may only read; rows are written by services (service_role bypasses RLS).
create function fm_tenant_table(tbl text, write_roles text[] default array['owner','admin','member'], mode text default 'standard') returns void
language plpgsql as $$
begin
  if mode not in ('standard', 'read_only') then
    raise exception 'fm_tenant_table: unknown mode %', mode;
  end if;
  execute format('alter table %I enable row level security', tbl);
  execute format('create policy %I on %I for select using (is_member(business_id))', tbl || '_select', tbl);
  if mode = 'standard' then
    execute format(
      'create policy %I on %I for all using (has_role(business_id, %L::text[])) with check (has_role(business_id, %L::text[]))',
      tbl || '_write', tbl, write_roles, write_roles
    );
  end if;
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end;
$$;
--> statement-breakpoint
grant usage on schema public to anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function is_member(uuid), has_role(uuid, text[]), business_has_members(uuid), is_public(uuid) to anon, authenticated, service_role;
--> statement-breakpoint
-- memberships policies (business FK arrives in 0002; policies only need the helpers).
alter table memberships enable row level security;
--> statement-breakpoint
create policy memberships_select on memberships for select using (is_member(business_id));
--> statement-breakpoint
-- Owners/admins manage the team. A user may also create the first owner row of a brand-new business for themselves.
create policy memberships_insert on memberships for insert with check (
  has_role(business_id, array['owner','admin'])
  or (user_id = auth.uid() and role = 'owner' and not business_has_members(business_id))
);
--> statement-breakpoint
create policy memberships_update on memberships for update
  using (has_role(business_id, array['owner','admin']))
  with check (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
create policy memberships_delete on memberships for delete using (
  has_role(business_id, array['owner','admin']) or user_id = auth.uid()
);
--> statement-breakpoint
revoke all on memberships from anon;
--> statement-breakpoint
grant select, insert, update, delete on memberships to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('memberships');
