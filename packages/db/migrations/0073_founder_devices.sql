-- 0073 — the mobile companion app (founder, 2026-11-08; docs/mobile). A signed-in person's phones register for push:
-- one row per device token, owned by the account that signed in on that phone last (a shared or handed-over phone
-- follows the latest sign-in; the api moves a token with the service role, see repos/devices.ts). Account-scoped like
-- account_preferences, not business-scoped: a person's devices follow them into every business, and the push fan-out
-- (a later change) picks recipients per business through memberships. Each person reads, writes and deletes only
-- their own rows (`user_id = auth.uid()`); the service role reads them all to send.
create table founder_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  provider text not null default 'onesignal' check (provider in ('onesignal')),
  -- The provider's subscription id for this install; unique across accounts (a token names one phone).
  token text not null unique check (char_length(token) between 8 and 512),
  app_version text not null default '' check (char_length(app_version) <= 40),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index founder_devices_user_id_idx on founder_devices (user_id, last_seen_at desc);
--> statement-breakpoint
alter table founder_devices enable row level security;
--> statement-breakpoint
create policy founder_devices_own on founder_devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());
--> statement-breakpoint
revoke all on founder_devices from anon;
--> statement-breakpoint
grant select, insert, update, delete on founder_devices to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('founder_devices');
--> statement-breakpoint
-- Which kinds of push a person wants (`{ "customer": false }`; an absent kind is on) and whether amounts stay off the
-- lock screen. On the preferences row beside the other personal choices; the existing policy and grants cover them.
alter table account_preferences add column notifications jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table account_preferences add column hide_amounts_on_lock_screen boolean not null default false;
