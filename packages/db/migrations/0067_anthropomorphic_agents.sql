-- 0067 — anthropomorphic agents (founder, 2026-10-22). Every agent carries one persona key from the catalog in
-- @foundmill/shared (`PERSONAS`): a human first name and a face the founder may choose to see instead of the agent's
-- title name. The key is given at hire (repos.agents.create/createMany/clone), unique among the business's agents and,
-- where the catalog allows, not one the owner's other businesses use; agents hired before this migration are given one
-- at api boot (repos.agents.backfillPersonas). A rename never changes it. Null only until that backfill has run.
-- Business-scoped like the rest of the row: the agents policies (0004) cover the new column unchanged.
alter table agents add column persona_key text check (persona_key is null or persona_key ~ '^[a-z]{1,40}$');
--> statement-breakpoint
-- The assignment reads the business's keys (taken) and the owner's other businesses' keys (avoid).
create index agents_persona_key_idx on agents (business_id, persona_key) where persona_key is not null;
--> statement-breakpoint
-- The switch is the account's, beside guidance and text size (0064): off shows agents exactly as before. The existing
-- policy (`user_id = auth.uid()`) and grants cover the column; a person with no row reads the default (off).
alter table account_preferences add column anthropomorphic_agents boolean not null default false;
--> statement-breakpoint
-- One AI-generated portrait per catalog key: a platform asset, not business data (no business_id). The gateway makes it
-- from the key alone (`personaPortraitPrompt`), the api stores it with the service connection and serves the bytes on
-- GET /personas/:key. RLS is on with no policies and app roles hold no grants, like credentials (0011): nothing reaches
-- it except the service role. `persona_key` is the natural key (unique); `id` keeps the §7 convention every table has.
create table persona_portraits (
  id uuid primary key default gen_random_uuid(),
  persona_key text not null unique check (persona_key ~ '^[a-z]{1,40}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  content bytea not null check (octet_length(content) between 1 and 8388608),
  model text not null check (length(model) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
alter table persona_portraits enable row level security;
--> statement-breakpoint
-- No policies: even a grant could not open this table to app roles. Belt and braces.
revoke all on persona_portraits from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on persona_portraits to service_role;
--> statement-breakpoint
select fm_track_updated_at('persona_portraits');
