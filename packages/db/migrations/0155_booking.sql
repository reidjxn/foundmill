-- 0155 — Foundmill's own booking, free on every plan (founder, Nov 22, 2026). For a project whose customers pick a
-- time (tutoring, cleaning, coaching, repairs): one person, any number of services. No booking vendor.
--
--   booking_settings   one row per project: the founder's zone and weekly hours, whether the founder's calendar's busy
--                      times are read, and `status`: 'draft' (set up, by the founder or drafted by the team, and not
--                      public) or 'live' (the founder approved it; visitors can book).
--   booking_services   what can be booked: name, duration, buffers, price as shown, online or in person, the notice
--                      and how far ahead.
--   bookings           a slot a visitor holds while filling in the form ('held', until `hold_expires_at`) and the
--                      booking once confirmed, with the customer's name, email and answers.
--
-- Double booking is the one bug that must never ship. `bookings_no_overlap` is an exclusion constraint: no two rows of
-- one project that keep their slot ('held' or 'confirmed') may have overlapping `busy` ranges, where `busy` is the
-- appointment with the service's buffers. Two visitors racing for one slot: exactly one insert succeeds, the other
-- gets 23P01, whoever writes and however they got there. Every instant is timestamptz (UTC).
--
-- Who may do what:
--   read    members of the business (a booking is a customer record, like the CRM's)
--   write   the services only: the api writes for a founder after checking the role, and for a visitor through the
--           public route. No app role inserts, updates or deletes.
-- A collaborator reads all three tables, as they read `entities` (the CRM's customer records, open to a collaborator
-- since 0092 and left open by 0094): the select policy is `is_member`, not `is_member_not_collaborator`.
-- The public page reads `public_booking_pages` on the service connection (only a live setup of a published page of a
-- committed, unarchived project that is not a sample), then that project's services from `booking_services`.
--
-- `btree_gist` gives `=` on uuid a gist operator class, which the exclusion constraint needs. It is created the way
-- 0001 creates pg_trgm (no schema named); Supabase ships it, and Postgres marks it trusted.
create extension if not exists btree_gist;
--> statement-breakpoint
create table booking_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'draft' constraint booking_settings_status_value check (status in ('draft', 'live')),
  -- The founder's IANA zone: the weekly hours are wall-clock times there.
  time_zone text not null constraint booking_settings_time_zone_length check (char_length(time_zone) between 1 and 64),
  -- `{ "1": [{ "start": 540, "end": 1020 }], … }`: weekday "0" (Sunday) to "6", minutes from midnight.
  weekly_hours jsonb not null default '{}'::jsonb constraint booking_settings_weekly_hours_object check (jsonb_typeof(weekly_hours) = 'object'),
  -- Read the founder's Google Calendar for busy times and write confirmed bookings to it (after the founder's yes).
  use_calendar boolean not null default false,
  -- Who drafted it (an agent's `booking_setup`), and who turned it on.
  drafted_by_agent_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_settings_business_id_key unique (business_id),
  constraint booking_settings_live_is_approved check (status <> 'live' or approved_at is not null)
);
--> statement-breakpoint
select fm_tenant_table('booking_settings', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on booking_settings from anon, authenticated;
--> statement-breakpoint
create table booking_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null constraint booking_services_name_length check (char_length(name) between 1 and 80),
  duration_min integer not null constraint booking_services_duration_range check (duration_min between 10 and 480),
  buffer_before_min integer not null default 0 constraint booking_services_buffer_before_range check (buffer_before_min between 0 and 120),
  buffer_after_min integer not null default 0 constraint booking_services_buffer_after_range check (buffer_after_min between 0 and 120),
  -- The price as shown, in minor units; null is free. Showing a price takes no payment.
  price_minor bigint constraint booking_services_price_minor_check check (price_minor is null or price_minor >= 0),
  currency char(3) not null constraint booking_services_currency_format check (currency ~ '^[A-Z]{3}$'),
  mode text not null default 'online' constraint booking_services_mode_value check (mode in ('online', 'in_person')),
  min_notice_min integer not null default 720 constraint booking_services_notice_range check (min_notice_min between 0 and 20160),
  max_days_ahead integer not null default 30 constraint booking_services_days_ahead_range check (max_days_ahead between 1 and 180),
  -- Up to 3 optional questions the founder asks, as text.
  questions jsonb not null default '[]'::jsonb constraint booking_services_questions_array check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 3),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index booking_services_business_id_idx on booking_services (business_id, position);
