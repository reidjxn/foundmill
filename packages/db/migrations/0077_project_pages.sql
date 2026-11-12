-- 0077 — a public page for every project (docs/THESIS_REVIEW.md package 1.1; CLAUDE.md "Foundmill hosts every
-- project's public page at a Foundmill address for free"). One row per business: the draft the founders write, the
-- copy that is published (null until they publish, and again after they take it down) and the page's address under
-- /p/. Until now nothing a project made could be seen outside the product.
--
-- Who may do what:
--   read             members of the business (never anon: the public reads the view below, nothing else)
--   write the draft  owner, admin, member (the same roles that edit the product vision, 0003)
--   publish, take down, change a live page's address, delete   owner or admin only (the guard trigger and the delete policy)
-- The api writes as the signed-in user through RLS, so these rules hold for a write made straight through PostgREST too.
--
-- What is public: the view `public_project_pages`, and only its eight columns.

-- True when a jsonb value is a page that may be shown: the pitch on one line (1 to 140 characters), about (1 to 1,500),
-- "who it is for" (0 to 300), a known stage and the show-founders flag. Mirrors `ProjectPageContent` in @foundmill/shared.
create function fm_page_content_ok(c jsonb) returns boolean
language sql immutable as $$
  select coalesce(
    jsonb_typeof(c) = 'object'
    and jsonb_typeof(c->'pitch') = 'string' and char_length(c->>'pitch') between 1 and 140 and position(E'\n' in c->>'pitch') = 0 and position(E'\r' in c->>'pitch') = 0
    and jsonb_typeof(c->'about') = 'string' and char_length(c->>'about') between 1 and 1500
    and jsonb_typeof(c->'forWhom') = 'string' and char_length(c->>'forWhom') <= 300
    and jsonb_typeof(c->'stage') = 'string' and c->>'stage' in ('idea', 'building', 'live')
    and jsonb_typeof(c->'showFounders') = 'boolean',
    false);
$$;
--> statement-breakpoint
grant execute on function fm_page_content_ok(jsonb) to anon, authenticated, service_role;
--> statement-breakpoint
create table project_pages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- The address: 3 to 40 lowercase letters, digits and hyphens, never starting or ending with a hyphen, and never a
  -- word the product keeps for itself (`PAGE_RESERVED_SLUGS` in @foundmill/shared; a test compares the two lists).
  slug text not null
    constraint project_pages_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
    constraint project_pages_slug_reserved check (slug not in (
      'new', 'login', 'api', 'p', 'b', 'admin', 'settings', 'foundmill', 'www', 'app', 'help', 'about', 'terms', 'privacy', 'auth',
      'start', 'examples', 'businesses', 'onboarding', 'support', 'network', 'communities', 'profiles', 'milestones')),
  -- What the founders are writing: the page's fields, which may still be incomplete.
  draft jsonb not null
    constraint project_pages_draft_shape check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 16000),
  -- The published copy; the public page shows this and nothing else.
  published jsonb
    constraint project_pages_published_shape check (published is null or fm_page_content_ok(published)),
  -- When it last went live (kept after it is taken down).
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  -- When it was taken down; null while it is live or was never published.
  unpublished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint project_pages_business_id_key unique (business_id),
  constraint project_pages_slug_key unique (slug),
  constraint project_pages_published_dated check (published is null or published_at is not null),
  constraint project_pages_live_or_down check (published is null or unpublished_at is null)
);
--> statement-breakpoint
create index project_pages_published_by_idx on project_pages (published_by);
--> statement-breakpoint
create index project_pages_updated_by_idx on project_pages (updated_by);
--> statement-breakpoint
alter table project_pages enable row level security;
--> statement-breakpoint
create policy project_pages_select on project_pages for select using (is_member(business_id));
--> statement-breakpoint
create policy project_pages_insert on project_pages for insert with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy project_pages_update on project_pages for update
  using (has_role(business_id, array['owner','admin','member']))
  with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
