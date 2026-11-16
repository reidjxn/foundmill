---
date: 2026-11-15
branch: claude/wp03-t2-waitlist-admits
title: A waitlist that admits and emails (WP-03 T2)
areas: [db, gateway, orchestrator, shared, events, api, web, docs]
supersedes: []
---
## What changed
- Migration 0111 adds `waitlist_entries.notified_at` and two partial indexes for the sweep. RLS unchanged (services
  only); `rls/idea-drafts.test.ts` now reads the new columns as a client and fails if any policy appears.
- `repos.waitlist`: `admitNext` (oldest sign-up first, accounts only, `for update skip locked`, admission recorded as
  `open`), `admittedSince`, `toNotify`, `forEmail` and `markNotified`. The order is one fragment, `WAITLIST_ORDER`.
- Gateway: `ACCOUNT_EMAIL_KINDS` (`waitlist_admitted`, and `continue_link` declared for T3) and
  `notify-account-email.ts` on `POST /v1/notify/email`, the orchestrator only. Words: `waitlistAdmittedEmail`.
- Orchestrator: `WAITLIST_ADMIT_PER_DAY` (unset means 0), the `waitlistSweep` activity, the `waitlistAdmissions`
  workflow and the `waitlist-admissions` schedule (every 15 minutes); `GatewayClient.accountEmail`.
- The waitlist's saved line promises the email, to the address that signed in, only where it is sent (see "Merged
  with T1" below); elsewhere it keeps T1's "Come back to check; we cannot email you yet."
- docs/DEPLOY.md §4 "Admit people from the waitlist" and a production-record row; ARCHITECTURE §4, §9, §10.

## Merged with T1 (Nov 16)
- T1 (#194) merged into main first. Conflicts in `NotInvitedPage.tsx` and `api-error-page.test.tsx` were resolved
  on T1's structure: the join runs once on arrival, the page works from 390 px, "Save my place" only retries a failed
  join, and `WaitlistJoin` is exported and also rendered on the ceiling's page (`OnWaitlistPage`). T2 adds the email
  lines beside T1's: `WAITLIST_WORDS.joinedEmail` / `joinedWithCardEmail`, picked by `waitlistJoinedLine`. T2's old
  tests (pressing "Join the waitlist") gave way to T1's; the email lines have tests of their own.
- The promise is conditional, because the recorded decision "the waitlist line promises no email until the waitlist
  that sends it exists" (2026-11-13) still holds in production: platform mail is not live (WP-00 S1/S2) and
  `WAITLIST_ADMIT_PER_DAY` is 0. The api decides: `waitlistEmails(env)` (@foundmill/shared env.ts) is true only with
  `WAITLIST_EMAILS` on **and** `platformMailLive(env)`. `refusalFor` puts it on the `not_listed` and `ceiling`
  refusals as `details.waitlistEmails`; the web reads it (`lib/trpc.ts` `waitlistEmails`, false when absent) and
  `ApiErrorPage` passes it as `emails` to both pages, the way it already passes `reason`.
- Why an api flag and not platform mail alone: the email is sent by the orchestrator's sweep, which the api cannot
  see (it may not be deployed, and the api does not read `WAITLIST_ADMIT_PER_DAY`). Live mail alone would promise an
  email from a sweep that may not run. Why not the flag alone: a flag set before S1/S2 would promise mail that cannot
  go out, so live platform mail is required too. Documented in docs/DEPLOY.md §4 and the production-record row (the
  Desktop session sets it with `WAITLIST_ADMIT_PER_DAY`, after S1 and S2) and in .env.example.
- `ON_WAITLIST_WORDS` (the ceiling card's body) still promises nothing; the plan's T2 row for it is not applied, since
  it is the api's `ON_WAITLIST_MESSAGE` too and would need the same switch. The saved line under the card carries the
  conditional promise instead. The plan's check "`cannot email you yet` prints nothing" no longer applies: that line is
  the off state. The `ON_WAITLIST_EMAIL_PROMISE` comment in allowlist.ts was stale after T1 and now says this.
- `not-invited.spec.ts` also asserts no "We email" on its stack (SendGrid on its mock, so off even with the flag).
- Migration 0111 is still free on main (main ends at 0110).

## Decisions
- Migration 0111: no open branch had a migration past 0110 when the branch was cut (checked every remote branch).
- `account.admitted` (WP-02 T9's event, its own idempotency key) is written in `admitNext`'s transaction for each new
  admission, so the funnel counts the day a person was let in; the profile step then writes nothing for them. A
  hand admission still gets it from the profile step. No event of this change's own.
- An entry whose account already had an admission gets `admitted_at`, no second row, and no event; it still uses one
  of the day's places. The day's hand admissions count toward the number too (`admittedSince` reads `admitted_at`).
- The email says "Your place is open." where the plan said "opened today": a send held back by a limit goes out on a
  later day, and the sweep retries for 7 days.
- The kept card is named only while it is still kept (live, or claimed by the same person). The gateway reads the
  card itself (`forEmail`), so `toNotify` returns ids only (smaller than the plan).
- The sweep retries `per_address` and `simulated` as well as the notifier's `RETRY_REASONS`, so a mock gateway on
  staging or production never marks anyone told.
- `WAITLIST_ADMIT_PER_DAY` lives in `apps/orchestrator/src/env.ts`, where the orchestrator's own knobs are parsed,
  not in packages/shared env.ts as the plan said.
- `waitlistAdmittedEmail` is in `people-email.ts` beside `invitationEmail`, whose `render` it uses.
- The account email gets no audit row (there is no project) and goes to the nil business on the mock connector.

## Not done
- `ON_WAITLIST_WORDS` and `ON_WAITLIST_EMAIL_PROMISE` stay (see "Merged with T1"). `IDEA_BOX_WORDS.keepLead` is left to T1, which rewrites it first.
- Switched on in production only after WP-00 S1 and S2 (the Desktop session sets `WAITLIST_ADMIT_PER_DAY` on the
  orchestrator and `WAITLIST_EMAILS=1` on the api).
- The row lock needs a real-Postgres run; PGlite runs the two sweeps one after the other.
