-- 0085 — account-scoped events: a private event store for facts about one person (founder, Nov 12, 2026).
-- Until now every event belonged to a project: `events.business_id` and `outbox.business_id` are NOT NULL, the relay
-- keys streams by business, and every member of a business reads that business's event rows. A fact about a person
-- (their profile went public; later a follow, an ask, an answer) had nowhere to go without showing that person to a
-- project's members. This adds the person-level store beside the business one. `events` and `outbox`, their policies
-- and their grants are not touched.
--
-- The rule.
--   - One row belongs to one person: `user_id`, the account it is about. The row goes with the account
--     (`on delete cascade` from auth.users), and it never moves to another account.
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
--     (@foundmill/events `writeAccountEvent`), and the database holds the part it can see, whichever writer: no
--     payload carries the id of any account, and a row's actor is the person themselves or the system
--     (`fm_account_events_guard`, `account_events_actor_own`).
--   - A row is a fact that happened: once written it is never changed (`fm_account_events_guard` refuses UPDATE).
--
-- The event types are declared in the one catalog (packages/events `catalogue.ts`, `scope: "account"`); the first two
-- are `profile.published` and `profile.unpublished`.
create table account_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (char_length(type) <= 80 and type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  occurred_at timestamptz not null default now(),
  actor jsonb not null,
  payload jsonb not null default '{}',
  -- A repeat with the same key for the same person writes nothing (the partial unique index below).
  idempotency_key text check (char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- So the outbox row can be held to its event's own account (the composite foreign key on account_outbox).
  constraint account_events_id_user_id_key unique (id, user_id),
  constraint account_events_payload_object check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  -- The person themselves, or the system by a word (never an id): no second party is ever the actor on a private row.
  constraint account_events_actor_own check (
    jsonb_typeof(actor) = 'object'
    and coalesce(actor->>'kind', '') in ('user', 'system')
    and char_length(coalesce(actor->>'id', '')) between 1 and 80
    and (actor->>'kind' <> 'user' or actor->>'id' = user_id::text)
    and (actor->>'kind' <> 'system' or actor->>'id' !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
  )
);
--> statement-breakpoint
create index account_events_user_id_idx on account_events (user_id, occurred_at desc, id desc);
--> statement-breakpoint
create index account_events_type_idx on account_events (user_id, type, occurred_at desc);
--> statement-breakpoint
create unique index account_events_idempotency_idx on account_events (user_id, idempotency_key) where idempotency_key is not null;
--> statement-breakpoint
-- Whichever role writes (the api, a worker, a migration): an event is never rewritten, and its payload never carries
-- the id of an account, its own person's included (that one is `user_id`). Every UUID in the payload is looked up by
-- primary key, so the check costs a few index reads on a payload of at most 16 KB. Security definer: the writer's role
-- need not read auth.users.
create function fm_account_events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'account_events: an event is never changed once written' using errcode = '42501';
  end if;
  if exists (
    select 1
      from regexp_matches(new.payload::text, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'g') as m(found)
      join auth.users u on u.id = (m.found[1])::uuid
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
