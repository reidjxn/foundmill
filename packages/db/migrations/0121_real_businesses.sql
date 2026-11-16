-- 0121 — real_businesses: every project that is not a sample (docs/holistic-plan/WP-11 T9, A8-06). Per-project numbers
-- are scoped by business_id and covered by the cross-tenant suites; the gap was SQL that reads across projects and had
-- to remember `not is_demo` by hand. A query that reads more than one project joins this view (packages/db CLAUDE.md),
-- and is listed in CROSS_BUSINESS_REPORTS (repos/demo-isolation.test.ts), which fails when a sample changes a number.
-- The view carries no column of businesses but `id`, so a column added later never makes it stale. Foundmill's own
-- project (HOUSE_BUSINESS_ID, packages/config showcase.ts) appears with is_house true: some figures count it, the
-- "outside" ones leave it out.
-- security_invoker: the view reads businesses with the caller's rights, so a grant to a client role later could never
-- read past RLS (Supabase advisor lint 0010, security definer view).
create view real_businesses with (security_invoker = true) as
  select b.id, (b.id = 'f0f0f0f0-0000-4000-8000-00000000f00d'::uuid) as is_house from businesses b where not b.is_demo;
--> statement-breakpoint
revoke all on real_businesses from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on real_businesses to service_role;
--> statement-breakpoint
comment on view real_businesses is 'Every project that is not a sample; is_house marks Foundmill''s own. A query that reads more than one project joins this.';
