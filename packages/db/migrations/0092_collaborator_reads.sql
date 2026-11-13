-- 0092 — a collaborator reads nothing of the tables that only the founders and admins write (security review of the
-- invitations change, 2026-11-13). It follows 0091.
--
-- 0090 made a collaborator a member in every `has_role` check and left reads to `is_member`, so a collaborator's own
-- RLS connection could select every row of a table whose writes are an owner's or an admin's (`fm_tenant_table(...,
-- array['owner','admin'])`) and of the Money tables the services write: the bank accounts, the cap table, the legal
-- entities, the integrations and their webhooks, the policies, the usage ledger and credits, the checkouts, and the
-- project's invitations. The api never served those to a collaborator (@foundmill/shared `COLLABORATOR_SECTIONS`:
-- nothing of Money, Legal, Billing or Settings), but the database did not say the same. From 0092 it does: each of
-- these tables' select policy is `is_member_not_collaborator(business_id)`, a membership that has not ended and is not a
-- collaborator's. Owners, cofounders, admins, members, viewers, advisors and example viewers read them as before.
--
-- Left as they were, on purpose, with the reason (each is named in rls/people-roles.test.ts):
--   * admin-written tables a collaborator's own screens read: `departments` and `department_members` (the Team, which a
--     collaborator reads), `holiday_periods` (the shell's vacation notice), `business_logos` and `business_foundations`
--     (the shell and Home), `product_research` (Product), `session_recordings` (Development's Live sessions),
--     `contact_consents` (Customers), `demo_sample_rows` (sample bookkeeping, never on a real project);
--   * the Money and Legal tables members write (`transactions`, `ledger_snapshots`, `forecasts`, `filings`,
--     `contracts`, `compliance_events`, `regulatory_gates`): a collaborator still reads and writes them in the database
--     as a member does, and only the api's section walls keep them out. Closing those needs the write policies changed
--     as well and is not part of this migration: 0093 closes them, reads and writes (docs/ARCHITECTURE.md, the
--     collaborator's walls).

create function is_member_not_collaborator(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.business_id = bid and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
       and m.role <> 'collaborator'
  );
$$;
--> statement-breakpoint
grant execute on function is_member_not_collaborator(uuid) to anon, authenticated, service_role;
--> statement-breakpoint
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'securities', 'cap_table_entries', 'usage_ledger', 'credit_balances', 'billing_checkouts', 'legal_entities', 'incorporations', 'integrations', 'webhooks', 'policies', 'app_installations', 'invitations'] loop
    execute format('drop policy %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_member_not_collaborator(business_id))', t || '_select', t);
  end loop;
end;
$$;
