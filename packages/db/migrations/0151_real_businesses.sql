-- 0151 — real_businesses: every project that is not a sample (docs/holistic-plan/WP-11 T9, A8-06). A query that reads
-- more than one project joins this view instead of remembering `not is_demo` by hand. `is_house` marks Foundmill's own
-- project (HOUSE_BUSINESS_ID, packages/config/src/showcase.ts) for the figures that count it and the ones that leave it
-- out. The view carries `id` and nothing else of `businesses`, so a column added later never makes it stale. Service
-- role only, like the reports that read it.
create view real_businesses as
  select b.id, (b.id = 'f0f0f0f0-0000-4000-8000-00000000f00d'::uuid) as is_house from businesses b where not b.is_demo;
--> statement-breakpoint
revoke all on real_businesses from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on real_businesses to service_role;
--> statement-breakpoint
comment on view real_businesses is 'Every project that is not a sample; is_house marks Foundmill''s own. A query that reads more than one project joins this.';
