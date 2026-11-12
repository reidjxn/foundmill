-- 0080 — a person's own public profile (docs/THESIS_REVIEW.md package 2.3, first part). Until now a person could be
-- seen only as the owner of a committed, public business, and only by a display name; the profile's fields were
-- private inputs for agents. This adds a page about the person that exists without any project, at /u/<handle>, and
-- is public only when the person publishes it.
--
-- The new columns live on `founder_profiles` and keep its account-scoped rule (0002 `founder_profiles_own`: the row's
-- owner reads and writes it, nobody else, anon never). Two rules are new:
--   - the database checks every new field's shape and length itself, whichever client wrote;
--   - what the public sees changes only through the api (service role), which screens the text first: a signed-in
--     client writing straight to the table may take its profile down and edit it while it is not public, but cannot
--     make it public, or change what a public profile shows (the guard trigger below).
--
-- What is public: the view `public_person_profiles`, and only its ten columns. Nothing else of the row (email lives in
-- auth.users; residence, citizenship, budget, skill ratings, experience, time, constraints and risk stay private). The
-- view is read by the api alone (service role), through `publicPerson.byHandle` and its rate limits: anon and
-- authenticated cannot select it straight through PostgREST, so a reader cannot list every public profile at once.
--
-- A handle a person leaves stays theirs for 90 days (`person_handle_releases`, service role only): nobody else can take
-- it and pose as them at an address people already have.

-- True when a text array is a list of 0 to 8 tags of 1 to 30 characters on one line each. Mirrors `PersonProfileContent`
-- in @foundmill/shared.
create function fm_person_tags_ok(t text[]) returns boolean
language sql immutable as $$
  select coalesce(
    cardinality(t) <= 8
    and not exists (select 1 from unnest(t) as x(tag) where x.tag is null or char_length(x.tag) not between 1 and 30 or x.tag ~ '[\r\n]'),
    false);
$$;
--> statement-breakpoint
grant execute on function fm_person_tags_ok(text[]) to anon, authenticated, service_role;
--> statement-breakpoint
alter table founder_profiles
  -- The address under /u/: the project page's rule (0077): 3 to 40 lowercase letters, digits and hyphens, never
  -- starting or ending with a hyphen, never a word the product keeps (`PAGE_RESERVED_SLUGS`; a test compares the lists).
  add column handle text
    constraint founder_profiles_handle_format check (handle ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
    constraint founder_profiles_handle_reserved check (handle not in (
      'new', 'login', 'api', 'p', 'b', 'admin', 'settings', 'foundmill', 'www', 'app', 'help', 'about', 'terms', 'privacy', 'auth',
      'start', 'examples', 'businesses', 'onboarding', 'support', 'network', 'communities', 'profiles', 'milestones')),
  add column headline text not null default ''
    constraint founder_profiles_headline_shape check (char_length(headline) <= 80 and headline !~ '[\r\n]'),
  add column about text not null default ''
    constraint founder_profiles_about_shape check (char_length(about) <= 600),
  add column strengths text[] not null default '{}'
    constraint founder_profiles_strengths_shape check (fm_person_tags_ok(strengths)),
  add column wants_to_learn text[] not null default '{}'
    constraint founder_profiles_wants_to_learn_shape check (fm_person_tags_ok(wants_to_learn)),
  -- "What are you here for?": building on my own (the default, a complete answer), open to people, looking for a
  -- cofounder, looking to join a project.
  add column looking_for text not null default 'on_my_own'
    constraint founder_profiles_looking_for_value check (looking_for in ('on_my_own', 'open_to_people', 'looking_for_cofounder', 'looking_to_join')),
  add column place text not null default ''
    constraint founder_profiles_place_shape check (char_length(place) <= 60 and place !~ '[\r\n]'),
  add column public boolean not null default false,
  -- When the profile last went public (kept after it is taken down).
  add column published_at timestamptz,
  add constraint founder_profiles_public_ready check (not public or (handle is not null and published_at is not null));
--> statement-breakpoint
create unique index founder_profiles_handle_key on founder_profiles (handle);
--> statement-breakpoint
-- Going public, and changing what a public profile shows, is the api's to do (service role), after its screen. A
-- signed-in client may still take the profile down (public -> false), and change anything while it is not public,
-- except the display name while a published project page names the person as one of its founders (the page shows it).
-- Not security definer: `current_user` must be the caller's role (the page check reads the caller's own memberships
-- and pages under RLS, which an owner can see).
create function fm_founder_profiles_public_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name and exists (
       select 1
         from memberships m
         join project_pages p on p.business_id = m.business_id
         join businesses b on b.id = p.business_id
        where m.user_id = new.user_id and m.role = 'owner'
          and p.published->'showFounders' = 'true'::jsonb
          and b.committed_at is not null and b.archived_at is null and not b.is_demo) then
    raise exception 'permission denied for founder_profiles: a name a public page shows is changed through the app' using errcode = '42501';
  end if;
  if not new.public then
    return new;
  end if;
  if tg_op = 'INSERT' or not old.public
     or new.handle is distinct from old.handle
     or new.display_name is distinct from old.display_name
     or new.headline is distinct from old.headline
     or new.about is distinct from old.about
     or new.strengths is distinct from old.strengths
     or new.wants_to_learn is distinct from old.wants_to_learn
     or new.looking_for is distinct from old.looking_for
     or new.place is distinct from old.place
     or new.published_at is distinct from old.published_at
     or new.archived_at is distinct from old.archived_at then
    raise exception 'permission denied for founder_profiles: a public profile is published and changed through the app' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger founder_profiles_public_guard before insert or update on founder_profiles for each row execute function fm_founder_profiles_public_guard();
