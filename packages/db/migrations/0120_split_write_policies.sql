-- 0120 — split each `<table>_write for all` policy into one policy per write command (Supabase advisor lint 0006,
-- multiple_permissive_policies; docs/holistic-plan/WP-11 T6). A `for all` policy also answers select, so every read
-- on these 58 tables evaluated two expressions. The rule each role has is unchanged: `_insert` takes the old
-- `with check`, `_update` the old `using` and `with check`, `_delete` the old `using`, with the same roles. Writers keep
-- their reads because in every pair the writers are among the readers (has_role implies is_member; the 0095 tables pair
-- has_role and is_member_not_collaborator with a select of is_member_not_collaborator; skill_definitions and
-- suppression_list pair `business_id is not null and has_role` with `business_id is null or is_member`; the idea tables
-- pair owner-or-writer with owner-or-member). Only policies named `<table>_write` are split: posts_moderate,
-- community_members_moderate and the single `*_own` policies stay. The two guards make the migration fail, not guess.
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
    if not exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename and x.cmd = 'SELECT') then
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
-- The helpers, so a table made later is born split. Signatures unchanged; the search_path of 0117 in their own text.
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
    'create policy %I on %I for select using (owner_user_id = (select auth.uid()) or (business_id is not null and is_member(business_id)))',
    tbl || '_select', tbl);
  execute format(
    'create policy %I on %I for insert with check ((business_id is null and owner_user_id = (select auth.uid())) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_insert', tbl);
  execute format(
    'create policy %I on %I for update using (owner_user_id = (select auth.uid()) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))'
    || ' with check ((business_id is null and owner_user_id = (select auth.uid())) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_update', tbl);
  execute format(
    'create policy %I on %I for delete using (owner_user_id = (select auth.uid()) or (business_id is not null and has_role(business_id, array[''owner'',''admin'',''member''])))',
    tbl || '_delete', tbl);
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end;
$$;
