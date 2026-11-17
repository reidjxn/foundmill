-- 0131 — Pay buttons (WP-07 T7): a project's payment links. A founder pastes a link made in their own Stripe account
-- (`source = 'pasted'`); T8 lets the finance lead make one (`source = 'stripe'`). Business-level, not site-level, so the
-- project page's button (WP-08) reads the same rows.
--
-- Who may do what:
--   read    members of the business (the links are what the site shows publicly)
--   write   the services; and an owner or an admin, narrowly (it is the founder's own link): they may add a pasted link
--           (`pay_links_insert`: never `simulated`, `source = 'stripe'`, `provider_link_id` or an archived row) and archive one (`pay_links_archive`, only `archived_at` from null to a time). No app role
--           changes a link's URL or key or deletes a row: where a button sends people never changes silently.
--
-- A site's HTML never holds the payment URL: its button is `/_fm/pay/<key>`, which apps/sites resolves through
-- `site_pay_link`, so a release cannot swap where a payment goes. A simulated link (a mock connector's) is never
-- returned, so it never reaches a visitor.
create table pay_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  key text not null constraint pay_links_key_format check (key ~ '^[a-z0-9-]{2,40}$'),
  label text not null constraint pay_links_label_length check (char_length(label) between 1 and 80),
  price_minor bigint constraint pay_links_price_minor_check check (price_minor is null or price_minor >= 0),
  currency char(3) constraint pay_links_currency_format check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- https on an allowed host only (`payLinkUrlProblem` in packages/shared; the check is the last word).
  url text not null constraint pay_links_url_format check (char_length(url) <= 500 and url ~ '^https://buy\.stripe\.com/[A-Za-z0-9_/-]+$'),
  source text not null constraint pay_links_source_check check (source in ('pasted', 'stripe')),
  provider_link_id text,
  simulated boolean not null default false,
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pay_links_key_unique unique (business_id, key)
);
--> statement-breakpoint
select fm_tenant_table('pay_links', array['owner','admin'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on pay_links from anon, authenticated;
--> statement-breakpoint
create policy pay_links_insert on pay_links for insert
  with check (has_role(business_id, array['owner','admin']) and source = 'pasted' and not simulated and provider_link_id is null and archived_at is null);
--> statement-breakpoint
-- (A table grant: an insert lists every column, with DEFAULT for those it leaves; the policy above holds the values.)
grant insert on pay_links to authenticated;
--> statement-breakpoint
create policy pay_links_archive on pay_links for update
  using (has_role(business_id, array['owner','admin']) and archived_at is null)
  with check (has_role(business_id, array['owner','admin']) and archived_at is not null);
--> statement-breakpoint
grant update (archived_at, updated_at) on pay_links to authenticated;
--> statement-breakpoint
-- The payment URL behind a site's `/_fm/pay/<key>`: a link of the business whose live site has that slug, or of the
-- site of one of its newest 3 previews (so the founder can try the button before publishing). Never an archived or a
-- simulated link, never a taken-down site's. Null otherwise.
create function site_pay_link(label text, key text) returns text
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select p.url
    from pay_links p
   where p.key = site_pay_link.key and p.archived_at is null and not p.simulated
     and p.business_id = (
       select s.business_id from sites s
        where lower(site_pay_link.label) !~ '^p-[0-9a-f]{32}$' and s.slug = lower(site_pay_link.label) and s.status = 'live'
          and exists (select 1 from site_releases lr where lr.id = s.live_release_id and lr.state = 'preview')
       union all
       select s.business_id from site_releases r join sites s on s.id = r.site_id
        where lower(site_pay_link.label) ~ '^p-[0-9a-f]{32}$'
          and r.preview_token = substr(lower(site_pay_link.label), 3) and r.state = 'preview' and s.status <> 'taken_down'
          and r.id in (select r2.id from site_releases r2 where r2.site_id = r.site_id and r2.state = 'preview' order by r2.number desc limit 3)
       limit 1)
   limit 1
$$;
--> statement-breakpoint
revoke execute on function site_pay_link(text, text) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function site_pay_link(text, text) to service_role, sites_reader;
