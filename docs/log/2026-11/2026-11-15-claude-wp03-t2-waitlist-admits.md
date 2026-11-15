---
date: 2026-11-15
branch: claude/wp03-t2-waitlist-admits
title: A waitlist that admits and emails (WP-03 T2)
areas: [db, gateway, orchestrator, shared, events, web, docs]
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
- The invite-only page's joined lines now promise the email, to the address that signed in.
- docs/DEPLOY.md §4 "Admit people from the waitlist" and a production-record row; ARCHITECTURE §4, §9, §10.

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
- `ON_WAITLIST_WORDS` and `ON_WAITLIST_EMAIL_PROMISE` stay: the ceiling's page stores nobody until T1 step 3, so
  promising an email there would be false. `IDEA_BOX_WORDS.keepLead` is left to T1, which rewrites it first.
- Switched on in production only after WP-00 S1 and S2 (the Desktop session sets `WAITLIST_ADMIT_PER_DAY`).
- The row lock needs a real-Postgres run; PGlite runs the two sweeps one after the other.
