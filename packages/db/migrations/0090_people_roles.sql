-- 0090 — the cofounder and collaborator roles (docs/THESIS_REVIEW.md package 3.3; CLAUDE.md "the words for people",
-- founder 2026-11-11). Appended to the roles a membership can hold; every role that exists keeps its meaning.
--
--   * `cofounder`: equal standing, any number. Owner-equivalent wherever an owner is meant: `has_role(bid, roles)` is
--     true for a cofounder whenever `roles` holds 'owner', so every policy written over `has_role` (0001's tenant
--     tables, 0026's membership guards, 0089's invitations) treats a cofounder as an owner without being rewritten. The
--     places that read `memberships.role = 'owner'` themselves are redefined here: the membership guards, the
--     keep-an-owner trigger (an owner or a cofounder keeps the business), the public profiles, the founders' names on a
--     project's public page and on a person's page, and the founder profile's public guard.
--   * `collaborator`: someone trying out or helping, with limited access. In the database a collaborator writes where a
--     member writes (`has_role` is true for a collaborator whenever `roles` holds 'member'): the walls between sections
--     (read and write Product and Customers, read the plan, nothing of Money or Settings) are the api's, as they are for
--     every member today (@foundmill/shared `COLLABORATOR_SECTIONS`; no policy here reads section permissions). A
--     collaborator never matches 'owner' or 'admin', so the admin-only tables (accounts, cap table, legal entities,
--     integrations, policies, billing, departments, logos...) stay closed to them in the database as well.
--   * `memberships.expires_at`: when a collaborator's access ends (null: no end). Only a collaborator's row may carry
--     one. From that moment the row opens nothing: `is_member` and `has_role` leave it out, as the api does.
--
-- Nothing else of the policies changes. `memberships_select` (0066) is over `is_member` and follows it.

alter table memberships drop constraint memberships_role_check;
--> statement-breakpoint
alter table memberships add constraint memberships_role_check check (role in ('owner','admin','member','viewer','advisor','cofounder','collaborator'));
--> statement-breakpoint
alter table memberships add column expires_at timestamptz;
--> statement-breakpoint
alter table memberships add constraint memberships_expires_only_collaborator check (expires_at is null or role = 'collaborator');
--> statement-breakpoint
-- The membership that opens the business to its holder right now: any row of theirs, unless it has ended.
create or replace function is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.business_id = bid and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
  );
$$;
--> statement-breakpoint
-- A cofounder holds 'owner' and a collaborator 'member' for every check; an ended membership holds nothing.
create or replace function has_role(bid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.business_id = bid and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
       and (m.role = any(roles)
            or (m.role = 'cofounder' and 'owner' = any(roles))
            or (m.role = 'collaborator' and 'member' = any(roles)))
  );
$$;
--> statement-breakpoint
-- 0026's guards, with an owner's standing for a cofounder: only an owner or a cofounder inserts, changes or removes a row
-- with an owner's standing, or grants one; admins manage everyone else; nobody changes their own row.
drop policy memberships_insert on memberships;
--> statement-breakpoint
create policy memberships_insert on memberships for insert with check (
  has_role(business_id, array['owner'])
  or (has_role(business_id, array['admin']) and role not in ('owner','cofounder'))
  or (user_id = auth.uid() and role = 'owner' and not business_has_members(business_id))
);
--> statement-breakpoint
drop policy memberships_update on memberships;
--> statement-breakpoint
create policy memberships_update on memberships for update
  using (user_id <> auth.uid() and (has_role(business_id, array['owner']) or (has_role(business_id, array['admin']) and role not in ('owner','cofounder'))))
  with check (user_id <> auth.uid() and (has_role(business_id, array['owner']) or (has_role(business_id, array['admin']) and role not in ('owner','cofounder'))));
--> statement-breakpoint
drop policy memberships_delete on memberships;
--> statement-breakpoint
create policy memberships_delete on memberships for delete using (
  user_id = auth.uid()
  or has_role(business_id, array['owner'])
  or (has_role(business_id, array['admin']) and role not in ('owner','cofounder'))
);
--> statement-breakpoint
-- 0035's trigger: a business keeps at least one person with an owner's standing (an owner or a cofounder), under the
-- same per-business lock.
create or replace function fm_memberships_keep_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role in ('owner','cofounder') then
    perform pg_advisory_xact_lock(hashtext('memberships_owner'), hashtext(old.business_id::text));
    if exists (select 1 from businesses b where b.id = old.business_id)
      and exists (select 1 from auth.users u where u.id = old.user_id)
      and not exists (select 1 from memberships m where m.business_id = old.business_id and m.role in ('owner','cofounder')) then
      raise exception 'A business must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
comment on function fm_memberships_keep_owner() is 'Keeps at least one owner or cofounder per business; serialized per business by pg_advisory_xact_lock(hashtext(''memberships_owner''), hashtext(business_id::text)) (0035, 0090).';
--> statement-breakpoint
-- 0044's view, with the founders' names of cofounders too.
create or replace view public_profiles with (security_barrier) as
  select b.id as business_id, 'business'::text as kind, b.name as display_name, b.slug, b.crest_url, b.archetype,
         b.kit_primary, b.kit_secondary, b.region, b.committed_at, null::uuid as user_id
    from businesses b
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
  union all
  select m.business_id, 'founder'::text, fp.display_name, null, null, null, null, null, null, null, fp.user_id
    from founder_profiles fp
    join memberships m on m.user_id = fp.user_id and m.role in ('owner','cofounder','admin')
    join businesses b on b.id = m.business_id
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
     and fp.visibility = 'public' and fp.archived_at is null;
--> statement-breakpoint
-- 0077's view: the founders' names are the owners' and the cofounders'.
create or replace view public_project_pages with (security_barrier) as
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
                      where m.business_id = b.id and m.role in ('owner','cofounder') and fp.archived_at is null and btrim(fp.display_name) <> ''), '{}'::text[])
         else '{}'::text[] end as founder_names
    from project_pages p
    join businesses b on b.id = p.business_id
   where p.published is not null and b.committed_at is not null and b.archived_at is null and not b.is_demo;
--> statement-breakpoint
-- 0080's view: a person's projects are those they found, as an owner or a cofounder.
create or replace view public_person_profiles with (security_barrier) as
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
                      and exists (select 1 from memberships m where m.business_id = p.business_id and m.user_id = fp.user_id and m.role in ('owner','cofounder'))),
                  '[]'::jsonb) as projects
    from founder_profiles fp
   where fp.public and fp.handle is not null and fp.published_at is not null and fp.archived_at is null;
--> statement-breakpoint
-- 0080's guard: the name a public page shows as a founder's (an owner's or a cofounder's) changes through the app.
create or replace function fm_founder_profiles_public_guard() returns trigger
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
        where m.user_id = new.user_id and m.role in ('owner','cofounder')
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