-- Deleting the row takes a live page down, so it is an owner's or an admin's to do.
create policy project_pages_delete on project_pages for delete using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
revoke all on project_pages from anon;
--> statement-breakpoint
grant select, insert, update, delete on project_pages to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('project_pages');
--> statement-breakpoint
-- Publishing is an owner's or an admin's decision. A member with write access edits the draft and, while the page is
-- not live, its address; anything that changes what the public sees (the published copy, its dates, who published it, a
-- live page's address) is refused for them here, whichever client wrote. A page never moves to another business, and a
-- sample business never has a public page. Not security definer: `current_user` must be the caller's role.
create function fm_project_pages_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  app_role boolean := current_user in ('authenticated', 'anon');
  goes_public boolean;
begin
  if tg_op = 'INSERT' then
    goes_public := new.published is not null or new.published_at is not null or new.published_by is not null or new.unpublished_at is not null;
  else
    if new.business_id is distinct from old.business_id then
      raise exception 'A page stays with its business' using errcode = '23514';
    end if;
    goes_public := new.published is distinct from old.published
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.unpublished_at is distinct from old.unpublished_at
      or (old.published is not null and new.slug is distinct from old.slug);
  end if;
  if goes_public and app_role and not has_role(new.business_id, array['owner','admin']) then
    raise exception 'permission denied for project_pages: only an owner or an admin can publish a page, take it down or change a live page''s address' using errcode = '42501';
  end if;
  if new.published is not null and exists (select 1 from businesses b where b.id = new.business_id and b.is_demo) then
    raise exception 'A sample business has no public page' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger project_pages_guard before insert or update on project_pages for each row execute function fm_project_pages_guard();
--> statement-breakpoint
-- The public read. Exactly these columns, for anyone, signed in or not: the address, the published copy and when it went
-- live; the business's name, its logo's version (the sha256 of `business_logos`; the image itself is served by the api
-- for a page this view lists) and its brand colors (the business-card columns of `public_profiles`, 0044, whose
-- `crest_url` is retired, 0017); and the display names of the business's owners, only while the published copy says to
-- show them. A row exists only while the page is published and its business is committed, not archived and not a
-- sample. `game_mode` is not consulted: publishing the page is the founder's own explicit choice.
create view public_project_pages with (security_barrier) as
  select p.slug,
         p.published,
         p.published_at,
         b.name,
         (select l.sha256::text from business_logos l where l.business_id = b.id) as logo_version,
         b.kit_primary,
         b.kit_secondary,
         case when p.published->'showFounders' = 'true'::jsonb then
           coalesce((select array_agg(fp.display_name order by m.created_at, m.id)
                       from memberships m
                       join founder_profiles fp on fp.user_id = m.user_id
                      where m.business_id = b.id and m.role = 'owner' and fp.archived_at is null and btrim(fp.display_name) <> ''), '{}'::text[])
         else '{}'::text[] end as founder_names
    from project_pages p
    join businesses b on b.id = p.business_id
   where p.published is not null and b.committed_at is not null and b.archived_at is null and not b.is_demo;
--> statement-breakpoint
revoke all on public_project_pages from anon, authenticated;
--> statement-breakpoint
grant select on public_project_pages to anon, authenticated, service_role;
--> statement-breakpoint
-- The Product module gains a tab, "Public page", right after Specification (`MODULE_TABS.product`). New businesses get
-- it from Commit and the seeds; this adds it to every department that already shows the Specification tab. Tabs after
-- Specification move one place along first.
update screen_definitions s
   set position = s.position + 1
  from screen_definitions spec
  join departments d on d.id = spec.department_id
 where spec.tab_slug = 'specification' and spec.archived_at is null
   and 'product' = any(d.module_keys)
   and s.department_id = spec.department_id
   and s.position > spec.position
   and not exists (select 1 from screen_definitions x where x.department_id = spec.department_id and x.tab_slug = 'public-page');
--> statement-breakpoint
insert into screen_definitions (business_id, department_id, tab_slug, title, position, layout)
select spec.business_id, spec.department_id, 'public-page', 'Public page', spec.position + 1,
       '{"widgets":[{"key":"module:product/public-page","x":0,"y":0,"w":12,"h":60,"settings":{}}]}'::jsonb
  from screen_definitions spec
  join departments d on d.id = spec.department_id
 where spec.tab_slug = 'specification' and spec.archived_at is null
   and 'product' = any(d.module_keys)
   and not exists (select 1 from screen_definitions x where x.department_id = spec.department_id and x.tab_slug = 'public-page');
