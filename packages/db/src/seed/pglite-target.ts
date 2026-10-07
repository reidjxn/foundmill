/**
 * A file-backed PGlite database for local use when DATABASE_URL is unset (`SEED_TARGET=pglite`, default dir
 * `./.pglite/dev`, override with SEED_PGLITE_DIR). Boots the same roles and stub `auth` schema as the test harness,
 * applies the migrations that are not yet recorded in `_foundmill_local_migrations`, and hands back a Drizzle db.
 *
 * The bootstrap SQL mirrors src/testing/pglite.ts (which only builds in-memory instances); keep the two in step.
 */
import { PGlite, type Extension } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../client";
import { readMigrations } from "../migrations";
import * as schema from "../schema";
import { rewriteForMissingVector } from "../testing/pglite";

const BOOTSTRAP_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
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
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;
create table if not exists public._foundmill_local_migrations (tag text primary key, applied_at timestamptz not null default now());
`;

export interface LocalPglite {
  db: Db;
  pg: PGlite;
  dataDir: string;
  appliedMigrations: string[];
  hasVector: boolean;
  close(): Promise<void>;
}

async function loadVector(): Promise<Extension | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "@electric-sql/pglite-pgvector")) as { vector?: Extension };
    return mod.vector ?? null;
  } catch {
    return null;
  }
}

export async function openLocalPglite(dataDir: string): Promise<LocalPglite> {
  const vector = await loadVector();
  const extensions: Record<string, Extension> = { pg_trgm };
  if (vector) extensions.vector = vector;
  const pg = await PGlite.create({ dataDir, extensions, relaxedDurability: true });
  await pg.exec(BOOTSTRAP_SQL);
  const done = new Set((await pg.query<{ tag: string }>("select tag from public._foundmill_local_migrations")).rows.map((r) => r.tag));
  const applied: string[] = [];
  for (const m of readMigrations()) {
    if (done.has(m.tag)) continue;
    await pg.exec(vector ? m.sql : rewriteForMissingVector(m.sql));
    await pg.query("insert into public._foundmill_local_migrations (tag) values ($1)", [m.tag]);
    applied.push(m.tag);
  }
  const db = drizzle({ client: pg, schema }) as unknown as Db;
  return { db, pg, dataDir, appliedMigrations: applied, hasVector: Boolean(vector), close: () => pg.close() };
}
