-- 0091 — who counts as a person from before open sign-up, and a cofounder invitation is always to an address
-- (security review of the invitations change, 2026-11-13). It follows 0090.
--
-- `admission_existing_before()`: the moment this migration ran, stored in the database as a function's constant. Under
-- open sign-up (SIGNUP_OPEN) an account is admitted without counting toward the day's ceiling as a person from before
-- (`account_admissions.how = 'existing'`) only when its founder profile was created before this moment
-- (apps/api services/access.ts). Before 0091 any profile counted, so an account made today could save a profile and
-- skip the ceiling. SIGNUP_EXISTING_BEFORE (an ISO timestamp) overrides it where an operator wants another cutover.
-- Executable by the service role only: no client role needs it.
--
-- `invitations_cofounder_email`: a cofounder invitation names the address it is for (the api accepts it only for the
-- account signed in with that confirmed address). NOT VALID: it holds for every row written from now on; a link-only
-- cofounder invitation made before 0091 is refused by the api instead (services/invitations.ts `workingInvitation`).

do $$
begin
  execute format(
    'create function admission_existing_before() returns timestamptz language sql immutable parallel safe as %L',
    format('select %L::timestamptz', now())
  );
end;
$$;
--> statement-breakpoint
comment on function admission_existing_before() is 'The moment 0091 ran: under open sign-up a founder profile created before it is a person from before (account_admissions.how = existing). SIGNUP_EXISTING_BEFORE overrides it in apps/api.';
--> statement-breakpoint
revoke all on function admission_existing_before() from public, anon, authenticated;
--> statement-breakpoint
grant execute on function admission_existing_before() to service_role;
--> statement-breakpoint
alter table invitations add constraint invitations_cofounder_email check (role <> 'cofounder' or email is not null) not valid;
