-- 0085 — account-scoped events: a private event store for facts about one person (founder, Nov 12, 2026).
-- Until now every event belonged to a project: `events.business_id` and `outbox.business_id` are NOT NULL, the relay
-- keys streams by business, and every member of a business reads that business's event rows. A fact about a person
-- (their profile went public; later a follow, an ask, an answer) had nowhere to go without showing that person to a
-- project's members. This adds the person-level store beside the business one.
--
-- `outbox` is not touched. `events` gets exactly one thing: the check `events_not_account_scoped`, so an
-- account-scoped type can never be a row of a business (a member writing straight to the table included). Its
-- columns, its other constraints, its indexes, its policies and its grants stay as they were.
--
-- The rule.
--   - One row belongs to one person: `user_id`, the account it is about. The row goes with the account
--     (`on delete cascade` from auth.users), and it never moves to another account.
--   - The account-scoped types are listed once in the database: `fm_account_event_types()`. `account_events` takes
--     only those types and `events` refuses them. The list is the same as `ACCOUNT_EVENT_TYPES` in @foundmill/shared
--     (a test compares them), so a new account-scoped type needs a migration that redefines the function.
--   - Only the services write (the owner connection and `service_role`). No client role inserts, updates or deletes:
--     there is no write policy and no write grant.
--   - A signed-in person reads their own rows and nobody else's (`account_events_own_select`), and only the columns
--     that are theirs to read: `id, user_id, type, occurred_at, payload, created_at`. `actor` and `idempotency_key`
--     stay with the services (a key may be built from ids the person has no business reading). Table-level SELECT is
--     not granted, so a client query names its columns; `select *` is refused.
--   - `account_outbox` is the delivery queue: service role only, no policy, no client grant.
--   - A fact about two people (a follow, an answer, a referral) is one row per person it belongs to, each with a
--     payload shaped for that reader. A payload names another person only by something already public about them (a
--     public handle), never by account id, email address or any private field. The writer checks this
--     (@foundmill/events `writeAccountEvent`), and the database holds the part it can see, whichever writer: no single
--     value of a payload carries the id of any account, in any common spelling (hyphenated, without hyphens, with
--     hyphens elsewhere, in capitals, with Unicode dashes, with spaces, dots, colons or underscores between its
--     parts, inside other text), and a row's actor is exactly
--     `{ kind, id }`: the person themselves, or the system by a word (`fm_account_events_guard`,
--     `account_events_actor_own`). What the database cannot see: an id cut into pieces across several values, and
--     anything that is not an account id (an email address is the writer's to refuse).
--   - A row is a fact that happened: once written it is never changed (`fm_account_events_guard` refuses UPDATE).
--     `updated_at` and its trigger exist only because the schema's convention test asks them of every table but
--     `audit_log` (packages/db `migrations.test.ts`); the column never changes.
--
-- The event types are declared in the one catalog (packages/events `catalogue.ts`, `scope: "account"`); the first two
-- are `profile.published` and `profile.unpublished`.

-- The account-scoped event types, in one place for both checks below. To add one: a new migration with
-- `create or replace function fm_account_event_types()` returning the longer list (and the type appended to
-- `ACCOUNT_EVENT_TYPES` in @foundmill/shared; packages/db `rls/account-events.test.ts` compares the two).
create function fm_account_event_types() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['profile.published', 'profile.unpublished']::text[]
$$;
--> statement-breakpoint
revoke all on function fm_account_event_types() from public, anon;
--> statement-breakpoint
-- Members insert into `events` under RLS, and a check runs as the role that writes: they need to call it.
grant execute on function fm_account_event_types() to authenticated, service_role;
--> statement-breakpoint
-- Text as the guards compare it: lower case, with the punctuation an id is written with taken out (the hyphen, every
-- Unicode dash, the space, the dot, the colon and the underscore), so an id reads as its 32 letters and digits however
-- it was punctuated. (The dashes: U+2010 to U+2015, U+2212, U+FE58, U+FE63, U+FF0D.) In a payload's JSON text the
-- quotes, commas and brackets stay, so two values never run together.
create function fm_account_id_text(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.translate(
           pg_catalog.lower(t),
           '- ._:' || pg_catalog.chr(8208) || pg_catalog.chr(8209) || pg_catalog.chr(8210) || pg_catalog.chr(8211) || pg_catalog.chr(8212)
             || pg_catalog.chr(8213) || pg_catalog.chr(8722) || pg_catalog.chr(65112) || pg_catalog.chr(65123) || pg_catalog.chr(65293),
           '')
$$;
--> statement-breakpoint
revoke all on function fm_account_id_text(text) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function fm_account_id_text(text) to service_role;
--> statement-breakpoint
-- The one change to `events`: a fact about a person is never a row of a business, whoever writes (0060 did the same
-- for the person-addressed types). No writer produced these types before this migration; a row planted by hand under
-- one of these names goes first, so the check can be added (its outbox row cascades).
delete from events where type = any (fm_account_event_types());
--> statement-breakpoint
alter table events add constraint events_not_account_scoped check (type <> all (fm_account_event_types()));
--> statement-breakpoint
create table account_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null default now(),
  actor jsonb not null,
  payload jsonb not null default '{}',
  -- A repeat with the same key for the same person writes nothing (the partial unique index below).
  idempotency_key text check (char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- So the outbox row can be held to its event's own account (the composite foreign key on account_outbox).
  constraint account_events_id_user_id_key unique (id, user_id),
  -- Only an account-scoped type is a row here; a business-scoped type belongs to `events`.
  constraint account_events_type_account_scoped check (type = any (fm_account_event_types())),
  constraint account_events_payload_object check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  -- Exactly `{ kind, id }`, both text. The person themselves, or the system by a word (never an id, however it is
  -- spelled): no second party is ever the actor on a private row, and nothing else rides in the actor. `is true`:
  -- a missing key makes the expression null, and a check passes on null.
  constraint account_events_actor_own check ((
    jsonb_typeof(actor) = 'object'
    and jsonb_typeof(actor -> 'kind') = 'string'
    and jsonb_typeof(actor -> 'id') = 'string'
    and (actor - 'kind' - 'id') = '{}'::jsonb
    and actor ->> 'kind' in ('user', 'system')
    and (actor ->> 'kind' <> 'user' or actor ->> 'id' = user_id::text)
    and (actor ->> 'kind' <> 'system'
         or (actor ->> 'id' ~ '^[a-z][a-z0-9_.:-]{0,62}$' and fm_account_id_text(actor ->> 'id') !~ '[0-9a-f]{32}'))
  ) is true)
);
--> statement-breakpoint
create index account_events_user_id_idx on account_events (user_id, occurred_at desc, id desc);
--> statement-breakpoint
create index account_events_type_idx on account_events (user_id, type, occurred_at desc);
--> statement-breakpoint
create unique index account_events_idempotency_idx on account_events (user_id, idempotency_key) where idempotency_key is not null;
--> statement-breakpoint
-- Whichever role writes (the api, a worker, a migration): an event is never rewritten, and no single value of its
-- payload carries the id of an account, its own person's included (that one is `user_id`), in any common spelling.
-- The payload's text is read through `fm_account_id_text` (lower case, an id's punctuation out); every run of 32 or
-- more letters a to f and digits is then looked up in auth.users by primary key, at every position of the run, so an
-- id inside a longer run is found too. JSON's own quotes, commas and brackets still separate values: an id cut in
-- two across values is not seen. The cost is a few index reads on a payload of at most 16 KB. Security definer with
-- an empty search path: the writer's role need not read auth.users, and every name below is schema-qualified.
create function fm_account_events_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'account_events: an event is never changed once written' using errcode = '42501';
  end if;
  if exists (
    select 1
      from pg_catalog.regexp_matches(public.fm_account_id_text(new.payload::text), '[0-9a-f]{32,}', 'g') as m(run)
      cross join lateral pg_catalog.generate_series(1, pg_catalog.length(m.run[1]) - 31) as g(i)
      join auth.users u on u.id = (pg_catalog.substr(m.run[1], g.i, 32))::uuid
  ) then
    raise exception 'account_events: a payload never names a person by their account id' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke all on function fm_account_events_guard() from public, anon, authenticated;
--> statement-breakpoint
create trigger account_events_guard before insert or update on account_events for each row execute function fm_account_events_guard();
--> statement-breakpoint
alter table account_events enable row level security;
--> statement-breakpoint
create policy account_events_own_select on account_events for select to authenticated using (user_id = auth.uid());
--> statement-breakpoint
revoke all on account_events from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select (id, user_id, type, occurred_at, payload, created_at) on account_events to authenticated;
--> statement-breakpoint
grant select, insert on account_events to service_role;
--> statement-breakpoint
select fm_track_updated_at('account_events');
--> statement-breakpoint
-- The delivery queue, written in the same transaction as the event and relayed to Redis `ae:{user_id}` by apps/api.
-- `attempts`, `last_error` and `next_attempt_at` record a row the relay could not publish and when it tries again;
-- a row that can never be published is closed (`published_at`) with its `last_error`. Service role only.
create table account_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  published_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (char_length(last_error) <= 500),
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_outbox_event_id_key unique (event_id),
  -- The queue row is its event's own person's: it cannot name another account.
  constraint account_outbox_event_fkey foreign key (event_id, user_id) references account_events (id, user_id) on delete cascade
);
--> statement-breakpoint
create index account_outbox_user_id_idx on account_outbox (user_id);
--> statement-breakpoint
create index account_outbox_unpublished_idx on account_outbox (created_at) where published_at is null;
--> statement-breakpoint
alter table account_outbox enable row level security;
--> statement-breakpoint
revoke all on account_outbox from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update on account_outbox to service_role;
--> statement-breakpoint
select fm_track_updated_at('account_outbox');
