-- 0095 — a collaborator reads and writes nothing of the Money and Legal tables members write (the coordinating session's
-- line, 2026-11-13). It follows 0094, which closed a collaborator's reads of the admin-written and Money tables and left
-- these seven open.
--
-- `transactions`, `ledger_snapshots`, `forecasts` (Money) and `filings`, `contracts`, `compliance_events`,
-- `regulatory_gates` (Legal) were made by `fm_tenant_table` with the default writers (0009, 0010): `T_select` over
-- `is_member` and `T_write`, FOR ALL, over `has_role(business_id, array['owner','admin','member'])`. Since 0092 a
-- collaborator holds 'member' in every `has_role` check, so a collaborator's own RLS connection read and wrote all seven,
-- and a FOR ALL policy also answers SELECT: closing `T_select` alone would have left the rows readable through `T_write`.
-- From 0095 both policies leave a collaborator out, whether their access is running or has ended:
--   * `T_select`: `is_member_not_collaborator(business_id)` (0094). Owners, cofounders, admins, members, viewers,
--     advisors and example viewers read as before;
--   * `T_write`: the same writers as before (`has_role(…, owner/admin/member)`: an owner, a cofounder, an admin, a member)
--     and not a collaborator. A person holds one membership row per business, so the conjunction is exactly "that row's
--     role is a writer's and is not a collaborator's".
-- The api already kept a collaborator out (@foundmill/shared `COLLABORATOR_SECTIONS`: Finance and Legal "none"; every
-- Money and Legal procedure is `sectionRead`/`sectionWrite`, and the Home sentences, the metrics and a revenue goal wall
-- themselves), so no screen of theirs reads these tables. The services' own connection is not limited by RLS.
--
-- The migration refuses to run if any of the seven tables carries a policy other than the two it rewrites, so a policy
-- added later on one of them is a decision for whoever adds it, not an opening nobody saw.

do $$
declare
  t text;
  stray text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into stray
    from pg_policies
   where schemaname = 'public'
     and tablename in ('transactions', 'ledger_snapshots', 'forecasts', 'filings', 'contracts', 'compliance_events', 'regulatory_gates')
     and policyname <> tablename || '_select' and policyname <> tablename || '_write';
  if stray is not null then
    raise exception '0095: unexpected policies on the Money and Legal tables: %', stray;
  end if;
  foreach t in array array['transactions', 'ledger_snapshots', 'forecasts', 'filings', 'contracts', 'compliance_events', 'regulatory_gates'] loop
    execute format('drop policy %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_member_not_collaborator(business_id))', t || '_select', t);
    execute format('drop policy %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for all using (has_role(business_id, array[''owner'',''admin'',''member'']) and is_member_not_collaborator(business_id)) with check (has_role(business_id, array[''owner'',''admin'',''member'']) and is_member_not_collaborator(business_id))',
      t || '_write', t
    );
  end loop;
end;
$$;
--> statement-breakpoint
comment on function is_member_not_collaborator(uuid) is 'A membership of the business that has not ended and is not a collaborator''s: the select policy of the tables a collaborator never reads (0094, 0095), and half of the write policy of the Money and Legal tables members write (0095).';
--> statement-breakpoint
-- `is_member_not_collaborator(uuid)` (0094) is security definer and answers about the caller only; the row policies above
-- and 0094's call it as `authenticated`. 0094 granted it to anon as well, and on Supabase postgres's default privileges
-- grant it to anon directly: anon never needs it (no auth.uid(), so it is always false). Revoked from public and anon
-- (docs/DECISIONS.md, 0087's rule on main: a security-definer function names who may call it); authenticated and the
-- service keep it, granted here explicitly.
revoke execute on function is_member_not_collaborator(uuid) from public, anon;
--> statement-breakpoint
grant execute on function is_member_not_collaborator(uuid) to authenticated, service_role;
