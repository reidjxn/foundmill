-- 0056 — LIVE social: column grants (audit follow-up FU-S-1, 2026-10-14). 0012 granted the client roles SELECT on
-- whole rows of `message_threads` and `posts`, and 0027 then added columns the app deliberately keeps from the people
-- who can read the row. Through Supabase's Data API (PostgREST with a user's own token) a participant could read every
-- participant's `muted_ids`, and any community member, an author included, could read a post's `screening` verdict,
-- the `moderated_by` moderator and the `moderation_note`. The api hides all four (routers/live.ts threadView and
-- postView); a row policy cannot hide a column, so the client roles lose SELECT on those columns here.
--
-- How. Table-level SELECT is revoked from `authenticated` and `anon`, then SELECT is granted again column by column on
-- everything the api shows. `service_role` and the owner connection (the api, orchestrator and workers on
-- DATABASE_URL) keep their table-level grants, so the api's reads are unchanged. A query by a client role that names a
-- hidden column, or reads `*`, fails with "permission denied for table"; it must list the columns it needs. Row
-- policies (participants; members, authors and moderators) are untouched, and none of them reads a hidden column.
--
-- A column added to either table later is NOT readable by the client roles until a migration grants it (column
-- privileges are never inherited from the table defaults): the db test "client roles read the visible columns of
-- message_threads and posts only" lists every column and fails until the new one is placed on one side or the other.
revoke select on message_threads from authenticated, anon;
--> statement-breakpoint
grant select (id, participant_ids, kind, left_ids, subject, last_message_at, archived_at, created_at, updated_at) on message_threads to authenticated;
--> statement-breakpoint
revoke select on posts from authenticated, anon;
--> statement-breakpoint
grant select (id, community_id, author_user_id, business_id, parent_post_id, body_md, entity_ids, status, edited_at, moderated_at, archived_at, created_at, updated_at) on posts to authenticated;
