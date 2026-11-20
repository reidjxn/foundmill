-- 0143 — when a project page's published copy last changed (WP-08 T7; audit s3 §3.1). `published_at` keeps the
-- day the page first went live ("Live since" does not move on a republish) and `updated_at` moves on every draft save,
-- so neither is the page's `dateModified` or its sitemap `lastmod`. `content_published_at` is set on each publish whose
-- copy differs from what was public; backfilled to `published_at`.
--
-- For a client role the database writes it, like the two dates of 0090 (the guard below, 0090's with one rule added).
-- `public_project_pages` (0092's view) gains the column at its end. RLS unchanged.
alter table project_pages add column content_published_at timestamptz;
--> statement-breakpoint
update project_pages set content_published_at = published_at where published is not null;
--> statement-breakpoint
create or replace function fm_project_pages_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  app_role boolean := current_user in ('authenticated', 'anon');
  goes_public boolean;
  stamp timestamptz := date_trunc('milliseconds', now());
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
  -- The two dates are the database's to write for a client role (the table above).
  if app_role then
    if tg_op = 'INSERT' then
      new.published_at := case when new.published is not null then stamp end;
      new.unpublished_at := null;
    elsif old.published is null and new.published is not null then
      new.published_at := stamp;
      new.unpublished_at := null;
    elsif old.published is not null and new.published is null then
      new.published_at := old.published_at;
      new.unpublished_at := stamp;
    else
      new.published_at := old.published_at;
      new.unpublished_at := old.unpublished_at;
    end if;
    -- 0143: when the published copy last changed (dateModified, the sitemap's lastmod), the database's clock too.
    if new.published is not null and (tg_op = 'INSERT' or new.published is distinct from old.published) then
      new.content_published_at := stamp;
    elsif tg_op = 'INSERT' then
      new.content_published_at := null;
    else
      new.content_published_at := old.content_published_at;
    end if;
  end if;
  if new.published is not null and exists (select 1 from businesses b where b.id = new.business_id and b.is_demo) then
    raise exception 'A sample business has no public page' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
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
         else '{}'::text[] end as founder_names,
         p.content_published_at
    from project_pages p
    join businesses b on b.id = p.business_id
   where p.published is not null and b.committed_at is not null and b.archived_at is null and not b.is_demo;
