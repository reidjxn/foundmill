-- 0122 — public_profiles is the service's alone (docs/holistic-plan/WP-11 T18 step 1, A8-21). Every reader is
-- repos/social.ts on the service connection; the client roles had select. This follows the rule of the Nov 11
-- person-profile review (public views are read by the service, which decides what a visitor sees) and supersedes the
-- 2026-10-05 line that left this view readable by anyone.
revoke all on public_profiles from public, anon, authenticated;
--> statement-breakpoint
grant select on public_profiles to service_role;
