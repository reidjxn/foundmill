-- 0158 — auth.uid() once per statement, not once per row (Supabase advisor lint 0003, auth_rls_initplan;
-- docs/holistic-plan/WP-11 T5). Wrapping the call in a select makes Postgres plan it as one InitPlan. 45 policies on
-- 28 tables: 39 written by hand and 6 made by fm_idea_table. No rule changes: `alter policy` keeps each policy's
-- command, roles and whether it is restrictive (inbox_items_for_user stays restrictive); only when the function is
-- evaluated moves. Nothing on main contained `select auth.uid()` before this, so one textual pass is safe.
do $$
declare p record; q text; c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')
  loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    c := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
      case when q is not null then format(' using (%s)', q) else '' end,
      case when c is not null then format(' with check (%s)', c) else '' end);
  end loop;
end $$;
--> statement-breakpoint
-- The helper, so a table it makes later is born with the same form. The body of 0156 (the split policies) with each auth.uid() wrapped, and
-- the search_path of 0157 in its own text (create or replace resets what `alter function ... set` stored).
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
