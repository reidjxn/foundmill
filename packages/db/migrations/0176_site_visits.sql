-- 0176 — visits to a project's Foundmill Site counted too (founder, Nov 25, 2026: "Yes I want it, they should be
-- counted"). The same daily counts as the public page (0175), told apart by `surface`.
--
-- page_visit_days.surface   'page' for `/p/<slug>` (the web's beacon, through the api), 'site' for `<slug>.<SITES_DOMAIN>`
--                           (apps/sites). The key becomes (business, day, surface, source).
--
-- site_visit(label, source)  apps/sites' one write: one visit for today (UTC) to the live site whose slug is `label`,
--                           in the bucket `source`. As narrow as it can be: it returns nothing, takes no business id,
--                           counts only a live site of a real project (never a preview, a taken-down site or a sample),
--                           refuses a source outside the list by counting nothing, and can only add one. Executable by
--                           `sites_reader` and the service role; nobody else. Nothing about the visitor reaches it.
alter table page_visit_days add column surface text not null default 'page' check (surface in ('page', 'site'));
--> statement-breakpoint
alter table page_visit_days drop constraint page_visit_days_business_id_day_source_key;
--> statement-breakpoint
alter table page_visit_days add constraint page_visit_days_business_id_day_surface_source_key unique (business_id, day, surface, source);
--> statement-breakpoint
create function site_visit(label text, source text) returns void
language sql volatile security definer set search_path = pg_catalog, public, pg_temp as $$
  insert into page_visit_days (business_id, day, surface, source, visits)
  select s.business_id, (now() at time zone 'utc')::date, 'site', site_visit.source, 1
    from sites s
    join real_businesses rb on rb.id = s.business_id
    join site_releases lr on lr.id = s.live_release_id and lr.state = 'preview'
   where lower(site_visit.label) !~ '^p-[0-9a-f]{32}$'
     and s.slug = lower(site_visit.label)
     and s.status = 'live'
     and site_visit.source in ('direct', 'post', 'foundmill', 'search', 'ai', 'social', 'email', 'paid', 'referral', 'other')
  on conflict (business_id, day, surface, source) do update set visits = page_visit_days.visits + 1, updated_at = now()
$$;
--> statement-breakpoint
revoke execute on function site_visit(text, text) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function site_visit(text, text) to service_role, sites_reader;
