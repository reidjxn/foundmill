-- 0081 — the public page view is the api's to read (security review, Nov 11, 2026). 0077 granted `public_project_pages`
-- to anon and authenticated, so anyone holding the public anon key could list every published page at once straight
-- through PostgREST, past the api's per-address and per-caller limits. Every reader of the view is the api on the
-- service connection (`publicPage.bySlug`, the Follow form's target lookup, a person profile's project list, and the
-- view `public_person_profiles`, which reads it as its owner), so the client roles lose it.
revoke all on public_project_pages from public, anon, authenticated;
--> statement-breakpoint
grant select on public_project_pages to service_role;
