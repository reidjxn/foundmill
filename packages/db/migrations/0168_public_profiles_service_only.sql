-- 0168 — public_profiles is the service's (WP-11 T18 step 1; A8-21, a11 S10). Every reader is `repos/social.ts` on the
-- service connection, as for the other public views since the Nov 11 person-profile review (0080, 0081): no client role
-- reads it, and the service role reads it and does nothing else. This supersedes the 2026-10-05 line that left the view
-- readable by anyone.
revoke all on public_profiles from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on public_profiles to service_role;