--> statement-breakpoint
-- A handle a person leaves (renamed, or cleared), kept for them for 90 days: one row per handle, the account it was
-- released by and when. Account-scoped but written and read only by the database's own triggers and the api (service
-- role): no client role reads it (it would list who used which address), and no client writes it (a person could
-- otherwise reserve addresses they never held). Taking the handle back, or a newer release by its next holder, replaces
-- the row; an account's rows go with the account.
create table person_handle_releases (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index person_handle_releases_user_id_idx on person_handle_releases (user_id);
--> statement-breakpoint
alter table person_handle_releases enable row level security;
--> statement-breakpoint
revoke all on person_handle_releases from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on person_handle_releases to service_role;
--> statement-breakpoint
select fm_track_updated_at('person_handle_releases');
--> statement-breakpoint
-- Whoever writes (the api, a signed-in client while the profile is private, a migration): a handle released by another
-- account in the last 90 days is refused as taken, with the same error as the unique index, so every writer gets the
-- person's sentence ("That address is taken"). Security definer: the releases are not readable by client roles.
create function fm_founder_profiles_handle_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handle is not null and (tg_op = 'INSERT' or new.handle is distinct from old.handle) and exists (
       select 1 from person_handle_releases r
        where r.handle = new.handle and r.user_id <> new.user_id and r.released_at > now() - interval '90 days') then
    raise exception 'duplicate key value violates unique constraint "founder_profiles_handle_key"'
      using errcode = '23505', constraint = 'founder_profiles_handle_key', detail = 'The handle was released by another account less than 90 days ago.';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger founder_profiles_handle_hold before insert or update of handle on founder_profiles for each row execute function fm_founder_profiles_handle_hold();
--> statement-breakpoint
-- Records the handle a person leaves, and forgets a release once its owner takes the handle back.
create function fm_founder_profiles_handle_released() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.handle is not null and new.handle is distinct from old.handle then
    insert into person_handle_releases (handle, user_id, released_at) values (old.handle, old.user_id, now())
      on conflict (handle) do update set user_id = excluded.user_id, released_at = excluded.released_at;
  end if;
  if new.handle is not null then
    delete from person_handle_releases where handle = new.handle and user_id = new.user_id;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create trigger founder_profiles_handle_released after update of handle on founder_profiles for each row execute function fm_founder_profiles_handle_released();
--> statement-breakpoint
-- The public read. Exactly these columns, for the api to serve to anyone, signed in or not: the handle, the display name, what the person
-- wrote for their profile (headline, about, the two tag lists, what they are here for, the place) and when it went
-- public; and the person's published project pages (slug, name, pitch), only for projects where they are an owner AND
-- the published page itself chose to name the people building it (`showFounders`), so a membership the founders did not
-- choose to show is never revealed. A project page is listed only while `public_project_pages` lists it (published,
-- committed, not archived, not a sample). A row exists only while the person's profile is public and not archived.
-- Nothing of the account (id, email, residence, citizenship, budget, skills, experience, time, constraints, risk,
-- visibility) leaves through it.
-- Age: the product does not yet record "I am 18 or older" at sign-up (package 2.2); `network_attestations` records it
-- only for the network, so this view does not filter on it. When 2.2 lands, it adds the condition here.
create view public_person_profiles with (security_barrier) as
  select fp.handle,
         fp.display_name,
         fp.headline,
         fp.about,
         fp.strengths,
         fp.wants_to_learn,
         fp.looking_for,
         fp.place,
         fp.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', pp.slug, 'name', pp.name, 'pitch', pp.published->>'pitch') order by pp.published_at desc, pp.slug)
                     from public_project_pages pp
                     join project_pages p on p.slug = pp.slug
                    where pp.published->'showFounders' = 'true'::jsonb
                      and exists (select 1 from memberships m where m.business_id = p.business_id and m.user_id = fp.user_id and m.role = 'owner')),
                  '[]'::jsonb) as projects
    from founder_profiles fp
   where fp.public and fp.handle is not null and fp.published_at is not null and fp.archived_at is null;
--> statement-breakpoint
-- The service role only: the api reads it on the service connection, one handle at a time and rate-limited
-- (`publicPerson.byHandle`). A client role selecting it straight through PostgREST is refused.
revoke all on public_person_profiles from public, anon, authenticated;
--> statement-breakpoint
grant select on public_person_profiles to service_role;
