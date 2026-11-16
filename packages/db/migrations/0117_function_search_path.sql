-- 0117 — every function in public pins its search_path (Supabase advisor lint 0011, function_search_path_mutable;
-- docs/holistic-plan/WP-11 T4). None of the thirteen is security definer, so this closes a lint, not a hole: a function
-- whose path follows the caller's could resolve a table or operator from a schema the caller put first. `public` stays
-- on the path because the helpers name tables unqualified and pg_trgm and vector live there.
-- A later `create or replace function` resets this: every redefinition carries the same `set search_path` in its own
-- text, and rls/advisors.test.ts fails on a miss.
-- Each loop skips a signature that does not exist: the migration-point tests (migration-00NN.test.ts) apply every
-- migration but one, so a function may be missing there. On a real database all thirteen exist.
-- The tenancy helpers (0001, 0002).
do $$
declare f text;
begin
  foreach f in array array[
    'fm_set_updated_at()',
    'fm_track_updated_at(text)',
    'fm_tenant_table(text, text[], text)',
    'fm_idea_table(text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = pg_catalog, public, pg_temp', f);
    end if;
  end loop;
end $$;
--> statement-breakpoint
-- The triggers and checks.
do $$
declare f text;
begin
  foreach f in array array[
    'entities_search_update()',
    'audit_log_chain()',
    'audit_log_immutable()',
    'fm_agents_clear_paused_reason()',
    'fm_business_currency(text)',
    'fm_page_content_ok(jsonb)',
    'fm_person_tags_ok(text[])',
    'admission_existing_before()',
    'fm_page_quiz_ok(jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = pg_catalog, public, pg_temp', f);
    end if;
  end loop;
end $$;
