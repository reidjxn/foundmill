-- 0087 — client grants on Supabase (a real-Postgres check, Nov 13, 2026). On Supabase, `postgres` has classic default
-- privileges in `public`: everything it creates (tables, views, functions, sequences) is granted straight to anon,
-- authenticated and service_role, all privileges. A `revoke ... from public` takes away only the PUBLIC pseudo-role's
-- grant, not those direct grants. PGlite has no such defaults, so the suites could not see what this closes:
--   - `fm_purge_business(uuid)` (0028, security definer: permanently deletes a business) and
--     `refresh_journey_daily()` (0007, security definer) were service-only by intent but EXECUTE-able by anon and
--     authenticated. Revoked from public, anon and authenticated (public again so this holds on its own); the
--     service_role grants of 0007 and 0028 stay.
--   - `account_preferences` (0022), `founder_presence` and `founder_visit_days` (0083) were meant to have no client
--     DELETE (the rows go with the account, or with the business), but their FOR ALL row policies plus the default
--     table grant let a person delete their own row. Revoking the grant is enough; the policies stay as they are.
--     Nothing in the api deletes these rows as a client role (service_role keeps its DELETE on the 0083 tables).
--   - TRUNCATE (which ignores row level security), TRIGGER (a client role could attach a trigger to another tenant's
--     table, which then runs on everyone's writes) and REFERENCES: no migration ever granted them to a client role.
--     Revoked on every table and view in `public` from anon and authenticated, and from the migration role's default
--     privileges, so a table created later does not bring them back.
--   - `public_person_profiles` (0080) and `public_project_pages` (0081) are the service role's to read and nobody's to
--     write; the default grants gave it every privilege, and `public_person_profiles` is auto-updatable, so the
--     service role could write `founder_profiles` through it. It keeps SELECT only, as the two migrations granted.
-- Nothing is granted here, and no policy changes. The rule from now on (docs/DECISIONS.md): a service-only function
-- revokes from `public, anon, authenticated`, never from `public` alone.
revoke execute on function fm_purge_business(uuid) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function refresh_journey_daily() from public, anon, authenticated;
--> statement-breakpoint
revoke delete on account_preferences, founder_presence, founder_visit_days from anon, authenticated;
--> statement-breakpoint
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
--> statement-breakpoint
revoke insert, update, delete, truncate, references, trigger on public_person_profiles, public_project_pages from service_role;
--> statement-breakpoint
-- `audit_log_verify(uuid)` (0011) is security definer and hashes a whole audit chain for the business it is given; it is
-- for members (granted to authenticated) and the service, never for anon, who reached it through PUBLIC.
revoke execute on function audit_log_verify(uuid) from public, anon;
