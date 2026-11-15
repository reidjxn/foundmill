-- A Postgres cluster set up the way Supabase sets up a project, for CI's "Real Postgres (migrations and tenancy)" job
-- (docs/holistic-plan/WP-11 T1; docs/DEPLOY.md §4 "Checking grants on a real Postgres" made runnable). Run once as the
-- superuser against template1: roles are cluster-wide, and the auth schema, the extensions and the default privileges
-- are copied into every database the test harness creates (packages/db src/testing/postgres.ts, one per harness).
-- Throwaway credentials for a container that lives for one CI job; nothing here is a secret.

create role postgres login password 'postgres' createrole createdb replication bypassrls nosuperuser;
create role authenticator login noinherit;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin login noinherit createrole;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create extension if not exists pg_trgm;
create extension if not exists vector;

create schema auth authorization supabase_auth_admin;
-- The three statements of PGLITE_BOOTSTRAP_SQL (packages/db src/pglite.ts), unchanged.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, postgres;
grant select on auth.users to service_role;
grant select, insert, update, delete, references, trigger on auth.users to postgres;

-- Supabase's classic default privileges: everything postgres or supabase_admin creates in public is granted to the
-- client roles directly, which is why a migration revokes by name (docs/DECISIONS.md 2026-11-13, 0087).
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
