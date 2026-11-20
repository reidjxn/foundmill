-- 0146 — the `for all` write policies, split (docs/holistic-plan/WP-11 T6, A8-04). `fm_tenant_table` and `fm_idea_table`
-- made `<t>_select` and `<t>_write for all`, so every select evaluated both (Supabase advisor lint 0006, multiple
-- permissive policies, 320 findings). Each `<t>_write` becomes `<t>_insert`, `<t>_update` and `<t>_delete` with the same
-- expressions: insert takes the old `with check` (or `using` when it had none), update takes `using` and `with check`,
-- delete takes `using`. No rule changes. Writers keep their reads because an `update ... where` or a `returning` still
-- needs the select policy, and in every pair the writers are among the readers (checked on the 58 pairs in the pull
-- request). Only policies named `<table>_write` are split; `posts_moderate`, `community_members_moderate` and the
-- single `*_own` policies stay `for all` on purpose. The two guards make the migration fail, not guess.
do $$
declare p record; r text;
begin
  for p in select tablename, policyname, qual, with_check, roles from pg_policies
            where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE' and policyname = tablename || '_write'
  loop
    if exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename
                and x.policyname in (p.tablename || '_insert', p.tablename || '_update', p.tablename || '_delete')) then
      raise exception 'split write policies: % already has a per-command policy', p.tablename;
    end if;
    if not exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename and x.cmd = 'SELECT' and x.permissive = 'PERMISSIVE' and x.roles && p.roles) then
      raise exception 'split write policies: % has no select policy; writers would lose reads', p.tablename;
    end if;
    r := array_to_string(p.roles, ', ');
    execute format('create policy %I on public.%I for insert to %s with check (%s)', p.tablename || '_insert', p.tablename, r, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', p.tablename || '_update', p.tablename, r, p.qual, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for delete to %s using (%s)', p.tablename || '_delete', p.tablename, r, p.qual);
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
--> statement-breakpoint
-- The helpers, so a table made later is born split. Each carries the pinned search_path in its own text
-- (`create or replace` resets what `alter function ... set` stored).
create or replace function fm_tenant_table(tbl text, write_roles text[] default array['owner','admin','member'], mode text default 'standard') returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if mode not in ('standard', 'read_only') then
    raise exception 'fm_tenant_table: unknown mode %', mode;
  end if;
  execute format('alter table %I enable row level security', tbl);
  execute format('create policy %I on %I for select using (is_member(business_id))', tbl || '_select', tbl);
  if mode = 'standard' then
    execute format('create policy %I on %I for insert with check (has_role(business_id, %L::text[]))', tbl || '_insert', tbl, write_roles);
    execute format('create policy %I on %I for update using (has_role(business_id, %L::text[])) with check (has_role(business_id, %L::text[]))', tbl || '_update', tbl, write_roles, write_roles);
    execute format('create policy %I on %I for delete using (has_role(business_id, %L::text[]))', tbl || '_delete', tbl, write_roles);
  end if;
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end;
$$;
--> statement-breakpoint
create or replace function fm_idea_table(tbl text) returns void language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  execute format('alter table %I enable row level security', tbl);
  execute format(
    'create policy %I on %I for select using (owner_user_id = auth.uid() or (business_id is not null and is_member(business_id)))',
    tbl || '_select', tbl);
  execute format(
    'create policy %I on %I for insert with check ((business_id is null and owner_user_id = auth.uid()) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_insert', tbl);
  execute format(
    'create policy %I on %I for update using (owner_user_id = auth.uid() or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))'
    || ' with check ((business_id is null and owner_user_id = auth.uid()) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_update', tbl);
  execute format(
    'create policy %I on %I for delete using (owner_user_id = auth.uid() or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_delete', tbl);
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end;
$$;
