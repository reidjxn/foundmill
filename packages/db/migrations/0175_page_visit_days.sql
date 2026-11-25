-- 0175 — visits to a project's public page, counted by Foundmill (founder, Nov 25, 2026: free on every plan, so the team
-- has page numbers without PostHog; packages/shared `page-visits.ts`).
--
-- One row per business, day (UTC) and source, holding a count. Nothing names a visitor: no address, no device, no
-- referrer, no cookie value; the source is one of a fixed list of buckets. The api's beacon route writes it on the
-- service connection with one upsert per visit (apps/api services/page-visits.ts), after leaving out the project's own
-- members; the browser leaves out automated ones. A sample business has no public page, so it never gets a row.
--
-- page_visit_days   read by every member of the business (the default tenant policy). Written by the service
--                   connection only: a client role holds no insert, update or delete, so nobody in a project can type a
--                   count in by hand.
create table page_visit_days (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  day date not null,
  source text not null check (source in ('direct', 'post', 'foundmill', 'search', 'ai', 'social', 'email', 'paid', 'referral', 'other')),
  visits integer not null default 0 check (visits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, day, source)
);
--> statement-breakpoint
select fm_tenant_table('page_visit_days', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on page_visit_days from anon, authenticated;
