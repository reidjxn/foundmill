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
-- auth.users; residence, citizenship, budget, skill ratings, experience, time, constraints and risk stay private).

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
-- signed-in client may still take the profile down (public -> false), and change anything while it is not public.
-- Not security definer: `current_user` must be the caller's role.
create function fm_founder_profiles_public_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or not new.public then
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
-- The public read. Exactly these columns, for anyone, signed in or not: the handle, the display name, what the person
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
revoke all on public_person_profiles from anon, authenticated;
--> statement-breakpoint
grant select on public_person_profiles to anon, authenticated, service_role;