--> statement-breakpoint
select fm_tenant_table('booking_services', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on booking_services from anon, authenticated;
--> statement-breakpoint
create table bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  service_id uuid not null references booking_services(id) on delete restrict,
  status text not null constraint bookings_status_value check (status in ('held', 'confirmed', 'canceled', 'no_show', 'completed')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The appointment with the service's buffers as they were when it was booked: what nobody else may overlap.
  busy tstzrange not null,
  hold_expires_at timestamptz,
  -- The CRM record of the customer, once confirmed.
  entity_id uuid references entities(id) on delete set null,
  customer_name text constraint bookings_customer_name_length check (customer_name is null or char_length(customer_name) between 1 and 80),
  customer_email text constraint bookings_customer_email_length check (customer_email is null or char_length(customer_email) between 3 and 254),
  -- `[{ "question": "...", "answer": "..." }]`: a customer's own words, untrusted content.
  answers jsonb not null default '[]'::jsonb constraint bookings_answers_array check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) <= 3),
  -- The sentence the visitor agreed to, exactly as shown.
  consent_text text,
  -- The visitor's own zone, to write their emails in.
  visitor_time_zone text constraint bookings_visitor_time_zone_length check (visitor_time_zone is null or char_length(visitor_time_zone) <= 64),
  -- sha256 of the token the visitor's browser holds for its hold.
  hold_token_hash text,
  -- Never a real outcome: a booking made by a member of the project on its own page, or in a mode where results are simulated.
  test boolean not null default false,
  calendar_event_id text,
  reminder_sent_at timestamptz,
  confirmed_at timestamptz,
  canceled_at timestamptz,
  -- 'customer', 'founder' or 'system' (a hold that ran out).
  canceled_by text constraint bookings_canceled_by_value check (canceled_by is null or canceled_by in ('customer', 'founder', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_order check (starts_at < ends_at),
  constraint bookings_busy_covers check (busy @> tstzrange(starts_at, ends_at, '[)')),
  constraint bookings_held_expires check ((status = 'held') = (hold_expires_at is not null)),
  constraint bookings_confirmed_has_customer check (status = 'held' or (customer_name is not null and customer_email is not null and consent_text is not null)),
  constraint bookings_no_overlap exclude using gist (business_id with =, busy with &&) where (status in ('held', 'confirmed'))
);
--> statement-breakpoint
create index bookings_business_starts_idx on bookings (business_id, starts_at);
--> statement-breakpoint
create index bookings_service_id_idx on bookings (service_id);
--> statement-breakpoint
create index bookings_entity_id_idx on bookings (entity_id);
--> statement-breakpoint
create unique index bookings_hold_token_hash_key on bookings (hold_token_hash) where hold_token_hash is not null;
--> statement-breakpoint
-- The reminder pass: confirmed bookings that start soon and have had no reminder.
create index bookings_reminder_due_idx on bookings (starts_at) where status = 'confirmed' and reminder_sent_at is null;
--> statement-breakpoint
-- No booking of one business points at another business's service, whoever writes.
create function fm_booking_same_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from booking_services s where s.id = new.service_id and s.business_id = new.business_id) then
    raise exception 'a booking belongs to a service of its own business' using errcode = '23514', constraint = 'bookings_same_business';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_booking_same_business() from public, anon, authenticated;
--> statement-breakpoint
create trigger bookings_same_business before insert or update of service_id, business_id on bookings for each row execute function fm_booking_same_business();
--> statement-breakpoint
select fm_tenant_table('bookings', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on bookings from anon, authenticated;
--> statement-breakpoint
-- What a visitor's booking page may read. Built on `public_project_pages`, so the rule for what is public is written
-- once: a published page of a committed, unarchived project that is not a sample. Only a live setup.
create view public_booking_pages with (security_barrier) as
  select pp.slug, p.business_id, pp.name, bs.time_zone, bs.weekly_hours, bs.use_calendar
    from public_project_pages pp
    join project_pages p on p.slug = pp.slug
    join booking_settings bs on bs.business_id = p.business_id
   where bs.status = 'live';
--> statement-breakpoint
revoke all on public_booking_pages from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on public_booking_pages to service_role;
