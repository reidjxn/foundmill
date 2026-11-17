-- The funnel's four account facts (WP-02 T9): `account.admitted`, `profile.created`, `idea.kept` and `idea.drafted`
-- join the account-scoped event types, so they are written to `account_events` and never to a project's `events`.
-- The whole list is redefined (as 0085, 0088 and 0097 did); nothing else changes.
create or replace function fm_account_event_types() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['profile.published', 'profile.unpublished', 'signup.attributed', 'referral.arrived', 'founder_notice.sent', 'account.admitted', 'profile.created', 'idea.kept', 'idea.drafted']::text[]
$$;
--> statement-breakpoint
-- As 0088 and 0097 did: no writer ever produced these types in `events`; a row a member planted under one of the names
-- through RLS goes, so every row of `events` satisfies the scope check as it now reads.
delete from events where type in ('account.admitted', 'profile.created', 'idea.kept', 'idea.drafted');
